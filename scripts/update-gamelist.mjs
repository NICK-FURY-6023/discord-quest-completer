// Refreshes src/assets/gamelist.json from the Discord detectable mirror.
// Only the fields the app actually uses are kept, which keeps the bundled
// fallback small and fast to parse.
//
// Usage: pnpm update:gamelist [url]
// The source can also be set with the GAME_LIST_URL environment variable.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DEFAULT_SOURCE_URL = 'https://markterence.github.io/discord-quest-completer/detectable.json';
const SOURCE_URL = process.argv[2] || process.env.GAME_LIST_URL || DEFAULT_SOURCE_URL;
const OUTPUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/assets/gamelist.json');

const response = await fetch(SOURCE_URL);
if (!response.ok) {
    throw new Error(`Failed to download the game list: HTTP ${response.status}`);
}

const raw = await response.json();
if (!Array.isArray(raw)) {
    throw new Error('Expected the game list to be a JSON array.');
}

const trimmed = raw
    .filter(game => game && game.id != null && typeof game.name === 'string')
    .map(game => ({
        id: String(game.id),
        name: game.name,
        aliases: Array.isArray(game.aliases) ? game.aliases.filter(alias => typeof alias === 'string') : [],
        themes: Array.isArray(game.themes) ? game.themes.filter(theme => typeof theme === 'string') : [],
        executables: (Array.isArray(game.executables) ? game.executables : [])
            .filter(exe => exe && typeof exe.name === 'string')
            .map(exe => ({
                is_launcher: exe.is_launcher === true,
                name: exe.name,
                os: typeof exe.os === 'string' ? exe.os : 'win32',
                ...(typeof exe.arguments === 'string' ? { arguments: exe.arguments } : {}),
            })),
    }));

await writeFile(OUTPUT, JSON.stringify(trimmed));

const launchable = trimmed.filter(game => game.executables.length > 0).length;
console.log(`Wrote ${trimmed.length} games (${launchable} launchable) to ${path.relative(process.cwd(), OUTPUT)}`);
