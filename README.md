<p>
  <h1 align="center">Discord Quest Completer</h1>
</p>

![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/markterence/discord-quest-completer/build-release.yaml?branch=main&style=flat&label=build%20(release))
[![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/markterence/discord-quest-completer/rust-check.yml?branch=main&style=flat&label=scheduled%20build%20%28every%202%20days%29)](https://github.com/markterence/discord-quest-completer/actions/workflows/rust-check.yml?query=branch%3Amain+event%3Aschedule)


> A quest completer for Discord. Discord Quest Completer. I don't know what to call this, but there it is.

A Windows desktop application for Discord Rich Presence and completing Discord Quest for games without needing to install the full actual games/applications. Perfect for completing Discord Quests and showing off your gaming status without the storage burden.


<!--
Old attachments: Kept here since github dont provide way to remove/manage attached files.

https://github.com/user-attachments/assets/34ff80c4-9e76-452c-9b02-e56f9ea706dd
https://github.com/user-attachments/assets/de904123-07df-41a9-8db1-ff05cc7ccc9b
-->

https://github.com/user-attachments/assets/de904123-07df-41a9-8db1-ff05cc7ccc9b

---

## 📥 Installation

Pre-built binaries for Windows, Linux and macOS are published on the [Releases](https://github.com/NICK-FURY-6023/discord-quest-completer/releases) page. Every release is built by CI from the current `main` (see [Building a Release](#-building-a-release-ci)).

Alternatively, you can follow the [development setup instructions](#-development-setup) to build the app from source.

### Windows

Download `discord-quest-completer-<version>-windows-x64.zip` (portable) or the `.msi`/`.exe` installer from the release assets, then extract and run `discord-quest-completer.exe`.

### Linux

Download `discord-quest-completer-<version>-linux-x64.tar.gz` (portable) or the `.deb`/`.AppImage` from the release assets. The app needs WebKitGTK 4.1 and GTK4, e.g. on Debian/Ubuntu:

```bash
sudo apt-get install libwebkit2gtk-4.1-0 libgtk-4-1
```

Then extract the tarball and run `./discord-quest-completer` from an X11 or Wayland session.

### macOS (Apple Silicon)

Download `discord-quest-completer-<version>-macos-arm64.zip`, unzip it and drag `Discord Quest Completer.app` into Applications. The build is not code-signed, so the first launch needs Right-click → Open. Intel Macs should build from source.

> [!IMPORTANT]
> Make sure you place or extract in a location where you have write or execute permissions.
> 
> The reason for this is that the app will create dummy game file in the same directory.
> By default, the app will not need to be run as administrator, unless if it was installed in a directory that requires elevated permissions. (e.g. `C:\Program Files\`, root of `C:\`, etc.)


> [!NOTE]
> Webview2 is required to run the app. WebView2 comes preinstalled on Windows 11. On versions older than Windows 11 you may need to install it manually.
> If you don't have it installed, you can download it from [here](https://developer.microsoft.com/en-us/microsoft-edge/webview2).


## Uninstall

To uninstall the app, simply go to the folder where you extracted or placed the app and delete it's folder and thats it.

The content of the folder may look like this:

```text
discord-quest-completer/
├── discord-quest-completer.exe (main app)
├── data/ 
│   ├── src-win.exe (runner dummy template)
├── games/
│    ├── <game-id>/
```

<!-- COMMENT:
  This folder on local app data seems to only exists when using the installer or when Web API like local storage was used? 
  Bring the section back once it's verified it was also existing using the quick portable builds.
-->
<!--
**Other optional files to remove when uninstalling:**

Delete the `me.markterence.discordquestcompleter` folder on `%localappdata%`. 

```bash
# Put this on File Explorer's address bar to navigate on the folder.
%localappdata%/me.markterence.discordquestcompleter
```

The folder `%localappdata%/me.markterence.discordquestcompleter` contains the WebView2 files used by Tauri for the this app. The contents of the folder varies per-user but it may look this this:

```
EBWebView
.cookies
```


> The `%localappdata%` is a system variable on Windows and is equivalent to `C:\Users\<YOUR USER>\AppData\Local\`.
-->

---

## ✨ Features

- Simulate playing verified Discord games without intalling a full game!
- Complete Discord Quests requiring 15-minute gameplay (not yet tested for Stream the game Quests)
- Only Discord Verified games are supported. The application fetches a list of games that Discord can automatically detect.
- Sidebar app with three pages: **Home** (search + play), **Quests** (estimated progress per game) and **Settings**.
- Games keep running until you press Stop, so Discord keeps showing them after the estimated quest time is reached.
- Quests page shows a progress bar against the estimated quest length, a completed badge, and a history of finished sessions.
- Settings includes a live status dashboard (running sessions, game list source, cache size, runner), appearance options (dark/light/system theme and accent color), play behaviour toggles, cache/data controls and an activity log.
- Discord does not expose its quest list, so the app estimates progress from play time and only shows detected Discord quest data when the local Discord install exposes it.

## ⚙️ How It Works

This app creates small executable files that mimic the actual game processes that Discord looks for when detecting a verified game to use it for it's Rich Presence activity.
When launched/played, the tiny executables trigger Discord's Rich Presence/Registed Games detection. Discord checks if Game exe name is running, sometimes it needs to be a folder where the game is supposed to be, thats how mainly it detects the Games, we can clearly see this on the "Registered Games" in the settings.

The dummy game executale files used by this program are placed in a folder called  `games/` folder relative to the main application's exe. As of release build v2025.10.07 the dummy executable file size is around 250kb, it could be smaller but it requires the end-users to install .NET Framework Runtime (which is sometimes comes pre-installed on an up-to-date Windows 11 PC's, so for now the dummy exe using WinAPI through C++ for compatibility rather than C#)

> [!TIP]
> After launching some games over a period of time, those files may accumulate. For a little maintenance, you can manually delete the created folders under the `games/` folder if you need to.


<!--
> _Currently, I am hesitant to add a file‑maintenance operation that deletes or clears the `games/` folder, because doing so may still cause unexpected issues. On Windows, the file system is case‑insensitive, so if you have a file named `Notes.txt` and you issue a command to delete `notes.txt`, Windows will still delete the `Notes.txt` file (the one that begins with a capital “N”)._
-->

## Use Cases

- Complete Discord Quests without downloading massive game files
- Show-off playing the latest games on your status if you want to. (Even if you don't really have it.) (LOL)
- Save disk space while still participating in Discord's Quest.
- I want to complete the Quest but I don't want to install the game's anti-cheat, game is too big, or it won't run on my PC.
- Useful for users with limited internet bandwidth or storage space

<!-- ## 🚀 Planned Features and fixes

- Make the "Stop" button work again if process was terminated outside of app's control.
- Persist games that added on the list so it wont reset.
- Discord Activity Simulator/playground (Customizable rich presence for developers and custom activities)
- Set custom activity status from supported games
- Linux and MacOS support (if possible) -->

## :heart: Support :heart:


[![GitHub][github-badge]][github-sponsors] - Become a Sponsor on GitHub. One time support, or a recurring donation

[![Paypal][paypal-badge]][paypal] - One-time donation via PayPal

<p align="center">
  <img src="https://hoshizora.markterence.me/github-stargazers/markterence/discord-quest-completer?show_usernames=1&v=1" align="center" alt="stargazers"/>
</p>

---

## 🖥️ Supported Platforms

| Platform | Status | Notes |
| --- | --- | --- |
| Windows 10/11 (x64) | Supported | WebView2 required (preinstalled on Windows 11) |
| Linux (x64) | Experimental | Needs WebKitGTK 4.1 + GTK4; built and published by CI |
| macOS (Apple Silicon) | Experimental | Unsigned build, needs Right-click → Open on first launch |

Each platform ships its own dummy game runner, because Discord detects the "game" by watching for that helper process:

| Platform | Runner crate | Resource in the bundle |
| --- | --- | --- |
| Windows | `src-win` (Win32, no runtime deps) | `data/src-win.exe` |
| Linux | `src-linux` (GTK4) | `data/src-linux` |
| macOS | `src-darwin` (winit) | `data/src-darwin` |

The Linux and macOS runners are newer and less battle-tested than the Windows one. If the runner does not stay alive, Discord will not show the game as playing.

---

## 🛠️ Tech Stack

- 🦀 Rust
- 🌐 Vue.js
- 🧰 Tauri

## 🧑‍💻 Development Setup

### 🖥️ Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

### 📋 Requirements

- Tauri - make sure the [pre-requisites](https://tauri.app/start/prerequisites/) are installed such as Rust.
- NodeJS - use any that is latest or node 20+
- pnpm - project uses pnpm as package manager for the frontend.

### 🛠️ Development

Install dependencies for the Vue.js frontend using pnpm

```bash
pnpm install
```

Build and copy the dummy game binary for your platform into the Tauri app's `resources` folder:

```bash
pnpm sync:runner
```

That picks `build:runner:<os>` + `copy:runner:<os>` for your OS, so `src-tauri/resources/` ends up with `src-win.exe`, `src-linux` or `src-darwin`.

Then run the Tauri dev command to start the development server.

```bash
pnpm tauri dev
```

- Also, get the list of detecatable games from the Discord API: `GET /api/applications/detectable` or `GET /api/:version/applications/detectable` and place the JSON file in `src/assets/gamelist.json`


---

## 📦 Building a Release (CI)

`.github/workflows/build-release.yaml` is triggered manually (`workflow_dispatch`) and publishes a draft pre-release tagged with today's date.

What each build job does:

1. Downloads system dependencies (WebKitGTK + GTK4 on Linux).
2. Refreshes `src/assets/gamelist.json` with `pnpm update:gamelist` (a ~3.7 MB trimmed snapshot, with the committed file as fallback).
3. Builds the OS-specific dummy runner from `src-win` / `src-linux` / `src-darwin`.
4. Runs `pnpm exec vue-tsc --noEmit` so TypeScript errors fail the build before the Rust link.
5. Builds the Tauri app and uploads the bundle plus the portable binary as an artifact.

The `release` job then packages the portable builds and attaches them together with the installers:

| Platform | Portable asset | Installers |
| --- | --- | --- |
| Windows x64 | `discord-quest-completer-<version>-windows-x64.zip` | `.msi`, `.exe` |
| Linux x64 | `discord-quest-completer-<version>-linux-x64.tar.gz` | `.deb`, `.AppImage` |
| macOS arm64 | `discord-quest-completer-<version>-macos-arm64.zip` | `.dmg` |

Start a release from **Actions → publish → Run workflow**, or from the CLI:

```bash
gh workflow run build-release.yaml
```

To reproduce a release locally:

```bash
pnpm install
pnpm update:gamelist
pnpm sync:runner
pnpm exec vue-tsc --noEmit
pnpm tauri build
```

Artifacts land in `src-tauri/target/release/bundle/` and the portable binary next to it in `src-tauri/target/release/`.

---

## Other Thoughts

### The Discord's RPC server and Rich Presence 

There is also an experimental action like Discord RPC functionality along the selected game.
It connects to Discord's RPC Gateway to send Activity updates for the selected game using its App ID, even if the game is not actually running. (This is Rich Presence only so Quests will not detect it)

(This may not work for some time, as Discord updates their RPC and SDK. The syntax I used in the Rust code may not be updated, as it is not one of the main focus of this app.)

Though this is functional as it uses Discord Rich Presence, what happens is it uses the App ID of some App on Discord and connects it to the RPC.  
See: [Discord Developer Docs – Creating an App](https://discord.com/developers/docs/quick-start/getting-started#step-1-creating-an-app)

For example, the App ID for Overwatch is `356875221078245376`, and we use it with something like [discordjs/rpc](https://github.com/discordjs/RPC).


```js
// Set this to your Client ID.
const clientId = '356875221078245376'; // This is Overwatch's App ID on Discord, not one I created.
DiscordRPC.register(clientId);

const rpc = new DiscordRPC.Client({ transport: 'ipc' });
const startTimestamp = new Date();

// You will see "Verified Overwatch" on Discord Activity with custom details.
rpc.setActivity({
  details: `Bleet bleet`,
  state: 'in bleet bleet party',
  startTimestamp,
});
```

This may not be the intended use of Discord's RPC and may violate their Terms of Service.  
I am not entirely sure if you can use others' App IDs other than the ones you own in the Discord Developer Dashboard for the application you are developing.
Use this feature at your own risk.


### Disclaimer

This tool is intended for educational purposes and personal use. Please respect Discord's terms of service, partners, game publishers and advertisers rights when using this application.

The creators and maintainers of this project are not liable for any damages, account suspensions, or other consequences that may arise from using this software. Use at your own risk.

Discord is a registered trademark of Discord Inc. It is referenced on this open-source project for descriptive and definition purposes only and does not imply any affiliation, sponsorship, or endorsement by Discord Inc in any way.

---

<!--
## Other Alternatives

If you can't install this application for any reason, there is some steps on a gist from [aamiaa](https://github.com/aamiaa/) that allows you to use Discord client's Web Inspector and paste the code provided and complete the quest.

See the guide here: https://gist.github.com/aamiaa/204cd9d42013ded9faf646fae7f89fbb
-->


## License

[MIT License](LICENSE)© Mark Terence Tiglao - 2025

---


[github-badge]: https://img.shields.io/badge/-Github%20Sponsor-fafbfc?logo=GitHub%20Sponsors
[github-sponsors]: https://github.com/sponsors/markterence
[paypal-badge]: https://img.shields.io/badge/-Paypal-002991?logo=Paypal
[paypal]: https://paypal.me/MarkTerenceTiglao

