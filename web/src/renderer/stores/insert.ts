// Zustand des Einfügen-Fensters (W4-10, Vorlage `InsertStore.swift`): gewählter Baustein, Einstellungen je Baustein,
// Umgebung der Cursorposition und Projektkatalog. Hält nie Dokumenttext außer dem kleinen Ausschnitt für die Vorschau.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import type { InsertionContext } from '../../shared/core/insertion';
import { DEFAULT_INSERTION_KIND } from '../app/insertKinds';
import type { InsertionKind } from '../app/insertKinds';
import { adoptSelection, createInsertSettings, EMPTY_INSERT_CATALOG } from '../app/insertLogic';
import type { InsertCatalog, InsertSettings } from '../app/insertLogic';

export interface InsertOpenInput {
    /** Fehlt: der zuletzt benutzte Baustein */
    readonly kind?: InsertionKind;
    readonly selectedText: string;
    readonly context: InsertionContext | null;
    readonly canInsertIntoEditor: boolean;
}

export interface InsertState extends InsertSettings {
    readonly isOpen: boolean;
    readonly kind: InsertionKind;
    /** Umgebung der Cursorposition beim Öffnen; `null` ohne `.tex` vorne */
    readonly context: InsertionContext | null;
    readonly canInsertIntoEditor: boolean;
    readonly catalog: InsertCatalog;
    readonly errorMessage: string | null;
    readonly isBusy: boolean;
    open(input: InsertOpenInput): void;
    close(): void;
    setKind(kind: InsertionKind): void;
    /** Ändert die Einstellungen eines Bausteins (`change` bekommt den alten Wert) */
    update<K extends keyof InsertSettings>(key: K, change: (current: InsertSettings[K]) => InsertSettings[K]): void;
    setCatalog(catalog: InsertCatalog): void;
    setError(message: string | null): void;
    setBusy(isBusy: boolean): void;
    /** Nach dem Anlegen einer Quelle: Eingaben leeren, Art, Sprache und Zitier-Wahl bleiben */
    resetSource(): void;
}

export type InsertStore = StoreApi<InsertState>;

/** Das Label für den Querverweis: das gewählte, sonst das erste vorhandene (Swift `reloadCatalog`) */
function referenceLabelFor(current: string, catalog: InsertCatalog): string {
    if (current !== '' && catalog.labels.some((entry) => entry.label === current)) return current;
    return catalog.labels[0]?.label ?? '';
}

export function createInsertStore(): InsertStore {
    return createStore<InsertState>()((set, get) => ({
        ...createInsertSettings(),
        isOpen: false,
        kind: DEFAULT_INSERTION_KIND,
        context: null,
        canInsertIntoEditor: false,
        catalog: EMPTY_INSERT_CATALOG,
        errorMessage: null,
        isBusy: false,
        open: (input) => {
            const adopted = adoptSelection(get(), input.selectedText);
            set({
                code: adopted.code,
                equation: adopted.equation,
                list: adopted.list,
                kind: input.kind ?? get().kind,
                context: input.context,
                canInsertIntoEditor: input.canInsertIntoEditor,
                errorMessage: null,
                isBusy: false,
                isOpen: true,
            });
        },
        close: () => {
            if (get().isOpen) set({ isOpen: false, isBusy: false, errorMessage: null });
        },
        setKind: (kind) => {
            if (get().kind !== kind) set({ kind, errorMessage: null });
        },
        update: (key, change) => set({ [key]: change(get()[key]) } as Partial<InsertState>),
        setCatalog: (catalog) => {
            const label = referenceLabelFor(get().reference.label, catalog);
            set({ catalog, reference: { ...get().reference, label } });
        },
        setError: (errorMessage) => set({ errorMessage }),
        setBusy: (isBusy) => set({ isBusy }),
        resetSource: () => {
            const { source, sourceOptions } = get();
            const fresh = createInsertSettings().source;
            set({
                source: { ...fresh, mode: source.mode, type: source.type, language: source.language },
                sourceOptions: { ...sourceOptions, note: '' },
            });
        },
    }));
}

export const insertStore = createInsertStore();

export function useInsertStore<T>(selector: (state: InsertState) => T): T {
    return useStore(insertStore, selector);
}
