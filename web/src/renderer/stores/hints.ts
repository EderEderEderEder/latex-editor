// Hinweis-Store (W4-12): Ergebnis der Verweisprüfung aus dem Index-Worker (undefinierte Verweise je Datei, ungenutzte
// Labels, Quellen und Abkürzungen, doppelte Labels) und der Filter „Hinweise“ der Fehlerliste. Hält nur die
// Ergebnislisten, nie Text. Gesetzt wird nur bei echter Änderung (derselbe Stand löst nichts aus).
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { EMPTY_REFERENCES, type ReferenceSnapshot } from '../app/referenceCheckLogic';

export interface HintsState {
    readonly references: ReferenceSnapshot;
    /** Filter der Fehlerliste: Abschnitt „Hinweise“ zeigen (Standard an, wie in Swift) */
    readonly showsHints: boolean;
    setReferences(references: ReferenceSnapshot): void;
    setShowsHints(shows: boolean): void;
}

export type HintsStore = StoreApi<HintsState>;

export function createHintsStore(): HintsStore {
    return createStore<HintsState>()((set, get) => ({
        references: EMPTY_REFERENCES,
        showsHints: true,
        setReferences: (references) => {
            if (get().references !== references) set({ references });
        },
        setShowsHints: (shows) => {
            if (get().showsHints !== shows) set({ showsHints: shows });
        },
    }));
}

export const hintsStore = createHintsStore();

export function useHintsStore<T>(selector: (state: HintsState) => T): T {
    return useStore(hintsStore, selector);
}

/** Anzahl aller Hinweise (für den Zähler des Filters) */
export function hintCount(references: ReferenceSnapshot): number {
    return references.duplicateLabels.length + references.unusedLabels.length
        + references.unusedAcronyms.length + references.unusedSources.length;
}
