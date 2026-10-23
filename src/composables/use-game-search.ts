import Fuse, { type IFuseOptions } from 'fuse.js';
import { computed, ref, shallowRef, watch, type Ref } from 'vue';
import { refDebounced } from '@vueuse/core';
import type { Game } from '@/types/types';
import { getCurrentOS } from '@/constants/constants';

const PAGE_SIZE = 25;

// Trademark/copyright signs in Discord's names ("Battlefield™ 1") only hurt matching.
const IGNORED_SYMBOLS = /[\u00A9\u2122\u00AE]/g;

const fuseOptions: IFuseOptions<Game> = {
    keys: [
        { name: 'name', weight: 0.7 },
        { name: 'aliases', weight: 0.2 },
        { name: 'executables.name', weight: 0.1 },
    ],
    getFn: (obj: any, path: string | string[]) => {
        const value = Fuse.config.getFn(obj, path);
        return typeof value === 'string' ? value.replace(IGNORED_SYMBOLS, '') : value;
    },
    isCaseSensitive: false,
    // ignoreLocation makes a match anywhere in the name count, which is what users expect
    // for long titles like "Tom Clancy's Rainbow Six Siege".
    ignoreLocation: true,
    threshold: 0.4,
    includeScore: true,
    includeMatches: false,
};

/**
 * Game search with its own Fuse index. The index is rebuilt only when the list or a
 * filter changes - never on every keystroke, and never because nested game state changed.
 */
export function useGameSearch(source: Ref<Game[]>) {
    const platform = getCurrentOS();

    const query = shallowRef('');
    const debouncedQuery = refDebounced(query, 150);

    // Every game in the list can be played (process mode when Discord registered an
    // executable, RPC mode otherwise), so the filter starts off.
    const onlyLaunchable = ref(false);
    const platformOnly = ref(false);

    const visibleCount = ref(PAGE_SIZE);
    const activeIndex = ref(0);

    const listSize = computed(() => source.value.length);
    const launchableCount = computed(() => source.value.reduce((total, game) => (game.executables.length > 0 ? total + 1 : total), 0));

    const pool = computed<Game[]>(() => {
        let list = onlyLaunchable.value ? source.value.filter(game => game.executables.length > 0) : source.value;
        if (platformOnly.value) {
            list = list.filter(game => game.executables.some(exe => exe.os === platform));
        }
        return list;
    });

    const fuse = shallowRef(new Fuse<Game>([], fuseOptions));

    watch(
        pool,
        list => {
            fuse.value = new Fuse(list, fuseOptions);
        },
        { immediate: true },
    );

    const isSearchPending = computed(() => query.value.trim() !== debouncedQuery.value.trim());

    const matches = computed<Game[]>(() => {
        const raw = debouncedQuery.value.replace(IGNORED_SYMBOLS, '').trim();
        if (!raw) {
            return [];
        }
        const lower = raw.toLowerCase();

        const candidates = new Map<string, { game: Game; score: number }>();

        // Numeric queries may be an app ID: match those directly so they are never
        // lost in fuzzy noise.
        if (/^\d{3,}$/.test(raw)) {
            for (const game of pool.value) {
                if (game.id.startsWith(raw)) {
                    candidates.set(game.id, { game, score: 0 });
                }
            }
        }

        for (const result of fuse.value.search(raw)) {
            if (!candidates.has(result.item.id)) {
                candidates.set(result.item.id, { game: result.item, score: result.score ?? 1 });
            }
        }

        const rank = (game: Game) => {
            const name = game.name.replace(IGNORED_SYMBOLS, '').toLowerCase();
            if (name === lower) return 0;
            if (name.startsWith(lower)) return 1;
            if (game.aliases?.some(alias => alias.toLowerCase() === lower)) return 2;
            if (game.aliases?.some(alias => alias.toLowerCase().startsWith(lower))) return 3;
            if (name.includes(lower)) return 4;
            return 5;
        };

        return [...candidates.values()]
            .sort((a, b) => rank(a.game) - rank(b.game) || a.score - b.score)
            .map(entry => entry.game);
    });

    const results = computed(() => matches.value.slice(0, visibleCount.value));
    const totalMatches = computed(() => matches.value.length);
    const hasMore = computed(() => matches.value.length > results.value.length);

    watch(debouncedQuery, () => {
        visibleCount.value = PAGE_SIZE;
        activeIndex.value = 0;
    });

    watch([onlyLaunchable, platformOnly], () => {
        visibleCount.value = PAGE_SIZE;
        activeIndex.value = 0;
    });

    watch(results, () => {
        if (activeIndex.value >= results.value.length) {
            activeIndex.value = Math.max(results.value.length - 1, 0);
        }
    });

    function loadMore() {
        visibleCount.value += PAGE_SIZE;
    }

    function moveActive(delta: number) {
        if (!results.value.length) {
            return;
        }
        const next = activeIndex.value + delta;
        activeIndex.value = Math.min(Math.max(next, 0), results.value.length - 1);
    }

    function setActive(index: number) {
        activeIndex.value = index;
    }

    function clear() {
        query.value = '';
    }

    return {
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
        poolSize: computed(() => pool.value.length),
        launchableCount,
        listSize,
    };
}
