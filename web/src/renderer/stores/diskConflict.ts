// Hinweise der Konfliktleiste (W2-13): offene Dateien, die auf der Platte geändert oder gelöscht wurden, während der
// Editor sie nicht still neu laden darf. Schlüssel ist der Sitzungsschlüssel; nie Text, nur Hashes.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import type { AbsolutePath, ContentHash, WriteResult } from '../../shared/contract';

export type DiskConflictKind = 'changed' | 'deleted';

export interface DiskConflict {
    readonly kind: DiskConflictKind;
    /** Hash der Sitzung beim Entstehen; ändert er sich (Speichern, Neuladen), ist der Hinweis überholt */
    readonly knownHash: ContentHash;
    /** Plattenstand bei `changed` (für „Meine Version behalten“), bei `deleted` `null` */
    readonly disk: WriteResult | null;
}

export interface DiskConflictState {
    readonly conflicts: Readonly<Record<AbsolutePath, DiskConflict>>;
    set(path: AbsolutePath, conflict: DiskConflict): void;
    clear(path: AbsolutePath): void;
    /** Behält nur die Hinweise, für die `keep` zutrifft */
    retain(keep: (path: AbsolutePath, conflict: DiskConflict) => boolean): void;
}

export type DiskConflictStore = StoreApi<DiskConflictState>;

function sameConflict(a: DiskConflict | undefined, b: DiskConflict): boolean {
    if (a === undefined) return false;
    return a.kind === b.kind && a.knownHash === b.knownHash && a.disk?.hash === b.disk?.hash && a.disk?.mtime === b.disk?.mtime;
}

export function createDiskConflictStore(): DiskConflictStore {
    return createStore<DiskConflictState>()((set, get) => ({
        conflicts: {},
        set: (path, conflict) => {
            if (sameConflict(get().conflicts[path], conflict)) return;
            set({ conflicts: { ...get().conflicts, [path]: conflict } });
        },
        clear: (path) => {
            if (!(path in get().conflicts)) return;
            const next = { ...get().conflicts };
            delete next[path];
            set({ conflicts: next });
        },
        retain: (keep) => {
            const entries = Object.entries(get().conflicts);
            const kept = entries.filter(([path, conflict]) => keep(path, conflict));
            if (kept.length !== entries.length) set({ conflicts: Object.fromEntries(kept) });
        },
    }));
}

export const diskConflictStore = createDiskConflictStore();

export function useDiskConflictStore<T>(selector: (state: DiskConflictState) => T): T {
    return useStore(diskConflictStore, selector);
}
