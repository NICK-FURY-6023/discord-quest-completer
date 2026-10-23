<script setup lang="ts">
import { computed } from 'vue';
import { Pages, useGlobalState } from '@/composables/app-state';
import { useSessions } from '@/composables/use-sessions';
import { useToasts } from '@/composables/use-toasts';

const { page, setPage } = useGlobalState();
const { sessions } = useSessions();
const { toasts, dismiss } = useToasts();

const navItems = [
    {
        page: Pages.HOME,
        label: 'Home',
        icon: 'M4 11.5 12 4l8 7.5M6 10v9a1 1 0 0 0 1 1h3v-5h4v5h3a1 1 0 0 0 1-1v-9',
    },
    {
        page: Pages.QUESTS,
        label: 'Quests',
        icon: 'M4 6.5h16M4 12h10M4 17.5h7M17 15.5l1.8 1.8L22 14',
    },
    {
        page: Pages.SETTINGS,
        label: 'Settings',
        icon: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm8-3.5c0-.5 0-1-.1-1.4l2-1.5-2-3.4-2.3 1a8 8 0 0 0-2.4-1.4L14.8 3H9.2l-.4 2.3a8 8 0 0 0-2.4 1.4l-2.3-1-2 3.4 2 1.5a8.4 8.4 0 0 0 0 2.8l-2 1.5 2 3.4 2.3-1a8 8 0 0 0 2.4 1.4l.4 2.3h5.6l.4-2.3a8 8 0 0 0 2.4-1.4l2.3 1 2-3.4-2-1.5c.1-.4.1-.9.1-1.4Z',
    },
    {
        page: Pages.PLAYGROUND,
        label: 'Playground',
        icon: 'M9 4v6l-5 9a1 1 0 0 0 .9 1.5h14.2a1 1 0 0 0 .9-1.5l-5-9V4M8 4h8M7.5 13h9',
    },
] as const;

const playingLabel = computed(() => {
    if (!sessions.value.length) return 'Idle';
    if (sessions.value.length === 1) return sessions.value[0].gameName;
    return `${sessions.value.length} games playing`;
});

function toastToneClass(tone: string) {
    switch (tone) {
        case 'success':
            return 'border-[var(--success)]';
        case 'warning':
            return 'border-[var(--warning)]';
        case 'error':
            return 'border-[var(--danger)]';
        default:
            return '';
    }
}
</script>

<template>
    <div class="flex h-dvh overflow-hidden">
        <!-- Sidebar -->
        <aside class="sidebar-glass w-[15rem] shrink-0 flex flex-col px-3 py-4 gap-4">
            <div class="flex items-center gap-2.5 px-1">
                <div class="w-9 h-9 rounded-xl grid place-items-center shrink-0"
                    style="background: var(--accent); box-shadow: 0 6px 18px -8px var(--accent)">
                    <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="#fff" stroke-width="2"
                        stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 3v18M5 8.5 12 3l7 5.5M5 15.5 12 21l7-5.5" />
                    </svg>
                </div>
                <div class="min-w-0">
                    <p class="text-sm font-bold leading-tight truncate" style="color: var(--text)">Quest Completer</p>
                    <p class="text-[11px] leading-tight" style="color: var(--text-faint)">Discord RPC runner</p>
                </div>
            </div>

            <nav class="flex flex-col gap-1 shrink-0" aria-label="Main">
                <button v-for="item in navItems" :key="item.page" class="nav-link"
                    :class="{ 'nav-link-active': page === item.page }"
                    :aria-current="page === item.page ? 'page' : undefined" @click="setPage(item.page)">
                    <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
                        stroke-linecap="round" stroke-linejoin="round">
                        <path :d="item.icon" />
                    </svg>
                    <span>{{ item.label }}</span>
                    <span v-if="item.page === Pages.QUESTS && sessions.length"
                        class="ml-auto chip chip-success text-[10px] px-1.5 py-0">
                        {{ sessions.length }}
                    </span>
                </button>
            </nav>

            <div class="mt-auto panel-soft p-3">
                <div class="flex items-center gap-2 mb-1">
                    <span class="dot" :class="sessions.length ? 'dot-live' : ''"></span>
                    <span class="panel-title">Now playing</span>
                </div>
                <p class="text-sm font-medium truncate" style="color: var(--text)">{{ playingLabel }}</p>
                <button class="btn btn-ghost w-full justify-start px-0 text-xs mt-1" @click="setPage(Pages.QUESTS)">
                    {{ sessions.length ? 'View quest progress →' : 'Nothing running' }}
                </button>
            </div>

            <p class="text-[10px] px-1" style="color: var(--text-faint)">
                Discord shows the game while the runner keeps running.
            </p>
        </aside>

        <!-- Content -->
        <main class="flex-1 min-w-0 overflow-y-auto">
            <slot></slot>
        </main>

        <!-- Toasts -->
        <div class="fixed top-3 right-3 z-[60] flex flex-col gap-2 w-[min(22rem,80vw)]">
            <div v-for="toast in toasts" :key="toast.id" class="toast px-3 py-2 text-sm flex items-start gap-2 border"
                :class="toastToneClass(toast.tone)">
                <span class="dot mt-1.5"
                    :class="toast.tone === 'success' ? 'dot-live' : toast.tone === 'error' ? 'dot-off' : 'dot-busy'"></span>
                <span class="flex-1 leading-snug">{{ toast.message }}</span>
                <button class="faint hover:opacity-70 leading-none text-lg" aria-label="Dismiss"
                    @click="dismiss(toast.id)">×</button>
            </div>
        </div>
    </div>
</template>
