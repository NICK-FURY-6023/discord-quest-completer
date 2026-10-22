<template>
    <div>
        <p v-if="isMac" class="mb-3 text-xs faint">
            A small game window opens while playing. Discord on macOS usually only detects apps with a visible window.
        </p>

        <h3 v-if="filteredExecutables.length > 0" class="text-sm font-medium mb-3" style="color: var(--text)">
            Select an executable to launch:
        </h3>

        <p v-if="usingCrossPlatformFallback" class="text-xs mb-2" style="color: var(--warning)">
            No {{ currentPlatform }} executable is registered for this game. Using another platform's executable name as
            a fallback.
        </p>

        <p v-if="filteredExecutables.length === 0" class="text-sm" style="color: var(--warning)">
            Either Discord has not registered any launchable executables for this game,
            or there are no executables available for your platform ({{ currentPlatform }}).
        </p>

        <div class="space-y-2">
            <div v-for="executable in filteredExecutables" :key="executable.name"
                class="panel-soft p-3 grid grid-cols-[auto_1fr_auto] gap-2 items-center w-full">
                <span class="chip">{{ executable.os }}</span>

                <div class="relative overflow-hidden min-w-0">
                    <div class="flex flex-nowrap overflow-x-auto scrollbar-none max-w-full pr-4 fade-right">
                        <div v-for="(section, i) in splitExecutableName(executable)" :key="i"
                            class="border rounded-md px-2 py-1 mr-1 whitespace-nowrap text-xs font-mono"
                            style="border-color: var(--border); color: var(--text-muted)">
                            {{ section }}
                        </div>
                    </div>
                </div>

                <button class="btn text-xs justify-self-end"
                    :class="executable.is_running ? 'btn-danger' : 'btn-accent'" @click="handleLaunch(executable)">
                    {{ executable.is_running ? 'Stop' : 'Play' }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { GameActionsKey, getCurrentOS, isMacOS } from '@/constants/constants';
import { GameActionsProvider, type Game, type GameExecutable } from '@/types/types';
import { path } from '@tauri-apps/api';
import { computed, inject } from 'vue';

const props = defineProps<{
    game: Game
}>();

const emit = defineEmits<{
    play: [{ game: Game, executable: GameExecutable }]
    stop: [{ game: Game, executable: GameExecutable }]
    install_and_play: [{ game: Game, executable: GameExecutable }]
}>();

const gameActions = inject<GameActionsProvider>(GameActionsKey);

function isValidPath(name: string) {
    const illegalChars = ['>', '<', ':', '"', '|', '?', '*'];
    return !illegalChars.some(char => name.includes(char));
}

const validExecutables = computed(() =>
    props.game.executables.filter(executable => isValidPath(executable.name))
);

const currentPlatform = getCurrentOS();

const isMac = isMacOS();

const filteredExecutables = computed(() => {
    const platformMatches = validExecutables.value.filter(
        executable => executable.os === currentPlatform
    );

    if (platformMatches.length > 0) {
        return platformMatches;
    }

    return validExecutables.value;
});

const usingCrossPlatformFallback = computed(() => {
    if (validExecutables.value.length === 0) {
        return false;
    }

    return !validExecutables.value.some(executable => executable.os === currentPlatform);
});

function splitExecutableName(executable: GameExecutable) {
    const allSections = executable.name.split(/\\|\//);

    const last = executable.name.split(/\\|\//).pop();
    // remove file extension if there was none, just return the last section
    const name = last?.split('.').slice(0, -1).join('.') || last;
    return [
        ...allSections.slice(0, -1),
        name,
    ];
}

function getExecutablePath(executable: GameExecutable) {
    const allSections = executable.name.split(/\\|\//);
    const last = executable.name.split(/\\|\//).pop();
    // remove file extension if there was none, just return the last section
    const name = last?.split('.').slice(0, -1).join('.') || last;
    return [
        ...allSections.slice(0, -1)
    ].join(path.sep())
}

function getFilename(executable: GameExecutable) {
    const last = executable.name.split(/\\|\//).pop();
    // remove file extension if there was none, just return the last section
    return last;
}

function handleLaunch(executable: GameExecutable) {
    if (executable.is_running) {
        emit('stop', {
            game: props.game,
            executable: {
                path: getExecutablePath(executable),
                segments: splitExecutableName(executable).length,
                filename: getFilename(executable),
                ...executable,
            },
        });
    } else if (!gameActions?.isGameExecutableInstalled(executable)) {
        emit('install_and_play', {
            game: props.game,
            executable: {
                path: getExecutablePath(executable),
                segments: splitExecutableName(executable).length,
                filename: getFilename(executable),
                ...executable,
            },
        });
    } else {
        emit('play', {
            game: props.game,
            executable: {
                path: getExecutablePath(executable),
                segments: splitExecutableName(executable).length,
                filename: getFilename(executable),
                ...executable,
            },
        });
    }
}
</script>

<style scoped>
.fade-right {
    -webkit-mask-image: linear-gradient(to right, black 85%, transparent 100%);
    mask-image: linear-gradient(to right, black 85%, transparent 100%);
}

.scrollbar-none {
    scrollbar-width: none;
    -ms-overflow-style: none;
}

.scrollbar-none::-webkit-scrollbar {
    display: none;
}
</style>
