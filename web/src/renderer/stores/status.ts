// Meldungstext der Statusleiste (eigener Store, getrennt vom Editor-Store): gesetzt wird nur bei echter Änderung.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';

export type StatusKind = 'info' | 'error';

export interface StatusMessage {
    readonly text: string;
    readonly kind: StatusKind;
}

export interface StatusState {
    readonly message: StatusMessage | null;
    show(message: StatusMessage): void;
    clear(): void;
}

export type StatusStore = StoreApi<StatusState>;

export function createStatusStore(): StatusStore {
    return createStore<StatusState>()((set, get) => ({
        message: null,
        show: (message) => {
            const current = get().message;
            if (current?.text === message.text && current.kind === message.kind) return;
            set({ message });
        },
        clear: () => {
            if (get().message !== null) set({ message: null });
        },
    }));
}

export const statusStore = createStatusStore();

export function useStatusStore<T>(selector: (state: StatusState) => T): T {
    return useStore(statusStore, selector);
}
