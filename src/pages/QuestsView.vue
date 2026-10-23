<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { Pages, useGlobalState } from '@/composables/app-state';
import {
    endReasonLabel,
    formatClock,
    formatDayLabel,
    formatStamp,
    useSessions,
    type SessionHistoryEntry,
} from '@/composables/use-sessions';
import { useSettings } from '@/composables/use-settings';
import { useFetchGameList } from '@/composables/fetch-gamelist';
import { useSelectedGames } from '@/composables/use-selected-games';
import { useToasts } from '@/composables/use-toasts';

interface DiscordQuestEntry {
    name: string;
    progress: number | null;
}

interface DiscordQuestScan {
    available: boolean;
    reason: string;
    quests: DiscordQuestEntry[];
}

const { setPage } = useGlobalState();
const { settings } = useSettings();
const { gameDB } = useFetchGameList();
const { addGame } = useSelectedGames();
const { push } = useToasts();
const {
    sessions,
    history,
    elapsed,
    remaining,
    progress,
    isComplete,
    requestStop,
    clearHistory,
    completedCount,
} = useSessions();

const discordScan = ref<DiscordQuestScan | null>(null);
const isScanning = ref(false);

const historyFilter = ref<'all' | 'completed' | 'stopped'>('all');
const historyFilters = [
    { value: 'all', label: 'All' },
    { value: 'completed', label: 'Completed' },
    { value: 'stopped', label: 'Stopped early' },
] as const;

const filteredHistory = computed(() =>
    history.value.filter(entry => {
        if (historyFilter.value === 'completed') return entry.completed;
        if (historyFilter.value === 'stopped') return !entry.completed;
        return true;
    }),
);

const historyGroups = computed(() => {
    const groups: { label: string; seconds: number; entries: SessionHistoryEntry[] }[] = [];
    for (const entry of filteredHistory.value) {
        const label = formatDayLabel(entry.endedAt);
        const last = groups[groups.length - 1];
        if (last && last.label === label) {
            last.entries.push(entry);
            last.seconds += entry.seconds;
        } else {
            groups.push({ label, seconds: entry.seconds, entries: [entry] });
        }
    }
    return groups;
});

/** Sends the game back to Home so the same entry can be played again. */
function replay(entry: SessionHistoryEntry) {
    const game = gameDB.value.find(item => item.id === entry.gameId);
    if (!game) {
        push(`${entry.gameName} is not in the current game list`, 'warning');
        return;
    }
    const added = addGame(game);
    push(
        added ? `${game.name} added — press Play on Home` : `${game.name} is already in your game list`,
        added ? 'success' : 'warning',
    );
    setPage(Pages.HOME);
}

function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function scanDiscord() {
    if (!isTauri()) {
        discordScan.value = {
            available: false,
            reason: 'Discord data can only be read inside the desktop app.',
            quests: [],
        };
        return;
    }
    isScanning.value = true;
    try {
        discordScan.value = await invoke<DiscordQuestScan>('detect_discord_quests');
    } catch (error) {
        discordScan.value = {
            available: false,
            reason: error instanceof Error ? error.message : String(error),
            quests: [],
        };
    } finally {
        isScanning.value = false;
    }
}

onMounted(scanDiscord);

const totalTrackedSeconds = computed(() =>
    history.value.reduce((total, entry) => total + entry.seconds, 0),
);

function relativeTime(timestamp: number): string {
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
    return `${Math.floor(seconds / 86400)} d ago`;
}
</script>

<template>
    <div class="p-6 lg:p-8 max-w-[1100px] mx-auto space-y-6">
        <header class="flex items-start justify-between gap-4 flex-wrap">
            <div>
                <h1 class="text-2xl font-bold" style="color: var(--text)">Quests</h1>
                <p class="text-sm mt-1 muted">
                    Progress is estimated from how long this app keeps a game running.
                    Target: {{ settings.questMinutes }} minutes per quest.
                </p>
            </div>
            <button class="btn btn-quiet" @click="setPage(Pages.HOME)">Play a game</button>
        </header>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div class="panel p-4">
                <p class="panel-title">Running</p>
                <p class="text-2xl font-bold mt-1" style="color: var(--text)">{{ sessions.length }}</p>
            </div>
            <div class="panel p-4">
                <p class="panel-title">Completed</p>
                <p class="text-2xl font-bold mt-1" style="color: var(--success)">{{ completedCount }}</p>
            </div>
            <div class="panel p-4">
                <p class="panel-title">Tracked time</p>
                <p class="text-2xl font-bold mt-1" style="color: var(--text)">{{ formatClock(totalTrackedSeconds) }}</p>
            </div>
            <div class="panel p-4">
                <p class="panel-title">Target</p>
                <p class="text-2xl font-bold mt-1" style="color: var(--text)">{{ settings.questMinutes }}<span
                        class="text-sm font-medium muted"> min</span></p>
            </div>
        </div>

        <section class="panel p-5">
            <div class="flex items-center justify-between gap-3 mb-1">
                <h2 class="font-semibold" style="color: var(--text)">Running now</h2>
                <span class="chip" :class="sessions.length ? 'chip-success' : ''">
                    <span class="dot" :class="sessions.length ? 'dot-live' : ''"></span>
                    {{ sessions.length ? 'playing' : 'idle' }}
                </span>
            </div>

            <div v-if="!sessions.length" class="py-8 text-center space-y-2">
                <p class="text-sm muted">No game is running, so no quest can progress.</p>
                <button class="btn btn-accent" @click="setPage(Pages.HOME)">Choose a game</button>
            </div>

            <div v-else class="space-y-4 mt-3">
                <article v-for="session in sessions" :key="session.key" class="panel-soft p-4"
                    data-quest-session>
                    <div class="flex items-start justify-between gap-3">
                        <div class="min-w-0">
                            <div class="flex items-center gap-2 flex-wrap">
                                <h3 class="font-semibold truncate" style="color: var(--text)">{{ session.gameName }}</h3>
                                <span v-if="isComplete(session)" class="chip chip-success">quest complete</span>
                                <span v-else class="chip chip-accent">in progress</span>
                            </div>
                            <span class="chip" :class="session.mode === 'rpc' ? 'chip-warning' : 'chip-accent'">
                                {{ session.mode === 'rpc' ? 'RPC mode' : 'process mode' }}
                            </span>
                            <p class="text-xs font-mono mt-2 truncate faint">{{ session.executable.name }}</p>
                            <p class="text-xs mt-1 faint">
                                App ID {{ session.gameId }} · started {{ formatStamp(session.startedAt) }}
                            </p>
                            <div v-if="session.party" class="flex items-center gap-2 mt-2" data-party>
                                <span class="party-member" aria-hidden="true">Y</span>
                                <span class="text-xs faint">
                                    {{ session.party.size }} of {{ session.party.max }} players in the Discord party
                                </span>
                            </div>
                        </div>
                        <button class="btn btn-danger shrink-0" @click="requestStop(session)">Stop</button>
                    </div>

                    <div class="mt-3 progress-track">
                        <div class="progress-fill" :class="{ 'progress-fill-done': isComplete(session) }"
                            :style="{ width: progress(session) + '%' }" role="progressbar"
                            :aria-valuenow="Math.round(progress(session))" aria-valuemin="0" aria-valuemax="100"></div>
                    </div>
                    <div class="flex items-center justify-between text-xs mt-2 faint">
                        <span>{{ formatClock(elapsed(session)) }} elapsed</span>
                        <span v-if="isComplete(session)">estimated quest time reached · still running</span>
                        <span v-else>{{ formatClock(remaining(session)) }} to estimated completion</span>
                    </div>
                </article>
            </div>
        </section>

        <section class="panel p-5">
            <div class="flex items-center justify-between gap-3">
                <div>
                    <h2 class="font-semibold" style="color: var(--text)">Discord quest data</h2>
                    <p class="text-xs mt-1 faint">
                        Discord keeps its quest list private; this is a best-effort read of the local Discord install.
                    </p>
                </div>
                <button class="btn btn-quiet" :disabled="isScanning" @click="scanDiscord">
                    {{ isScanning ? 'Scanning...' : 'Rescan' }}
                </button>
            </div>

            <div class="mt-3 text-sm">
                <div v-if="discordScan && discordScan.quests.length" class="space-y-2">
                    <div v-for="quest in discordScan.quests" :key="quest.name"
                        class="panel-soft p-3 flex items-center justify-between gap-3" data-discord-quest>
                        <span class="truncate">{{ quest.name }}</span>
                        <span class="chip">{{ quest.progress !== null ? Math.round(quest.progress) + '%' : 'detected'
                            }}</span>
                    </div>
                </div>
                <p v-else class="muted">
                    {{ discordScan?.reason || 'Checking Discord...' }}
                </p>
                <p v-if="discordScan && !discordScan.available" class="text-xs mt-2 faint">
                    The estimate above is used instead: it is based on how long this app keeps the game running.
                </p>
            </div>
        </section>

        <section class="panel p-5">
            <div class="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h2 class="font-semibold" style="color: var(--text)">Recent sessions</h2>
                    <p class="text-xs mt-1 faint">
                        Exact start and end time, duration and how each session ended.
                    </p>
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                    <div class="flex gap-1" role="group" aria-label="History filter">
                        <button v-for="option in historyFilters" :key="option.value" class="btn text-xs"
                            :class="historyFilter === option.value ? 'btn-accent' : 'btn-quiet'"
                            :aria-pressed="historyFilter === option.value"
                            @click="historyFilter = option.value">
                            {{ option.label }}
                        </button>
                    </div>
                    <button v-if="history.length" class="btn btn-ghost text-xs" @click="clearHistory">Clear
                        history</button>
                </div>
            </div>

            <p v-if="!history.length" class="text-sm muted py-3">Finished sessions will show up here.</p>
            <p v-else-if="!filteredHistory.length" class="text-sm muted py-3">No session matches this filter.</p>

            <div v-else class="mt-4 space-y-5">
                <div v-for="group in historyGroups" :key="group.label">
                    <div class="flex items-center justify-between gap-2 mb-2">
                        <span class="panel-title">{{ group.label }}</span>
                        <span class="text-xs faint">
                            {{ group.entries.length }} session{{ group.entries.length === 1 ? '' : 's' }} ·
                            {{ formatClock(group.seconds) }} tracked
                        </span>
                    </div>
                    <ul class="space-y-2">
                        <li v-for="entry in group.entries" :key="entry.key + entry.startedAt"
                            class="panel-soft p-3" data-history-entry>
                            <div class="flex items-start justify-between gap-3">
                                <div class="min-w-0">
                                    <p class="text-sm truncate flex items-center gap-1.5 flex-wrap"
                                        style="color: var(--text)">
                                        {{ entry.gameName }}
                                        <span class="chip"
                                            :class="entry.mode === 'rpc' ? 'chip-warning' : 'chip-accent'">
                                            {{ entry.mode === 'rpc' ? 'RPC' : 'process' }}
                                        </span>
                                    </p>
                                    <p class="text-xs faint mt-1" data-history-timespan>
                                        {{ formatStamp(entry.startedAt) }} → {{ formatStamp(entry.endedAt) }}
                                        · {{ formatClock(entry.seconds) }}
                                    </p>
                                    <p class="text-xs faint">
                                        {{ endReasonLabel(entry.endReason) }} · App ID {{ entry.gameId }}
                                        <template v-if="entry.party">
                                            · party {{ entry.party.size }} of {{ entry.party.max }}
                                        </template>
                                        · {{ relativeTime(entry.endedAt) }}
                                    </p>
                                </div>
                                <div class="flex flex-col items-end gap-1.5 shrink-0">
                                    <span class="chip" :class="entry.completed ? 'chip-success' : ''">
                                        {{ entry.completed ? 'completed' : 'stopped early' }}
                                    </span>
                                    <button class="btn btn-ghost text-xs" @click="replay(entry)">Play again</button>
                                </div>
                            </div>
                        </li>
                    </ul>
                </div>
            </div>
        </section>
    </div>
</template>
