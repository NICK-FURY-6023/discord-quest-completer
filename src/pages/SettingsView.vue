<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { getCurrentOS } from '@/constants/constants';
import { useGlobalState } from '@/composables/app-state';
import { useFetchGameList } from '@/composables/fetch-gamelist';
import { useSessions, formatClock } from '@/composables/use-sessions';
import { useSelectedGames } from '@/composables/use-selected-games';
import { useSettings, ACCENTS, clampMinutes, type AccentName, type ThemeMode } from '@/composables/use-settings';
import { useToasts } from '@/composables/use-toasts';

const { logs, clearLogs } = useGlobalState();
const { gameDB, info, isRefreshing, lastError, fetchGameList } = useFetchGameList();
const { settings, resetSettings, resolvedTheme } = useSettings();
const { sessions, history, elapsed, requestStop, clearHistory, activeCount, questSeconds } = useSessions();
const { games: selectedGames, clearGames } = useSelectedGames();
const { push } = useToasts();

const cacheBytes = ref<number | null>(null);
const appVersion = ref('dev');
const platform = getCurrentOS();

const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'System' },
];

const accentEntries = Object.entries(ACCENTS) as [AccentName, (typeof ACCENTS)[AccentName]][];

const cacheLabel = computed(() => {
    if (cacheBytes.value === null) return 'not cached yet';
    if (cacheBytes.value < 1024) return `${cacheBytes.value} B`;
    if (cacheBytes.value < 1024 * 1024) return `${(cacheBytes.value / 1024).toFixed(0)} KB`;
    return `${(cacheBytes.value / (1024 * 1024)).toFixed(1)} MB`;
});

const trackedTime = computed(() =>
    formatClock(history.value.reduce((total, entry) => total + entry.seconds, 0)),
);

function isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function readCacheSize() {
    if (!isTauri()) return;
    try {
        const raw = await invoke<string>('read_gamelist_cache');
        cacheBytes.value = new Blob([raw]).size;
    } catch {
        cacheBytes.value = 0;
    }
}

async function loadVersion() {
    if (!isTauri()) return;
    try {
        appVersion.value = await getVersion();
    } catch {
        appVersion.value = 'unknown';
    }
}

onMounted(() => {
    void readCacheSize();
    void loadVersion();
});

async function refreshGameList() {
    await fetchGameList();
    await readCacheSize();
    if (lastError.value) {
        push('Could not refresh the game list', 'warning');
    } else {
        push('Game list refreshed', 'success');
    }
}

async function clearCache() {
    try {
        await invoke('clear_gamelist_cache');
        cacheBytes.value = 0;
        push('Cached game list cleared', 'success');
    } catch (error) {
        push('Could not clear the cache: ' + (error instanceof Error ? error.message : String(error)), 'error');
    }
}

function clearSavedGames() {
    clearGames();
    push('Saved game list cleared', 'success');
}

function resetAllSettings() {
    resetSettings();
    push('Settings restored to defaults', 'success');
}

function updateQuestMinutes(event: Event) {
    const target = event.target as HTMLInputElement;
    settings.questMinutes = clampMinutes(target.value);
    target.value = String(settings.questMinutes);
}

function logTone(type: string) {
    switch (type) {
        case 'error':
            return 'var(--danger)';
        case 'warning':
            return 'var(--warning)';
        case 'debug':
            return 'var(--success)';
        default:
            return 'var(--text-muted)';
    }
}
</script>

<template>
    <div class="p-6 lg:p-8 max-w-[1000px] mx-auto space-y-6">
        <header>
            <h1 class="text-2xl font-bold" style="color: var(--text)">Settings</h1>
            <p class="text-sm mt-1 muted">Everything that is running right now, plus how the app behaves.</p>
        </header>

        <!-- Live status -->
        <section class="panel p-5" data-settings-section="status">
            <div class="flex items-center justify-between gap-3">
                <h2 class="font-semibold" style="color: var(--text)">Live status</h2>
                <span class="chip" :class="activeCount ? 'chip-success' : ''">
                    <span class="dot" :class="activeCount ? 'dot-live' : ''"></span>
                    {{ activeCount ? activeCount + ' running' : 'idle' }}
                </span>
            </div>

            <div class="grid md:grid-cols-2 gap-3 mt-4">
                <div class="panel-soft p-4">
                    <p class="panel-title">Running sessions</p>
                    <div v-if="!sessions.length" class="text-sm muted mt-1">No game process tracked.</div>
                    <ul v-else class="mt-2 space-y-2">
                        <li v-for="session in sessions" :key="session.key" data-status-session
                            class="flex items-center justify-between gap-2">
                            <div class="min-w-0">
                                <p class="text-sm truncate" style="color: var(--text)">{{ session.gameName }}</p>
                                <p class="text-xs faint">{{ formatClock(elapsed(session)) }} · {{
                                    session.executable.name }}</p>
                            </div>
                            <button class="btn btn-ghost text-xs" @click="requestStop(session)">Stop</button>
                        </li>
                    </ul>
                </div>

                <div class="panel-soft p-4">
                    <p class="panel-title">Game list</p>
                    <p class="text-sm mt-1" style="color: var(--text)">
                        {{ gameDB.length.toLocaleString() }} loaded ·
                        {{ info.launchable.toLocaleString() }} launchable
                    </p>
                    <p class="text-xs mt-1 faint">
                        Source: {{ info.source || 'unknown' }} · cache {{ cacheLabel }}
                        <template v-if="isRefreshing"> · refreshing...</template>
                    </p>
                    <p v-if="lastError" class="text-xs mt-1" style="color: var(--warning)">{{ lastError }}</p>
                    <button class="btn btn-quiet text-xs mt-3" :disabled="isRefreshing" @click="refreshGameList">
                        Refresh now
                    </button>
                </div>

                <div class="panel-soft p-4">
                    <p class="panel-title">Runner</p>
                    <p class="text-sm mt-1" style="color: var(--text)">{{ platform }} dummy process</p>
                    <p class="text-xs mt-1 faint">
                        Launched per Play; Discord detects this process as the game.
                    </p>
                </div>

                <div class="panel-soft p-4">
                    <p class="panel-title">App</p>
                    <p class="text-sm mt-1" style="color: var(--text)">v{{ appVersion }}</p>
                    <p class="text-xs mt-1 faint">
                        Theme: {{ resolvedTheme }} · quest target {{ settings.questMinutes }} min ({{ questSeconds }}s)
                    </p>
                </div>
            </div>
        </section>

        <!-- Appearance -->
        <section class="panel p-5" data-settings-section="appearance">
            <h2 class="font-semibold" style="color: var(--text)">Appearance</h2>

            <div class="mt-4">
                <p class="panel-title">Theme</p>
                <div class="flex gap-2 mt-2">
                    <button v-for="option in themeOptions" :key="option.value" class="btn"
                        :class="settings.theme === option.value ? 'btn-accent' : 'btn-quiet'"
                        :aria-pressed="settings.theme === option.value" @click="settings.theme = option.value">
                        {{ option.label }}
                    </button>
                </div>
            </div>

            <div class="mt-5">
                <p class="panel-title">Accent</p>
                <div class="flex flex-wrap gap-2 mt-2">
                    <button v-for="[name, accent] in accentEntries" :key="name" class="btn btn-quiet"
                        :aria-pressed="settings.accent === name" :title="accent.label"
                        :style="settings.accent === name ? { borderColor: accent.color, color: accent.color } : {}"
                        @click="settings.accent = name">
                        <span class="w-3 h-3 rounded-full" :style="{ background: accent.color }"></span>
                        {{ accent.label }}
                    </button>
                </div>
            </div>
        </section>

        <!-- Play behaviour -->
        <section class="panel p-5" data-settings-section="play">
            <h2 class="font-semibold" style="color: var(--text)">Play behaviour</h2>

            <div class="mt-3">
                <label class="toggle-row" for="quest-minutes">
                    <span>
                        <span class="text-sm" style="color: var(--text)">Estimated quest length</span>
                        <span class="block text-xs faint">Used for progress only; the game keeps running until you
                            stop it.</span>
                    </span>
                    <input id="quest-minutes" class="input w-24 text-center" type="number" min="1" max="240"
                        :value="settings.questMinutes" @change="updateQuestMinutes" />
                </label>

                <div class="divider my-1"></div>

                <label class="toggle-row" for="notify-play">
                    <span>
                        <span class="text-sm" style="color: var(--text)">Notify when a game starts</span>
                        <span class="block text-xs faint">Shows an in-app toast with the game name.</span>
                    </span>
                    <input id="notify-play" v-model="settings.notifyOnPlay" class="toggle" type="checkbox" />
                </label>

                <div class="divider my-1"></div>

                <label class="toggle-row" for="confirm-stop">
                    <span>
                        <span class="text-sm" style="color: var(--text)">Confirm before stopping</span>
                        <span class="block text-xs faint">Asks before the runner process is killed.</span>
                    </span>
                    <input id="confirm-stop" v-model="settings.confirmStop" class="toggle" type="checkbox" />
                </label>

                <div class="divider my-1"></div>

                <label class="toggle-row" for="remember-games">
                    <span>
                        <span class="text-sm" style="color: var(--text)">Remember my game list</span>
                        <span class="block text-xs faint">Restores your selected games on the next launch.</span>
                    </span>
                    <input id="remember-games" v-model="settings.rememberGames" class="toggle" type="checkbox" />
                </label>
            </div>
        </section>

        <!-- Data & cache -->
        <section class="panel p-5" data-settings-section="data">
            <h2 class="font-semibold" style="color: var(--text)">Data &amp; cache</h2>
            <p class="text-xs mt-1 faint">
                {{ selectedGames.length }} saved game(s) · {{ history.length }} session(s) · {{ trackedTime }} tracked
            </p>

            <div class="flex flex-wrap gap-2 mt-4">
                <button class="btn btn-quiet" :disabled="isRefreshing" @click="refreshGameList">Refresh game list</button>
                <button class="btn btn-quiet" @click="clearCache">Clear cached list</button>
                <button class="btn btn-quiet" @click="clearSavedGames">Clear saved games</button>
                <button class="btn btn-quiet" @click="clearHistory">Clear session history</button>
                <button class="btn btn-danger" @click="resetAllSettings">Reset settings</button>
            </div>
        </section>

        <!-- Logs -->
        <section class="panel p-5" data-settings-section="logs">
            <div class="flex items-center justify-between gap-3">
                <h2 class="font-semibold" style="color: var(--text)">Activity log</h2>
                <button class="btn btn-ghost text-xs" @click="clearLogs">Clear log</button>
            </div>

            <div v-if="!logs.length" class="text-sm muted py-4">Nothing logged yet.</div>
            <ul v-else class="mt-3 max-h-64 overflow-y-auto space-y-1 font-mono text-xs">
                <li v-for="(log, index) in [...logs].reverse().slice(0, 80)" :key="index" class="flex gap-2">
                    <span class="shrink-0 faint">{{ new Date(log.timestamp).toLocaleTimeString() }}</span>
                    <span class="shrink-0" :style="{ color: logTone(log.type) }">[{{ log.type }}]</span>
                    <span class="break-words" style="color: var(--text-muted)">{{ log.message }}</span>
                </li>
            </ul>
        </section>

        <p class="text-xs faint pb-2">
            Discord Quest Completer · built with Tauri, Rust and Vue. Discord hides its quest list, so the Quests page
            estimates progress from play time.
        </p>
    </div>
</template>
