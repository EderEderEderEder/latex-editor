import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentHash } from '../../src/shared/contract';
import { GrantStore } from '../../src/main/grants';
import { createProjectWatch } from '../../src/main/handlers/watchHandlers';
import { QuitTasks } from '../../src/main/lifecycle';
import { currentPathPlatform, MACOS_PATHS, WINDOWS_PATHS } from '../../src/main/paths';
import { writeTextFile } from '../../src/main/textIo';
import {
    categorizePath,
    DEBOUNCE_MAX_WAIT_MS,
    DEBOUNCE_QUIET_MS,
    Debouncer,
    type FileWatcher,
    type FsChangedBatch,
    ProjectWatcher,
    type RawWatchFactory,
    type Scheduler,
    splitRelative,
    TRANSIENT_RETRY_DELAYS_MS,
    withTransientRetry,
} from '../../src/main/watch';

// Logik der Dateiüberwachung mit gefälschtem `fs.watch` (Fabrik) und gefälschtem Zeitgeber; die Dateien selbst
// liegen echt in einem Temp-Ordner (lstat/readdir funktionieren in der Sandbox, nur `fs.watch` nicht).

const PLATFORM = currentPathPlatform();
const STORM_FILE_COUNT = 300;
const STORM_GAP_MS = 3;
const BURST_GAP_MS = 200;
const BURST_DURATION_MS = 2_000;
const AUX_EXTENSIONS = ['aux', 'log', 'toc', 'synctex.gz', 'fls', 'out', 'fdb_latexmk', 'bbl', 'blg', 'synctex(busy)'];

class ManualScheduler implements Scheduler {
    time = 0;
    private nextId = 1;
    private readonly timers = new Map<number, { at: number; callback: () => void }>();

    now(): number {
        return this.time;
    }

    setTimeout(callback: () => void, ms: number): unknown {
        const id = this.nextId++;
        this.timers.set(id, { at: this.time + ms, callback });
        return id;
    }

    clearTimeout(handle: unknown): void {
        this.timers.delete(handle as number);
    }

    advance(ms: number): void {
        const target = this.time + ms;
        for (;;) {
            const due = [...this.timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
            if (due === undefined) break;
            this.timers.delete(due[0]);
            this.time = due[1].at;
            due[1].callback();
        }
        this.time = target;
    }
}

class FakeRawWatcher {
    onName: ((name: string | null) => void) | null = null;
    onError: ((error: Error) => void) | null = null;
    closed = 0;
    throwOnStart: Error | null = null;

    readonly factory: RawWatchFactory = (_root, onName, onError) => {
        if (this.throwOnStart !== null) throw this.throwOnStart;
        this.onName = onName;
        this.onError = onError;
        return { close: () => this.closed++ };
    };

    emit(...names: string[]): void {
        for (const name of names) this.onName?.(name);
    }
}

function codedError(code: string): Error {
    return Object.assign(new Error(code), { code });
}

let dir: string;
let scheduler: ManualScheduler;
let raw: FakeRawWatcher;
let watcher: ProjectWatcher;
let batches: FsChangedBatch[];
let errors: Error[];

beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'watch-unit-')));
    scheduler = new ManualScheduler();
    raw = new FakeRawWatcher();
    batches = [];
    errors = [];
    watcher = new ProjectWatcher({ watchFactory: raw.factory, scheduler, platform: PLATFORM, onError: (error) => errors.push(error) });
});

afterEach(async () => {
    watcher.stop();
    await rm(dir, { recursive: true, force: true });
});

async function files(entries: Record<string, string>): Promise<void> {
    for (const [name, content] of Object.entries(entries)) {
        await mkdir(join(dir, name, '..'), { recursive: true });
        await writeFile(join(dir, name), content);
    }
}

async function start(): Promise<void> {
    await watcher.start(dir, (batch) => batches.push(batch));
}

async function settle(ms = DEBOUNCE_QUIET_MS): Promise<void> {
    scheduler.advance(ms);
    await watcher.whenIdle();
}

function summary(batch: FsChangedBatch | undefined): string[] {
    if (batch === undefined) return [];
    return batch.paths.map((path, index) => `${batch.kinds[index]}:${path.slice(dir.length + 1).split('\\').join('/')}`);
}

describe('Klassifizierung (Ereignisart egal, Index entscheidet)', () => {
    it('neu, geändert, gelöscht; verschwundene unbekannte Datei (Temp) fällt weg', async () => {
        await files({ 'main.tex': 'a', 'alt.tex': 'b' });
        await start();
        await files({ 'main.tex': 'a2', 'neu.tex': 'c' });
        await rm(join(dir, 'alt.tex'));
        raw.emit('main.tex', 'neu.tex', 'alt.tex', 'weg.tex');
        await settle();
        expect(batches).toHaveLength(1);
        expect(summary(batches[0])).toEqual(['changed:main.tex', 'created:neu.tex', 'deleted:alt.tex']);
        expect(batches[0]?.treeChanged).toBe(true);
        expect(batches[0]?.gitChanged).toBe(false);
    });

    it('atomares Speichern (Temp + rename, mehrere Rohereignisse) ergibt einen Stapel ohne treeChanged', async () => {
        await files({ 'main.tex': 'alt' });
        await start();
        await writeTextFile(join(dir, 'main.tex'), 'neu', 'utf8', 'lf');
        await writeFile(join(dir, 'main.tex.tmp'), 'x');
        raw.emit('.main.tex.abc123.tmp', 'main.tex.tmp', 'main.tex', 'main.tex');
        await settle();
        expect(batches).toHaveLength(1);
        expect(summary(batches[0])).toEqual(['changed:main.tex']);
        expect(batches[0]?.treeChanged).toBe(false);
    });

    it('Groß-/Kleinschreibung umbenennen: alter Name gelöscht, neuer Name neu (Existenz per readdir)', async () => {
        await files({ 'Datei.tex': 'x' });
        await start();
        await rename(join(dir, 'Datei.tex'), join(dir, 'datei.tex'));
        raw.emit('Datei.tex', 'datei.tex');
        await settle();
        expect(summary(batches[0])).toEqual(['deleted:Datei.tex', 'created:datei.tex']);
    });

    it.skipIf(!PLATFORM.unicodeInsensitive)('NFC/NFD: Ereignis in anderer Normalform trifft denselben Index-Eintrag', async () => {
        const nfd = 'Übung.tex'.normalize('NFD');
        await files({ [nfd]: 'x' });
        await start();
        await writeFile(join(dir, nfd), 'y');
        raw.emit('Übung.tex'.normalize('NFC'));
        await settle();
        expect(batches[0]?.kinds).toEqual(['changed']);
        expect(batches[0]?.paths[0]?.normalize('NFC')).toBe(join(dir, 'Übung.tex').normalize('NFC'));
        expect(batches[0]?.treeChanged).toBe(false);
    });
});

describe('Ordner: Teilbaum neu einlesen', () => {
    it('umbenannter Ordner meldet nur alten und neuen Namen, die Kinder kommen aus dem Teilbaum', async () => {
        await files({ 'kap/a.tex': 'a', 'kap/b.tex': 'b' });
        await start();
        await rename(join(dir, 'kap'), join(dir, 'kapitel'));
        raw.emit('kap', 'kapitel');
        await settle();
        expect(summary(batches[0]).sort()).toEqual(['created:kapitel/a.tex', 'created:kapitel/b.tex', 'deleted:kap/a.tex', 'deleted:kap/b.tex']);
        expect(batches[0]?.treeChanged).toBe(true);
    });

    it('neuer Ordner nur mit Ordnerereignis und gelöschter Ordner', async () => {
        await files({ 'alt/x.tex': 'x' });
        await start();
        await files({ 'neu/tief/y.tex': 'y' });
        await rm(join(dir, 'alt'), { recursive: true });
        raw.emit('neu', 'alt');
        await settle();
        expect(summary(batches[0])).toEqual(['created:neu/tief/y.tex', 'deleted:alt/x.tex']);
        expect(batches[0]?.treeChanged).toBe(true);
    });

    it('leerer neuer Ordner: nur treeChanged, keine Pfade', async () => {
        await start();
        await mkdir(join(dir, 'leer'));
        raw.emit('leer');
        await settle();
        expect(batches).toEqual([{ paths: [], kinds: [], treeChanged: true, gitChanged: false }]);
    });
});

describe('Filter und Build', () => {
    it('Build-Sturm (300 Hilfsdateien, Build-PDF) ergibt einen Stapel nur mit der Quelländerung', async () => {
        await files({ 'kapitel.tex': 'q', 'main.pdf': 'pdf0' });
        await start();
        watcher.setBuildOutputs([join(dir, 'main.pdf')]);
        for (let i = 0; i < STORM_FILE_COUNT; i++) {
            const name = `kap${i}.${AUX_EXTENSIONS[i % AUX_EXTENSIONS.length] ?? 'aux'}`;
            await writeFile(join(dir, name), 'hilf');
            raw.emit(name);
            scheduler.advance(STORM_GAP_MS);
        }
        await files({ 'main.pdf': 'pdf1-länger', 'kapitel.tex': 'q2' });
        raw.emit('main.pdf', 'kapitel.tex', '_minted-main/x.pygtex', 'node_modules/p/a.js', 'Thumbs.db', 'x.tex~');
        await settle();
        expect(batches).toHaveLength(1);
        expect(summary(batches[0])).toEqual(['changed:kapitel.tex']);
        expect(batches[0]?.treeChanged).toBe(false);
    });

    it('nur Hilfsdateien: kein Stapel, kein Zeitgeber', async () => {
        await start();
        raw.emit('main.aux', 'main.log', 'main.synctex.gz', 'main.fdb_latexmk', '.DS_Store');
        await settle(DEBOUNCE_MAX_WAIT_MS);
        expect(batches).toEqual([]);
    });

    it('.git: nur HEAD/index/refs setzen gitChanged, ohne Dateiereignis; Objekte und Sperren nicht', async () => {
        await start();
        raw.emit('.git/objects/ab/cdef', '.git/index.lock', '.git/logs/HEAD');
        await settle();
        expect(batches).toEqual([]);
        raw.emit('.git/index', '.git/refs/heads/main');
        await settle();
        expect(batches).toEqual([{ paths: [], kinds: [], treeChanged: false, gitChanged: true }]);
    });
});

describe('Eigenes Speichern', () => {
    it('unterdrückt das Echo (auch ein nachgeliefertes), meldet aber fremde Änderungen danach', async () => {
        await files({ 'main.tex': 'alt' });
        await start();
        const result = await writeTextFile(join(dir, 'main.tex'), 'eigener Stand', 'utf8', 'lf');
        watcher.ignoreOwnWrite(join(dir, 'main.tex'), result.hash);
        raw.emit('main.tex');
        await settle();
        raw.emit('main.tex');
        await settle();
        expect(batches).toEqual([]);
        await writeFile(join(dir, 'main.tex'), 'fremd');
        raw.emit('main.tex');
        await settle();
        expect(summary(batches[0])).toEqual(['changed:main.tex']);
    });

    it('Pfade außerhalb des Projekts werden ignoriert', async () => {
        await files({ 'main.tex': 'x' });
        await start();
        watcher.ignoreOwnWrite(join(tmpdir(), 'fremd.tex'), 'egal' as ContentHash);
        await writeFile(join(dir, 'main.tex'), 'y');
        raw.emit('main.tex');
        await settle();
        expect(summary(batches[0])).toEqual(['changed:main.tex']);
    });
});

describe('Entpreller', () => {
    it('300 ms Ruhe; jedes neue Ereignis startet die Frist neu', () => {
        const flushed: string[][] = [];
        const debouncer = new Debouncer((items) => flushed.push(items), scheduler);
        debouncer.push('a');
        scheduler.advance(DEBOUNCE_QUIET_MS - 1);
        debouncer.push('b');
        scheduler.advance(DEBOUNCE_QUIET_MS - 1);
        expect(flushed).toEqual([]);
        scheduler.advance(1);
        expect(flushed).toEqual([['a', 'b']]);
    });

    it('Höchstwartezeit 1,5 s bei Dauerfeuer', () => {
        const flushedAt: number[] = [];
        const debouncer = new Debouncer(() => flushedAt.push(scheduler.now()), scheduler);
        for (let t = 0; t < BURST_DURATION_MS; t += BURST_GAP_MS) {
            debouncer.push('a');
            scheduler.advance(BURST_GAP_MS);
        }
        scheduler.advance(DEBOUNCE_QUIET_MS);
        expect(flushedAt[0]).toBe(DEBOUNCE_MAX_WAIT_MS);
        expect(flushedAt).toHaveLength(2);
    });

    it('Zeiten sind einspeisbar', () => {
        const flushed: string[][] = [];
        const debouncer = new Debouncer((items) => flushed.push(items), scheduler, 50, 80);
        debouncer.push('a');
        scheduler.advance(40);
        debouncer.push('b');
        scheduler.advance(40);
        expect(flushed).toEqual([['a', 'b']]);
    });
});

describe('Fehler und Sicherheitsnetz', () => {
    it('Überwacher-Fehler (EMFILE) → onError, Überwacher zu, rescan findet die verpasste Änderung', async () => {
        await files({ 'main.tex': 'a' });
        await start();
        await files({ 'neu.tex': 'n' });
        raw.onError?.(codedError('EMFILE'));
        await watcher.whenIdle();
        expect(errors.map((error) => (error as Error & { code?: string }).code)).toEqual(['EMFILE']);
        expect(raw.closed).toBe(1);
        expect(summary(batches[0])).toEqual(['created:neu.tex']);
    });

    it('Überwacher startet nicht (ENOSPC): Betrieb ohne Überwachung, rescan() bleibt nutzbar', async () => {
        raw.throwOnStart = codedError('ENOSPC');
        await files({ 'main.tex': 'a' });
        await start();
        expect(errors).toHaveLength(1);
        expect(batches).toEqual([]);
        await files({ 'main.tex': 'länger als vorher' });
        await watcher.rescan();
        expect(summary(batches[0])).toEqual(['changed:main.tex']);
        await watcher.rescan();
        expect(batches).toHaveLength(1);
    });

    it('rescan filtert Hilfsdateien und Build-PDF und meldet Löschungen', async () => {
        await files({ 'main.tex': 'a', 'weg.tex': 'w' });
        await start();
        watcher.setBuildOutputs([join(dir, 'main.pdf')]);
        await files({ 'main.aux': 'x', 'main.pdf': 'pdf' });
        await rm(join(dir, 'weg.tex'));
        await watcher.rescan();
        expect(summary(batches[0])).toEqual(['deleted:weg.tex']);
        expect(batches[0]?.treeChanged).toBe(true);
    });

    it('nach stop() kommt nichts mehr', async () => {
        await files({ 'main.tex': 'a' });
        await start();
        await files({ 'main.tex': 'b' });
        raw.emit('main.tex');
        watcher.stop();
        await settle();
        await watcher.rescan();
        expect(batches).toEqual([]);
        expect(raw.closed).toBe(1);
    });
});

describe('Hilfen', () => {
    it('withTransientRetry wiederholt bei EBUSY/EPERM/EACCES mit Rückoff, sonst sofort', async () => {
        const sleeps: number[] = [];
        const sleep = (ms: number): Promise<void> => {
            sleeps.push(ms);
            return Promise.resolve();
        };
        let calls = 0;
        const flaky = (): Promise<string> => (++calls < 3 ? Promise.reject(codedError('EBUSY')) : Promise.resolve('ok'));
        expect(await withTransientRetry(flaky, sleep)).toBe('ok');
        expect(sleeps).toEqual(TRANSIENT_RETRY_DELAYS_MS.slice(0, 2));
        await expect(withTransientRetry(() => Promise.reject(codedError('ENOENT')), sleep)).rejects.toThrow('ENOENT');
        sleeps.length = 0;
        await expect(withTransientRetry(() => Promise.reject(codedError('EPERM')), sleep)).rejects.toThrow('EPERM');
        expect(sleeps).toEqual([...TRANSIENT_RETRY_DELAYS_MS]);
    });

    it('categorizePath und splitRelative', () => {
        expect(categorizePath(['kap', 'a.tex'])).toBe('source');
        expect(categorizePath(['abb', 'bild.pdf'])).toBe('source');
        expect(categorizePath(['main.synctex.gz'])).toBe('noise');
        expect(categorizePath(['.git', 'HEAD'])).toBe('git');
        expect(categorizePath(['.git', 'refs', 'heads', 'main.lock'])).toBe('noise');
        expect(categorizePath(['.hidden', 'a.tex'])).toBe('noise');
        expect(splitRelative('kap\\a.tex', WINDOWS_PATHS)).toEqual(['kap', 'a.tex']);
        expect(splitRelative('kap\\a.tex', MACOS_PATHS)).toEqual(['kap\\a.tex']);
    });
});

describe('GrantStore.onProjectChanged', () => {
    it('meldet Öffnen, Wechsel und Schließen, nicht dasselbe Projekt erneut; Abmelden wirkt', async () => {
        const grants = new GrantStore({ platform: PLATFORM });
        const seen: (string | null)[] = [];
        const unsubscribe = grants.onProjectChanged((root) => seen.push(root));
        const first = grants.grant(join(dir, 'A'), 'project').grantId;
        const second = grants.grant(join(dir, 'B'), 'project').grantId;
        grants.openProject(first);
        grants.openProject(first);
        grants.openProject(second);
        grants.closeProject();
        unsubscribe();
        grants.openProject(first);
        expect(seen).toEqual([join(dir, 'A'), join(dir, 'B'), null]);
    });
});

describe('createProjectWatch (Verdrahtung)', () => {
    class FakeFileWatcher implements FileWatcher {
        roots: string[] = [];
        stopped = 0;
        onBatch: ((batch: FsChangedBatch) => void) | null = null;
        start(root: string, onBatch: (batch: FsChangedBatch) => void): Promise<void> {
            this.roots.push(root);
            this.onBatch = onBatch;
            return Promise.resolve();
        }
        stop(): void {
            this.stopped++;
        }
        rescan = vi.fn(() => Promise.resolve());
        ignoreOwnWrite = vi.fn();
        setBuildOutputs = vi.fn();
    }

    it('startet je Projekt, sendet fs:changed, beendet beim Wechsel und beim Beenden', async () => {
        const grants = new GrantStore({ platform: PLATFORM });
        const quitTasks = new QuitTasks();
        const created: FakeFileWatcher[] = [];
        const emit = vi.fn();
        const watch = createProjectWatch({
            grants, emit, quitTasks, log: () => undefined,
            createWatcher: () => {
                const fake = new FakeFileWatcher();
                created.push(fake);
                return fake;
            },
        });
        grants.openProject(grants.grant(join(dir, 'A'), 'project').grantId);
        const batch: FsChangedBatch = { paths: [join(dir, 'A', 'a.tex')], kinds: ['changed'], treeChanged: false, gitChanged: false };
        created[0]?.onBatch?.(batch);
        expect(emit).toHaveBeenCalledWith('fs:changed', batch);
        await watch?.rescan();
        expect(created[0]?.rescan).toHaveBeenCalledTimes(1);
        grants.openProject(grants.grant(join(dir, 'B'), 'project').grantId);
        expect(created[0]?.stopped).toBe(1);
        expect(created[1]?.roots).toEqual([join(dir, 'B')]);
        await quitTasks.runAll(() => undefined);
        expect(created[1]?.stopped).toBe(1);
    });

    it('ohne emit keine Überwachung', () => {
        const grants = new GrantStore({ platform: PLATFORM });
        expect(createProjectWatch({ grants, emit: undefined, quitTasks: new QuitTasks(), log: () => undefined })).toBeNull();
    });
});
