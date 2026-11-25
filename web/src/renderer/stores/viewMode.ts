// Ansichtsmodus und Teilerposition des Arbeitsbereichs (W3-4, Vorlage Swift `viewMode`). Die Teilerposition ist ein
// Anteil der Breite (0–1) und bleibt bei Moduswechseln erhalten; die Mindestbreiten klemmt erst die Aufteilung
// (`app/viewModeLogic.ts`), weil nur dort die Fensterbreite bekannt ist. Gesetzt wird nur bei echter Änderung.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { clampFraction, DEFAULT_SPLIT_FRACTION, DEFAULT_VIEW_MODE } from '../app/viewModeLogic';
import type { ViewMode } from '../app/viewModeLogic';

export interface ViewModeState {
    readonly mode: ViewMode;
    /** Anteil des Editors an der Breite ohne Teiler */
    readonly fraction: number;
    setMode(mode: ViewMode): void;
    setFraction(fraction: number): void;
    resetFraction(): void;
}

export type ViewModeStore = StoreApi<ViewModeState>;

export function createViewModeStore(): ViewModeStore {
    return createStore<ViewModeState>()((set, get) => ({
        mode: DEFAULT_VIEW_MODE,
        fraction: DEFAULT_SPLIT_FRACTION,
        setMode: (mode) => {
            if (get().mode !== mode) set({ mode });
        },
        setFraction: (fraction) => {
            const next = clampFraction(fraction);
            if (get().fraction !== next) set({ fraction: next });
        },
        resetFraction: () => get().setFraction(DEFAULT_SPLIT_FRACTION),
    }));
}

export const viewModeStore = createViewModeStore();

export function useViewModeStore<T>(selector: (state: ViewModeState) => T): T {
    return useStore(viewModeStore, selector);
}
