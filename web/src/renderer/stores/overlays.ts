// Welcher modale Dialog der App gerade offen ist („Schnell öffnen“, „Gehe zu Zeile“). Höchstens einer zugleich.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';

export type OverlayKind = 'quickOpen' | 'gotoLine';

export interface OverlayState {
    readonly active: OverlayKind | null;
    show(kind: OverlayKind): void;
    close(): void;
}

export type OverlayStore = StoreApi<OverlayState>;

export function createOverlayStore(): OverlayStore {
    return createStore<OverlayState>()((set, get) => ({
        active: null,
        show: (kind) => {
            if (get().active !== kind) set({ active: kind });
        },
        close: () => {
            if (get().active !== null) set({ active: null });
        },
    }));
}

export const overlayStore = createOverlayStore();

export function useOverlayStore<T>(selector: (state: OverlayState) => T): T {
    return useStore(overlayStore, selector);
}
