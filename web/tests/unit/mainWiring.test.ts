import { EventEmitter } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { build as viteBuild } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BuildDependencies, defaultBuildDependencies, type SpawnFunction } from '../../src/main/build';
import { GrantStore } from '../../src/main/grants';
import { type AppHandlerOptions, createAppHandlers, createBuildLogParser } from '../../src/main/handlers/appHandlers';
import { createBuildHandlers, type BuildWatchHooks } from '../../src/main/handlers/buildHandlers';
import type { DialogLike } from '../../src/main/handlers/dialogHandlers';
import type { EventSender } from '../../src/main/ipc';
import { QuitTasks } from '../../src/main/lifecycle';
import type { ParseWorkerLike } from '../../src/main/logParser';
import { currentPathPlatform } from '../../src/main/paths';
import { SETTINGS_FILE_NAME } from '../../src/main/settings';
import { type FileWatcher, ProjectWatcher, type RawWatchFactory } from '../../src/main/watch';
import type { ParseWorkerRequest } from '../../src/main/workers/parse.worker';
import type { IpcEvents, ToolsInfo } from '../../src/shared/contract';

// Verdrahtung im Main ohne Electron (W2-INT): Papierkorb, Echo-Unterdrückung, Abgleich nach dem Build,
// Log-Parser im Build-Bericht, Aufräumen beim Beenden.

const QUIET_MS = 10;
const MAX_WAIT_MS = 40;
const SETTLE_MS = 80;
const FAKE_PID = 4711;
const PDFLATEX = { engine: 'pdflatex' } as const;
const FAKE_TOOLS: ToolsInfo = { latexmk: '/tex/bin/latexmk', git: null, synctexRef: null, distro: 'texlive', problems: [] };
const REAL_TEX_TIMEOUT_MS = 240_000;
const DEMO_PROJECT = fileURLToPath(new URL('../../../shared/Testdaten/HgbDemo', import.meta.url));
const PARSE_WORKER_SOURCE = fileURLToPath(new URL('../../src/main/workers/parse.worker.ts', import.meta.url));
const PARSE_WORKER_FILE_NAME = 'parse.worker.cjs';

type RecordedEvent = { event: string; payload: unknown };

let base: string;
let project: string;
let userData: string;

beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'main-wiring-')));
    project = join(base, 'Projekt');
    userData = join(base, 'userData');
    await writeFile(join(base, '.keep'), '');
    await mkdir(project);
    await mkdir(userData);
    await writeFile(join(project, 'main.tex'), 'alt\n');
});

afterEach(async () => {
    await rm(base, { recursive: true, force: true });
});

function recorder(): { emit: EventSender; events: RecordedEvent[] } {
    const events: RecordedEvent[] = [];
    return { events, emit: (event, payload) => void events.push({ event, payload }) };
}

function baseOptions(overrides: Partial<AppHandlerOptions<object>> = {}): AppHandlerOptions<object> {
    const dialog: DialogLike<object> = {
        showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
        showSaveDialog: () => Promise.resolve({ canceled: true }),
    };
    return {
        userDataDir: userData, dialog, window: () => ({}), platform: currentPathPlatform(),
        quitTasks: new QuitTasks(), log: vi.fn(), confirmClose: vi.fn(), ...overrides,
    };
}

function openProject(grants: GrantStore, root = project): void {
    grants.openProject(grants.grant(root, 'project').grantId);
}

// Rohüberwacher ohne `fs.watch` (in der Sandbox `EMFILE`): der Test meldet Namen selbst.
function fakeRawWatch(): { factory: RawWatchFactory; fire: (name: string) => void } {
    let onName: ((name: string | null) => void) | null = null;
    const factory: RawWatchFactory = (_root, listener) => {
        onName = listener;
        return { close: () => undefined };
    };
    return { factory, fire: (name) => onName?.(name) };
}

function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
}

describe('Papierkorb', () => {
    it('fs:trash erreicht den hereingereichten trashItem mit dem Projektpfad', async () => {
        const trashItem = vi.fn((path: string) => rm(path, { force: true }));
        const app = createAppHandlers(baseOptions({ trashItem }));
        openProject(app.grants);
        const token = await app.handlers['fs:trash'](join(project, 'main.tex'));
        expect(typeof token).toBe('string');
        expect(trashItem).toHaveBeenCalledWith(join(project, 'main.tex'));
    });

    it('ohne trashItem bleibt fs:trash ein Fehler, nichts wird gelöscht', async () => {
        const app = createAppHandlers(baseOptions());
        openProject(app.grants);
        await expect(app.handlers['fs:trash'](join(project, 'main.tex'))).rejects.toBeDefined();
        expect(await readFile(join(project, 'main.tex'), 'utf8')).toBe('alt\n');
    });
});

describe('Dateiüberwachung und fs:writeText', () => {
    function watchedApp() {
        const raw = fakeRawWatch();
        const watchers: ProjectWatcher[] = [];
        const { emit, events } = recorder();
        const createWatcher = (onError: (error: Error) => void): FileWatcher => {
            const watcher = new ProjectWatcher({ onError, watchFactory: raw.factory, quietMs: QUIET_MS, maxWaitMs: MAX_WAIT_MS });
            watchers.push(watcher);
            return watcher;
        };
        const app = createAppHandlers(baseOptions({ emit, createWatcher }));
        openProject(app.grants);
        return { app, raw, events, watcher: () => watchers[0] as ProjectWatcher };
    }

    const changes = (events: RecordedEvent[]) => events.filter((entry) => entry.event === 'fs:changed');

    it('das eigene Speichern erzeugt kein fs:changed, eine fremde Änderung schon', async () => {
        const { app, raw, events, watcher } = watchedApp();
        await watcher().whenIdle();
        await app.handlers['fs:writeText'](join(project, 'main.tex'), 'neu und länger\n', 'utf8', 'lf');
        raw.fire('main.tex');
        await settle();
        await watcher().whenIdle();
        expect(changes(events)).toEqual([]);
        await writeFile(join(project, 'main.tex'), 'von außen, noch länger\n');
        raw.fire('main.tex');
        await settle();
        await watcher().whenIdle();
        expect(changes(events)).toHaveLength(1);
        expect((changes(events)[0]?.payload as IpcEvents['fs:changed']).paths).toEqual([join(project, 'main.tex')]);
    });

    it('eine gewährte Datei außerhalb des Projekts wird geschrieben, die Überwachung bleibt still', async () => {
        const { app, events, watcher } = watchedApp();
        const { grantId } = app.grants.grant(join(base, '.keep'), 'saveTarget');
        await app.handlers['fs:writeText'](grantId, 'x\n', 'utf8', 'lf');
        await watcher().rescan();
        expect(await readFile(join(base, '.keep'), 'utf8')).toBe('x\n');
        expect(changes(events)).toEqual([]);
    });
});

// ---------- Build: Überwachung vor und nach dem Lauf ----------

class FakeChild extends EventEmitter {
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    readonly pid = FAKE_PID;
}

function fakeBuild(watch: BuildWatchHooks, order: string[]) {
    const grants = new GrantStore({ platform: currentPathPlatform() });
    openProject(grants);
    const children: FakeChild[] = [];
    const spawn: SpawnFunction = () => {
        order.push('spawn');
        const child = new FakeChild();
        children.push(child);
        return child;
    };
    const buildDependencies: BuildDependencies = { ...defaultBuildDependencies(), spawn, signal: () => undefined };
    const emit: EventSender = (event) => void order.push(event);
    const handlers = createBuildHandlers({
        grants, emit, quitTasks: new QuitTasks(), userDataDir: userData, log: () => undefined, buildDependencies,
        detectTools: () => Promise.resolve(FAKE_TOOLS), watch,
    });
    return { handlers, children };
}

async function waitFor(condition: () => boolean): Promise<void> {
    while (!condition()) await new Promise((resolve) => setImmediate(resolve));
}

describe('Build und Dateiüberwachung', () => {
    it('Build-PDF vor dem Start bekannt, Abgleich erst nach build:finished', async () => {
        const order: string[] = [];
        const outputs: string[][] = [];
        const watch: BuildWatchHooks = {
            setBuildOutputs: (paths) => void (outputs.push([...paths]), order.push('setBuildOutputs')),
            rescan: () => (order.push('rescan'), Promise.resolve()),
        };
        const { handlers, children } = fakeBuild(watch, order);
        await handlers['build:start'](join(project, 'main.tex'), PDFLATEX);
        await waitFor(() => children.length === 1);
        children[0]?.emit('exit', 0, null);
        children[0]?.emit('close', 0, null);
        await waitFor(() => order.includes('rescan'));
        expect(outputs).toEqual([[join(project, 'main.pdf')]]);
        const relevant = order.filter((entry) => entry !== 'build:status');
        expect(relevant).toEqual(['setBuildOutputs', 'spawn', 'build:finished', 'rescan']);
    });
});

// ---------- Log-Parser im Build ----------

class FakeParseWorker extends EventEmitter implements ParseWorkerLike {
    readonly requests: ParseWorkerRequest[] = [];
    terminated = false;

    postMessage(request: ParseWorkerRequest): void {
        this.requests.push(request);
        const issue = { id: 0, severity: 'warning', message: 'Verweis fehlt', file: '/p/a.tex', line: 3, detail: 'l.3' } as const;
        queueMicrotask(() => this.emit('message', { id: request.id, ok: true, value: [issue] }));
    }

    terminate(): void {
        this.terminated = true;
    }
}

describe('Log-Parser und Aufräumen beim Beenden', () => {
    it('build:finished.report bekommt die Meldungen des Workers (nur Vertragsfelder), Biber-Log daneben', async () => {
        const workers: FakeParseWorker[] = [];
        const options = baseOptions({ createParseWorker: () => (workers.push(new FakeParseWorker()), workers.at(-1) as FakeParseWorker) });
        const parseLog = createBuildLogParser(options);
        const logPath = join(project, 'main.log');
        expect(await parseLog?.(logPath)).toEqual([{ severity: 'warning', message: 'Verweis fehlt', file: '/p/a.tex', line: 3 }]);
        expect(workers[0]?.requests[0]).toMatchObject({ logPath, biberPath: join(project, 'main.blg'), baseDirectory: project });
        await options.quitTasks.runAll(() => undefined);
        expect(workers[0]?.terminated).toBe(true);
    });

    it('Quit-Aufgaben: Einstellungen, Überwachung, Build und Log-Parser', async () => {
        const stop = vi.fn();
        const createWatcher = (): FileWatcher => ({
            start: () => Promise.resolve(), stop, rescan: () => Promise.resolve(),
            ignoreOwnWrite: () => undefined, setBuildOutputs: () => undefined,
        });
        const quitTasks = new QuitTasks();
        const app = createAppHandlers(baseOptions({
            quitTasks, emit: recorder().emit, createWatcher, createParseWorker: () => new FakeParseWorker(),
        }));
        openProject(app.grants);
        expect(quitTasks.size).toBe(4);
        await app.handlers['settings:set']('fontSize', 17);
        await quitTasks.runAll(() => undefined);
        expect(stop).toHaveBeenCalled();
        expect(JSON.parse(await readFile(join(userData, SETTINGS_FILE_NAME), 'utf8')).values.fontSize).toBe(17);
        await expect(app.handlers['build:start'](join(project, 'main.tex'), PDFLATEX)).rejects.toBeDefined();
    });
});

// ---------- echter TeX-Lauf (nur mit LATEXEDITOR_REAL_TEX=1) ----------

async function bundleParseWorker(directory: string): Promise<string> {
    await viteBuild({
        configFile: false,
        logLevel: 'warn',
        build: {
            ssr: PARSE_WORKER_SOURCE,
            outDir: directory,
            emptyOutDir: false,
            minify: false,
            rollupOptions: { output: { format: 'cjs', entryFileNames: PARSE_WORKER_FILE_NAME } },
        },
    });
    return join(directory, PARSE_WORKER_FILE_NAME);
}

describe.skipIf(process.env.LATEXEDITOR_REAL_TEX !== '1')('echter Build über createAppHandlers', () => {
    it('fig:fehlt als Warnung mit Datei und Zeile aus dem Log', { timeout: REAL_TEX_TIMEOUT_MS }, async () => {
        const copy = join(base, 'HgbDemo');
        await cp(DEMO_PROJECT, copy, { recursive: true });
        const parseWorkerScript = await bundleParseWorker(join(base, 'worker'));
        let resolveFinished: (payload: IpcEvents['build:finished']) => void = () => undefined;
        const finishedEvent = new Promise<IpcEvents['build:finished']>((resolve) => (resolveFinished = resolve));
        const emit: EventSender = (event, payload) => {
            if (event === 'build:finished') resolveFinished(payload as IpcEvents['build:finished']);
        };
        const quitTasks = new QuitTasks();
        const app = createAppHandlers(baseOptions({ emit, quitTasks, parseWorkerScript, createWatcher: () => ({
            start: () => Promise.resolve(), stop: () => undefined, rescan: () => Promise.resolve(),
            ignoreOwnWrite: () => undefined, setBuildOutputs: () => undefined,
        }) }));
        openProject(app.grants, copy);
        await app.handlers['build:start'](join(copy, 'main.tex'), PDFLATEX);
        const finished = await finishedEvent;
        console.log(`Echter Build über createAppHandlers: ${JSON.stringify(finished.report)}`);
        expect(finished).toMatchObject({ ok: true, pdfPath: join(copy, 'main.pdf') });
        expect(finished.report).toContainEqual({
            severity: 'warning', message: expect.stringContaining('fig:fehlt'), file: join(copy, 'chapters', 'einleitung.tex'), line: 20,
        });
        await quitTasks.runAll(() => undefined);
    });
});
