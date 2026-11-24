// Gliederungs-Store (W2-6): hält nur Gliederungsdaten (Einträge, Baum, Include-Zuordnung, aktueller Abschnitt), nie Text.
// Die Texte liefert der Aufrufer über `readFile`; Aktualisierungen sind entprellt und setzen nur bei Änderung.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import type { FileTarget } from '../../shared/contract';
import {
    OutlineParser, buildOutlineTree, currentEntry, includeChain, sameEntries, sameIncludingFile,
} from '../../shared/core/latex/outline';
import type { OutlineEntry, OutlineNode, OutlineResult, ReadFile } from '../../shared/core/latex/outline';
import { createDebounced } from '../app/debounce';

/** Ruhezeit nach dem letzten Änderungshinweis, bevor neu geparst wird */
export const OUTLINE_REFRESH_DELAY_MS = 300;

export interface OutlineStoreState {
    readonly mainFile: FileTarget | null;
    readonly entries: readonly OutlineEntry[];
    readonly tree: readonly OutlineNode[];
    readonly includingFile: Readonly<Record<string, string>>;
    /** Abschnitt an der Cursorposition */
    readonly currentEntryId: string | null;
    /** Hauptdatei setzen (oder `null`); parst sofort neu */
    setMainFile(file: FileTarget | null): void;
    /** Hinweis „Text hat sich geändert“: parst nach der Ruhezeit neu */
    requestRefresh(): void;
    refreshNow(): Promise<void>;
    /** Cursorposition (1-basierte Zeile); der Aufrufer entprellt (150 ms wie in Swift) */
    updateCursor(file: FileTarget, line: number): void;
    includeChainTo(file: FileTarget): string[];
}

export type OutlineStore = StoreApi<OutlineStoreState>;

export interface OutlineStoreDeps {
    readonly readFile: ReadFile;
    readonly delayMs?: number;
}

type SetState = OutlineStore['setState'];
type GetState = OutlineStore['getState'];

const EMPTY: Pick<OutlineStoreState, 'entries' | 'tree' | 'includingFile' | 'currentEntryId'> = {
    entries: [], tree: [], includingFile: {}, currentEntryId: null,
};

export function createOutlineStore(deps: OutlineStoreDeps): OutlineStore {
    return createStore<OutlineStoreState>()((set, get) => {
        const parser = new OutlineParser();
        let generation = 0;
        let cursor: { file: FileTarget; line: number } | null = null;
        const currentId = (entries: readonly OutlineEntry[]): string | null =>
            cursor === null ? null : currentEntry(entries, cursor.file, cursor.line)?.id ?? null;
        const refreshNow = async (): Promise<void> => {
            const main = get().mainFile;
            const ticket = ++generation;
            if (main === null) return applyResult(set, get, null, currentId);
            const result = await parser.outline(main, deps.readFile);
            if (ticket === generation) applyResult(set, get, result, currentId);
        };
        const debounced = createDebounced(() => void refreshNow(), deps.delayMs ?? OUTLINE_REFRESH_DELAY_MS);
        return {
            mainFile: null,
            ...EMPTY,
            setMainFile: (file) => {
                if (get().mainFile === file) return;
                debounced.cancel();
                set({ mainFile: file });
                void refreshNow();
            },
            requestRefresh: () => debounced.call(),
            refreshNow,
            updateCursor: (file, line) => {
                cursor = { file, line };
                const id = currentId(get().entries);
                if (id !== get().currentEntryId) set({ currentEntryId: id });
            },
            includeChainTo: (file) => includeChain(file, get().mainFile, get().includingFile),
        };
    });
}

/** Setzt nur, was sich geändert hat; `null` leert die Gliederung */
function applyResult(
    set: SetState, get: GetState, result: OutlineResult | null, currentId: (entries: readonly OutlineEntry[]) => string | null,
): void {
    const state = get();
    const next = result ?? EMPTY;
    const patch: { -readonly [K in keyof OutlineStoreState]?: OutlineStoreState[K] } = {};
    if (!sameEntries(state.entries, next.entries)) {
        patch.entries = next.entries;
        patch.tree = buildOutlineTree(next.entries);
        const id = currentId(next.entries);
        if (id !== state.currentEntryId) patch.currentEntryId = id;
    }
    if (!sameIncludingFile(state.includingFile, next.includingFile)) patch.includingFile = next.includingFile;
    if (Object.keys(patch).length > 0) set(patch);
}

export function useOutlineStore<T>(store: OutlineStore, selector: (state: OutlineStoreState) => T): T {
    return useStore(store, selector);
}
