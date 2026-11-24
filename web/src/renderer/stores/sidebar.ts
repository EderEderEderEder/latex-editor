// Seitenleisten-Store (W2-3, Vorlage `SidebarStore`): aktiver Tab, Breite, aufgeklappte Ordner, Auswahl im Baum,
// Filtertext und ausgeblendete Dateitypen. Der Zustand lebt hier und nicht in den Komponenten, weil sie beim
// Tabwechsel der Seitenleiste neu entstehen. Gesetzt wird nur bei echter Änderung.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import type { AbsolutePath } from '../../shared/contract';

export type SidebarTab = 'files' | 'outline' | 'issues';

export const SIDEBAR_MIN_WIDTH = 180;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_DEFAULT_WIDTH = 260;

export interface SidebarState {
    readonly tab: SidebarTab;
    readonly width: number;
    readonly expandedFolders: ReadonlySet<AbsolutePath>;
    readonly selectedPath: AbsolutePath | null;
    readonly fileFilter: string;
    /** Kleingeschriebene Endungen ohne Punkt, `''` für Dateien ohne Endung; gilt für alle Projekte */
    readonly hiddenExtensions: ReadonlySet<string>;
    readonly showsBuildFiles: boolean;
    setTab(tab: SidebarTab): void;
    setWidth(width: number): void;
    setFolderExpanded(path: AbsolutePath, isExpanded: boolean): void;
    toggleFolder(path: AbsolutePath): void;
    /** Klappt Ordner auf (z. B. die Ordner über der geöffneten Datei) */
    expandFolders(paths: readonly AbsolutePath[]): void;
    select(path: AbsolutePath | null): void;
    setFileFilter(text: string): void;
    setExtensionHidden(extension: string, isHidden: boolean): void;
    showAllExtensions(): void;
    setShowsBuildFiles(shows: boolean): void;
    /** Projektwechsel: Ordner, Auswahl und Filtertext zurück; Dateitypen und Breite bleiben */
    resetForProject(): void;
}

export type SidebarStore = StoreApi<SidebarState>;

export function clampSidebarWidth(width: number): number {
    if (!Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
    return Math.min(Math.max(Math.round(width), SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
}

function withMember<T>(set: ReadonlySet<T>, member: T, isIncluded: boolean): ReadonlySet<T> {
    if (set.has(member) === isIncluded) return set;
    const next = new Set(set);
    if (isIncluded) next.add(member);
    else next.delete(member);
    return next;
}

export function createSidebarStore(): SidebarStore {
    return createStore<SidebarState>()((set, get) => ({
        tab: 'files',
        width: SIDEBAR_DEFAULT_WIDTH,
        expandedFolders: new Set(),
        selectedPath: null,
        fileFilter: '',
        hiddenExtensions: new Set(),
        showsBuildFiles: false,
        setTab: (tab) => {
            if (get().tab !== tab) set({ tab });
        },
        setWidth: (width) => {
            const next = clampSidebarWidth(width);
            if (get().width !== next) set({ width: next });
        },
        setFolderExpanded: (path, isExpanded) => {
            const next = withMember(get().expandedFolders, path, isExpanded);
            if (next !== get().expandedFolders) set({ expandedFolders: next });
        },
        toggleFolder: (path) => get().setFolderExpanded(path, !get().expandedFolders.has(path)),
        expandFolders: (paths) => {
            const current = get().expandedFolders;
            if (paths.every((path) => current.has(path))) return;
            set({ expandedFolders: new Set([...current, ...paths]) });
        },
        select: (path) => {
            if (get().selectedPath !== path) set({ selectedPath: path });
        },
        setFileFilter: (text) => {
            if (get().fileFilter !== text) set({ fileFilter: text });
        },
        setExtensionHidden: (extension, isHidden) => {
            const next = withMember(get().hiddenExtensions, extension, isHidden);
            if (next !== get().hiddenExtensions) set({ hiddenExtensions: next });
        },
        showAllExtensions: () => {
            if (get().hiddenExtensions.size > 0) set({ hiddenExtensions: new Set() });
        },
        setShowsBuildFiles: (shows) => {
            if (get().showsBuildFiles !== shows) set({ showsBuildFiles: shows });
        },
        resetForProject: () => {
            const { expandedFolders, selectedPath, fileFilter } = get();
            if (expandedFolders.size === 0 && selectedPath === null && fileFilter === '') return;
            set({ expandedFolders: new Set(), selectedPath: null, fileFilter: '' });
        },
    }));
}

export const sidebarStore = createSidebarStore();

export function useSidebarStore<T>(selector: (state: SidebarState) => T): T {
    return useStore(sidebarStore, selector);
}
