import { ref, watch } from 'vue';
import { createGlobalState } from '@vueuse/core';
import type { Game } from '@/types/types';
import { normalizeGame } from './fetch-gamelist';
import { randomString } from '@/utils/random-string';
import { useSettings } from './use-settings';

const GAMES_KEY = 'dqc:selected-games:v1';

function toStorableGame(game: Game): Game {
    return {
        uid: game.uid,
        id: game.id,
        name: game.name,
        aliases: game.aliases,
        themes: game.themes,
        launchable: game.launchable,
        is_custom: game.is_custom,
        // Never persist runtime state: on a fresh launch nothing is running/installed yet.
        executables: game.executables.map(exe => ({
            is_launcher: exe.is_launcher,
            name: exe.name,
            os: exe.os,
            ...(exe.arguments ? { arguments: exe.arguments } : {}),
        })),
    };
}

function restoreGames(): Game[] {
    try {
        const raw = localStorage.getItem(GAMES_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        const restored: Game[] = [];
        for (const entry of parsed as any[]) {
            const game = normalizeGame(entry);
            if (!game) continue;
            restored.push({
                ...game,
                uid: typeof entry?.uid === 'string' ? entry.uid : randomString(),
                is_custom: entry?.is_custom === true,
            });
        }
        return restored;
    } catch {
        return [];
    }
}

export const useSelectedGames = createGlobalState(() => {
    const games = ref<Game[]>(restoreGames());
    const { settings } = useSettings();

    function persist() {
        try {
            if (!settings.rememberGames) {
                localStorage.removeItem(GAMES_KEY);
                return;
            }
            localStorage.setItem(GAMES_KEY, JSON.stringify(games.value.map(toStorableGame)));
        } catch {
            /* storage is best effort */
        }
    }

    watch(games, persist);
    watch(() => settings.rememberGames, persist);

    function addGame(game: Game): Game | null {
        if (games.value.some(existing => existing.id === game.id)) {
            return null;
        }
        const added: Game = {
            ...game,
            uid: randomString(),
            is_running: false,
            is_installed: false,
            // Deep copy so play/stop state can never mutate the search list.
            executables: game.executables.map(exe => ({ ...exe, is_running: false, is_installed: false })),
        };
        games.value = [...games.value, added];
        return added;
    }

    function removeGame(uid: string | undefined) {
        games.value = games.value.filter(game => game.uid !== uid);
    }

    function clearGames() {
        games.value = [];
    }

    return { games, addGame, removeGame, clearGames, persist };
});
