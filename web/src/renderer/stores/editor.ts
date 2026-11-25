// Editor-Store (W1-6): Tab-Metadaten ohne Text (Pfad, Titel, Vorschau/fest, Reihenfolge, aktiver Tab, „geändert“,
// Kodierung, Zeilenenden, Hash, mtime). Der Text lebt nur in den Sitzungen (`editor/session.ts`); der Store hält
// sie außerhalb seines Zustands und gibt sie beim Schließen oder Verdrängen eines Vorschau-Tabs frei.
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import type { AbsolutePath, ContentHash, EpochMillis, LineEnding, TextEncoding, TextFile, WriteResult } from '../../shared/contract';
import {
    EMPTY_TABS, activateNextTab, activatePreviousTab, activateTab, closeOtherTabs, closeTab, moveTab, openTab,
    promoteTab, relocateTabs,
} from '../../shared/core/tabs';
import type { TabsState } from '../../shared/core/tabs';
import { SessionRegistry } from '../editor/session';
import type { EditorSession, SaveSnapshot, SelectionSnapshot, SessionFileInfo } from '../editor/session';

export interface TabInfo {
    readonly path: AbsolutePath;
    readonly title: string;
    readonly isDirty: boolean;
    readonly encoding: TextEncoding;
    readonly eol: LineEnding;
    readonly hash: ContentHash;
    readonly mtime: EpochMillis;
}

export interface OpenOptions {
    /** Einfachklick öffnet als Vorschau-Tab (Standard), Doppelklick fest */
    readonly asPreview?: boolean;
    /** Gemerkte Auswahl für eine neue Sitzung (Tab-Gedächtnis); bei bereits offener Datei ohne Wirkung */
    readonly selection?: SelectionSnapshot;
}

export interface EditorStoreState {
    readonly tabs: TabsState;
    readonly files: Readonly<Record<AbsolutePath, TabInfo>>;
    open(file: TextFile, options?: OpenOptions): void;
    pin(path: AbsolutePath): void;
    close(path: AbsolutePath): void;
    closeOthers(path: AbsolutePath): void;
    activate(path: AbsolutePath): void;
    activateNext(): void;
    activatePrevious(): void;
    move(path: AbsolutePath, onto: AbsolutePath): void;
    /** Zieht Tabs um; `name` ist der neue Anzeigename von `from` (bei „Speichern unter“ der Name der Gewährung) */
    relocate(from: AbsolutePath, to: AbsolutePath, name?: string): void;
    markSaved(path: AbsolutePath, snapshot: SaveSnapshot, result: WriteResult): void;
    /** Übernimmt Hash, mtime, Kodierung und Zeilenenden der Sitzung nach einem Abgleich mit der Platte (W2-13) */
    refreshFile(path: AbsolutePath): void;
    session(path: AbsolutePath): EditorSession | undefined;
    activeSession(): EditorSession | null;
}

export type EditorStore = StoreApi<EditorStoreState>;

type SetState = EditorStore['setState'];
type GetState = EditorStore['getState'];

/** Titel ist der Anzeigename der Datei, nie der Schlüssel (bei Dialog-Dateien eine `GrantId`) */
function tabInfo(file: SessionFileInfo, isDirty: boolean): TabInfo {
    const { path, name, encoding, eol, hash, mtime } = file;
    return { path, title: name, isDirty, encoding, eol, hash, mtime };
}

function sameInfo(a: TabInfo | undefined, b: TabInfo): boolean {
    if (a === undefined) return false;
    return a.path === b.path && a.title === b.title && a.isDirty === b.isDirty && a.encoding === b.encoding &&
        a.eol === b.eol && a.hash === b.hash && a.mtime === b.mtime;
}

function withInfo(files: EditorStoreState['files'], info: TabInfo): EditorStoreState['files'] {
    return sameInfo(files[info.path], info) ? files : { ...files, [info.path]: info };
}

function withoutPaths(files: EditorStoreState['files'], paths: readonly AbsolutePath[]): EditorStoreState['files'] {
    if (!paths.some((path) => path in files)) return files;
    const next = { ...files };
    for (const path of paths) delete next[path];
    return next;
}

/** Setzt nur, was sich wirklich geändert hat; ohne Änderung wird niemand benachrichtigt. */
function applyChanges(set: SetState, get: GetState, tabs: TabsState, files: EditorStoreState['files']): void {
    const state = get();
    if (tabs === state.tabs && files === state.files) return;
    set({ tabs, files });
}

function tabActions(set: SetState, get: GetState) {
    const updateTabs = (change: (tabs: TabsState) => TabsState): void => applyChanges(set, get, change(get().tabs), get().files);
    return {
        pin: (path: AbsolutePath) => updateTabs((tabs) => promoteTab(tabs, path)),
        activate: (path: AbsolutePath) => updateTabs((tabs) => activateTab(tabs, path)),
        activateNext: () => updateTabs(activateNextTab),
        activatePrevious: () => updateTabs(activatePreviousTab),
        move: (path: AbsolutePath, onto: AbsolutePath) => updateTabs((tabs) => moveTab(tabs, path, onto)),
    };
}

function closingActions(set: SetState, get: GetState, registry: SessionRegistry) {
    // Erst den Zustand setzen (der sichtbare View wechselt zum Nachbarn), dann die Sitzungen freigeben.
    const closeWhere = (next: TabsState): void => {
        const removed = get().tabs.items.filter((item) => !next.items.includes(item));
        applyChanges(set, get, next, withoutPaths(get().files, removed));
        for (const path of removed) registry.close(path);
    };
    return {
        close: (path: AbsolutePath) => closeWhere(closeTab(get().tabs, path)),
        closeOthers: (path: AbsolutePath) => closeWhere(closeOtherTabs(get().tabs, path)),
    };
}

function openAction(set: SetState, get: GetState, registry: SessionRegistry) {
    const handleDirty = (session: EditorSession, isDirty: boolean): void => {
        if (registry.get(session.path) !== session) return;
        const files = withInfo(get().files, tabInfo(session.file, isDirty));
        // Die erste Änderung hält einen Vorschau-Tab fest, damit sie nicht verloren geht.
        const tabs = isDirty ? promoteTab(get().tabs, session.path) : get().tabs;
        applyChanges(set, get, tabs, files);
    };
    return (file: TextFile, options: OpenOptions = {}): void => {
        const { tabs, replaced } = openTab(get().tabs, file.path, options.asPreview ?? true);
        let files = get().files;
        if (registry.get(file.path) === undefined) {
            const session = registry.create(file, { onDirtyChange: handleDirty, selection: options.selection });
            files = withInfo(files, tabInfo(session.file, false));
        }
        applyChanges(set, get, tabs, replaced === null ? files : withoutPaths(files, [replaced]));
        if (replaced !== null) registry.close(replaced);
    };
}

function fileActions(set: SetState, get: GetState, registry: SessionRegistry) {
    return {
        relocate: (from: AbsolutePath, to: AbsolutePath, name?: string): void => {
            const { tabs, mapping } = relocateTabs(get().tabs, from, to);
            if (mapping.size === 0) return;
            let files = withoutPaths(get().files, [...mapping.keys()]);
            for (const [oldPath, newPath] of mapping) {
                registry.relocate(oldPath, newPath, oldPath === from ? name : undefined);
                const session = registry.get(newPath);
                if (session) files = withInfo(files, tabInfo(session.file, session.isDirty));
            }
            applyChanges(set, get, tabs, files);
        },
        markSaved: (path: AbsolutePath, snapshot: SaveSnapshot, result: WriteResult): void => {
            const session = registry.get(path);
            if (session === undefined) return;
            session.markSaved(snapshot, result);
            applyChanges(set, get, get().tabs, withInfo(get().files, tabInfo(session.file, session.isDirty)));
        },
    };
}

// Abgleich mit der Platte (W2-13, `app/diskSync.ts`): Neuladen ohne Wechsel von „geändert“ meldet die Sitzung nicht.
function diskActions(set: SetState, get: GetState, registry: SessionRegistry) {
    return {
        refreshFile: (path: AbsolutePath): void => {
            const session = registry.get(path);
            if (session === undefined) return;
            applyChanges(set, get, get().tabs, withInfo(get().files, tabInfo(session.file, session.isDirty)));
        },
    };
}

/** Eigener Store je Aufruf (Tests); die App nutzt `editorStore`. */
export function createEditorStore(registry: SessionRegistry = new SessionRegistry()): EditorStore {
    return createStore<EditorStoreState>()((set, get) => ({
        tabs: EMPTY_TABS,
        files: {},
        open: openAction(set, get, registry),
        ...tabActions(set, get),
        ...closingActions(set, get, registry),
        ...fileActions(set, get, registry),
        ...diskActions(set, get, registry),
        session: (path) => registry.get(path),
        activeSession: () => {
            const active = get().tabs.active;
            return active === null ? null : (registry.get(active) ?? null);
        },
    }));
}

export const editorStore = createEditorStore();

export function useEditorStore<T>(selector: (state: EditorStoreState) => T): T {
    return useStore(editorStore, selector);
}

export function isPreviewTab(state: EditorStoreState, path: AbsolutePath): boolean {
    return state.tabs.preview === path;
}
