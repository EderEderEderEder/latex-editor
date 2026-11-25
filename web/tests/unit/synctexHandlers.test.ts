import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GrantStore } from '../../src/main/grants';
import { createAppHandlers } from '../../src/main/handlers/appHandlers';
import type { DialogLike } from '../../src/main/handlers/dialogHandlers';
import {
    createSyncTeXHandlers,
    observeBuildEvents,
    reloadOnProjectOpen,
} from '../../src/main/handlers/synctexHandlers';
import type { EventSender } from '../../src/main/ipc';
import type { IpcHandler } from '../../src/main/ipcHandlers';
import { QuitTasks } from '../../src/main/lifecycle';
import { MACOS_PATHS, type PathPlatform, type RealpathFunction, WINDOWS_PATHS } from '../../src/main/paths';
import { type SyncTeXBackend, SyncTeXClientError } from '../../src/main/synctexClient';
import { type PdfStat, SYNCTEX_SERVICE_MESSAGES, SyncTeXService } from '../../src/main/synctexService';
import type { SyncTeXLoadSummary } from '../../src/main/workers/synctex.worker';
import type {
    GeneralError,
    IpcEvents,
    ProjectInfo,
    SyncTexBackwardResult,
    SyncTexForwardResult,
} from '../../src/shared/contract';
import { IpcFailure } from '../../src/shared/ipcResult';

// Handler `synctex:forward`/`synctex:backward` und Nachladen mit gefälschtem Worker-Client; `realpath` gefälscht,
// damit macOS-Symlinks (`/tmp` → `/private/tmp`) und Windows-Junctions ohne echtes Dateisystem prüfbar sind.

const SUMMARY: SyncTeXLoadSummary = { inputs: 1, records: 1, pages: 1, durationMs: 0 };
const PDF_MTIME = 1_732_500_000_000;
const FORWARD_RESULT: SyncTexForwardResult = { page: 2, rects: [{ x: 1, y: 2, width: 3, height: 4 }] };
const LINE = 3;

const MAC_ROOT = '/tmp/Projekt';
const MAC_REAL_ROOT = '/private/tmp/Projekt';
const macRealpath: RealpathFunction = (target) => {
    if (target === `${MAC_ROOT}/raus.tex`) return Promise.resolve('/etc/raus.tex');
    const isTmp = target === '/tmp' || target.startsWith('/tmp/');
    return Promise.resolve(isTmp ? `/private${target}` : target);
};

// Windows: `D:\Arbeit` ist eine Junction nach `C:\Daten\Arbeit`.
const WIN_ROOT = 'D:\\Arbeit';
const WIN_REAL_ROOT = 'C:\\Daten\\Arbeit';
const winRealpath: RealpathFunction = (target) => {
    const lower = target.toLowerCase();
    const inside = lower === WIN_ROOT.toLowerCase() || lower.startsWith(`${WIN_ROOT.toLowerCase()}\\`);
    return Promise.resolve(inside ? WIN_REAL_ROOT + target.slice(WIN_ROOT.length) : target);
};

type LoadState = 'ok' | 'broken';

class FakeBackend implements SyncTeXBackend {
    readonly files = new Map<string, LoadState>();
    readonly loads: Array<{ file: string; platform: NodeJS.Platform | undefined }> = [];
    readonly forwardCalls: Array<[string, number]> = [];
    backwardResult: SyncTexBackwardResult | null = null;
    queryError: GeneralError | null = null;
    loadGate: Promise<void> | null = null;
    forgotten = 0;

    async load(file: string, platform?: NodeJS.Platform): Promise<SyncTeXLoadSummary> {
        this.loads.push({ file, platform });
        if (this.loadGate !== null) await this.loadGate;
        const state = this.files.get(file);
        if (state === undefined) throw new SyncTeXClientError({ kind: 'notFound', message: 'fehlt' });
        if (state === 'broken') throw new SyncTeXClientError({ kind: 'io', message: 'unvollständig' });
        return SUMMARY;
    }

    forward(file: string, line: number): Promise<SyncTexForwardResult | null> {
        this.forwardCalls.push([file, line]);
        if (this.queryError !== null) return Promise.reject(new SyncTeXClientError(this.queryError));
        return Promise.resolve(FORWARD_RESULT);
    }

    backward(): Promise<SyncTexBackwardResult | null> {
        if (this.queryError !== null) return Promise.reject(new SyncTeXClientError(this.queryError));
        return Promise.resolve(this.backwardResult);
    }

    forget(): void {
        this.forgotten++;
    }
}

type RecordedEvent = { event: string; payload: unknown };

function setup(platform: PathPlatform, root: string, realpath: RealpathFunction) {
    const grants = new GrantStore({ platform });
    const backend = new FakeBackend();
    const events: RecordedEvent[] = [];
    const emit: EventSender = (event, payload) => void events.push({ event, payload });
    const log = vi.fn();
    const stat: PdfStat = () => Promise.resolve({ mtimeMs: PDF_MTIME });
    const service = new SyncTeXService({ backend, platform, emit, log, stat, realpath });
    grants.onProjectChanged(() => service.reset());
    const open = (projectRoot: string): string => grants.openProject(grants.grant(projectRoot, 'project').grantId);
    open(root);
    const handlers = createSyncTeXHandlers({ grants, backend, service, realpath });
    return { grants, backend, events, log, service, handlers, open, emit };
}

function macSetup() {
    return setup(MACOS_PATHS, MAC_ROOT, macRealpath);
}

async function loadedMac() {
    const context = macSetup();
    context.backend.files.set(`${MAC_REAL_ROOT}/main.synctex.gz`, 'ok');
    expect(await context.service.reloadBeside(`${MAC_ROOT}/main.tex`)).toBe(true);
    return context;
}

describe('Nachladen der SyncTeX-Daten', () => {
    it('lädt main.synctex.gz (aufgelöst) und meldet synctex:ready mit der PDF-Zeit', async () => {
        const { backend, events, service } = await loadedMac();
        expect(backend.loads).toEqual([{ file: `${MAC_REAL_ROOT}/main.synctex.gz`, platform: 'darwin' }]);
        expect(events).toEqual([{ event: 'synctex:ready', payload: { pdfMtime: PDF_MTIME } }]);
        expect(service.hasData).toBe(true);
    });

    it('fehlt die gz-Datei, wird die unkomprimierte geladen', async () => {
        const { backend, events, service } = macSetup();
        backend.files.set(`${MAC_REAL_ROOT}/main.synctex`, 'ok');
        expect(await service.reloadBeside(`${MAC_REAL_ROOT}/main.pdf`)).toBe(true);
        expect(backend.loads.map((entry) => entry.file)).toEqual([`${MAC_REAL_ROOT}/main.synctex.gz`, `${MAC_REAL_ROOT}/main.synctex`]);
        expect(events).toHaveLength(1);
    });

    it('unvollständige Datei: alte Daten bleiben, kein Ereignis, Meldung im Log', async () => {
        const { backend, events, service, log } = await loadedMac();
        backend.files.set(`${MAC_REAL_ROOT}/main.synctex.gz`, 'broken');
        expect(await service.reloadBeside(`${MAC_ROOT}/main.tex`)).toBe(false);
        expect(service.hasData).toBe(true);
        expect(events).toHaveLength(1);
        expect(log).toHaveBeenCalledWith(SYNCTEX_SERVICE_MESSAGES.loadFailed('unvollständig'));
    });

    it('ohne SyncTeX-Datei passiert nichts (kein Log)', async () => {
        const { service, events, log } = macSetup();
        expect(await service.reloadBeside(`${MAC_ROOT}/main.tex`)).toBe(false);
        expect(service.hasData).toBe(false);
        expect(events).toEqual([]);
        expect(log).not.toHaveBeenCalled();
    });

    it('Projektwechsel verwirft die Daten; ein Laden von vorher meldet nichts mehr', async () => {
        const { backend, events, service, open, handlers } = await loadedMac();
        let release = (): void => undefined;
        backend.loadGate = new Promise<void>((resolve) => {
            release = () => resolve();
        });
        const reload = service.reloadBeside(`${MAC_ROOT}/main.tex`);
        open('/tmp/Anderes');
        release();
        expect(await reload).toBe(false);
        expect(service.hasData).toBe(false);
        expect(backend.forgotten).toBeGreaterThanOrEqual(2);
        expect(events).toHaveLength(1);
        expect(await handlers['synctex:forward']('/tmp/Anderes/main.tex', LINE)).toBeNull();
    });
});

describe('synctex:forward', () => {
    it('ohne geladene Daten null, ohne den Worker zu fragen', async () => {
        const { handlers, backend } = macSetup();
        expect(await handlers['synctex:forward'](`${MAC_ROOT}/kapitel.tex`, LINE)).toBeNull();
        expect(backend.forwardCalls).toEqual([]);
    });

    it('sucht mit dem aufgelösten Pfad der Projektdatei', async () => {
        const { handlers, backend } = await loadedMac();
        expect(await handlers['synctex:forward'](`${MAC_ROOT}/kapitel.tex`, LINE)).toEqual(FORWARD_RESULT);
        expect(backend.forwardCalls).toEqual([[`${MAC_REAL_ROOT}/kapitel.tex`, LINE]]);
    });

    it('Datei außerhalb des Projekts wird abgelehnt', async () => {
        const { handlers } = await loadedMac();
        await expect(handlers['synctex:forward']('/tmp/Anderes/x.tex', LINE)).rejects.toMatchObject({ error: { kind: 'forbiddenPath' } });
    });

    it('notFound des Workers (keine Daten nach Neustart) wird null, io ein Fehler', async () => {
        const { handlers, backend } = await loadedMac();
        backend.queryError = { kind: 'notFound', message: 'keine Daten' };
        expect(await handlers['synctex:forward'](`${MAC_ROOT}/kapitel.tex`, LINE)).toBeNull();
        backend.queryError = { kind: 'io', message: 'kaputt' };
        await expect(handlers['synctex:forward'](`${MAC_ROOT}/kapitel.tex`, LINE)).rejects.toBeInstanceOf(IpcFailure);
    });
});

describe('synctex:backward', () => {
    it.each([
        [`${MAC_REAL_ROOT}/kapitel/eins.tex`, `${MAC_ROOT}/kapitel/eins.tex`],
        [`${MAC_ROOT}/kapitel/eins.tex`, `${MAC_ROOT}/kapitel/eins.tex`],
    ])('%s erscheint in Projektform als %s', async (reported, expected) => {
        const { handlers, backend } = await loadedMac();
        backend.backwardResult = { file: reported, line: LINE };
        expect(await handlers['synctex:backward'](1, 100, 200)).toEqual({ file: expected, line: LINE });
    });

    it.each([
        ['anderes Projekt', '/private/tmp/Anderes/x.tex'],
        ['Symlink aus dem Projekt hinaus', `${MAC_REAL_ROOT}/raus.tex`],
        ['TeX-Installation', '/usr/local/texlive/2026/texmf-dist/tex/latex/base/article.tex'],
        ['relativer Pfad', 'relativ.tex'],
    ])('%s ergibt null', async (_label, reported) => {
        const { handlers, backend } = await loadedMac();
        backend.backwardResult = { file: reported, line: LINE };
        expect(await handlers['synctex:backward'](1, 100, 200)).toBeNull();
    });

    it('ohne Treffer oder ohne Daten null', async () => {
        const { handlers } = macSetup();
        expect(await handlers['synctex:backward'](1, 100, 200)).toBeNull();
        const loaded = await loadedMac();
        expect(await loaded.handlers['synctex:backward'](99, 0, 0)).toBeNull();
    });
});

describe('Windows-Pfade (path.win32, Junction, Groß-/Kleinschreibung)', () => {
    async function loadedWindows() {
        const context = setup(WINDOWS_PATHS, WIN_ROOT, winRealpath);
        context.backend.files.set(`${WIN_REAL_ROOT}\\main.synctex.gz`, 'ok');
        expect(await context.service.reloadBeside(`${WIN_ROOT}\\main.pdf`)).toBe(true);
        return context;
    }

    it('lädt mit Plattform win32 über den aufgelösten Pfad', async () => {
        const { backend } = await loadedWindows();
        expect(backend.loads).toEqual([{ file: `${WIN_REAL_ROOT}\\main.synctex.gz`, platform: 'win32' }]);
    });

    it('forward: kleines Laufwerk, Schrägstriche und andere Schreibung finden die aufgelöste Datei', async () => {
        const { handlers, backend } = await loadedWindows();
        expect(await handlers['synctex:forward']('d:/arbeit/Kapitel/eins.tex', LINE)).toEqual(FORWARD_RESULT);
        expect(backend.forwardCalls).toEqual([[`${WIN_REAL_ROOT}\\Kapitel\\eins.tex`, LINE]]);
    });

    it('backward: Pfad hinter der Junction erscheint unter der Projektwurzel, fremde Pfade ergeben null', async () => {
        const { handlers, backend } = await loadedWindows();
        backend.backwardResult = { file: 'C:\\daten\\arbeit\\Kapitel\\eins.tex', line: LINE };
        expect(await handlers['synctex:backward'](1, 10, 20)).toEqual({ file: `${WIN_ROOT}\\Kapitel\\eins.tex`, line: LINE });
        backend.backwardResult = { file: 'C:\\Daten\\Anderes\\eins.tex', line: LINE };
        expect(await handlers['synctex:backward'](1, 10, 20)).toBeNull();
    });
});

describe('Anschluss an Build und Projektöffnen', () => {
    function finished(overrides: Partial<IpcEvents['build:finished']>): IpcEvents['build:finished'] {
        return { ok: true, cancelled: false, report: [], pdfPath: `${MAC_REAL_ROOT}/main.pdf`, durationMs: 1, ...overrides };
    }

    it('nach build:finished mit PDF wird neu geladen (auch mit Fehlern), nach Abbruch nicht', () => {
        const { service } = macSetup();
        const reload = vi.spyOn(service, 'reloadBeside').mockResolvedValue(true);
        const forwarded: string[] = [];
        const emit = observeBuildEvents((event) => void forwarded.push(event), service);
        emit('build:status', { state: 'running', startedAt: 1 });
        emit('build:finished', finished({ ok: false }));
        emit('build:finished', finished({ cancelled: true }));
        emit('build:finished', finished({ pdfPath: null }));
        expect(forwarded).toEqual(['build:status', 'build:finished', 'build:finished', 'build:finished']);
        expect(reload.mock.calls).toEqual([[`${MAC_REAL_ROOT}/main.pdf`]]);
    });

    it('project:open lädt neben der erkannten Hauptdatei, ohne Hauptdatei nicht', async () => {
        const { service } = macSetup();
        const reload = vi.spyOn(service, 'reloadBeside').mockResolvedValue(true);
        const info = (mainFile: string | null): ProjectInfo => ({
            root: MAC_ROOT,
            mainFile,
            tree: { kind: 'directory', name: 'Projekt', path: MAC_ROOT, children: [] },
        });
        const withMain: IpcHandler<'project:open'> = () => Promise.resolve(info(`${MAC_ROOT}/main.tex`));
        const withoutMain: IpcHandler<'project:open'> = () => Promise.resolve(info(null));
        expect((await reloadOnProjectOpen(withMain, service)('grant')).mainFile).toBe(`${MAC_ROOT}/main.tex`);
        await reloadOnProjectOpen(withoutMain, service)('grant');
        expect(reload.mock.calls).toEqual([[`${MAC_ROOT}/main.tex`]]);
    });

    it('createAppHandlers mit Worker-Fabrik: Kanäle sind verdrahtet (ohne Projekt null), Beenden räumt auf', async () => {
        const userDataDir = await mkdtemp(join(tmpdir(), 'synctex-wiring-'));
        try {
            const dialog: DialogLike<object> = {
                showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
                showSaveDialog: () => Promise.resolve({ canceled: true }),
            };
            const quitTasks = new QuitTasks();
            const createSyncTeXWorker = vi.fn(() => {
                throw new Error('darf ohne Daten nicht starten');
            });
            const { handlers } = createAppHandlers({
                userDataDir, dialog, window: () => ({}), platform: MACOS_PATHS, quitTasks, log: vi.fn(),
                confirmClose: vi.fn(), createSyncTeXWorker,
            });
            expect(await handlers['synctex:forward'](`${MAC_ROOT}/main.tex`, LINE)).toBeNull();
            expect(await handlers['synctex:backward'](1, 0, 0)).toBeNull();
            expect(createSyncTeXWorker).not.toHaveBeenCalled();
            await quitTasks.runAll(vi.fn());
        } finally {
            await rm(userDataDir, { recursive: true, force: true });
        }
    });
});
