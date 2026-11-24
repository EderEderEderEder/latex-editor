import { watch as nativeWatch, type Dirent } from 'node:fs';
import * as fsp from 'node:fs/promises';
import type { ContentHash, FsChangeKind, IpcEvents } from '../shared/contract';
import { currentPathPlatform, type PathPlatform } from './paths';
import { isBuildFileName, MAX_TREE_DEPTH, MAX_TREE_ENTRIES, SKIPPED_DIRECTORY_NAMES } from './project';
import { hashBytes } from './textIo';

// Dateiüberwachung des Projektordners (W2-2, Regeln aus S10 in docs/ARCHITEKTUR.md): `fs.watch` mit `recursive`.
// Die Ereignisart (`rename`/`change`) wird ignoriert (macOS meldet fast alles als `rename`); neu/geändert/gelöscht
// entscheidet ein Index per `readdir`/`lstat`. Ohne Electron; Rohüberwacher und Zeitgeber sind einspeisbar, ein Tausch
// gegen `chokidar` berührt nur `RawWatchFactory`. Kein Polling: `rescan()` ist das Sicherheitsnetz.

export type FsChangedBatch = IpcEvents['fs:changed'];

export const DEBOUNCE_QUIET_MS = 300;
export const DEBOUNCE_MAX_WAIT_MS = 1_500;
// Kurz gesperrte Dateien (OneDrive, Virenscanner unter Windows): Wiederholung mit Rückoff, danach aufgeben.
export const TRANSIENT_RETRY_DELAYS_MS: readonly number[] = [50, 100, 200, 400, 800];
// So lange gilt ein eigenes Speichern als Echo; Ereignisse können ins Nachbarfenster des Entprellers wandern.
export const OWN_WRITE_TTL_MS = 5_000;

const TRANSIENT_ERROR_CODES: ReadonlySet<string> = new Set(['EBUSY', 'EPERM', 'EACCES']);
const SEPARATOR = '/';
const ROOT = '';
const HIDDEN_PREFIX = '.';
const GIT_DIRECTORY = '.git';
const GIT_FILES: ReadonlySet<string> = new Set(['HEAD', 'index', 'packed-refs']);
const GIT_REFS_DIRECTORY = 'refs';
const LOCK_SUFFIX = '.lock';
const MINTED_PREFIX = '_minted';
const BACKUP_SUFFIX = '~';
// Ergänzt `isBuildFileName` (project.ts) um Editor-Reste; versteckte Namen (`.DS_Store`, `.#…`) fallen ohnehin weg.
const NOISE_EXTENSIONS: readonly string[] = ['.auxlock', '.pyg', '.ist', '.brf', '.tmp', '.swp', '.swx', '.bak'];
const NOISE_FILE_NAMES: ReadonlySet<string> = new Set(['thumbs.db', 'desktop.ini', '4913']);

// ---------- Zeitgeber und Rohüberwacher (einspeisbar) ----------

export interface Scheduler {
    now(): number;
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

export const SYSTEM_SCHEDULER: Scheduler = {
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export interface RawWatchHandle {
    close(): void;
}

// `name` relativ zur Wurzel; `null` heißt „unbekannt“ und führt zum Neueinlesen des ganzen Baums.
export type RawWatchFactory = (
    root: string,
    onName: (name: string | null) => void,
    onError: (error: Error) => void,
) => RawWatchHandle;

export const nodeWatchFactory: RawWatchFactory = (root, onName, onError) => {
    const handle = nativeWatch(root, { recursive: true }, (_eventType, name) => onName(name ?? null));
    handle.on('error', onError);
    return handle;
};

// ---------- Hilfen ----------

function errorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
    return typeof error.code === 'string' ? error.code : undefined;
}

function toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

export function describeWatchError(error: Error): string {
    const code = errorCode(error);
    if (code === 'EMFILE') return 'zu viele offene Dateien (EMFILE)';
    if (code === 'ENOSPC') return 'Grenze überwachter Ordner erreicht (ENOSPC, fs.inotify.max_user_watches)';
    return error.message;
}

export async function withTransientRetry<T>(
    operation: () => Promise<T>,
    sleep: (ms: number) => Promise<void>,
    delaysMs: readonly number[] = TRANSIENT_RETRY_DELAYS_MS,
): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await operation();
        } catch (error) {
            const delay = delaysMs[attempt];
            if (!TRANSIENT_ERROR_CODES.has(errorCode(error) ?? '') || delay === undefined) throw error;
            await sleep(delay);
        }
    }
}

export function splitRelative(name: string, platform: PathPlatform): string[] {
    const parts = platform.windows ? name.split(/[\\/]/) : name.split(SEPARATOR);
    return parts.filter((part) => part.length > 0 && part !== '.');
}

// Index-Schlüssel: Groß-/Kleinschreibung zählt (Umbenennen `Datei` → `datei` ist eine Änderung), unter macOS NFC.
export function indexKey(relPath: string, platform: PathPlatform): string {
    return platform.unicodeInsensitive ? relPath.normalize('NFC') : relPath;
}

function isWithinKey(key: string, prefix: string): boolean {
    return prefix === ROOT || key === prefix || key.startsWith(prefix + SEPARATOR);
}

function joinRelative(parent: string, name: string): string {
    return parent === ROOT ? name : `${parent}${SEPARATOR}${name}`;
}

// ---------- Filter ----------

export type PathCategory = 'source' | 'git' | 'noise';

function isNoiseFileName(name: string): boolean {
    const lower = name.toLowerCase();
    if (NOISE_FILE_NAMES.has(lower) || name.endsWith(BACKUP_SUFFIX) || isBuildFileName(name)) return true;
    return NOISE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function isNoiseDirectoryName(name: string): boolean {
    const lower = name.toLowerCase();
    return name.startsWith(HIDDEN_PREFIX) || SKIPPED_DIRECTORY_NAMES.has(lower) || lower.startsWith(MINTED_PREFIX);
}

function isNoiseEntry(name: string, isDirectory: boolean): boolean {
    if (name.startsWith(HIDDEN_PREFIX)) return true;
    return isDirectory ? isNoiseDirectoryName(name) : isNoiseFileName(name);
}

// In `.git` zählen nur HEAD, Index und Refs (ohne `.lock`); Objekte, Logs usw. sind Rauschen.
function isRelevantGitPath(rest: readonly string[]): boolean {
    const joined = rest.join(SEPARATOR);
    if (joined.endsWith(LOCK_SUFFIX)) return false;
    return GIT_FILES.has(joined) || (rest[0] === GIT_REFS_DIRECTORY && rest.length > 1);
}

// Versteckte Pfade, `node_modules`, `_minted*` und Build-Hilfsdateien lösen kein Dateiereignis aus (wie Swift).
export function categorizePath(segments: readonly string[]): PathCategory {
    const [first] = segments;
    if (first === undefined) return 'source';
    if (first === GIT_DIRECTORY) return isRelevantGitPath(segments.slice(1)) ? 'git' : 'noise';
    const last = segments.length - 1;
    const noisy = segments.some((segment, index) =>
        isNoiseDirectoryName(segment) || (index === last && isNoiseFileName(segment)));
    return noisy ? 'noise' : 'source';
}

// ---------- Entpreller ----------

// Sammelt Namen; liefert nach `quietMs` Ruhe, spätestens `maxWaitMs` nach dem ersten Namen (Dauerfeuer).
export class Debouncer {
    private pending = new Set<string>();
    private timer: unknown = null;
    private firstAt = 0;

    constructor(
        private readonly flush: (items: string[]) => void,
        private readonly scheduler: Scheduler,
        private readonly quietMs = DEBOUNCE_QUIET_MS,
        private readonly maxWaitMs = DEBOUNCE_MAX_WAIT_MS,
    ) {}

    push(item: string): void {
        const now = this.scheduler.now();
        if (this.pending.size === 0) this.firstAt = now;
        this.pending.add(item);
        this.clearTimer();
        const remaining = Math.max(0, this.maxWaitMs - (now - this.firstAt));
        this.timer = this.scheduler.setTimeout(() => this.fire(), Math.min(this.quietMs, remaining));
    }

    cancel(): void {
        this.clearTimer();
        this.pending = new Set();
    }

    private fire(): void {
        this.timer = null;
        const items = [...this.pending];
        this.pending = new Set();
        if (items.length > 0) this.flush(items);
    }

    private clearTimer(): void {
        if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
        this.timer = null;
    }
}

// ---------- Überwacher ----------

// Schnittstelle für Aufrufer; die Umsetzung dahinter (fs.watch, später evtl. chokidar) ist austauschbar.
export interface FileWatcher {
    start(root: string, onBatch: (batch: FsChangedBatch) => void): Promise<void>;
    stop(): void;
    // Sicherheitsnetz (Build fertig, Fenster-Fokus, Überwacher-Fehler): Baum und mtime/Größe gegen den Index.
    rescan(): Promise<void>;
    // Eigenes Speichern: ein Ereignis mit genau diesem Inhalt ist ein Echo und wird unterdrückt.
    ignoreOwnWrite(path: string, hash: ContentHash): void;
    // Build-PDF (und Ähnliches): Änderungen erscheinen nie als Pfad, nur Anlegen/Löschen setzt `treeChanged`.
    setBuildOutputs(paths: readonly string[]): void;
}

export interface ProjectWatcherOptions {
    readonly watchFactory?: RawWatchFactory;
    readonly scheduler?: Scheduler;
    readonly platform?: PathPlatform;
    // Überwacher-Fehler (EMFILE, ENOSPC, EPERM beim Löschen der Wurzel): danach Betrieb ohne Überwachung.
    readonly onError?: (error: Error) => void;
    readonly quietMs?: number;
    readonly maxWaitMs?: number;
    readonly retryDelaysMs?: readonly number[];
}

interface EntryStats {
    readonly isDirectory: boolean;
    readonly mtimeMs: number;
    readonly size: number;
}

interface IndexEntry extends EntryStats {
    // Name in der Form auf der Platte (für Zugriffe und Meldungen), mit `/` getrennt
    readonly relPath: string;
}

interface OwnWrite {
    readonly hash: ContentHash;
    readonly expiresAt: number;
}

interface BatchState {
    readonly changes: Map<string, { readonly relPath: string; readonly kind: FsChangeKind }>;
    readonly visited: Set<string>;
    // Elternordner → (Vergleichsname → Name auf der Platte); `null` = Ordner fehlt
    readonly listings: Map<string, Map<string, string> | null>;
    treeChanged: boolean;
    gitChanged: boolean;
}

const DIRECTORY_STATS: EntryStats = { isDirectory: true, mtimeMs: 0, size: 0 };
// Datei existiert, ist aber gesperrt: gilt als geändert (lieber ein Ereignis zu viel als eines verloren).
const LOCKED_FILE_STATS: EntryStats = { isDirectory: false, mtimeMs: -1, size: -1 };

function createBatchState(): BatchState {
    return { changes: new Map(), visited: new Set(), listings: new Map(), treeChanged: false, gitChanged: false };
}

function hasChanged(known: EntryStats, current: EntryStats): boolean {
    return known.mtimeMs !== current.mtimeMs || known.size !== current.size;
}

export class ProjectWatcher implements FileWatcher {
    private readonly factory: RawWatchFactory;
    private readonly scheduler: Scheduler;
    private readonly platform: PathPlatform;
    private readonly retryDelays: readonly number[];
    private readonly debouncer: Debouncer;
    private root: string | null = null;
    private realRoot: string | null = null;
    private onBatch: ((batch: FsChangedBatch) => void) | null = null;
    private handle: RawWatchHandle | null = null;
    private index = new Map<string, IndexEntry>();
    private readonly ownWrites = new Map<string, OwnWrite>();
    private buildOutputPaths: readonly string[] = [];
    private buildOutputKeys: ReadonlySet<string> = new Set();
    private queue: Promise<void> = Promise.resolve();
    // Jeder Start/Stopp erhöht die Generation; Aufgaben einer alten Generation melden nichts mehr.
    private generation = 0;

    constructor(private readonly options: ProjectWatcherOptions = {}) {
        this.factory = options.watchFactory ?? nodeWatchFactory;
        this.scheduler = options.scheduler ?? SYSTEM_SCHEDULER;
        this.platform = options.platform ?? currentPathPlatform();
        this.retryDelays = options.retryDelaysMs ?? TRANSIENT_RETRY_DELAYS_MS;
        this.debouncer = new Debouncer((names) => this.onDebounced(names), this.scheduler, options.quietMs, options.maxWaitMs);
    }

    // Erst der Index (in der Warteschlange), dann der Rohüberwacher: Ereignisse während des Einlesens warten dahinter.
    async start(root: string, onBatch: (batch: FsChangedBatch) => void): Promise<void> {
        this.stop();
        const generation = ++this.generation;
        this.root = root;
        this.onBatch = onBatch;
        void this.enqueue(async () => {
            this.realRoot = await fsp.realpath(root).catch(() => root);
            this.buildOutputKeys = this.keysOf(this.buildOutputPaths);
            const index = await this.scanSubtree(ROOT, await this.entryStats(ROOT));
            if (generation === this.generation) this.index = index;
        });
        this.openRawWatcher(root, generation);
        // Auch ein Sicherheitsnetz-Lauf nach einem Startfehler ist danach fertig.
        await this.whenIdle();
    }

    stop(): void {
        this.generation++;
        this.closeHandle();
        this.debouncer.cancel();
        this.onBatch = null;
        this.root = null;
        this.index = new Map();
        this.ownWrites.clear();
    }

    rescan(): Promise<void> {
        if (this.root === null) return Promise.resolve();
        const generation = this.generation;
        return this.enqueue(async () => {
            const state = createBatchState();
            await this.diffSubtree(ROOT, state, await this.entryStats(ROOT));
            await this.finishBatch(state, generation);
        });
    }

    ignoreOwnWrite(path: string, hash: ContentHash): void {
        const key = this.relativeKeyOf(path);
        if (key === null) return;
        const now = this.scheduler.now();
        for (const [pendingKey, pending] of this.ownWrites) {
            if (pending.expiresAt < now) this.ownWrites.delete(pendingKey);
        }
        this.ownWrites.set(key, { hash, expiresAt: now + OWN_WRITE_TTL_MS });
    }

    setBuildOutputs(paths: readonly string[]): void {
        this.buildOutputPaths = [...paths];
        this.buildOutputKeys = this.keysOf(paths);
    }

    // Für Tests und geordnetes Beenden: wartet, bis alle eingereihten Auswertungen fertig sind.
    whenIdle(): Promise<void> {
        return this.queue;
    }

    private openRawWatcher(root: string, generation: number): void {
        try {
            this.handle = this.factory(
                root,
                (name) => this.onRawName(name ?? ROOT, generation),
                (error) => this.handleWatchError(error, generation),
            );
        } catch (error) {
            this.handleWatchError(toError(error), generation);
        }
    }

    private onRawName(name: string, generation: number): void {
        if (generation !== this.generation) return;
        const segments = splitRelative(name, this.platform);
        if (categorizePath(segments) === 'noise') return;
        this.debouncer.push(name);
    }

    private onDebounced(names: readonly string[]): void {
        const generation = this.generation;
        void this.enqueue(() => this.processNames(names, generation));
    }

    private handleWatchError(error: Error, generation: number): void {
        if (generation !== this.generation) return;
        this.closeHandle();
        this.options.onError?.(error);
        void this.rescan();
    }

    private closeHandle(): void {
        try {
            this.handle?.close();
        } catch {
            // Ein schon kaputter Überwacher lässt sich nicht immer sauber schließen; er ist danach ohnehin weg.
        }
        this.handle = null;
    }

    private enqueue(task: () => Promise<void>): Promise<void> {
        const run = this.queue.then(task).catch((error: unknown) => this.options.onError?.(toError(error)));
        this.queue = run;
        return run;
    }

    private keysOf(paths: readonly string[]): ReadonlySet<string> {
        const keys = paths.map((path) => this.relativeKeyOf(path)).filter((key): key is string => key !== null);
        return new Set(keys);
    }

    // Pfad aus dem Main (oft per realpath aufgelöst) → Index-Schlüssel; `null` außerhalb des Projekts.
    private relativeKeyOf(path: string): string | null {
        const { path: pathModule } = this.platform;
        for (const base of [this.root, this.realRoot]) {
            if (base === null) continue;
            const relative = pathModule.relative(base, path);
            if (relative === '' || relative.startsWith('..') || pathModule.isAbsolute(relative)) continue;
            return indexKey(splitRelative(relative, this.platform).join(SEPARATOR), this.platform);
        }
        return null;
    }

    private absolute(relPath: string): string {
        const root = this.root ?? '';
        return relPath === ROOT ? root : this.platform.path.join(root, ...relPath.split(SEPARATOR));
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => this.scheduler.setTimeout(resolve, ms));
    }

    private retry<T>(operation: () => Promise<T>): Promise<T> {
        return withTransientRetry(operation, (ms) => this.sleep(ms), this.retryDelays);
    }

    // ---------- Auswertung eines Stapels ----------

    private async processNames(names: readonly string[], generation: number): Promise<void> {
        const state = createBatchState();
        for (const name of names) {
            if (generation !== this.generation) return;
            const segments = splitRelative(name, this.platform);
            const category = categorizePath(segments);
            if (category === 'git') state.gitChanged = true;
            if (category !== 'source') continue;
            if (segments.length === 0) await this.diffSubtree(ROOT, state, await this.entryStats(ROOT));
            else await this.classifyCandidate(segments, state);
        }
        await this.finishBatch(state, generation);
    }

    private async classifyCandidate(segments: readonly string[], state: BatchState): Promise<void> {
        const found = await this.probe(segments, state);
        const fallbackPath = segments.join(SEPARATOR);
        const key = indexKey(found?.relPath ?? fallbackPath, this.platform);
        if (state.visited.has(key)) return;
        const known = this.index.get(key);
        const relPath = found?.relPath ?? known?.relPath ?? fallbackPath;
        // Ordner (neu, gelöscht, umbenannt): nur sein Name wird gemeldet, also den Teilbaum vergleichen.
        if (found?.stats.isDirectory === true || known?.isDirectory === true) {
            await this.diffSubtree(relPath, state, found?.stats ?? null);
            return;
        }
        state.visited.add(key);
        this.classifyFile(key, relPath, found?.stats ?? null, known, state);
    }

    private classifyFile(key: string, relPath: string, stats: EntryStats | null, known: IndexEntry | undefined, state: BatchState): void {
        if (stats === null) {
            // Unbekannt und weg: Temp-Datei (atomares Speichern), verwerfen.
            if (known === undefined) return;
            this.index.delete(key);
            this.record(state, known.relPath, 'deleted', false);
            return;
        }
        this.index.set(key, { relPath, ...stats });
        this.record(state, relPath, known === undefined ? 'created' : 'changed', false);
    }

    // Existenz per `readdir(Elternordner)` mit exaktem Namen: `lstat` fände nach `Datei` → `datei` auch den alten Namen.
    private async probe(segments: readonly string[], state: BatchState): Promise<{ relPath: string; stats: EntryStats } | null> {
        const name = segments[segments.length - 1] ?? ROOT;
        const parent = segments.slice(0, -1).join(SEPARATOR);
        const diskName = (await this.listing(parent, state))?.get(this.compareName(name));
        if (diskName === undefined) return null;
        const relPath = joinRelative(parent, diskName);
        const stats = await this.entryStats(relPath);
        return stats === null ? null : { relPath, stats };
    }

    private compareName(name: string): string {
        return this.platform.unicodeInsensitive ? name.normalize('NFC') : name;
    }

    private async listing(parent: string, state: BatchState): Promise<Map<string, string> | null> {
        const cached = state.listings.get(parent);
        if (cached !== undefined) return cached;
        let names: Map<string, string> | null = null;
        try {
            const entries = await this.retry(() => fsp.readdir(this.absolute(parent)));
            names = new Map(entries.map((entry) => [this.compareName(entry), entry]));
        } catch {
            names = null;
        }
        state.listings.set(parent, names);
        return names;
    }

    private async entryStats(relPath: string): Promise<EntryStats | null> {
        try {
            const info = await this.retry(() => fsp.lstat(this.absolute(relPath)));
            if (info.isDirectory()) return DIRECTORY_STATS;
            if (!info.isFile()) return null;
            return { isDirectory: false, mtimeMs: info.mtimeMs, size: info.size };
        } catch (error) {
            // Fehlt (ENOENT/ENOTDIR) oder unlesbar: gilt als nicht vorhanden; nur Sperren nach allen Versuchen zählen als da.
            return TRANSIENT_ERROR_CODES.has(errorCode(error) ?? '') ? LOCKED_FILE_STATS : null;
        }
    }

    // ---------- Teilbaum ----------

    // `stats` ist das Ergebnis der Existenzprüfung des Teilbaum-Anfangs (`null` = fehlt).
    private async diffSubtree(relPath: string, state: BatchState, stats: EntryStats | null): Promise<void> {
        const disk = await this.scanSubtree(relPath, stats);
        const prefix = indexKey(relPath, this.platform);
        for (const [key, entry] of this.index) {
            if (!isWithinKey(key, prefix) || disk.has(key)) continue;
            this.index.delete(key);
            state.visited.add(key);
            this.record(state, entry.relPath, 'deleted', entry.isDirectory);
        }
        for (const [key, entry] of disk) this.mergeEntry(key, entry, state);
    }

    private mergeEntry(key: string, entry: IndexEntry, state: BatchState): void {
        const known = this.index.get(key);
        this.index.set(key, entry);
        state.visited.add(key);
        if (known === undefined || known.isDirectory !== entry.isDirectory) {
            this.record(state, entry.relPath, 'created', entry.isDirectory);
            return;
        }
        if (!entry.isDirectory && hasChanged(known, entry)) this.record(state, entry.relPath, 'changed', false);
    }

    private async scanSubtree(relPath: string, stats: EntryStats | null): Promise<Map<string, IndexEntry>> {
        const result = new Map<string, IndexEntry>();
        if (stats === null) return result;
        if (relPath !== ROOT) result.set(indexKey(relPath, this.platform), { relPath, ...stats });
        if (!stats.isDirectory) return result;
        const depth = splitRelative(relPath, this.platform).length;
        await this.walk(relPath, depth, result, { remaining: MAX_TREE_ENTRIES });
        return result;
    }

    // Wie der Dateibaum (project.ts): keine Symlinks, keine versteckten Einträge, gleiche Tiefen- und Mengengrenze.
    private async walk(relDir: string, depth: number, out: Map<string, IndexEntry>, budget: { remaining: number }): Promise<void> {
        if (depth >= MAX_TREE_DEPTH) return;
        const entries = await this.readDirectory(relDir);
        for (const entry of entries) {
            if (budget.remaining <= 0) return;
            const isDirectory = entry.isDirectory();
            if ((!isDirectory && !entry.isFile()) || isNoiseEntry(entry.name, isDirectory)) continue;
            const childPath = joinRelative(relDir, entry.name);
            const stats = isDirectory ? DIRECTORY_STATS : await this.entryStats(childPath);
            if (stats === null) continue;
            budget.remaining--;
            out.set(indexKey(childPath, this.platform), { relPath: childPath, ...stats });
            if (isDirectory) await this.walk(childPath, depth + 1, out, budget);
        }
    }

    private async readDirectory(relDir: string): Promise<Dirent[]> {
        try {
            return await this.retry(() => fsp.readdir(this.absolute(relDir), { withFileTypes: true }));
        } catch {
            return [];
        }
    }

    // ---------- Ergebnis ----------

    private record(state: BatchState, relPath: string, kind: FsChangeKind, isDirectory: boolean): void {
        if (kind !== 'changed') state.treeChanged = true;
        const key = indexKey(relPath, this.platform);
        if (isDirectory || this.buildOutputKeys.has(key)) return;
        state.changes.set(key, { relPath, kind });
    }

    private async dropOwnEchoes(state: BatchState): Promise<void> {
        const now = this.scheduler.now();
        for (const [key, change] of state.changes) {
            const pending = this.ownWrites.get(key);
            if (pending === undefined) continue;
            if (pending.expiresAt < now || change.kind === 'deleted') {
                this.ownWrites.delete(key);
                continue;
            }
            if ((await this.hashOf(change.relPath)) === pending.hash) state.changes.delete(key);
            else this.ownWrites.delete(key);
        }
    }

    private async hashOf(relPath: string): Promise<ContentHash | null> {
        try {
            return hashBytes(await this.retry(() => fsp.readFile(this.absolute(relPath))));
        } catch {
            return null;
        }
    }

    private async finishBatch(state: BatchState, generation: number): Promise<void> {
        await this.dropOwnEchoes(state);
        const onBatch = this.onBatch;
        if (generation !== this.generation || onBatch === null) return;
        const changes = [...state.changes.values()];
        if (changes.length === 0 && !state.treeChanged && !state.gitChanged) return;
        onBatch({
            paths: changes.map((change) => this.absolute(change.relPath)),
            kinds: changes.map((change) => change.kind),
            treeChanged: state.treeChanged,
            gitChanged: state.gitChanged,
        });
    }
}
