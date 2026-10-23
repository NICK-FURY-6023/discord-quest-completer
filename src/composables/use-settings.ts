import { computed, reactive, watch } from 'vue';
import { createGlobalState, usePreferredDark } from '@vueuse/core';

export type ThemeMode = 'dark' | 'light' | 'system';
export type AccentName = 'blurple' | 'green' | 'amber' | 'rose' | 'cyan';

export interface AccentOption {
    label: string;
    color: string;
    hover: string;
}

export const ACCENTS: Record<AccentName, AccentOption> = {
    blurple: { label: 'Blurple', color: '#5865f2', hover: '#4752c4' },
    green: { label: 'Green', color: '#23a55a', hover: '#1e8e4d' },
    amber: { label: 'Amber', color: '#e0a020', hover: '#c28a16' },
    rose: { label: 'Rose', color: '#eb459e', hover: '#c93a86' },
    cyan: { label: 'Cyan', color: '#22a8c9', hover: '#1c8ba7' },
};

export interface AppSettings {
    theme: ThemeMode;
    accent: AccentName;
    /** Estimated length of a Discord quest, used for the progress display. */
    questMinutes: number;
    /** Size of the party Discord shows in the presence card ("1 of N"). */
    partyMax: number;
    notifyOnPlay: boolean;
    confirmStop: boolean;
    rememberGames: boolean;
}

const SETTINGS_KEY = 'dqc:settings:v1';

const DEFAULTS: AppSettings = {
    theme: 'dark',
    accent: 'blurple',
    questMinutes: 15,
    partyMax: 4,
    notifyOnPlay: true,
    confirmStop: false,
    rememberGames: true,
};

function loadSettings(): AppSettings {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return { ...DEFAULTS };
        const parsed = JSON.parse(raw) as Partial<AppSettings>;
        return {
            theme: parsed.theme === 'light' || parsed.theme === 'system' ? parsed.theme : 'dark',
            accent: parsed.accent && parsed.accent in ACCENTS ? parsed.accent : DEFAULTS.accent,
            questMinutes: clampMinutes(parsed.questMinutes),
            partyMax: clampPartySize(parsed.partyMax),
            notifyOnPlay: parsed.notifyOnPlay !== false,
            confirmStop: parsed.confirmStop === true,
            rememberGames: parsed.rememberGames !== false,
        };
    } catch {
        return { ...DEFAULTS };
    }
}

export function clampMinutes(value: unknown): number {
    const minutes = Number(value);
    if (!Number.isFinite(minutes)) return DEFAULTS.questMinutes;
    return Math.min(Math.max(Math.round(minutes), 1), 240);
}

export function clampPartySize(value: unknown): number {
    const size = Number(value);
    if (!Number.isFinite(size)) return DEFAULTS.partyMax;
    return Math.min(Math.max(Math.round(size), 1), 25);
}

function applyTheme(theme: 'dark' | 'light', accent: AccentOption) {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.setProperty('--accent', accent.color);
    root.style.setProperty('--accent-hover', accent.hover);
    const soft = accent.color + '24';
    root.style.setProperty('--accent-soft', soft);
}

export const useSettings = createGlobalState(() => {
    const settings = reactive<AppSettings>(loadSettings());
    const prefersDark = usePreferredDark();

    const resolvedTheme = computed<'dark' | 'light'>(() => {
        if (settings.theme === 'system') {
            return prefersDark.value ? 'dark' : 'light';
        }
        return settings.theme;
    });

    watch(
        [settings, resolvedTheme] as const,
        () => {
            applyTheme(resolvedTheme.value, ACCENTS[settings.accent]);
            try {
                localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
            } catch {
                /* storage may be disabled; the app keeps working in-memory */
            }
        },
        { deep: true, immediate: true },
    );

    function resetSettings() {
        Object.assign(settings, DEFAULTS);
    }

    return {
        settings,
        resolvedTheme,
        resetSettings,
        accents: ACCENTS,
    };
});
