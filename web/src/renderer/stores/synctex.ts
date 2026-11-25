// SyncTeX-Zustand des Renderers (W3-5): ob der Main Daten geladen hat (`synctex:ready` mit der Änderungszeit des
// PDFs) und die letzte Anfrage (Art, Zeit, Ausgang). Die Daten selbst liegen im Worker des Mains, hier nie Bytes.
// Die Kennung der letzten Anfrage verwirft veraltete Antworten („PDF folgt Cursor“ fragt oft hintereinander).
// Ohne DOM-Typen (Vitest).
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import type { EpochMillis } from '../../shared/contract';

export type SyncTeXRequestKind = 'forward' | 'backward';

export interface SyncTeXRequest {
    readonly id: number;
    readonly kind: SyncTeXRequestKind;
    readonly startedAt: EpochMillis;
    /** `null`, solange die Antwort aussteht */
    readonly outcome: string | null;
}

export interface SyncTeXState {
    /** Hat der Main seit dem letzten Projektwechsel SyncTeX-Daten gemeldet? */
    readonly isReady: boolean;
    /** Änderungszeit des PDFs zu den geladenen Daten */
    readonly pdfMtime: EpochMillis | null;
    readonly lastRequest: SyncTeXRequest | null;
    markReady(pdfMtime: EpochMillis): void;
    /** Neue Anfrage; die Rückgabe ist ihre Kennung */
    beginRequest(kind: SyncTeXRequestKind): number;
    /** Ausgang einer Anfrage; eine inzwischen überholte Anfrage ändert nichts */
    finishRequest(id: number, outcome: string): void;
    isLatest(id: number): boolean;
    /** Projektwechsel: Die Daten des alten Projekts gelten nicht mehr */
    reset(): void;
}

export type SyncTeXStore = StoreApi<SyncTeXState>;

const INITIAL_STATE = { isReady: false, pdfMtime: null, lastRequest: null } as const satisfies Partial<SyncTeXState>;

export function createSyncTeXStore(now: () => EpochMillis = Date.now): SyncTeXStore {
    let nextId = 0;
    return createStore<SyncTeXState>()((set, get) => ({
        ...INITIAL_STATE,
        markReady: (pdfMtime) => {
            if (get().isReady && get().pdfMtime === pdfMtime) return;
            set({ isReady: true, pdfMtime });
        },
        beginRequest: (kind) => {
            const id = ++nextId;
            set({ lastRequest: { id, kind, startedAt: now(), outcome: null } });
            return id;
        },
        finishRequest: (id, outcome) => {
            const request = get().lastRequest;
            if (request?.id !== id || request.outcome === outcome) return;
            set({ lastRequest: { ...request, outcome } });
        },
        isLatest: (id) => get().lastRequest?.id === id,
        reset: () => {
            const { isReady, pdfMtime, lastRequest } = get();
            if (!isReady && pdfMtime === null && lastRequest === null) return;
            set({ ...INITIAL_STATE });
        },
    }));
}

export const syncTeXStore = createSyncTeXStore();

export function useSyncTeXStore<T>(selector: (state: SyncTeXState) => T): T {
    return useStore(syncTeXStore, selector);
}
