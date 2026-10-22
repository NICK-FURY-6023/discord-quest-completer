<script setup lang="ts">
import { computed, provide, ref, useTemplateRef, watch } from 'vue';
import { useIntervalFn, tryOnMounted } from '@vueuse/core';
import { invoke } from '@tauri-apps/api/core';
import { path } from '@tauri-apps/api';
import { emit } from '@tauri-apps/api/event';
import { randomString } from '@/utils/random-string';
import { GameActionsProvider, GameExecutable, type Game } from '@/types/types';
import IconVerified from '@/components/IconVerified.vue';
import { isEmpty } from 'lodash-es';
import GameExecutables from '@/components/GameExecutables.vue';
import GameSearch from '@/components/GameSearch.vue';
import { GameActionsKey, getCurrentOS } from '@/constants/constants';
import { normalizeGame, useFetchGameList } from '@/composables/fetch-gamelist';
import { useGlobalState } from '@/composables/app-state';

type DialogKey =
    'none' |
    'rpc_message_1' |
    'no_game_selected';

const {
    gameDB,
    info,
    isReady,
    isRefreshing,
    lastError,
    fetchGameList,
} = useFetchGameList();
const { addLog } = useGlobalState();

const dialogRef = useTemplateRef<HTMLDialogElement>('dialogRef');
const customGameDialogRef = useTemplateRef<HTMLDialogElement>('customGameDialogRef');
const dialogMessage = ref('');
const isDialogOpen = ref(false);
const dialogKey = ref<DialogKey>('none');
const isConnectedToRPC = ref(false);
const isConnecting = ref(false);

// Selected games list
const gameList = ref<Game[]>([]);
const selectedGameId = ref<string | null | undefined>(null);

const selectedGame = computed(() => {
    if (!selectedGameId.value) return null;
    return gameList.value.find(g => g.uid === selectedGameId.value) ?? null;
});

/* ------------------------------------------------------------------ *
 * Persistence of the selected games
 * ------------------------------------------------------------------ */
const SELECTED_GAMES_KEY = 'dqc:selected-games:v1';

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

function persistSelectedGames() {
    try {
        localStorage.setItem(SELECTED_GAMES_KEY, JSON.stringify(gameList.value.map(toStorableGame)));
    } catch {
        addLog('error', 'Could not save the selected games list.');
    }
}

function restoreSelectedGames() {
    try {
        const raw = localStorage.getItem(SELECTED_GAMES_KEY);
        if (!raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;

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
        gameList.value = restored;
        if (restored.length) {
            addLog('info', `Restored ${restored.length} game(s) from your previous session.`);
        }
    } catch {
        addLog('error', 'Saved game list could not be restored.');
    }
}

function addGameToList(game: Game) {
    if (gameList.value.some(g => g.id === game.id)) {
        addLog('warning', `${game.name} is already in your list.`);
        return;
    }

    // Deep copy the executables: the search list must never be mutated by play/stop state.
    gameList.value.push({
        ...game,
        uid: randomString(),
        is_running: false,
        is_installed: false,
        executables: game.executables.map(exe => ({ ...exe, is_running: false, is_installed: false })),
    });
    persistSelectedGames();
}

const forceRerenderKey = ref(0);

function removeGameFromList(game: Game) {
    const gameId = game.uid;
    gameList.value = gameList.value.filter(item => item.uid !== gameId);
    sessions.value = sessions.value.filter(session => session.gameUid !== gameId);
    if (selectedGame.value?.uid === gameId) {
        selectedGameId.value = null;
        forceRerenderKey.value++;
    }
    persistSelectedGames();
}

function selectGame(game: Game) {
    selectedGameId.value = game?.uid;
}

function canPlayGame(game: Game | null) {
    if (!game) {
        return false;
    }
    return (game.is_installed && !game.is_running) ?? false;
}

function isExecutableRunning(executable: GameExecutable) {
    return executable.is_running ?? false;
}
function isGameExecutableInstalled(executable: GameExecutable) {
    return executable.is_installed ?? false;
}

function isGameInstalled(game: Game | null) {
    if (!game) {
        return false;
    }
    return game.is_installed ?? false;
}

/* ------------------------------------------------------------------ *
 * Running sessions (quest progress + auto-stop)
 * ------------------------------------------------------------------ */
interface GameSession {
    key: string;
    gameUid: string;
    gameName: string;
    executable: GameExecutable;
    startedAt: number;
}

const sessions = ref<GameSession[]>([]);
const now = ref(Date.now());
// Off by default: a session keeps the game running (Discord shows it playing)
// until it is stopped explicitly. Auto-stop is only for people who want a cap.
const autoStopEnabled = ref(false);
const autoStopMinutes = ref(15);

useIntervalFn(() => {
    now.value = Date.now();
}, 1000);

function autoStopLimitMinutes(): number {
    // The number input can be empty, which gives NaN.
    const minutes = Number(autoStopMinutes.value);
    return Math.min(Math.max(Number.isFinite(minutes) ? minutes : 15, 1), 180);
}

const targetMinutes = computed(() => (autoStopEnabled.value ? autoStopLimitMinutes() : 15));

function sessionElapsed(session: GameSession): number {
    return Math.max(0, Math.floor((now.value - session.startedAt) / 1000));
}

function formatDuration(totalSeconds: number): string {
    const safe = Math.max(0, totalSeconds);
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function sessionProgress(session: GameSession): number {
    return Math.min(100, (sessionElapsed(session) / (targetMinutes.value * 60)) * 100);
}

function startSession(game: Game, executable: GameExecutable) {
    const key = `${game.id}:${executable.name}`;
    sessions.value = [
        ...sessions.value.filter(session => session.key !== key),
        {
            key,
            gameUid: game.uid ?? game.id,
            gameName: game.name,
            executable,
            startedAt: Date.now(),
        },
    ];
}

function endSession(game: Game, executable: GameExecutable) {
    const key = `${game.id}:${executable.name}`;
    sessions.value = sessions.value.filter(session => session.key !== key);
}

function stopSession(session: GameSession) {
    // Drop the session first so a slow stop can never be requested twice.
    sessions.value = sessions.value.filter(item => item.key !== session.key);

    const game = gameList.value.find(item => item.uid === session.gameUid);
    if (!game) {
        return;
    }
    void stopPlaying({ game, executable: session.executable });
}

watch(now, () => {
    if (!autoStopEnabled.value) {
        return;
    }
    const limitSeconds = autoStopLimitMinutes() * 60;

    for (const session of [...sessions.value]) {
        if (sessionElapsed(session) < limitSeconds) {
            continue;
        }
        const game = gameList.value.find(item => item.uid === session.gameUid);
        if (!game) {
            sessions.value = sessions.value.filter(item => item.key !== session.key);
            continue;
        }
        sessions.value = sessions.value.filter(item => item.key !== session.key);
        addLog('info', `Auto-stopped ${session.gameName} after ${autoStopMinutes.value} minute(s).`);
        void stopPlaying({ game, executable: session.executable });
    }
});

/* ------------------------------------------------------------------ *
 * Custom game (any Discord app ID, not just detectable ones)
 * ------------------------------------------------------------------ */
const customGame = ref({ appId: '', name: '', executable: '' });
const customGameError = ref<string | null>(null);

function openCustomGameDialog() {
    customGameError.value = null;
    customGame.value = { appId: '', name: '', executable: '' };
    customGameDialogRef.value?.showModal();
}

function closeCustomGameDialog() {
    customGameDialogRef.value?.close();
}

function submitCustomGame() {
    const appId = customGame.value.appId.trim();
    const name = customGame.value.name.trim();
    const executableName = customGame.value.executable.trim();

    if (!/^\d{5,}$/.test(appId)) {
        customGameError.value = 'App ID must be the numeric Discord application ID (e.g. 356875221078245376).';
        return;
    }
    if (!name) {
        customGameError.value = 'Give the game a name.';
        return;
    }
    if (!executableName) {
        customGameError.value = 'Enter the executable name Discord should detect (e.g. game.exe).';
        return;
    }
    if (gameList.value.some(game => game.id === appId)) {
        customGameError.value = 'That app ID is already in your list.';
        return;
    }

    addGameToList({
        id: appId,
        name,
        aliases: [],
        themes: [],
        launchable: true,
        is_custom: true,
        executables: [{ is_launcher: false, name: executableName, os: getCurrentOS() }],
    });
    addLog('info', `Added custom game: ${name} (${appId}).`);
    closeCustomGameDialog();
}

/* ------------------------------------------------------------------ *
 * Game actions
 * ------------------------------------------------------------------ */
async function createDummyGame(game: Game | null, executable: GameExecutable) {
    if (!game) {
        return;
    }
    const gameUid = game.uid;
    const gameToInstall = gameList.value.find(g => g.uid === gameUid);
    const executableItem = gameToInstall?.executables.find(exe => exe.name === executable.name);
    if (gameToInstall && executableItem) {
        const payload = {
            path: executable.path,
            executable_name: executable.filename,
            path_len: executable.segments,
            app_id: Number(gameToInstall.id),
            display_name: gameToInstall.name,
        }
        const result = await invoke('create_fake_game', payload)
        gameToInstall.is_installed = true;
        executableItem.is_installed = true;
        return result ?? true;
    }
}

async function installAndPlay({ game, executable }: { game: Game, executable: GameExecutable }) {
    if (!game) {
        return;
    }
    const gameCreated = await createDummyGame(game, executable);
    if (gameCreated) {
        playGame({ game, executable });
    } else {
        addLog('error', 'Failed to create game');
    }
}

async function playGame({ game, executable }: { game: Game, executable: GameExecutable }) {
    if (!game) {
        return;
    }
    const gameUid = game.uid;
    try {
        addLog('info', `Playing game: ${game.name}`);
        addLog('info', `Executable: ${executable.name}`);

        const gameToPlay = gameList.value.find(g => g.uid === gameUid);
        const executableItem = gameToPlay?.executables.find(exe => exe.name === executable.name);
        if (gameToPlay && executableItem) {
            const payload = {
                name: game.name,
                path: executable.path,
                executable_name: executable.filename,
                path_len: executable.segments,
                app_id: Number(gameToPlay.id),
                exec_path: path.join(executable.path!, executable.filename!),
            }
            await invoke('run_background_process', payload);
            gameToPlay.is_running = true;
            executableItem.is_running = true;
            // Keep the launch details (filename/path/segments) so the session can stop the process.
            startSession(gameToPlay, { ...executableItem, ...executable });
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addLog('error', `Failed to launch game: ${message}`);
    }
}

async function stopPlaying({ game, executable }: { game: Game, executable: GameExecutable }) {
    if (!game) {
        return;
    }
    const gameUid = game.uid;

    const gameToPlay = gameList.value.find(g => g.uid === gameUid);
    const executableItem = gameToPlay?.executables.find(exe => exe.name === executable.name);
    if (gameToPlay && executableItem) {
        try {
            await invoke('stop_process', {
                exec_name: executable.filename!
            })
            addLog('info', `Stopped game process: ${game.name}`);
            addLog('info', `Stopped Executable: ${executable.name}`);
        } catch (error) {
            const errorMessage = (error instanceof Error) ? error.message : String(error);
            addLog('error', 'Failed to stop game process: ' + errorMessage);
        } finally {
            gameToPlay.is_running = false;
            executableItem.is_running = false;
            endSession(gameToPlay, executableItem);
        }
    } else {
        sessions.value = sessions.value.filter(session => session.key !== `${game.id}:${executable.name}`);
    }
}

/* ------------------------------------------------------------------ *
 * Discord Rich Presence (experimental)
 * ------------------------------------------------------------------ */
async function handleTestRPC(game: Game | null) {
    const state = isConnectedToRPC.value ? 'disconnect' : 'connect';

    if (!game && state === 'connect') {
        showDialog('no_game_selected');
        return;
    }
    if (state === 'disconnect' || isConnecting.value) {
        emit('event_disconnect');

        isConnectedToRPC.value = false;
        game!.is_running = false;
        isConnecting.value = false;
        return;
    }
    showDialog('rpc_message_1');
}

async function continueRPCRisk(game: Game | null) {
    if (!game) {
        return;
    }
    const gameUid = game.uid;
    const gameToTest = gameList.value.find(g => g.uid === gameUid);
    if (gameToTest) {
        isConnecting.value = true;
        invoke('connect_to_discord_rpc_3', {
            activity_json: JSON.stringify({
                app_id: gameToTest.id,
            }),
            action: 'connect',
        })
            .then(() => {
                isConnectedToRPC.value = true;
                gameToTest.is_running = true;
                isConnecting.value = false;
            })
            .catch((error: unknown) => {
                isConnecting.value = false;
                addLog('error', 'Failed to connect to Discord RPC: ' + (error instanceof Error ? error.message : String(error)));
            });

        hideDialog();
    }
}

function showDialog(message: DialogKey) {
    isDialogOpen.value = true;
    dialogMessage.value = message;
    dialogKey.value = message;
    if (!isEmpty(message)) {
        dialogRef.value?.showModal();
    }
}

function hideDialog() {
    dialogRef.value?.close();
    dialogMessage.value = '';
    isDialogOpen.value = false;
}

tryOnMounted(() => {
    restoreSelectedGames();
});

provide<GameActionsProvider>(GameActionsKey, {
    canPlayGame,
    isGameInstalled,
    isExecutableRunning,
    isGameExecutableInstalled,
});
</script>

<template>
    <div class="container mx-auto px-4 py-8">
        <!-- Center dialog -->
        <dialog id="dialog" class="dialogStyle inset-0 bg-gray-800 bg-opacity-50
        border border-gray-300 dark:border-gray-600 rounded-lg
        transition-opacity duration-300 ease-in-out z-50
        "
        style="left: 50%; top: 50%; transform: translate(-50%, -50%)"
        ref="dialogRef">
            <div class="flex flex-col items-center justify-center p-6">
                <div class="mb-4 text-gray-500 dark:text-gray-400">
                    <div v-if="dialogKey === 'rpc_message_1'">
                        <p>
                            This is only a feature in development.
                        </p>
                        <p class="my-2">
                            It works but due to the nature that it tricks Discord into thinking you are playing a game
                            by sending an RPC using actual game ID rather than letting Discord detect you have a game/application running.
                        </p>
                        <p>
                            This may flag your account as suspicious for self-botting.
                        </p>
                    </div>

                    <div v-if="dialogKey === 'no_game_selected'">
                        <p>
                            No game selected. Please select a game from the list on the left.
                        </p>
                    </div>
                </div>
                <div class="gap-2 flex">
                    <button
                        class="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300
                        border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-1"
                        @click="hideDialog()">
                        <span v-if="dialogKey == 'rpc_message_1'">
                            Cancel
                        </span>
                        <span v-else>OK</span>
                    </button>

                    <button v-if="dialogKey === 'rpc_message_1'"
                        class="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300
                        border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-1"
                        @click="continueRPCRisk(selectedGame)">
                        Accept risk and continue
                    </button>
                </div>
            </div>
        </dialog>

        <!-- Custom game dialog -->
        <dialog ref="customGameDialogRef" class="dialogStyle inset-0 bg-gray-800 bg-opacity-50
        border border-gray-300 dark:border-gray-600 rounded-lg z-50"
            style="left: 50%; top: 50%; transform: translate(-50%, -50%)">
            <form class="flex flex-col gap-3 p-6 w-[min(90vw,26rem)]" @submit.prevent="submitCustomGame">
                <h2 class="text-lg font-bold text-gray-900 dark:text-white">Add custom game</h2>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                    Use this for Discord apps that are not in the detectable list. The app ID is the number
                    from the game's Discord application, and the executable is the file name Discord watches for.
                </p>

                <label class="text-sm text-gray-700 dark:text-gray-300">
                    App ID
                    <input v-model="customGame.appId" inputmode="numeric" placeholder="356875221078245376"
                        class="mt-1 w-full px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
                </label>
                <label class="text-sm text-gray-700 dark:text-gray-300">
                    Game name
                    <input v-model="customGame.name" placeholder="Overwatch"
                        class="mt-1 w-full px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
                </label>
                <label class="text-sm text-gray-700 dark:text-gray-300">
                    Executable name
                    <input v-model="customGame.executable" placeholder="overwatch.exe"
                        class="mt-1 w-full px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
                </label>

                <p v-if="customGameError" class="text-xs text-red-400">{{ customGameError }}</p>

                <div class="flex justify-end gap-2 mt-2">
                    <button type="button"
                        class="px-4 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400"
                        @click="closeCustomGameDialog">
                        Cancel
                    </button>
                    <button type="submit" class="px-4 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white">
                        Add game
                    </button>
                </div>
            </form>
        </dialog>

        <h1 class="text-3xl font-bold text-gray-900 dark:text-white mb-6 text-center">
            Handler
        </h1>

        <!-- Game list fetch status -->
        <div class="mb-3 flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
            <div class="flex items-center gap-2 min-w-0">
                <span class="w-2 h-2 rounded-full shrink-0"
                    :class="isRefreshing ? 'bg-amber-400 animate-pulse' : lastError ? 'bg-amber-500' : 'bg-green-500'"></span>
                <span class="truncate">
                    <template v-if="!isReady">Loading game list...</template>
                    <template v-else>
                        {{ info.total.toLocaleString() }} games
                        <template v-if="info.launchable"> &middot; {{ info.launchable.toLocaleString() }} launchable</template>
                        <template v-if="info.source"> &middot; from {{ info.source }}</template>
                    </template>
                </span>
            </div>
            <button v-if="lastError" class="text-indigo-500 hover:underline shrink-0" @click="fetchGameList">
                Retry
            </button>
        </div>
        <p v-if="lastError" class="mb-3 text-xs text-amber-500 break-words">
            Could not refresh the game list: {{ lastError }}
        </p>

        <!-- Search Bar -->
        <div class="mb-8">
            <GameSearch :games="gameDB" :is-ready="isReady" :is-refreshing="isRefreshing" :info="info"
                @add="addGameToList" @refresh="fetchGameList" />
            <div class="mt-2 flex items-start justify-between gap-3">
                <p class="text-xs text-gray-500 dark:text-gray-400">
                    Discord quests usually need the game to run for about 15 minutes.
                </p>
                <button class="text-xs text-indigo-500 hover:underline shrink-0" @click="openCustomGameDialog">
                    + Add custom game
                </button>
            </div>
        </div>

        <!-- Two-Column Layout with right fixed column -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
            <!-- Left Column: Selected Games (scrollable) -->
            <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-4 sticky top-0 bg-white dark:bg-gray-800 py-2 z-10">
                    Games</h2>
                <div v-if="gameList.length === 0" class="text-gray-500 dark:text-gray-400 text-center py-8">
                    No games selected. Search and add games from the search bar.
                </div>
                <div v-else class="space-y-4">
                    <div v-for="game in gameList" :key="game.id"
                        class="p-3 border border-gray-200 dark:border-gray-700 rounded-lg
                        hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors
                        duration-200 ease-in-out"
                        :class="[
                            {
                                'ring-1 ring-violet-500/40 shadow-[0px_0px_8px_2px_#8e51ff50] bg-gray-100 dark:bg-gray-700/40': selectedGame?.uid === game.uid,
                            }
                        ]" @click="selectGame(game)">
                        <div class="flex justify-between items-center">
                            <div class="flex items-center gap-1 min-w-0">
                                <div class="font-medium text-gray-800 dark:text-white truncate">{{ game.name }}</div>
                                <div class="relative inline-flex items-center shrink-0">
                                    <div class="w-2 h-2 bg-white absolute rounded-full"
                                        style="left: 50%; top: 50%; transform: translate(-50%, -50%)"></div>
                                    <div class="relative inline-block">
                                        <IconVerified class="w-5 h-5 text-indigo-500 dark:text-indigo-400"></IconVerified>
                                    </div>
                                </div>
                                <span v-if="game.is_custom"
                                    class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 shrink-0">
                                    custom
                                </span>
                            </div>
                            <button @click.stop="removeGameFromList(game)" class="text-red-300 hover:text-red-400 shrink-0"
                                v-if="!game.is_running">
                                Remove
                            </button>
                        </div>
                        <div class="flex space-x-2 mt-2">
                            <div class="text-sm text-green-500 dark:text-green-400" v-if="game.is_running">
                                Running
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Right Column: Game Actions -->
            <div class="bg-white dark:bg-gray-800 p-4 rounded-lg shadow md:sticky md:top-4 self-start" :key="forceRerenderKey">
                <h2 class="text-xl font-bold text-gray-900 dark:text-white mb-4">Game Actions</h2>
                <div class="space-y-4">
                    <div class="text-gray-500 dark:text-gray-400 mb-2 text-sm" v-if="!selectedGame">
                        Select a game from the left to perform actions.
                    </div>

                    <div v-if="selectedGame" class="text-gray-500 dark:text-gray-400 mb-4 text-sm">
                        <strong>Name:</strong> {{ selectedGame.name }}<br>
                        <strong>ID:</strong> {{ selectedGame.id }}<br>
                        <strong v-if="selectedGame.aliases && selectedGame.aliases.length > 0">Aliases:</strong>
                        <ul v-if="selectedGame.aliases && selectedGame.aliases.length > 0" class="list-disc list-inside">
                            <li v-for="alias in selectedGame.aliases" :key="alias" class="text-gray-500 dark:text-gray-400">
                                <span class="font-mono">{{ alias }}</span>
                            </li>
                        </ul>
                    </div>
                    <button @click="handleTestRPC(selectedGame)"
                        class="w-full py-2 rounded-lg bg-gray-600 hover:bg-gray-700 text-white">
                        {{ isConnecting || isConnectedToRPC ? 'Disconnect to Discord Gateway' : 'Test RPC' }}
                    </button>

                    <div class="border-t border-gray-200 dark:border-gray-700 my-4"></div>

                    <GameExecutables v-if="selectedGame" :game="selectedGame" @play="playGame" @stop="stopPlaying"
                        @install_and_play="installAndPlay" />
                </div>

                <div class="border-t border-gray-200 dark:border-gray-700 my-5"></div>

                <div class="mt-6 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                    <h3 class="font-medium text-gray-800 dark:text-white mb-2">Status</h3>
                    <div class="text-sm text-gray-500 dark:text-gray-400 mb-2">
                        Check Discord to see if it displays that you are playing a game.
                    </div>

                    <div v-if="sessions.length === 0" class="text-gray-500 dark:text-gray-400">
                        Not playing any game
                    </div>
                    <div v-else class="space-y-3">
                        <div v-for="session in sessions" :key="session.key" class="text-sm">
                            <div class="flex items-center justify-between gap-2">
                                <span class="text-gray-700 dark:text-gray-300 truncate">{{ session.gameName }}</span>
                                <button class="text-red-400 hover:text-red-300 shrink-0" @click="stopSession(session)">
                                    Stop
                                </button>
                            </div>
                            <div class="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                                {{ session.executable.name }}
                            </div>
                            <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                {{ formatDuration(sessionElapsed(session)) }} elapsed &middot;
                                <template v-if="autoStopEnabled">
                                    stops in {{ formatDuration(targetMinutes * 60 - sessionElapsed(session)) }}
                                </template>
                                <template v-else>running until you press Stop</template>
                            </div>
                            <div v-if="autoStopEnabled" class="mt-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
                                <div class="h-full bg-green-500 rounded transition-all duration-500"
                                    :style="{ width: sessionProgress(session) + '%' }"></div>
                            </div>
                        </div>
                    </div>

                    <label class="mt-4 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <input v-model="autoStopEnabled" type="checkbox" class="accent-indigo-600" />
                        Auto-stop after
                        <input v-model.number="autoStopMinutes" type="number" min="1" max="180"
                            class="w-16 px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                            :disabled="!autoStopEnabled" />
                        min
                    </label>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
@reference "../theme/style.css";

.dialogStyle::backdrop {
    @apply bg-black/70 backdrop-blur-xs;
}
</style>
