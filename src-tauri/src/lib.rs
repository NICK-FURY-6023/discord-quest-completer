// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use once_cell::sync::OnceCell;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{path::BaseDirectory, AppHandle, Emitter, Listener, Manager};

mod rpc;
mod runner;

// Global static instance of the Discord client
static DISCORD_CLIENT: OnceCell<Mutex<Option<rpc::Client>>> = OnceCell::new();

fn get_discord_client() -> &'static Mutex<Option<rpc::Client>> {
    DISCORD_CLIENT.get_or_init(|| Mutex::new(None))
}

fn runner_resource_name() -> &'static str {
    #[cfg(target_os = "windows")]
    let runner_name = "data/src-win.exe";

    #[cfg(target_os = "linux")]
    let runner_name = "data/src-linux";

    #[cfg(target_os = "macos")]
    let runner_name = "data/src-darwin";

    runner_name
}

fn is_app_bundle(executable_name: &str) -> bool {
    cfg!(target_os = "macos") && executable_name.ends_with(".app")
}

fn bundle_binary_name(app_name: &str) -> String {
    app_name
        .strip_suffix(".app")
        .unwrap_or(app_name)
        .to_string()
}

fn game_folder_path(exe_dir: &Path, path: &str, app_id: i64) -> PathBuf {
    let normalized_path = Path::new(path).to_string_lossy().to_string();

    exe_dir
        .join("games")
        .join(app_id.to_string())
        .join(normalized_path)
}

fn resolve_runner_template(handle: &AppHandle) -> Result<PathBuf, String> {
    handle
        .path()
        .resolve(runner_resource_name(), BaseDirectory::Resource)
        .map_err(|e| format!("Failed to resolve runner template: {}", e))
}

fn make_macos_app_bundle(
    app_bundle_path: &Path,
    app_name: &str,
    display_name: &str,
    runner_template: &Path,
) -> Result<PathBuf, String> {
    let binary_name = bundle_binary_name(app_name);
    let macos_dir = app_bundle_path.join("Contents/MacOS");
    fs::create_dir_all(&macos_dir)
        .map_err(|e| format!("Failed to create app bundle directories: {}", e))?;

    let target_executable_path = macos_dir.join(&binary_name);
    fs::copy(runner_template, &target_executable_path)
        .map_err(|e| format!("Failed to copy dummy executable: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&target_executable_path)
            .map_err(|e| format!("Failed to read executable permissions: {}", e))?
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&target_executable_path, permissions)
            .map_err(|e| format!("Failed to set executable permissions: {}", e))?;
    }

    let info_plist = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDisplayName</key>
    <string>{display_name}</string>
    <key>CFBundleExecutable</key>
    <string>{binary_name}</string>
    <key>CFBundleIdentifier</key>
    <string>me.markterence.discordquestcompleter.dummy</string>
    <key>CFBundleName</key>
    <string>{display_name}</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
</dict>
</plist>
"#
    );

    fs::write(app_bundle_path.join("Contents/Info.plist"), info_plist)
        .map_err(|e| format!("Failed to write Info.plist: {}", e))?;

    Ok(target_executable_path)
}

fn launch_executable_path(game_folder_path: &Path, executable_name: &str) -> PathBuf {
    if is_app_bundle(executable_name) {
        game_folder_path
            .join(executable_name)
            .join("Contents/MacOS")
            .join(bundle_binary_name(executable_name))
    } else {
        game_folder_path.join(executable_name)
    }
}

fn stop_process_name(exec_name: &str) -> String {
    if is_app_bundle(exec_name) {
        bundle_binary_name(exec_name)
    } else {
        exec_name.to_string()
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command(rename_all = "snake_case")]
async fn create_fake_game(
    handle: tauri::AppHandle,
    path: &str,
    executable_name: &str,
    path_len: i64,
    app_id: i64,
    display_name: Option<String>,
) -> Result<String, String> {
    // Must create in the same directory as the executable to avoid permission issues
    // Get the executable directory to look for config file
    let exe_path: std::path::PathBuf = env::current_exe().unwrap_or_default();
    let exe_dir = exe_path.parent().unwrap_or_else(|| Path::new(""));

    let game_folder_path = game_folder_path(exe_dir, path, app_id);

    println!("Game folder path: {:?}", game_folder_path);
    println!(
        "Game full path: {:?}",
        game_folder_path.join(executable_name)
    );

    match fs::create_dir_all(&game_folder_path) {
        Ok(_) => {
            println!("Successfully created directory: {:?}", game_folder_path);
        }
        Err(e) => return Err(format!("Failed to create game folder: {}", e)),
    };

    let resource_path = resolve_runner_template(&handle)?;
    println!("Creating dummy game executable from: {:?}", resource_path);

    if is_app_bundle(executable_name) {
        let app_bundle_path = game_folder_path.join(executable_name);
        let bundle_display_name = display_name
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| bundle_binary_name(executable_name));
        let target_executable_path = make_macos_app_bundle(
            &app_bundle_path,
            executable_name,
            &bundle_display_name,
            &resource_path,
        )?;
        return Ok(format!(
            "Dummy app bundle created at: {:?}",
            target_executable_path
        ));
    }

    let target_executable_path = game_folder_path.join(executable_name);
    match fs::copy(&resource_path, &target_executable_path) {
        Ok(_) => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut perms = std::fs::metadata(&target_executable_path)
                    .map_err(|e| format!("Failed to get file metadata: {}", e))?
                    .permissions();
                perms.set_mode(0o755);
                std::fs::set_permissions(&target_executable_path, perms)
                    .map_err(|e| format!("Failed to set executable permissions: {}", e))?;
            }

            Ok(format!(
                "Dummy executable copied to: {:?}",
                target_executable_path
            ))
        }
        Err(e) => {
            // A dummy instance from an earlier Play can still hold the file (Windows
            // locks a running exe). The file on disk is already the runner, so reuse
            // it instead of failing the launch with "file is being used".
            if target_executable_path.exists() {
                Ok(format!(
                    "Reusing existing dummy executable: {:?} ({})",
                    target_executable_path, e
                ))
            } else {
                Err(format!("Failed to copy dummy executable: {}", e))
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn launch_macos_app_bundle(app_bundle_path: &Path, title: &str) -> Result<(), String> {
    let mut command = std::process::Command::new("open");
    command
        .arg("-n")
        .arg("-g")
        .arg("-a")
        .arg(app_bundle_path)
        .arg("--args")
        .arg("--title")
        .arg(title);

    command
        .spawn()
        .map_err(|e| format!("Failed to launch app bundle with open: {}", e))?;

    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
async fn run_background_process(
    name: &str,
    path: &str,
    executable_name: &str,
    path_len: i64,
    app_id: i64,
) -> Result<String, String> {
    let exe_path = env::current_exe().unwrap_or_default();
    let exe_dir = exe_path.parent().unwrap_or_else(|| Path::new(""));

    let game_folder_path = game_folder_path(exe_dir, path, app_id);

    if is_app_bundle(executable_name) {
        #[cfg(target_os = "macos")]
        {
            let bundle_path = game_folder_path.join(executable_name);
            launch_macos_app_bundle(&bundle_path, name)?;
            return Ok("App bundle launched successfully".to_string());
        }

        #[cfg(not(target_os = "macos"))]
        {
            let _ = name;
            return Err("App bundle launches are only supported on macOS".to_string());
        }
    }

    let executable_path = launch_executable_path(&game_folder_path, executable_name);
    
    let mut cmd = std::process::Command::new(&executable_path);
    cmd.args(["--title", name])
       .current_dir(game_folder_path);
    
    // Platform-specific process spawning
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0); // Create new process group on Unix
    }
    
    match cmd.spawn() {
        Ok(_) => Ok("Process started successfully".to_string()),
        Err(e) => Err(format!("Failed to start process: {}", e)),
    }
}

#[tauri::command(rename_all = "snake_case")]
async fn stop_process(exec_name: String) -> Result<(), String> {
    let process_name = stop_process_name(&exec_name);

    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("taskkill")
            .arg("/F")
            .arg("/IM")
            .arg(&process_name)
            .output()
            .map_err(|e| format!("Failed to execute taskkill: {}", e))?;

        if output.status.success() {
            Ok(())
        } else {
            Err(format!(
                "Failed to stop process: {}",
                String::from_utf8_lossy(&output.stderr)
            ))
        }
    }

    #[cfg(target_os = "macos")]
    {
        if is_app_bundle(&exec_name) {
            let bundle_pattern = format!("{}/Contents/MacOS", exec_name);
            let output = std::process::Command::new("pkill")
                .arg("-f")
                .arg(&bundle_pattern)
                .output()
                .map_err(|e| format!("Failed to execute pkill: {}", e))?;

            if output.status.success() {
                return Ok(());
            }
        }

        let output = std::process::Command::new("pkill")
            .arg("-x")
            .arg(&process_name)
            .output()
            .map_err(|e| format!("Failed to execute pkill: {}", e))?;

        if output.status.success() || output.status.code() == Some(1) {
            Ok(())
        } else {
            Err(format!(
                "Failed to stop process: {}",
                String::from_utf8_lossy(&output.stderr)
            ))
        }
    }
    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("pkill")
            .arg("-f")
            .arg(&exec_name)
            .output()
            .map_err(|e| format!("Failed to execute pkill: {}", e))?;

        if output.status.success() || output.status.code() == Some(1) {
            // pkill returns 1 if no processes were killed, which is fine
            Ok(())
        } else {
            Err(format!(
                "Failed to stop process: {}",
                String::from_utf8_lossy(&output.stderr)
            ))
        }
    }
}

/// Connects to (or disconnects from) Discord's local RPC socket and sets the activity.
/// Returns an error instead of panicking, so the UI can tell the user why a game
/// could not be shown through Rich Presence.
///
/// Calling from JS:
/// ```javascript
/// await invoke('connect_to_discord_rpc_3', { activity_json, action: 'connect' | 'disconnect' });
#[tauri::command(rename_all = "snake_case")]
async fn connect_to_discord_rpc_3(
    handle: AppHandle,
    activity_json: String,
    action: String,
) -> Result<(), String> {
    if action == "disconnect" {
        let client = {
            let mut guard = get_discord_client().lock().unwrap();
            guard.take()
        };
        if let Some(client) = client {
            client.discord.disconnect().await;
        }
        return Ok(());
    }

    let activity = runner::parse_activity_json(&activity_json)?;

    // Replace any previous connection instead of leaking it.
    {
        let mut guard = get_discord_client().lock().unwrap();
        guard.take();
    }

    let _ = handle.emit(
        "client_connecting",
        serde_json::json!({ "app_id": activity.app_id }),
    );

    let client = runner::set_activity(activity_json)
        .await
        .map_err(|e| format!("Discord RPC connection failed: {}", e))?;

    {
        let mut guard = get_discord_client().lock().unwrap();
        *guard = Some(client);
    }

    let _ = handle.emit(
        "client_connected",
        serde_json::json!({ "app_id": activity.app_id }),
    );

    Ok(())
}

const GAMELIST_GH_MIRROR_URL: &str =
    "https://markterence.github.io/discord-quest-completer/detectable.json";
const GAMELIST_DISCORD_URL: &str = "https://discord.com/api/applications/detectable";

/// Fetches a JSON game list and returns the raw body to the frontend.
/// Bounded by a timeout so a slow/unreachable host can never block the UI forever,
/// and returns an `Err` instead of panicking on network failures.
async fn fetch_game_list_response(url: &str) -> Result<tauri::ipc::Response, String> {
    let client = tauri_plugin_http::reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Request to {} failed: {}", url, e))?;

    if !res.status().is_success() {
        return Err(format!("{} returned HTTP {}", url, res.status()));
    }

    let body = res
        .text()
        .await
        .map_err(|e| format!("Failed to read response from {}: {}", url, e))?;

    Ok(tauri::ipc::Response::new(body))
}

#[tauri::command(rename_all = "snake_case")]
async fn fetch_gamelist_gh_mirror() -> Result<tauri::ipc::Response, String> {
    fetch_game_list_response(GAMELIST_GH_MIRROR_URL).await
}

#[tauri::command(rename_all = "snake_case")]
async fn fetch_gamelist_from_discord() -> Result<tauri::ipc::Response, String> {
    fetch_game_list_response(GAMELIST_DISCORD_URL).await
}

fn gamelist_cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;

    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create app data directory: {}", e))?;

    Ok(dir.join("gamelist.cache.json"))
}

/// Returns the last successfully fetched game list, so the app works offline
/// and never has to wait for the network before searching.
#[tauri::command(rename_all = "snake_case")]
fn read_gamelist_cache(app: AppHandle) -> Result<String, String> {
    let path = gamelist_cache_path(&app)?;
    fs::read_to_string(&path).map_err(|e| format!("Failed to read game list cache: {}", e))
}

#[tauri::command(rename_all = "snake_case")]
fn write_gamelist_cache(app: AppHandle, data: String) -> Result<(), String> {
    let path = gamelist_cache_path(&app)?;
    fs::write(&path, data).map_err(|e| format!("Failed to write game list cache: {}", e))
}


#[tauri::command(rename_all = "snake_case")]
fn clear_gamelist_cache(app: AppHandle) -> Result<(), String> {
    let path = gamelist_cache_path(&app)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Failed to clear the game list cache: {}", e)),
    }
}

/// Discord does not expose its quest list or quest progress to other apps. The only
/// local trace is whatever the desktop client writes to its log files, which differs
/// between Discord builds. This scan is therefore best effort: it returns what it
/// found, or a reason why there was nothing to find.
#[derive(serde::Serialize)]
struct DiscordQuestEntry {
    name: String,
    progress: Option<f64>,
}

#[derive(serde::Serialize)]
struct DiscordQuestScan {
    available: bool,
    reason: String,
    quests: Vec<DiscordQuestEntry>,
}

fn discord_log_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "windows")]
    if let Some(roaming) = env::var_os("APPDATA") {
        let base = PathBuf::from(roaming);
        dirs.push(base.join("discord").join("logs"));
        dirs.push(base.join("Discord").join("logs"));
    }

    #[cfg(target_os = "macos")]
    if let Some(home) = env::var_os("HOME") {
        dirs.push(
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
                .join("discord")
                .join("logs"),
        );
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(config) = env::var_os("XDG_CONFIG_HOME") {
            dirs.push(PathBuf::from(config).join("discord").join("logs"));
        } else if let Some(home) = env::var_os("HOME") {
            dirs.push(PathBuf::from(home).join(".config").join("discord").join("logs"));
        }
    }

    dirs
}

fn json_string_field(line: &str, keys: &[&str]) -> Option<String> {
    for key in keys {
        let needle = format!("\"{}\"", key);
        if let Some(start) = line.find(&needle) {
            let rest = &line[start + needle.len()..];
            let rest = rest.trim_start();
            let rest = rest.strip_prefix(':')?.trim_start();
            let rest = rest.strip_prefix('"')?;
            let end = rest.find('"')?;
            let value = rest[..end].trim();
            if !value.is_empty() && value.len() < 120 {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn json_number_field(line: &str, keys: &[&str]) -> Option<f64> {
    for key in keys {
        let needle = format!("\"{}\"", key);
        if let Some(start) = line.find(&needle) {
            let rest = &line[start + needle.len()..];
            let rest = rest.trim_start().strip_prefix(':')?.trim_start();
            let digits: String = rest
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            if let Ok(value) = digits.parse::<f64>() {
                return Some(value);
            }
        }
    }
    None
}

#[tauri::command(rename_all = "snake_case")]
fn detect_discord_quests() -> DiscordQuestScan {
    let mut log_dirs_found = false;
    let mut checked_files = 0usize;
    let mut quests: Vec<DiscordQuestEntry> = Vec::new();

    for dir in discord_log_dirs() {
        if !dir.is_dir() {
            continue;
        }
        log_dirs_found = true;

        let mut files: Vec<(std::time::SystemTime, PathBuf)> = fs::read_dir(&dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter_map(|entry| {
                let path = entry.path();
                if !path.is_file() {
                    return None;
                }
                let modified = entry.metadata().ok()?.modified().ok()?;
                Some((modified, path))
            })
            .collect();

        files.sort_by(|a, b| b.0.cmp(&a.0));

        for (_, path) in files.into_iter().take(3) {
            if fs::metadata(&path).map(|m| m.len()).unwrap_or(0) > 20 * 1024 * 1024 {
                continue;
            }
            let Ok(contents) = fs::read_to_string(&path) else {
                continue;
            };
            checked_files += 1;

            for line in contents.lines() {
                if !line.to_ascii_lowercase().contains("quest") {
                    continue;
                }
                let Some(name) = json_string_field(
                    line,
                    &["questName", "quest_name", "title", "name"],
                ) else {
                    continue;
                };
                if quests.iter().any(|entry| entry.name == name) {
                    continue;
                }
                quests.push(DiscordQuestEntry {
                    name,
                    progress: json_number_field(line, &["progress", "percent", "completion"]),
                });
                if quests.len() >= 10 {
                    break;
                }
            }

            if quests.len() >= 10 {
                break;
            }
        }
    }

    let reason = if !quests.is_empty() {
        format!("Found {} quest reference(s) in Discord's local logs.", quests.len())
    } else if !log_dirs_found {
        "Discord logs were not found on this machine, so quest data cannot be read.".to_string()
    } else if checked_files == 0 {
        "Discord's log folder exists but had no readable files.".to_string()
    } else {
        "Discord's local logs contain no quest entries; this Discord build does not log quest data, so the estimate above is used instead.".to_string()
    };

    DiscordQuestScan {
        available: !quests.is_empty(),
        reason,
        quests,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            create_fake_game,
            stop_process,
            connect_to_discord_rpc_3,
            run_background_process,
            fetch_gamelist_gh_mirror,
            fetch_gamelist_from_discord,
            read_gamelist_cache,
            write_gamelist_cache,
            clear_gamelist_cache,
            detect_discord_quests
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}