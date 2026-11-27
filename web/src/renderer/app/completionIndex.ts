/**
 * Client des Vervollständigungs-Index (W4-6, Muster `workers/analysisClient.ts`): sammelt, welche Dateien neu gelesen
 * werden müssen (Projektwechsel, neuer Baum, `fs:changed`, Tippen in offenen Tabs), liest nach einer Ruhezeit nur
 * diese (Platte per `fs:readMany`, offene Tabs aus der Sitzung) und schickt nur Geändertes an den Worker. Je Datei
 * merkt er sich Hash und Zeitstempel bzw. den Dokumentstand; Antworten mit veralteter Version werden verworfen.
 * Ohne DOM-Typen (die Tests laufen mit der Node-Typprüfung).
 */
import type { IpcEvents, ReadManyItem } from '../../shared/contract';
import {
    EMPTY_COMPLETION_INDEX,
    relativeWithin,
    sourceKindOf,
    type CompletionIndexResponse,
    type CompletionIndexSnapshot,
    type CompletionIndexUpdate,
    type ProjectFiles,
    type SourceFile,
} from './completionIndexLogic';
import { EMPTY_REFERENCES, type ReferenceSnapshot } from './referenceCheckLogic';

/** Ruhezeit nach der letzten Änderung (Swift `CompletionProvider.reloadDelay`) */
export const COMPLETION_INDEX_DEBOUNCE_MS = 500;
/** Höchstens so viele Dateien je `fs:readMany` */
export const READ_BATCH_SIZE = 100;
const PROJECT_OPEN_DELAY_MS = 0;

/** Der Teil von `Worker`, den der Client braucht (Tests liefern eine Fälschung) */
export interface CompletionWorkerLike {
    postMessage(request: CompletionIndexUpdate): void;
    terminate(): void;
    onmessage: ((event: { readonly data: CompletionIndexResponse }) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onmessageerror: ((event: unknown) => void) | null;
}

/** `null`: kein Worker verfügbar (z. B. in Node), der Index bleibt leer */
export type CompletionWorkerFactory = () => CompletionWorkerLike | null;

export interface IndexTimer {
    set(callback: () => void, delayMs: number): unknown;
    clear(handle: unknown): void;
}

/** Offener Tab: Anzeigename und aktueller Dokumentstand (unveränderliches Objekt, z. B. CodeMirror-`Text`) */
export interface OpenDocument {
    readonly name: string;
    readonly doc: { toString(): string };
}

export interface CompletionIndexDeps {
    readonly readMany: (paths: string[]) => Promise<readonly ReadManyItem[]>;
    readonly openDocuments: () => ReadonlyMap<string, OpenDocument>;
    readonly createWorker?: CompletionWorkerFactory;
    readonly timer?: IndexTimer;
    readonly debounceMs?: number;
    readonly onIndexChanged?: (index: CompletionIndexSnapshot) => void;
    /** W4-12: Ergebnis der Verweisprüfung hat sich geändert (kommt mit derselben Antwort des Workers) */
    readonly onReferencesChanged?: (references: ReferenceSnapshot) => void;
    readonly onError?: (message: string) => void;
}

type Stamp =
    | { readonly source: 'disk'; readonly hash: string; readonly mtime: number }
    | { readonly source: 'session'; readonly doc: object };

interface PendingWork {
    readonly changed: SourceFile[];
    readonly removed: string[];
    readonly toRead: string[];
}

// Über `globalThis`, weil die Tests ohne DOM-Typen übersetzt werden.
interface ModuleWorkerConstructor {
    new (url: URL, options: { readonly type: 'module' }): CompletionWorkerLike;
}

export function createDefaultCompletionWorker(): CompletionWorkerLike | null {
    const { Worker } = globalThis as unknown as { Worker?: ModuleWorkerConstructor };
    if (Worker === undefined) return null;
    return new Worker(new URL('../workers/completionIndex.worker.ts', import.meta.url), { type: 'module' });
}

const defaultTimer: IndexTimer = {
    set: (callback, delayMs) => setTimeout(callback, delayMs),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function sameFiles(left: ProjectFiles | null, right: ProjectFiles | null): boolean {
    if (left === null || right === null) return left === right;
    return left.root === right.root && left.mainFile === right.mainFile && left.files.length === right.files.length &&
        left.files.every((file, index) => file === right.files[index]);
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class CompletionIndexClient {
    private worker: CompletionWorkerLike | null = null;
    private project: ProjectFiles | null = null;
    private sources: ReadonlySet<string> = new Set();
    private openPaths: ReadonlySet<string> = new Set();
    private readonly dirty = new Set<string>();
    private readonly stamps = new Map<string, Stamp>();
    private documentsEdited = false;
    private pendingReset = true;
    private projectChanged = true;
    private version = 0;
    private generation = 0;
    private timerHandle: unknown = null;
    private flushing = false;
    private flushRequested = false;
    private disposed = false;
    private current: CompletionIndexSnapshot = EMPTY_COMPLETION_INDEX;
    private received: CompletionIndexSnapshot = EMPTY_COMPLETION_INDEX;
    private currentReferences: ReferenceSnapshot = EMPTY_REFERENCES;
    private receivedReferences: ReferenceSnapshot = EMPTY_REFERENCES;
    private readonly timer: IndexTimer;
    private readonly debounceMs: number;
    private readonly createWorker: CompletionWorkerFactory;

    constructor(private readonly deps: CompletionIndexDeps) {
        this.timer = deps.timer ?? defaultTimer;
        this.debounceMs = deps.debounceMs ?? COMPLETION_INDEX_DEBOUNCE_MS;
        this.createWorker = deps.createWorker ?? createDefaultCompletionWorker;
    }

    /** Zuletzt gültiger Index (leer, bis der Worker geantwortet hat) */
    get index(): CompletionIndexSnapshot {
        return this.current;
    }

    /** Zuletzt gültiges Ergebnis der Verweisprüfung (leer, bis der Worker geantwortet hat) */
    get references(): ReferenceSnapshot {
        return this.currentReferences;
    }

    /** Neues Projekt (Wurzel geändert: alles vergessen) oder neuer Baum (neue/entfernte Dateien neu lesen) */
    setProject(project: ProjectFiles | null): void {
        if (this.disposed || sameFiles(this.project, project)) return;
        const rootChanged = this.project?.root !== project?.root;
        const previousSources = this.sources;
        this.project = project;
        this.projectChanged = true;
        this.sources = new Set(project?.files.filter((file) => sourceKindOf(file) !== null) ?? []);
        if (rootChanged) {
            this.forgetAll();
            this.schedule(PROJECT_OPEN_DELAY_MS);
            return;
        }
        for (const path of this.sources) if (!previousSources.has(path)) this.dirty.add(path);
        for (const path of previousSources) if (!this.sources.has(path)) this.dirty.add(path);
        this.schedule();
    }

    /** `fs:changed`: betroffene Quelldateien des Projekts neu lesen */
    handleFsChanged(event: IpcEvents['fs:changed']): void {
        if (this.disposed) return;
        const before = this.dirty.size;
        for (const path of event.paths) if (this.sources.has(path) || this.openPaths.has(path)) this.dirty.add(path);
        if (this.dirty.size > before) this.schedule();
    }

    /** Ein offener Tab wurde bearbeitet (pro Tastendruck: nur Merker und Zeitgeber) */
    noteDocumentsEdited(): void {
        if (this.disposed) return;
        this.documentsEdited = true;
        this.schedule();
    }

    /** Tabs geöffnet oder geschlossen: geöffnete aus der Sitzung, geschlossene wieder von der Platte */
    noteOpenDocumentsChanged(): void {
        if (this.disposed) return;
        const now = new Set(this.relevantOpenDocuments().keys());
        const changed = [...now].filter((path) => !this.openPaths.has(path))
            .concat([...this.openPaths].filter((path) => !now.has(path)));
        this.openPaths = now;
        if (changed.length === 0) return;
        for (const path of changed) this.dirty.add(path);
        this.schedule();
    }

    dispose(): void {
        this.disposed = true;
        if (this.timerHandle !== null) this.timer.clear(this.timerHandle);
        this.timerHandle = null;
        this.worker?.terminate();
        this.worker = null;
    }

    private forgetAll(): void {
        this.generation++;
        this.pendingReset = true;
        this.stamps.clear();
        this.dirty.clear();
        this.openPaths = new Set(this.relevantOpenDocuments().keys());
        for (const path of this.sources) this.dirty.add(path);
        for (const path of this.openPaths) this.dirty.add(path);
        this.received = EMPTY_COMPLETION_INDEX;
        this.receivedReferences = EMPTY_REFERENCES;
        this.publish(EMPTY_COMPLETION_INDEX);
        this.publishReferences(EMPTY_REFERENCES);
    }

    private schedule(delayMs = this.debounceMs): void {
        if (this.timerHandle !== null) this.timer.clear(this.timerHandle);
        this.timerHandle = this.timer.set(() => void this.flush(), delayMs);
    }

    private async flush(): Promise<void> {
        this.timerHandle = null;
        if (this.disposed) return;
        if (this.flushing) {
            this.flushRequested = true;
            return;
        }
        this.flushing = true;
        try {
            await this.sendPending();
        } catch (error) {
            this.deps.onError?.(errorText(error));
        } finally {
            this.flushing = false;
        }
        if (this.flushRequested && !this.disposed) {
            this.flushRequested = false;
            this.schedule();
        }
    }

    private async sendPending(): Promise<void> {
        const generation = this.generation;
        const work = this.collectWork();
        // Lesefehler: Offene Tabs trotzdem schicken, die Plattendateien bei der nächsten Änderung erneut lesen
        const items = await this.readAll(work.toRead).catch((error: unknown) => {
            for (const path of work.toRead) this.dirty.add(path);
            this.deps.onError?.(errorText(error));
            return [];
        });
        if (this.disposed || generation !== this.generation) return;
        for (const item of items) this.acceptRead(item, work);
        if (!this.pendingReset && !this.projectChanged && work.changed.length === 0 && work.removed.length === 0) return;
        this.post(work);
    }

    /** Offene Tabs liefern ihren Text sofort; Projektdateien kommen in die Leseliste; der Rest fällt weg */
    private collectWork(): PendingWork {
        const open = this.relevantOpenDocuments();
        if (this.documentsEdited) for (const path of open.keys()) this.dirty.add(path);
        this.documentsEdited = false;
        const work: PendingWork = { changed: [], removed: [], toRead: [] };
        for (const path of this.dirty) this.classify(path, open.get(path), work);
        this.dirty.clear();
        return work;
    }

    private classify(path: string, document: OpenDocument | undefined, work: PendingWork): void {
        if (document !== undefined) {
            const stamp = this.stamps.get(path);
            if (stamp?.source === 'session' && stamp.doc === document.doc) return;
            this.stamps.set(path, { source: 'session', doc: document.doc });
            work.changed.push({ path, name: document.name, text: document.doc.toString() });
            return;
        }
        if (this.sources.has(path)) {
            work.toRead.push(path);
            return;
        }
        if (this.stamps.delete(path)) work.removed.push(path);
    }

    private async readAll(paths: readonly string[]): Promise<ReadManyItem[]> {
        const items: ReadManyItem[] = [];
        for (let start = 0; start < paths.length; start += READ_BATCH_SIZE) {
            items.push(...(await this.deps.readMany(paths.slice(start, start + READ_BATCH_SIZE))));
        }
        return items;
    }

    /** Gleicher Hash und Zeitstempel wie zuletzt: nichts schicken; Lesefehler (gelöscht): entfernen */
    private acceptRead(item: ReadManyItem, work: PendingWork): void {
        const previous = this.stamps.get(item.path);
        if (!item.result.ok) {
            if (this.stamps.delete(item.path)) work.removed.push(item.path);
            return;
        }
        const file = item.result.value;
        if (previous?.source === 'disk' && previous.hash === file.hash && previous.mtime === file.mtime) return;
        this.stamps.set(item.path, { source: 'disk', hash: file.hash, mtime: file.mtime });
        work.changed.push({ path: item.path, name: file.name, text: file.text });
    }

    private post(work: PendingWork): void {
        this.worker ??= this.startWorker();
        if (this.worker === null) return;
        this.version++;
        const update: CompletionIndexUpdate = {
            kind: 'update',
            version: this.version,
            reset: this.pendingReset,
            ...(this.projectChanged ? { project: this.project } : {}),
            changed: work.changed,
            removed: work.removed,
        };
        this.pendingReset = false;
        this.projectChanged = false;
        this.worker.postMessage(update);
    }

    private startWorker(): CompletionWorkerLike | null {
        const worker = this.createWorker();
        if (worker === null) return null;
        worker.onmessage = (event) => this.receive(worker, event.data);
        worker.onerror = () => this.restart(worker, 'Index-Worker der Vervollständigung ist ausgefallen');
        worker.onmessageerror = () => this.restart(worker, 'Antwort des Index-Workers unlesbar');
        return worker;
    }

    /** Neuer Worker kennt nichts: bei der nächsten Änderung alles neu schicken (kein Neustart in Schleife) */
    private restart(failed: CompletionWorkerLike, message: string): void {
        if (this.disposed || this.worker !== failed) return;
        failed.terminate();
        this.worker = null;
        this.pendingReset = true;
        this.projectChanged = true;
        this.stamps.clear();
        for (const path of this.sources) this.dirty.add(path);
        for (const path of this.openPaths) this.dirty.add(path);
        this.deps.onError?.(message);
    }

    /** Eine ältere Antwort zählt nicht, ihr Index aber schon, falls die aktuelle „unverändert“ meldet */
    private receive(source: CompletionWorkerLike, response: CompletionIndexResponse): void {
        if (this.disposed || source !== this.worker) return;
        if (response.kind === 'error') {
            this.deps.onError?.(response.message);
            return;
        }
        if (response.index !== null) this.received = response.index;
        if (response.references) this.receivedReferences = response.references;
        if (response.version !== this.version) return;
        this.publish(this.received);
        this.publishReferences(this.receivedReferences);
    }

    private publishReferences(references: ReferenceSnapshot): void {
        if (references === this.currentReferences) return;
        this.currentReferences = references;
        this.deps.onReferencesChanged?.(references);
    }

    private publish(index: CompletionIndexSnapshot): void {
        if (index === this.current) return;
        this.current = index;
        this.deps.onIndexChanged?.(index);
    }

    /** Offene Tabs mit Quelldatei-Endung; mit Projekt nur die darin */
    private relevantOpenDocuments(): Map<string, OpenDocument> {
        const relevant = new Map<string, OpenDocument>();
        for (const [path, document] of this.deps.openDocuments()) {
            if (sourceKindOf(document.name) === null) continue;
            if (this.project !== null && relativeWithin(this.project.root, path) === null) continue;
            relevant.set(path, document);
        }
        return relevant;
    }
}
