import { computed, ref, watch } from 'vue';
import { createGlobalState, useEventListener, useIntervalFn } from '@vueuse/core';
import type { Game, GameExecutable } from '@/types/types';
import { useSettings } from './use-settings';
import { useToasts } from './use-toasts';

export interface GameSession {
    key: string;
    gameUid: string;
    gameId: string;
    gameName: string;
    executable: GameExecutable;
    startedAt: number;
    /** Set once the estimated quest time has been reached. */
    completedAt: number | null;
}

export interface SessionHistoryEntry {
    key: string;
    gameName: string;
    gameId: string;
    startedAt: number;
    endedAt: number;
    seconds: number;
    completed: boolean;
}

const HISTORY_KEY = 'dqc:session-history:v1';
const HISTORY_LIMIT = 30;

function loadHistory(): SessionHistoryEntry[] {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((entry): entry is SessionHistoryEntry => !!entry && typeof entry.gameName === 'string' && typeof entry.startedAt === 'number')
            .slice(0, HISTORY_LIMIT);
    } catch {
        return [];
    }
}

export function sessionKey(game: Game, executable: GameExecutable): string {
    return `${game.id}:${executable.name}`;
}

export function formatClock(totalSeconds: number): string {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const seconds = safe % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export const useSessions = createGlobalState(() => {
    const sessions = ref<GameSession[]>([]);
    const history = ref<SessionHistoryEntry[]>(loadHistory());
    const now = ref(Date.now());
    const { settings } = useSettings();
    const { push } = useToasts();

    useIntervalFn(() => {
        now.value = Date.now();
    }, 1000);

    // WebView timers are throttled while the window is in the background, so re-sync
    // the clock as soon as the user looks at the app again.
    useEventListener(window, 'focus', () => {
        now.value = Date.now();
    });

    const questSeconds = computed(() => Math.max(60, settings.questMinutes * 60));

    function elapsed(session: GameSession): number {
        return Math.max(0, Math.floor((now.value - session.startedAt) / 1000));
    }

    function remaining(session: GameSession): number {
        return Math.max(0, questSeconds.value - elapsed(session));
    }

    function progress(session: GameSession): number {
        return Math.min(100, (elapsed(session) / questSeconds.value) * 100);
    }

    function isComplete(session: GameSession): boolean {
        return elapsed(session) >= questSeconds.value;
    }

    function persistHistory() {
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value));
        } catch {
            /* history is a convenience, never a hard dependency */
        }
    }

    function archive(session: GameSession, endedAt: number) {
        const seconds = Math.max(0, Math.floor((endedAt - session.startedAt) / 1000));
        const entry: SessionHistoryEntry = {
            key: session.key,
            gameName: session.gameName,
            gameId: session.gameId,
            startedAt: session.startedAt,
            endedAt,
            seconds,
            completed: session.completedAt !== null || seconds >= questSeconds.value,
        };
        history.value = [entry, ...history.value].slice(0, HISTORY_LIMIT);
        persistHistory();
    }

    function start(game: Game, executable: GameExecutable) {
        const key = sessionKey(game, executable);
        sessions.value = [
            ...sessions.value.filter(session => session.key !== key),
            {
                key,
                gameUid: game.uid ?? game.id,
                gameId: game.id,
                gameName: game.name,
                executable,
                startedAt: Date.now(),
                completedAt: null,
            },
        ];
        if (settings.notifyOnPlay) {
            push(`Now playing ${game.name}`, 'success');
        }
    }

    /** Stops tracking a session and archives it, regardless of who stopped the process. */
    function end(game: Game, executable: GameExecutable) {
        const key = sessionKey(game, executable);
        const session = sessions.value.find(item => item.key === key);
        sessions.value = sessions.value.filter(item => item.key !== key);
        if (session) {
            archive(session, Date.now());
        }
    }

    type StopHandler = (session: GameSession) => void;
    let stopHandler: StopHandler | null = null;

    function setStopHandler(handler: StopHandler | null) {
        stopHandler = handler;
    }

    function requestStop(session: GameSession) {
        if (stopHandler) {
            stopHandler(session);
            return;
        }
        const archived = sessions.value.find(item => item.key === session.key);
        sessions.value = sessions.value.filter(item => item.key !== session.key);
        if (archived) {
            archive(archived, Date.now());
        }
    }

    function findSession(gameUid: string | undefined) {
        if (!gameUid) return null;
        return sessions.value.find(session => session.gameUid === gameUid) ?? null;
    }

    function clearHistory() {
        history.value = [];
        persistHistory();
    }

    // Mark sessions complete once, so the UI can show the finished state even though
    // the game keeps running (and Discord keeps showing it).
    watch(now, () => {
        let changed = false;
        for (const session of sessions.value) {
            if (session.completedAt === null && elapsed(session) >= questSeconds.value) {
                session.completedAt = Date.now();
                changed = true;
                push(`${session.gameName}: estimated quest time reached`, 'success', 6000);
            }
        }
        if (changed) {
            sessions.value = [...sessions.value];
        }
    });

    const activeCount = computed(() => sessions.value.length);
    const completedCount = computed(() => history.value.filter(entry => entry.completed).length);

    return {
        sessions,
        history,
        questSeconds,
        now,
        elapsed,
        remaining,
        progress,
        isComplete,
        start,
        end,
        requestStop,
        setStopHandler,
        findSession,
        clearHistory,
        activeCount,
        completedCount,
    };
});
