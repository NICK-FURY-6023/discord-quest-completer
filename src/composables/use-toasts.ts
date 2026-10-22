import { ref } from 'vue';
import { createGlobalState } from '@vueuse/core';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
    id: number;
    message: string;
    tone: ToastTone;
}

let nextId = 1;

export const useToasts = createGlobalState(() => {
    const toasts = ref<Toast[]>([]);
    const timers = new Map<number, ReturnType<typeof setTimeout>>();

    function dismiss(id: number) {
        toasts.value = toasts.value.filter(toast => toast.id !== id);
        const timer = timers.get(id);
        if (timer) {
            clearTimeout(timer);
            timers.delete(id);
        }
    }

    function push(message: string, tone: ToastTone = 'info', ttl = 4000) {
        const id = nextId++;
        toasts.value = [...toasts.value.slice(-2), { id, message, tone }];
        timers.set(id, setTimeout(() => dismiss(id), ttl));
    }

    return { toasts, push, dismiss };
});
