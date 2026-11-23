// Gemeinsame Bausteine der Messungen zu S10 (Wegwerfcode): Überwacher mit Rohprotokoll,
// Entpreller (300 ms), Filter für Build-Hilfsdateien, Klassifizierung per fs.stat.
import { mkdtemp, readdir, realpath, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import type { FSWatcher, WatchEventType } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const DEBOUNCE_MS = 300;
/** FSEvents startet asynchron; ohne Wartezeit gehen die ersten Schreibvorgänge verloren. */
export const WATCHER_WARMUP_MS = 400;

export interface RawEvent {
    atMs: number;
    type: WatchEventType;
    name: string;
}

export type ChangeKind = 'created' | 'changed' | 'deleted' | 'ignored';

export interface ClassifiedChange {
    path: string;
    kind: ChangeKind;
}

export interface Batch {
    atMs: number;
    names: string[];
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function makeTestDirectory(label: string): Promise<string> {
    const base = await realpath(tmpdir());
    return mkdtemp(join(base, `s10-${label}-`));
}

export interface Watcher {
    events: RawEvent[];
    close(): void;
}

/** Rohüberwacher: protokolliert jedes Ereignis mit Zeit seit Start. */
export async function startWatcher(directory: string, onEvent?: (event: RawEvent) => void): Promise<Watcher> {
    const startedAt = performance.now();
    const events: RawEvent[] = [];
    const handle: FSWatcher = watch(directory, { recursive: true }, (type, name) => {
        const event: RawEvent = { atMs: performance.now() - startedAt, type, name: name ?? '' };
        events.push(event);
        onEvent?.(event);
    });
    handle.on('error', (error) => console.error('Überwacher-Fehler:', error));
    await sleep(WATCHER_WARMUP_MS);
    events.length = 0;
    return { events, close: () => handle.close() };
}

/**
 * Entpreller: sammelt Namen; ruft `flush` erst, wenn `quietMs` lang nichts kam.
 * `maxWaitMs` begrenzt die Verzögerung bei Dauerfeuer (0 = aus).
 */
export function createDebouncer(flush: (batch: Batch) => void, quietMs = DEBOUNCE_MS, maxWaitMs = 0) {
    let timer: NodeJS.Timeout | undefined;
    let firstAt = 0;
    let names = new Set<string>();
    const fire = (): void => {
        clearTimeout(timer);
        timer = undefined;
        const batch: Batch = { atMs: performance.now(), names: [...names] };
        names = new Set();
        flush(batch);
    };
    return {
        push(name: string): void {
            if (names.size === 0) {
                firstAt = performance.now();
            }
            names.add(name);
            clearTimeout(timer);
            const waited = performance.now() - firstAt;
            const delay = maxWaitMs > 0 ? Math.min(quietMs, Math.max(0, maxWaitMs - waited)) : quietMs;
            timer = setTimeout(fire, delay);
        },
        stop(): void {
            clearTimeout(timer);
        },
    };
}

/** Vorschlag Filterliste: Hilfsdateien von latexmk/pdflatex/biber/Editoren. */
export const BUILD_AUX_EXTENSIONS: readonly string[] = [
    'aux', 'log', 'toc', 'lof', 'lot', 'out', 'fls', 'fdb_latexmk', 'synctex.gz', 'synctex', 'synctex(busy)',
    'bbl', 'blg', 'bcf', 'run.xml', 'idx', 'ilg', 'ind', 'nav', 'snm', 'vrb', 'xdv', 'dvi', 'lol', 'loa',
    'glo', 'gls', 'glg', 'acn', 'acr', 'alg', 'ist', 'brf', 'auxlock', 'pyg', 'tmp', 'swp', 'swx', 'bak',
];
const IGNORED_FILE_NAMES: ReadonlySet<string> = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '4913']);
const IGNORED_DIRECTORY_PREFIXES: readonly string[] = ['_minted', 'node_modules/', '.git/objects/', '.git/logs/'];

export function isBuildNoise(relativePath: string): boolean {
    const normalized = relativePath.normalize('NFC').split('\\').join('/');
    const fileName = normalized.slice(normalized.lastIndexOf('/') + 1);
    const lower = fileName.toLowerCase();
    if (IGNORED_FILE_NAMES.has(fileName) || fileName.endsWith('~') || fileName.startsWith('.#')) {
        return true;
    }
    if (normalized.includes('.git/') && /\.lock$/.test(lower)) {
        return true;
    }
    if (IGNORED_DIRECTORY_PREFIXES.some((prefix) => normalized.startsWith(prefix) || normalized.includes(`/${prefix}`))) {
        return true;
    }
    return BUILD_AUX_EXTENSIONS.some((extension) => lower.endsWith(`.${extension}`));
}

/** Bestimmt neu/geändert/gelöscht per fs.stat gegen den bekannten Zustand (`known`, NFC-Pfade). */
export async function classifyBatch(directory: string, batch: Batch, known: Set<string>): Promise<ClassifiedChange[]> {
    const result: ClassifiedChange[] = [];
    for (const name of batch.names) {
        const path = name.normalize('NFC');
        const exists = await stat(join(directory, name)).then(() => true, () => false);
        const wasKnown = known.has(path);
        if (exists) {
            known.add(path);
            result.push({ path, kind: wasKnown ? 'changed' : 'created' });
            continue;
        }
        known.delete(path);
        result.push({ path, kind: wasKnown ? 'deleted' : 'ignored' });
    }
    return result;
}

export async function listTree(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { recursive: true });
    return entries.map((entry) => entry.normalize('NFC'));
}

export interface Session {
    watcher: Watcher;
    known: Set<string>;
    /** Entprellte Stapel ohne Filter. */
    allBatches: Batch[];
    /** Entprellte Stapel nach Filter und Klassifizierung (ignorierte Pfade entfernt, leere Stapel entfallen). */
    filteredBatches: { atMs: number; changes: ClassifiedChange[] }[];
    finish(): Promise<void>;
}

/** Überwacher + zwei Entpreller (ohne/mit Filter) auf einem Testordner. */
export async function openSession(directory: string, maxWaitMs = 0): Promise<Session> {
    const known = new Set(await listTree(directory));
    const allBatches: Batch[] = [];
    const filteredBatches: Session['filteredBatches'] = [];
    const pending: Promise<void>[] = [];
    const all = createDebouncer((batch) => allBatches.push(batch), DEBOUNCE_MS, maxWaitMs);
    const filtered = createDebouncer((batch) => {
        pending.push(
            classifyBatch(directory, batch, known).then((changes) => {
                const relevant = changes.filter((change) => change.kind !== 'ignored');
                if (relevant.length > 0) {
                    filteredBatches.push({ atMs: batch.atMs, changes: relevant });
                }
            }),
        );
    }, DEBOUNCE_MS, maxWaitMs);
    const watcher = await startWatcher(directory, (event) => {
        all.push(event.name);
        if (!isBuildNoise(event.name)) {
            filtered.push(event.name);
        }
    });
    const finish = async (): Promise<void> => {
        await sleep(DEBOUNCE_MS + 250);
        all.stop();
        filtered.stop();
        await Promise.all(pending);
        watcher.close();
    };
    return { watcher, known, allBatches, filteredBatches, finish };
}

export function summarize(values: readonly number[]): string {
    if (values.length === 0) {
        return 'keine Werte';
    }
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    return `min ${sorted[0]?.toFixed(1)} / median ${median.toFixed(1)} / max ${sorted[sorted.length - 1]?.toFixed(1)}`;
}

export function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const item of items) {
        const bucket = groups.get(key(item)) ?? [];
        bucket.push(item);
        groups.set(key(item), bucket);
    }
    return groups;
}
