<script setup lang="ts">
import { computed, provide, ref, useTemplateRef } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { path } from '@tauri-apps/api';
import { emit } from '@tauri-apps/api/event';
import { GameActionsProvider, GameExecutable, type Game } from '@/types/types';
import IconVerified from '@/components/IconVerified.vue';
import { isEmpty } from 'lodash-es';
import GameExecutables from '@/components/GameExecutables.vue';
import GameSearch from '@/components/GameSearch.vue';
import { GameActionsKey, getCurrentOS } from '@/constants/constants';
import { useFetchGameList } from '@/composables/fetch-gamelist';
import { useGlobalState } from '@/composables/app-state';
import { useSelectedGames } from '@/composables/use-selected-games';
import { useSessions, formatClock } from '@/composables/use-sessions';
import { useSettings } from '@/composables/use-settings';
import { useToasts } from '@/composables/use-toasts';

type DialogKey =
    'none' |
    'rpc_message_1' |
    'no_game_selected' |
    'confirm_stop';

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

// Selected games (shared with Settings, which can clear the list)
const { games: gameList, addGame, removeGame } = useSelectedGames();
const selectedGameId = ref<string | null | undefined>(null);

const selectedGame = computed(() => {
    if (!selectedGameId.value) return null;
    return gameList.value.find(g => g.uid === selectedGameId.value) ?? null;
});

const {
    sessions,
    start: startSession,
    end: endSession,
    requestStop: requestSessionStop,
    setStopHandler,
    elapsed: sessionElapsed,
    progress: sessionProgress,
    remaining: sessionRemaining,
    isComplete: sessionIsComplete,
} = useSessions();
const { settings } = useSettings();
const { push: pushToast } = useToasts();

const forceRerenderKey = ref(0);

function addGameToList(game: Game) {
    const added = addGame(game);
    if (!added) {
        addLog('warning', `${game.name} is already in your list.`);
        return;
    }
    pushToast(`Added ${game.name}`, 'success', 2500);
}

function removeGameFromList(game: Game) {
    removeGame(game.uid);
    if (selectedGameId.value === game.uid) {
        selectedGameId.value = null;
        forceRerenderKey.value++;
    }
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

const pendingStop = ref<{ game: Game, executable: GameExecutable } | null>(null);

async function stopPlaying(
    { game, executable }: { game: Game, executable: GameExecutable },
    options: { confirmed?: boolean } = {},
) {
    if (!game) {
        return;
    }
    if (settings.confirmStop && !options.confirmed) {
        pendingStop.value = { game, executable };
        showDialog('confirm_stop');
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

function confirmPendingStop() {
    const pending = pendingStop.value;
    pendingStop.value = null;
    hideDialog();
    if (pending) {
        void stopPlaying(pending, { confirmed: true });
    }
}

function cancelPendingStop() {
    pendingStop.value = null;
    hideDialog();
}

// Quests/Settings can request a stop without knowing how the process gets killed.
setStopHandler(session => {
    const game = gameList.value.find(item => item.uid === session.gameUid);
    if (game) {
        void stopPlaying({ game, executable: session.executable });
    }
});

provide<GameActionsProvider>(GameActionsKey, {
    canPlayGame,
    isGameInstalled,
    isExecutableRunning,
    isGameExecutableInstalled,
});
</script>

<template>
    <div class="p-6 lg:p-8 max-w-[1150px] mx-auto space-y-6">
        <!-- RPC / info dialogs -->
        <dialog ref="dialogRef" class="dialog-surface p-0 z-50" style="margin: auto">
            <div class="p-6 max-w-md">
                <div class="text-sm space-y-2 muted">
                    <template v-if="dialogKey === 'rpc_message_1'">
                        <h2 class="text-base font-semibold" style="color: var(--text)">Test RPC (experimental)</h2>
                        <p>
                            This tricks Discord into thinking you are playing a game by sending an RPC with the real
                            game ID, instead of letting Discord detect a running process.
                        </p>
                        <p>This may flag your account as suspicious for self-botting.</p>
                    </template>
                    <template v-else-if="dialogKey === 'no_game_selected'">
                        <p>No game selected. Pick one from your list on the left first.</p>
                    </template>
                    <template v-else-if="dialogKey === 'confirm_stop'">
                        <h2 class="text-base font-semibold" style="color: var(--text)">Stop the game?</h2>
                        <p>This kills the runner process, so Discord stops showing the game.</p>
                    </template>
                </div>
                <div class="flex justify-end gap-2 mt-5">
                    <template v-if="dialogKey === 'confirm_stop'">
                        <button class="btn btn-quiet" @click="cancelPendingStop">Cancel</button>
                        <button class="btn btn-accent" @click="confirmPendingStop">Stop game</button>
                    </template>
                    <template v-else>
                        <button class="btn btn-quiet" @click="hideDialog()">
                            {{ dialogKey === 'rpc_message_1' ? 'Cancel' : 'OK' }}
                        </button>
                        <button v-if="dialogKey === 'rpc_message_1'" class="btn btn-accent"
                            @click="continueRPCRisk(selectedGame)">
                            Accept risk and continue
                        </button>
                    </template>
                </div>
            </div>
        </dialog>

        <!-- Custom game dialog -->
        <dialog ref="customGameDialogRef" class="dialog-surface p-0 z-50" style="margin: auto">
            <form class="flex flex-col gap-3 p-6 w-[min(90vw,26rem)]" @submit.prevent="submitCustomGame">
                <h2 class="text-lg font-bold" style="color: var(--text)">Add custom game</h2>
                <p class="text-xs faint">
                    For Discord apps that are not in the detectable list. The app ID is the number from the game's
                    Discord application, and the executable is the file name Discord watches for.
                </p>

                <label class="text-sm muted">
                    App ID
                    <input v-model="customGame.appId" inputmode="numeric" placeholder="356875221078245376"
                        class="input mt-1" />
                </label>
                <label class="text-sm muted">
                    Game name
                    <input v-model="customGame.name" placeholder="Overwatch" class="input mt-1" />
                </label>
                <label class="text-sm muted">
                    Executable name
                    <input v-model="customGame.executable" placeholder="overwatch.exe" class="input mt-1" />
                </label>

                <p v-if="customGameError" class="text-xs" style="color: var(--danger)">{{ customGameError }}</p>

                <div class="flex justify-end gap-2 mt-2">
                    <button type="button" class="btn btn-quiet" @click="closeCustomGameDialog">Cancel</button>
                    <button type="submit" class="btn btn-accent">Add game</button>
                </div>
            </form>
        </dialog>

        <header class="flex items-start justify-between gap-4 flex-wrap">
            <div>
                <h1 class="text-2xl font-bold" style="color: var(--text)">Home</h1>
                <p class="text-sm mt-1 muted">Add a game, press Play, and Discord will show it as playing.</p>
            </div>
            <div class="flex flex-col items-end gap-1 text-xs">
                <span class="chip">
                    <span class="dot" :class="isRefreshing ? 'dot-busy' : lastError ? 'dot-off' : 'dot-live'"></span>
                    <template v-if="!isReady">Loading game list...</template>
                    <template v-else>{{ info.total.toLocaleString() }} games · {{ info.launchable.toLocaleString() }}
                        launchable</template>
                </span>
                <span class="faint">
                    source: {{ info.source || 'unknown' }}
                    <button v-if="lastError" class="underline ml-1" @click="fetchGameList">Retry</button>
                </span>
            </div>
        </header>

        <p v-if="lastError" class="panel-soft p-3 text-xs" style="color: var(--warning)">
            Could not refresh the game list: {{ lastError }}
        </p>

        <!-- Search -->
        <section class="panel p-4">
            <GameSearch :games="gameDB" :is-ready="isReady" :is-refreshing="isRefreshing" :info="info"
                @add="addGameToList" @refresh="fetchGameList" />
            <div class="mt-3 flex items-start justify-between gap-3 text-xs">
                <p class="faint">Discord quests usually need about {{ settings.questMinutes }} minutes of play time.</p>
                <button class="btn btn-ghost text-xs" @click="openCustomGameDialog">+ Add custom game</button>
            </div>
        </section>

        <div class="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-5 items-start">
            <!-- Selected games -->
            <section class="panel p-5">
                <div class="flex items-center justify-between gap-3 mb-3">
                    <h2 class="font-semibold" style="color: var(--text)">Your games</h2>
                    <span class="chip">{{ gameList.length }}</span>
                </div>

                <div v-if="!gameList.length" class="py-10 text-center">
                    <p class="text-sm muted">No games yet. Search above to add one.</p>
                </div>

                <div v-else class="space-y-2.5">
                    <div v-for="game in gameList" :key="game.uid" class="game-card p-3"
                        :class="{ 'game-card-active': selectedGame?.uid === game.uid }" data-game-card
                        @click="selectGame(game)">
                        <div class="flex items-center justify-between gap-2">
                            <div class="flex items-center gap-1.5 min-w-0">
                                <span class="font-medium truncate" style="color: var(--text)">{{ game.name }}</span>
                                <IconVerified class="w-4 h-4 shrink-0" style="color: var(--accent)" />
                                <span v-if="game.is_custom" class="chip chip-accent">custom</span>
                            </div>
                            <button v-if="!game.is_running" class="btn btn-ghost text-xs shrink-0"
                                @click.stop="removeGameFromList(game)">Remove</button>
                        </div>
                        <div class="flex items-center gap-2 mt-1.5 text-xs faint">
                            <span class="dot" :class="game.is_running ? 'dot-live' : ''"></span>
                            <span>{{ game.is_running ? 'Running' : 'Idle' }}</span>
                            <span>·</span>
                            <span class="truncate">ID {{ game.id }}</span>
                        </div>
                    </div>
                </div>
            </section>

            <!-- Actions + now playing -->
            <div class="space-y-5" :key="forceRerenderKey">
                <section class="panel p-5">
                    <h2 class="font-semibold mb-3" style="color: var(--text)">Game actions</h2>

                    <p v-if="!selectedGame" class="text-sm muted">Select a game on the left.</p>

                    <template v-else>
                        <div class="space-y-1 text-sm">
                            <p style="color: var(--text)">{{ selectedGame.name }}</p>
                            <p class="text-xs faint">ID {{ selectedGame.id }}</p>
                            <p v-if="selectedGame.aliases?.length" class="text-xs faint">
                                Alias: {{ selectedGame.aliases.slice(0, 3).join(', ') }}
                            </p>
                        </div>

                        <button class="btn btn-quiet w-full mt-4" @click="handleTestRPC(selectedGame)">
                            {{ isConnecting || isConnectedToRPC ? 'Disconnect from Discord Gateway' : 'Test RPC (experimental)' }}
                        </button>

                        <div class="divider my-4"></div>

                        <GameExecutables :game="selectedGame" @play="playGame" @stop="stopPlaying"
                            @install_and_play="installAndPlay" />
                    </template>
                </section>

                <section class="panel p-5">
                    <div class="flex items-center justify-between gap-2 mb-2">
                        <h2 class="font-semibold" style="color: var(--text)">Now playing</h2>
                        <span class="chip" :class="sessions.length ? 'chip-success' : ''">
                            <span class="dot" :class="sessions.length ? 'dot-live' : ''"></span>
                            {{ sessions.length ? 'live' : 'idle' }}
                        </span>
                    </div>
                    <p class="text-xs faint mb-3">Check Discord to confirm it shows you playing.</p>

                    <p v-if="!sessions.length" class="text-sm muted">Not playing any game.</p>

                    <div v-else class="space-y-3">
                        <article v-for="session in sessions" :key="session.key" class="panel-soft p-3" data-session>
                            <div class="flex items-center justify-between gap-2">
                                <div class="min-w-0">
                                    <p class="text-sm truncate" style="color: var(--text)">{{ session.gameName }}</p>
                                    <p class="text-xs font-mono truncate faint">{{ session.executable.name }}</p>
                                </div>
                                <button class="btn btn-danger text-xs shrink-0"
                                    @click="requestSessionStop(session)">Stop</button>
                            </div>
                            <div class="progress-track mt-2">
                                <div class="progress-fill"
                                    :class="{ 'progress-fill-done': sessionIsComplete(session) }"
                                    :style="{ width: sessionProgress(session) + '%' }"></div>
                            </div>
                            <p class="text-xs mt-1.5 faint">
                                {{ formatClock(sessionElapsed(session)) }} elapsed ·
                                <template v-if="sessionIsComplete(session)">estimated quest time reached</template>
                                <template v-else>{{ formatClock(sessionRemaining(session)) }} to estimate</template>
                            </p>
                        </article>
                    </div>
                </section>
            </div>
        </div>
    </div>
</template>

<style scoped>
.dialog-surface {
    max-height: 85vh;
    overflow: auto;
}
</style>
