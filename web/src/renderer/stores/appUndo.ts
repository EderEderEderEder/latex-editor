// App-Rückgängig für Datei-Aktionen (W2-9, Vorlage `FileUndo.swift`): Anlegen, Duplizieren, Umbenennen, Verschieben und
// Papierkorb samt Verweisänderungen sind je EIN Schritt. Im Zustand stehen nur die Titel für Menü und Meldungen; die
// Schritte selbst (mit ihren Rückgängig-Kennungen des Main) liegen außerhalb des Zustands. Schritte laufen nacheinander:
// Während einer läuft, wird ein weiterer Aufruf abgewiesen (`busy`).
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';

/** Ergebnis eines Schritts: `changed: false`, wenn nichts geändert wurde (der Schritt bleibt dann, wo er war) */
export interface AppUndoStep {
    readonly changed: boolean;
    /** Teilweise gelungen (z. B. ein Verweis ließ sich nicht zurücksetzen) */
    readonly warning?: string;
}

export interface AppUndoAction {
    readonly title: string;
    undo(): Promise<AppUndoStep>;
    redo(): Promise<AppUndoStep>;
}

export type AppUndoOutcome =
    | { readonly kind: 'done'; readonly title: string; readonly warning: string | null }
    | { readonly kind: 'failed'; readonly title: string }
    | { readonly kind: 'empty' }
    | { readonly kind: 'busy' };

export interface AppUndoState {
    /** Titel des nächsten Rückgängig-Schritts; `null`: nichts zu tun */
    readonly undoTitle: string | null;
    readonly redoTitle: string | null;
    readonly isBusy: boolean;
    /** Neuer Schritt nach einer Aktion; leert den Wiederholen-Stapel */
    push(action: AppUndoAction): void;
    undo(): Promise<AppUndoOutcome>;
    redo(): Promise<AppUndoOutcome>;
    /** Projektwechsel: alte Schritte gehören zu einem anderen Projekt */
    clear(): void;
}

export type AppUndoStore = StoreApi<AppUndoState>;

/** Obergrenze je Stapel; ältere Schritte verfallen (wie `MAX_UNDO_RECORDS` im Main, nur kleiner) */
export const MAX_APP_UNDO_STEPS = 100;

export const APP_UNDO_TEXTS = {
    undone: (title: string) => `„${title}“ rückgängig gemacht`,
    redone: (title: string) => `„${title}“ wiederholt`,
    nothingToUndo: 'Keine Datei-Aktion zum Rückgängigmachen.',
    nothingToRedo: 'Keine Datei-Aktion zum Wiederholen.',
    busy: 'Eine Datei-Aktion läuft noch.',
    withWarning: (done: string, warning: string) => `${done}, aber: ${warning}`,
} as const;

interface Stacks {
    readonly undo: AppUndoAction[];
    readonly redo: AppUndoAction[];
}

function titleOf(stack: readonly AppUndoAction[]): string | null {
    return stack.at(-1)?.title ?? null;
}

function pushBounded(stack: AppUndoAction[], action: AppUndoAction): void {
    stack.push(action);
    if (stack.length > MAX_APP_UNDO_STEPS) stack.shift();
}

export function createAppUndoStore(): AppUndoStore {
    return createStore<AppUndoState>()((set, get) => {
        const stacks: Stacks = { undo: [], redo: [] };
        const publish = (isBusy: boolean): void => {
            const next = { undoTitle: titleOf(stacks.undo), redoTitle: titleOf(stacks.redo), isBusy };
            const state = get();
            if (state.undoTitle === next.undoTitle && state.redoTitle === next.redoTitle && state.isBusy === isBusy) return;
            set(next);
        };
        // Nimmt den obersten Schritt von `from`, führt ihn aus und legt ihn bei Erfolg auf `to`.
        const step = async (
            from: AppUndoAction[], to: AppUndoAction[], run: (action: AppUndoAction) => Promise<AppUndoStep>,
        ): Promise<AppUndoOutcome> => {
            if (get().isBusy) return { kind: 'busy' };
            const action = from.pop();
            if (action === undefined) return { kind: 'empty' };
            publish(true);
            let result: AppUndoStep = { changed: false };
            try {
                result = await run(action);
            } finally {
                pushBounded(result.changed ? to : from, action);
                publish(false);
            }
            if (!result.changed) return { kind: 'failed', title: action.title };
            return { kind: 'done', title: action.title, warning: result.warning ?? null };
        };
        return {
            undoTitle: null,
            redoTitle: null,
            isBusy: false,
            push: (action) => {
                pushBounded(stacks.undo, action);
                stacks.redo.length = 0;
                publish(get().isBusy);
            },
            undo: () => step(stacks.undo, stacks.redo, (action) => action.undo()),
            redo: () => step(stacks.redo, stacks.undo, (action) => action.redo()),
            clear: () => {
                stacks.undo.length = 0;
                stacks.redo.length = 0;
                publish(get().isBusy);
            },
        };
    });
}

export const appUndoStore = createAppUndoStore();

export function useAppUndoStore<T>(selector: (state: AppUndoState) => T): T {
    return useStore(appUndoStore, selector);
}
