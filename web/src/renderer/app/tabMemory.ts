// Tab-Gedächtnis je Projekt (W2-4; Swift: `TabMemory`, dort nur Pfade und aktiver Tab): welche Tabs offen waren
// (relativ zum Projekt, Vorschau/fest, Auswahl, Scrollposition). Reine Umwandlung Store ↔ `TabMemory` plus ein
// Controller, der entprellt speichert und beim Öffnen des Projekts wiederherstellt. Der Main hält die Datei.
import { TAB_MEMORY_VERSION } from '../../shared/contract';
import type {
    AbsolutePath, RelativePath, RendererApi, TabMemory, TabMemoryEntry, TextFile,
} from '../../shared/contract';
import type { TabsState } from '../../shared/core/tabs';
import type { SelectionSnapshot } from '../editor/session';
import type { EditorStore } from '../stores/editor';
import type { StatusMessage } from '../stores/status';
import { createDebounced } from './debounce';
import type { ScrollMemory } from './scrollMemory';

export const TAB_MEMORY_SAVE_DELAY_MS = 800;
export const TAB_MEMORY_TEXTS = {
    saveFailed: (detail: string) => `Offene Tabs konnten nicht gemerkt werden: ${detail}`,
} as const;

const SEPARATORS = /[\\/]+/;
const TRAILING_SEPARATORS = /[\\/]+$/;
const BACKSLASH = /\\/g;
const WINDOWS_ROOT = /^[a-zA-Z]:|^\\\\/;
const DRIVE_PREFIX = /^[a-zA-Z]:/;
const PARENT_SEGMENT = '..';
const NO_SELECTION: SelectionSnapshot = { anchor: 0, head: 0 };

// ---------- Pfade ----------

/** Pfad relativ zur Projektwurzel mit `/`; `null`, wenn er nicht darunter liegt (z. B. eine Dialog-Kennung) */
export function toRelativePath(root: AbsolutePath, path: AbsolutePath): RelativePath | null {
    const prefix = root.replace(TRAILING_SEPARATORS, '');
    const caseInsensitive = WINDOWS_ROOT.test(root);
    const head = path.slice(0, prefix.length);
    const sameHead = caseInsensitive ? head.toLowerCase() === prefix.toLowerCase() : head === prefix;
    if (!sameHead || !SEPARATORS.test(path.charAt(prefix.length))) return null;
    const relative = path.slice(prefix.length + 1).replace(BACKSLASH, '/');
    return relative.length === 0 ? null : relative;
}

function isSafeRelativePath(relative: string): boolean {
    if (relative.length === 0 || relative.includes('\0') || relative.includes('\\')) return false;
    if (relative.startsWith('/') || DRIVE_PREFIX.test(relative)) return false;
    return !relative.split('/').includes(PARENT_SEGMENT);
}

/** Gegenstück zu `toRelativePath`; `null` für unsichere Pfade (absolut, `..`) */
export function toAbsolutePath(root: AbsolutePath, relative: RelativePath): AbsolutePath | null {
    if (!isSafeRelativePath(relative)) return null;
    const prefix = root.replace(TRAILING_SEPARATORS, '');
    const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
    return `${prefix}${separator}${relative.split('/').join(separator)}`;
}

// ---------- Store → Gedächtnis ----------

export interface TabMemorySource {
    readonly root: AbsolutePath;
    readonly tabs: TabsState;
    selectionOf(path: AbsolutePath): SelectionSnapshot | null;
    scrollOf(path: AbsolutePath): number;
}

function entryOf(source: TabMemorySource, path: AbsolutePath, relative: RelativePath): TabMemoryEntry {
    const selection = source.selectionOf(path) ?? NO_SELECTION;
    return {
        path: relative,
        isPreview: source.tabs.preview === path,
        anchor: selection.anchor,
        head: selection.head,
        scrollTop: Math.max(0, Math.round(source.scrollOf(path))),
    };
}

/** Nur Tabs unter der Projektwurzel; Dateien aus Dialogen (Kennung als Schlüssel) werden nicht gemerkt */
export function buildTabMemory(source: TabMemorySource): TabMemory {
    const tabs: TabMemoryEntry[] = [];
    let active: RelativePath | null = null;
    for (const path of source.tabs.items) {
        const relative = toRelativePath(source.root, path);
        if (relative === null) continue;
        tabs.push(entryOf(source, path, relative));
        if (source.tabs.active === path) active = relative;
    }
    return { version: TAB_MEMORY_VERSION, tabs, active };
}

// ---------- Gedächtnis → Store ----------

export interface TabMemoryDeps {
    readonly api: Pick<RendererApi, 'fs' | 'tabs'>;
    readonly store: EditorStore;
    readonly root: AbsolutePath;
    readonly scroll: ScrollMemory;
    readonly report?: (message: StatusMessage) => void;
    readonly delayMs?: number;
}

export interface RestoreResult {
    readonly opened: number;
    /** Nicht mehr vorhandene oder unlesbare Dateien und unsichere Pfade */
    readonly skipped: number;
}

interface RestoreTarget {
    readonly entry: TabMemoryEntry;
    readonly path: AbsolutePath;
}

function restoreTargets(root: AbsolutePath, memory: TabMemory): RestoreTarget[] {
    const targets: RestoreTarget[] = [];
    for (const entry of memory.tabs) {
        const path = toAbsolutePath(root, entry.path);
        if (path !== null) targets.push({ entry, path });
    }
    return targets;
}

function openRemembered(deps: TabMemoryDeps, file: TextFile, entry: TabMemoryEntry): void {
    const state = deps.store.getState();
    if (state.session(file.path) === undefined) deps.scroll.setPending(file.path, entry.scrollTop);
    state.open(file, { asPreview: entry.isPreview, selection: { anchor: entry.anchor, head: entry.head } });
}

/** Öffnet die gemerkten Tabs in ihrer Reihenfolge (neue Tabs stehen rechts vom aktiven) und aktiviert den gemerkten */
export async function restoreTabMemory(deps: TabMemoryDeps, memory: TabMemory): Promise<RestoreResult> {
    const targets = restoreTargets(deps.root, memory);
    const read = await deps.api.fs.readMany(targets.map((target) => target.path));
    if (!read.ok) return { opened: 0, skipped: memory.tabs.length };
    const entries = new Map(targets.map((target) => [target.path, target.entry]));
    let opened = 0;
    for (const item of read.value) {
        const entry = entries.get(item.path);
        if (entry === undefined || !item.result.ok) continue;
        openRemembered(deps, item.result.value, entry);
        opened++;
    }
    const active = memory.active === null ? null : toAbsolutePath(deps.root, memory.active);
    if (active !== null) deps.store.getState().activate(active);
    return { opened, skipped: memory.tabs.length - opened };
}

// ---------- Controller ----------

/** Hält das Gedächtnis eines Projekts aktuell: speichert entprellt bei Tab-Änderungen und auf Anforderung */
export class TabMemoryController {
    private lastSaved: string | null = null;
    private restoring = false;
    private stopped = false;
    private reportedFailure = false;
    private queue: Promise<void> = Promise.resolve();
    private readonly saveSoon;
    private readonly disconnect: readonly (() => void)[];

    constructor(private readonly deps: TabMemoryDeps) {
        this.saveSoon = createDebounced(() => void this.enqueueSave(), deps.delayMs ?? TAB_MEMORY_SAVE_DELAY_MS);
        const unsubscribeStore = deps.store.subscribe((state, previous) => {
            if (state.tabs === previous.tabs) return;
            deps.scroll.retain(new Set(state.tabs.items));
            this.changed();
        });
        this.disconnect = [unsubscribeStore, deps.scroll.onChange(() => this.changed())];
    }

    async restore(): Promise<RestoreResult> {
        this.restoring = true;
        try {
            const loaded = await this.deps.api.tabs.memoryLoad();
            if (!loaded.ok || loaded.value === null) return { opened: 0, skipped: 0 };
            this.lastSaved = JSON.stringify(loaded.value);
            return await restoreTabMemory(this.deps, loaded.value);
        } finally {
            this.restoring = false;
            this.changed();
        }
    }

    /** Schreibt sofort (Projekt schließen oder wechseln, Fenster schließen) und wartet auf das Ende */
    flush(): Promise<void> {
        this.saveSoon.cancel();
        return this.enqueueSave();
    }

    async stop(): Promise<void> {
        await this.flush();
        this.stopped = true;
        for (const disconnect of this.disconnect) disconnect();
    }

    private changed(): void {
        if (this.restoring || this.stopped) return;
        this.saveSoon.call();
    }

    private enqueueSave(): Promise<void> {
        this.queue = this.queue.then(() => this.save());
        return this.queue;
    }

    private async save(): Promise<void> {
        if (this.restoring || this.stopped) return;
        const memory = buildTabMemory(this.source());
        const json = JSON.stringify(memory);
        if (json === this.lastSaved) return;
        const result = await this.deps.api.tabs.memorySave(memory);
        if (result.ok) {
            this.lastSaved = json;
            return;
        }
        if (this.reportedFailure) return;
        this.reportedFailure = true;
        this.deps.report?.({ text: TAB_MEMORY_TEXTS.saveFailed(result.error.message), kind: 'error' });
    }

    private source(): TabMemorySource {
        const { store, root, scroll } = this.deps;
        return {
            root,
            tabs: store.getState().tabs,
            selectionOf: (path) => store.getState().session(path)?.selection ?? null,
            scrollOf: (path) => scroll.get(path),
        };
    }
}
