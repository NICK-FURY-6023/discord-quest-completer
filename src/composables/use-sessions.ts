import { computed, ref, watch } from 'vue';
import { createGlobalState, useEventListener, useIntervalFn } from '@vueuse/core';
import type { Game, GameExecutable } from '@/types/types';
import { useSettings } from './use-settings';
import { useToasts } from './use-toasts';

/** How the game is being shown in Discord: a dummy process or an RPC activity. */
export type SessionMode = 'process' | 'rpc';

/** Party size Discord shows on the profile card, e.g. "1 of 4 players". */
export interface SessionParty {
    size: number;
    max: number;
}

export type SessionEndReason = 'stopped' | 'app-closed' | 'rpc-disconnected';

export interface GameSession {
    key: string;
    gameUid: string;
    gameId: string;
    gameName: string;
    executable: GameExecutable;
    startedAt: number;
    /** Set once the estimated quest time has been reached. */
    completedAt: number | null;
    mode: SessionMode;
    party: SessionParty | null;
}

export interface SessionHistoryEntry {
    key: string;
    gameName: string;
    gameId: string;
    startedAt: number;
    endedAt: number;
    seconds: number;
    completed: boolean;
    mode: SessionMode;
    party: SessionParty | null;
    endReason: SessionEndReason;
}

const HISTORY_KEY = 'dqc:session-history:v1';
const HISTORY_LIMIT = 60;

function isMode(value: unknown): value is SessionMode {
    return value === 'process' || value === 'rpc';
}

function isParty(value: unknown): value is SessionParty {
    if (!value || typeof value !== 'object') return false;
    const party = value as Partial<SessionParty>;
    return (
        typeof party.size === 'number' &&
        typeof party.max === 'number' &&
        party.size > 0 &&
        party.max >= party.size
    );
}

function isEndReason(value: unknown): value is SessionEndReason {
    return value === 'stopped' || value === 'app-closed' || value === 'rpc-disconnected';
}

function loadHistory(): SessionHistoryEntry[] {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter(
                (entry): entry is SessionHistoryEntry =>
                    !!entry &&
                    typeof entry.gameName === 'string' &&
                    typeof entry.startedAt === 'number' &&
                    typeof entry.endedAt === 'number',
            )
            .map(entry => ({
                ...entry,
                key: typeof entry.key === 'string' ? entry.key : `${entry.gameId}:${entry.startedAt}`,
                seconds: Number.isFinite(entry.seconds) ? entry.seconds : Math.max(0, Math.round((entry.endedAt - entry.startedAt) / 1000)),
                completed: entry.completed === true,
                // Older entries were always dummy processes stopped by the user.
                mode: isMode(entry.mode) ? entry.mode : 'process',
                party: isParty(entry.party) ? entry.party : null,
                endReason: isEndReason(entry.endReason) ? entry.endReason : 'stopped',
            }))
            .slice(0, HISTORY_LIMIT);
    } catch {
        return [];
    }
}

export function sessionKey(game: Game, executable: GameExecutable): string {
    return `${game.id}:${executable.name}`;
}

/** Marker executable used for sessions that run through Discord RPC instead of a process. */
export function rpcExecutable(game: Game): GameExecutable {
    return { is_launcher: false, name: `Discord RPC activity (${game.id})`, os: 'rpc' };
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

/** Exact start/end stamp, e.g. "23 Oct 2026, 08:12:04". */
export function formatStamp(timestamp: number): string {
    return new Date(timestamp).toLocaleString(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

export function formatTimeOfDay(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

/** "Today", "Yesterday" or a date, used to group the session history. */
export function formatDayLabel(timestamp: number): string {
    const date = new Date(timestamp);
    const today = new Date();
    const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    const dayDiff = Math.round((startOfDay(today) - startOfDay(date)) / 86_400_000);
    if (dayDiff === 0) return 'Today';
    if (dayDiff === 1) return 'Yesterday';
    return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function endReasonLabel(reason: SessionEndReason): string {
    switch (reason) {
        case 'app-closed':
            return 'app closed';
        case 'rpc-disconnected':
            return 'RPC disconnected';
        default:
            return 'stopped by you';
    }
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

    function archive(session: GameSession, endedAt: number, endReason: SessionEndReason) {
        const seconds = Math.max(0, Math.floor((endedAt - session.startedAt) / 1000));
        const entry: SessionHistoryEntry = {
            key: session.key,
            gameName: session.gameName,
            gameId: session.gameId,
            startedAt: session.startedAt,
            endedAt,
            seconds,
            completed: session.completedAt !== null || seconds >= questSeconds.value,
            mode: session.mode,
            party: session.party,
            endReason,
        };
        history.value = [entry, ...history.value].slice(0, HISTORY_LIMIT);
        persistHistory();
    }

    function start(
        game: Game,
        executable: GameExecutable,
        mode: SessionMode = 'process',
        party: SessionParty | null = null,
    ) {
        const key = sessionKey(game, executable);
        const existing = sessions.value.find(session => session.key === key);
        if (existing) {
            return existing;
        }
        const session: GameSession = {
            key,
            gameUid: game.uid ?? game.id,
            gameId: game.id,
            gameName: game.name,
            executable,
            startedAt: Date.now(),
            completedAt: null,
            mode,
            party,
        };
        sessions.value = [...sessions.value, session];
        if (settings.notifyOnPlay) {
            push(`Now playing ${game.name}${mode === 'rpc' ? ' (RPC mode)' : ''}`, 'success');
        }
        return session;
    }

    function end(game: Game, executable: GameExecutable, reason: SessionEndReason = 'stopped') {
        const key = sessionKey(game, executable);
        const session = sessions.value.find(item => item.key === key);
        sessions.value = sessions.value.filter(item => item.key !== key);
        if (session) {
            archive(session, Date.now(), reason);
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
        sessions.value = sessions.value.filter(item => item.key !== session.key);
        archive(session, Date.now(), session.mode === 'rpc' ? 'rpc-disconnected' : 'stopped');
    }

    function findSession(gameUid: string | undefined) {
        if (!gameUid) return null;
        return sessions.value.find(session => session.gameUid === gameUid) ?? null;
    }

    function findRpcSession() {
        return sessions.value.find(session => session.mode === 'rpc') ?? null;
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

    // Closing the window kills the runner, so close the open sessions in the same
    // moment instead of losing them without a trace.
    useEventListener(window, 'beforeunload', () => {
        if (!sessions.value.length) return;
        const endedAt = Date.now();
        for (const session of sessions.value) {
            archive(session, endedAt, session.mode === 'rpc' ? 'rpc-disconnected' : 'app-closed');
        }
        sessions.value = [];
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
        findRpcSession,
        clearHistory,
        activeCount,
        completedCount,
    };
});
