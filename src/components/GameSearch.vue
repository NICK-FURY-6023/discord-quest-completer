<script setup lang="ts">
import { computed, ref, useTemplateRef, toRef } from 'vue';
import { onClickOutside } from '@vueuse/core';
import type { Game } from '@/types/types';
import type { GameListInfo } from '@/composables/fetch-gamelist';
import { useGameSearch } from '@/composables/use-game-search';

const props = defineProps<{
    games: Game[];
    isReady: boolean;
    isRefreshing: boolean;
    info: GameListInfo | null;
}>();

const emit = defineEmits<{
    add: [game: Game];
    refresh: [];
}>();

const rootRef = useTemplateRef<HTMLElement>('rootRef');
const inputRef = useTemplateRef<HTMLInputElement>('inputRef');
const open = ref(false);

const {
    platform,
    query,
    isSearchPending,
    onlyLaunchable,
    platformOnly,
    results,
    totalMatches,
    hasMore,
    loadMore,
    activeIndex,
    moveActive,
    setActive,
    clear,
    poolSize,
    launchableCount,
    listSize,
} = useGameSearch(toRef(props, 'games'));

const trimmedQuery = computed(() => query.value.trim());
const showNoResult = computed(() => props.isReady && !isSearchPending.value && trimmedQuery.value.length > 0 && totalMatches.value === 0);

onClickOutside(rootRef, () => {
    open.value = false;
});

function focusInput() {
    open.value = true;
    inputRef.value?.focus();
}

function clearSearch() {
    clear();
    focusInput();
}

function addGame(game: Game) {
    emit('add', game);
    open.value = false;
    query.value = '';
}

function onKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        open.value = true;
        moveActive(1);
        return;
    }
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        open.value = true;
        moveActive(-1);
        return;
    }
    if (event.key === 'Enter') {
        if (isSearchPending.value) {
            return;
        }
        const game = results.value[activeIndex.value];
        if (open.value && game) {
            event.preventDefault();
            addGame(game);
        }
        return;
    }
    if (event.key === 'Escape') {
        open.value = false;
        inputRef.value?.blur();
    }
}

function sourceLabel(source: GameListInfo['source']): string {
    switch (source) {
        case 'mirror':
            return 'Discord mirror';
        case 'discord':
            return 'Discord';
        case 'cache':
            return 'saved copy';
        case 'bundled':
            return 'bundled copy';
        default:
            return 'unknown source';
    }
}

function executablesForPlatform(game: Game) {
    const matches = game.executables.filter(exe => exe.os === platform);
    return matches.length ? matches : game.executables;
}
</script>

<template>
    <div ref="rootRef" class="relative">
        <div class="relative">
            <input ref="inputRef" v-model="query" type="text" role="combobox" aria-controls="game-search-results"
                :aria-expanded="open" aria-autocomplete="list" placeholder="Search games by name, alias or app ID..."
                class="w-full pl-4 pr-40 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:text-white"
                @focus="open = true" @keydown="onKeydown" />

            <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <button v-if="query" class="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                    title="Clear search" @mousedown.prevent @click="clearSearch">
                    Clear
                </button>
                <button
                    class="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-700 dark:text-white rounded-md disabled:opacity-60 disabled:cursor-not-allowed"
                    :disabled="isRefreshing" @click="emit('refresh')">
                    <span class="whitespace-nowrap">
                        {{ isRefreshing ? 'Refreshing...' : 'Refresh list' }}
                    </span>
                </button>
            </div>
        </div>

        <div v-if="open"
            class="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-96 overflow-y-auto">
            <!-- filters + list info -->
            <div class="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-3 py-2">
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                    <label class="flex items-center gap-1 cursor-pointer">
                        <input v-model="onlyLaunchable" type="checkbox" class="accent-indigo-600" />
                        Launchable only
                    </label>
                    <label class="flex items-center gap-1 cursor-pointer">
                        <input v-model="platformOnly" type="checkbox" class="accent-indigo-600" />
                        {{ platform }} executables only
                    </label>
                    <span class="ml-auto">
                        {{ listSize.toLocaleString() }} games
                        <template v-if="info"> &middot; {{ sourceLabel(info.source) }}</template>
                    </span>
                </div>
            </div>

            <!-- loading -->
            <div v-if="!isReady" class="p-3 text-sm text-gray-500 dark:text-gray-400">
                Loading the game list...
            </div>

            <!-- empty query help -->
            <div v-else-if="!trimmedQuery" class="p-3 text-sm text-gray-500 dark:text-gray-400 space-y-1">
                <p>
                    Search by game name, alias, app ID or executable name.
                    {{ launchableCount.toLocaleString() }} of {{ listSize.toLocaleString() }} games can be launched.
                </p>
                <p class="text-xs">
                    Pick a game and click "Add game to list" to queue it, then use Play on the right side.
                </p>
            </div>

            <!-- searching -->
            <div v-else-if="isSearchPending" class="p-3 text-sm text-gray-500 dark:text-gray-400">
                Searching...
            </div>

            <!-- no result -->
            <div v-else-if="showNoResult" class="p-3 text-sm text-gray-500 dark:text-gray-400 space-y-1">
                <p>No game found for "{{ trimmedQuery }}".</p>
                <p class="text-xs">
                    Try a shorter name, an alias, an app ID, or untick "Launchable only".
                </p>
            </div>

            <!-- results -->
            <div v-else role="listbox" id="game-search-results">
                <div v-for="(game, index) in results" :key="game.id" role="option" :aria-selected="index === activeIndex"
                    class="p-3 border-b border-gray-200 dark:border-gray-700 last:border-b-0 cursor-pointer"
                    :class="index === activeIndex ? 'bg-gray-100 dark:bg-gray-700' : 'hover:bg-gray-50 dark:hover:bg-gray-700/60'"
                    @mousedown.prevent @mouseenter="setActive(index)" @click="addGame(game)">
                    <div class="flex justify-between items-start gap-3">
                        <div class="min-w-0">
                            <div class="font-medium text-gray-800 dark:text-white flex flex-wrap items-center gap-1">
                                <span>{{ game.name }}</span>
                                <span v-if="!game.launchable"
                                    class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                    no executable
                                </span>
                            </div>
                            <div class="text-xs text-gray-500 dark:text-gray-400">App ID: {{ game.id }}</div>
                            <div v-if="game.executables.length" class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                <span class="font-mono">{{ executablesForPlatform(game).slice(0, 2).map(exe => exe.name).join(', ') }}</span>
                                <span v-if="executablesForPlatform(game).length > 2">
                                    +{{ executablesForPlatform(game).length - 2 }} more
                                </span>
                            </div>
                        </div>
                        <span class="shrink-0 text-xs text-indigo-600 dark:text-indigo-400">Add</span>
                    </div>
                </div>

                <!-- footer -->
                <div class="sticky bottom-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-3 py-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>
                        Showing {{ results.length }} of {{ totalMatches.toLocaleString() }} matches
                        <span v-if="poolSize !== listSize"> ({{ poolSize.toLocaleString() }} in current filters)</span>
                    </span>
                    <button v-if="hasMore" class="text-indigo-600 dark:text-indigo-400 hover:underline" @mousedown.prevent @click="loadMore">
                        Load more
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
