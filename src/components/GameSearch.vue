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
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
                style="color: var(--text-faint)" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
            </svg>
            <input ref="inputRef" v-model="query" type="text" role="combobox" aria-controls="game-search-results"
                :aria-expanded="open" aria-autocomplete="list" placeholder="Search games by name, alias or app ID..."
                class="input pl-9 pr-40 py-2.5" @focus="open = true" @keydown="onKeydown" />

            <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <button v-if="query" class="btn btn-ghost text-xs" title="Clear search" @mousedown.prevent
                    @click="clearSearch">
                    Clear
                </button>
                <button class="btn btn-quiet text-xs" :disabled="isRefreshing" @click="emit('refresh')">
                    {{ isRefreshing ? 'Refreshing...' : 'Refresh list' }}
                </button>
            </div>
        </div>

        <div v-if="open" class="absolute z-50 mt-2 w-full panel overflow-hidden"
            style="box-shadow: 0 24px 45px -20px rgba(0, 0, 0, 0.65)">
            <div class="sticky top-0 z-10 px-3 py-2"
                style="background: var(--bg-panel); border-bottom: 1px solid var(--border)">
                <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs faint">
                    <label class="flex items-center gap-1.5 cursor-pointer">
                        <input v-model="onlyLaunchable" type="checkbox" class="accent-[var(--accent)]" />
                        Launchable only
                    </label>
                    <label class="flex items-center gap-1.5 cursor-pointer">
                        <input v-model="platformOnly" type="checkbox" class="accent-[var(--accent)]" />
                        {{ platform }} executables only
                    </label>
                    <span class="ml-auto">
                        {{ listSize.toLocaleString() }} games
                        <template v-if="info"> · {{ sourceLabel(info.source) }}</template>
                    </span>
                </div>
            </div>

            <div v-if="!isReady" class="p-4 text-sm muted">
                Loading the game list...
            </div>

            <div v-else-if="!trimmedQuery" class="p-4 text-sm muted space-y-1">
                <p>
                    Search by game name, alias, app ID or executable name.
                    {{ launchableCount.toLocaleString() }} of {{ listSize.toLocaleString() }} games can be launched.
                </p>
                <p class="text-xs faint">
                    Pick a game to queue it, then press Play on the right side.
                </p>
            </div>

            <div v-else-if="isSearchPending" class="p-4 text-sm muted">
                Searching...
            </div>

            <div v-else-if="showNoResult" class="p-4 text-sm muted space-y-1">
                <p>No game found for "{{ trimmedQuery }}".</p>
                <p class="text-xs faint">
                    Try a shorter name, an alias, an app ID, or untick "Launchable only".
                </p>
            </div>

            <div v-else role="listbox" id="game-search-results">
                <div v-for="(game, index) in results" :key="game.id" role="option" :aria-selected="index === activeIndex"
                    class="p-3 cursor-pointer"
                    :style="{
                        background: index === activeIndex ? 'var(--bg-hover)' : 'transparent',
                        borderBottom: '1px solid var(--border)',
                    }" @mousedown.prevent @mouseenter="setActive(index)" @click="addGame(game)">
                    <div class="flex justify-between items-start gap-3">
                        <div class="min-w-0">
                            <div class="font-medium flex flex-wrap items-center gap-1.5" style="color: var(--text)">
                                <span>{{ game.name }}</span>
                                <span v-if="!game.launchable" class="chip chip-warning">no executable</span>
                            </div>
                            <div class="text-xs faint mt-0.5">App ID: {{ game.id }}</div>
                            <div v-if="game.executables.length" class="text-xs faint mt-1 font-mono truncate">
                                {{ executablesForPlatform(game).slice(0, 2).map(exe => exe.name).join(', ') }}
                                <span v-if="executablesForPlatform(game).length > 2">
                                    +{{ executablesForPlatform(game).length - 2 }} more
                                </span>
                            </div>
                        </div>
                        <span class="shrink-0 text-xs font-semibold" style="color: var(--accent)">Add</span>
                    </div>
                </div>

                <div class="sticky bottom-0 px-3 py-2 flex items-center justify-between text-xs faint"
                    style="background: var(--bg-panel); border-top: 1px solid var(--border)">
                    <span>
                        Showing {{ results.length }} of {{ totalMatches.toLocaleString() }} matches
                        <span v-if="poolSize !== listSize"> ({{ poolSize.toLocaleString() }} in current filters)</span>
                    </span>
                    <button v-if="hasMore" class="font-semibold" style="color: var(--accent)"
                        @mousedown.prevent @click="loadMore">
                        Load more
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
