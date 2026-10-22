import { Game, GameExecutable } from '@/types/types';
import { ref, shallowRef } from 'vue';
import { tryOnMounted } from '@vueuse/core';
import { invoke } from '@tauri-apps/api/core';
import { useGlobalState } from './app-state';

export type GameListSource = 'bundled' | 'cache' | 'mirror' | 'discord';

export interface GameListInfo {
    source: GameListSource | null;
    total: number;
    launchable: number;
    updatedAt: number | null;
}

function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Runs a Tauri command and never throws, so a missing/broken backend can only
 * degrade a feature instead of blocking the whole game list.
 */
async function invokeOrError<T>(command: string, args?: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
    if (!isTauri()) {
        return { error: 'Not running inside the desktop app, so backend commands are unavailable.' };
    }
    try {
        return { data: await invoke<T>(command, args) };
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
}

/** Tauri may hand back a parsed value, a JSON string or raw bytes depending on the command. */
function decodePayload(payload: unknown): unknown {
    if (typeof payload === 'string') {
        return JSON.parse(payload);
    }
    if (payload instanceof ArrayBuffer) {
        return JSON.parse(new TextDecoder().decode(new Uint8Array(payload)));
    }
    if (payload instanceof Uint8Array) {
        return JSON.parse(new TextDecoder().decode(payload));
    }
    return payload;
}

function normalizeExecutable(raw: any): GameExecutable | null {
    if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) {
        return null;
    }
    return {
        is_launcher: raw.is_launcher === true,
        name: raw.name.trim(),
        os: typeof raw.os === 'string' && raw.os.trim() ? raw.os.trim() : 'win32',
        ...(typeof raw.arguments === 'string' ? { arguments: raw.arguments } : {}),
    };
}

export function normalizeGame(raw: any): Game | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const id = raw.id !== undefined && raw.id !== null ? String(raw.id) : '';
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!id || !name) {
        return null;
    }

    const rawExecutables: unknown[] = Array.isArray(raw.executables) ? raw.executables : [];
    const executables = rawExecutables
        .map(normalizeExecutable)
        .filter((exe): exe is GameExecutable => exe !== null);

    return {
        id,
        name,
        executables,
        aliases: Array.isArray(raw.aliases) ? raw.aliases.filter((alias: unknown): alias is string => typeof alias === 'string') : [],
        themes: Array.isArray(raw.themes) ? raw.themes.filter((theme: unknown): theme is string => typeof theme === 'string') : [],
        launchable: executables.length > 0,
    };
}

/** Parses any game list payload into a clean, de-duplicated list ordered by name. */
export function parseGameList(payload: unknown): Game[] {
    let decoded: unknown;
    try {
        decoded = decodePayload(payload);
    } catch {
        return [];
    }
    if (!Array.isArray(decoded)) {
        return [];
    }

    const seen = new Set<string>();
    const games: Game[] = [];
    for (const raw of decoded) {
        const game = normalizeGame(raw);
        if (game && !seen.has(game.id)) {
            seen.add(game.id);
            games.push(game);
        }
    }
    return games.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fresh lists sometimes drop entries that are still launchable in the bundled snapshot,
 * so keep every game from both sides instead of replacing one with the other.
 */
export function mergeGameLists(primary: Game[], fallback: Game[]): Game[] {
    const seen = new Set(primary.map(game => game.id));
    const merged = [...primary];
    for (const game of fallback) {
        if (!seen.has(game.id)) {
            seen.add(game.id);
            merged.push(game);
        }
    }
    return merged.sort((a, b) => a.name.localeCompare(b.name));
}

export function countLaunchable(games: Game[]): number {
    return games.reduce((total, game) => (game.executables.length > 0 ? total + 1 : total), 0);
}

export function useFetchGameList() {
    const { addLog } = useGlobalState();

    // shallowRef keeps Vue from deep-tracking ~25k game objects. Deep tracking used to
    // re-index the whole search list on every nested change and freeze the UI.
    const gameDB = shallowRef<Game[]>([]);
    const info = ref<GameListInfo>({ source: null, total: 0, launchable: 0, updatedAt: null });
    const isReady = ref(false);
    const isRefreshing = ref(false);
    const lastError = ref<string | null>(null);

    let started = false;

    function applyList(games: Game[], source: GameListSource) {
        gameDB.value = games;
        info.value = {
            source,
            total: games.length,
            launchable: countLaunchable(games),
            updatedAt: Date.now(),
        };
        addLog('info', `Game list: ${games.length} entries from ${source} (${info.value.launchable} launchable).`);
    }

    async function loadBundled(): Promise<Game[]> {
        try {
            const bundled = await import('../assets/gamelist.json');
            return parseGameList((bundled as { default: unknown }).default);
        } catch {
            addLog('error', 'Bundled game list could not be loaded.');
            return [];
        }
    }

    async function loadCache(): Promise<Game[]> {
        const { data, error } = await invokeOrError<string>('read_gamelist_cache');
        if (error || !data) {
            return [];
        }
        return parseGameList(data);
    }

    async function fetchRemoteList(): Promise<{ list: Game[]; source: GameListSource } | { error: string }> {
        const mirror = await invokeOrError<unknown>('fetch_gamelist_gh_mirror');
        if (mirror.data !== undefined) {
            const list = parseGameList(mirror.data);
            if (list.length) {
                return { list, source: 'mirror' };
            }
        }

        const discord = await invokeOrError<unknown>('fetch_gamelist_from_discord');
        if (discord.data !== undefined) {
            const list = parseGameList(discord.data);
            if (list.length) {
                return { list, source: 'discord' };
            }
        }

        const messages = [...new Set([mirror.error, discord.error].filter(Boolean) as string[])];
        return { error: messages.length ? messages.join(' | ') : 'The game list response was empty or invalid.' };
    }

    function cacheList(games: Game[]) {
        // Fire and forget: a failed cache write must never affect the running app.
        void invokeOrError('write_gamelist_cache', { data: JSON.stringify(games) });
    }

    async function loadGameList() {
        lastError.value = null;

        if (!gameDB.value.length) {
            // 1. The bundled list is local and instant, so search works from the first second.
            const bundled = await loadBundled();
            if (bundled.length) {
                applyList(bundled, 'bundled');
                isReady.value = true;
            }

            // 2. Last successful fetch from disk: offline friendly and newer than the bundle.
            const cached = await loadCache();
            if (cached.length) {
                applyList(mergeGameLists(cached, bundled), 'cache');
                isReady.value = true;
            }
        }

        // 3. Always try the network and merge the fresh list on success.
        const remote = await fetchRemoteList();
        if ('list' in remote) {
            const bundled = await loadBundled();
            applyList(mergeGameLists(remote.list, bundled), remote.source);
            cacheList(remote.list);
            isReady.value = true;
        } else {
            lastError.value = remote.error;
            addLog('error', `Game list refresh failed: ${remote.error}`);
        }
    }

    async function fetchGameList() {
        if (isRefreshing.value) {
            return;
        }
        isRefreshing.value = true;
        try {
            await loadGameList();
        } finally {
            isRefreshing.value = false;
            isReady.value = true;
        }
    }

    tryOnMounted(() => {
        if (started) {
            return;
        }
        started = true;
        void fetchGameList();
    });

    return {
        gameDB,
        info,
        isReady,
        isRefreshing,
        lastError,
        fetchGameList,
    };
}
