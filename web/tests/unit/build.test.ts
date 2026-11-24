import { spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { cp, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    argumentsFor,
    BUILD_MESSAGES,
    buildArguments,
    buildEnvironment,
    type BuildDependencies,
    type BuildFinishedEvent,
    type BuildOutcome,
    BuildQueue,
    type BuildQueueOptions,
    BuildRunner,
    type BuildRequest,
    cleanArguments,
    createLineSplitter,
    defaultBuildDependencies,
    type FileStat,
    killPlanFor,
    launchBlocker,
    type OutputStream,
    siblingPath,
    type SpawnFunction,
    spawnOptionsFor,
} from '../../src/main/build';
import type { EventSender } from '../../src/main/ipc';
import { createBeforeQuitHandler, QuitTasks } from '../../src/main/lifecycle';
import { detectTools } from '../../src/main/tools';
import type { BuildIssue, BuildState, IpcEvents } from '../../src/shared/contract';

const FAKE_LATEXMK = fileURLToPath(new URL('../support/fakeLatexmk.mjs', import.meta.url));
const DEMO_PROJECT = fileURLToPath(new URL('../../../shared/Testdaten/HgbDemo', import.meta.url));
const PDFLATEX: BuildRequest['options'] = { engine: 'pdflatex' };
const CANCEL_BUDGET_MS = 3_000;
const LONG_DOCUMENT_MS = 40_000;
const GONE_CHECK_LIMIT_MS = 1_000;
const GONE_CHECK_STEP_MS = 20;
const REAL_TEX_TIMEOUT_MS = 240_000;
const GRANDCHILD_PREFIX = 'GRANDCHILD ';
const REAL_TEX_WARMUP_MS = 1_500;
const SHORT_DEADLINE_MS = 30;
// Unter Windows gibt es keine Prozessgruppen: `process.kill(-pid, 0)` meldet dort immer „weg“.
const HAS_PROCESS_GROUPS = process.platform !== 'win32';
// Wie in swift/Tests/…/BuildCancelTests.swift: rechnet rund 40 s, wenn niemand abbricht.
const SLOW_DOCUMENT = [
    '\\documentclass{article}',
    '\\begin{document}',
    '\\newcount\\mycount \\mycount=0',
    '\\def\\myloop{\\advance\\mycount by 1 \\ifnum\\mycount<100000000 \\expandafter\\myloop\\fi}',
    '\\myloop',
    'Fertig.',
    '\\end{document}',
    '',
].join('\n');

// ---------- reine Funktionen ----------

describe('Argumente, Umgebung, Startprüfung', () => {
    it('latexmk-Argumente als Array, Hauptdatei nur als Name (Arbeitsordner ist ihr Ordner)', () => {
        expect(buildArguments('/p/Arbeit mit Leerzeichen.tex', PDFLATEX, 'darwin')).toEqual([
            '-pdf', '-synctex=1', '-interaction=nonstopmode', '-file-line-error', '-cd', 'Arbeit mit Leerzeichen.tex',
        ]);
        expect(buildArguments('C:\\p\\main.tex', { engine: 'lualatex' }, 'win32')[0]).toBe('-lualatex');
        expect(buildArguments('C:\\p\\main.tex', { engine: 'xelatex' }, 'win32').at(-1)).toBe('main.tex');
    });

    it('Hauptdatei mit „-“ am Anfang bekommt „./“, damit latexmk sie nicht als Option liest', () => {
        expect(buildArguments('/p/-shell-escape.tex', PDFLATEX, 'linux').at(-1)).toBe('./-shell-escape.tex');
        expect(buildArguments('C:\\p\\-x.tex', PDFLATEX, 'win32').at(-1)).toBe('./-x.tex');
        expect(buildArguments('/p/a-b.tex', PDFLATEX, 'linux').at(-1)).toBe('a-b.tex');
    });

    it('PATH beginnt mit dem Ordner von latexmk, unter Windows bleibt der Schlüssel „Path“', () => {
        const windows = buildEnvironment({ Path: 'C:\\Windows' }, 'C:\\texlive\\2025\\bin\\windows\\latexmk.exe', 'win32');
        expect(windows.Path).toBe('C:\\texlive\\2025\\bin\\windows;C:\\Windows');
        expect(windows.PATH).toBeUndefined();
        const mac = buildEnvironment({}, '/Library/TeX/texbin/latexmk', 'darwin');
        expect(mac.PATH).toBe('/Library/TeX/texbin');
        expect(mac.max_print_line).toBe('10000');
    });

    it.each([
        ['C:\\TeX\\latexmk.bat', 'win32', BUILD_MESSAGES.windowsNotExe('C:\\TeX\\latexmk.bat')],
        ['C:\\TeX\\latexmk.CMD', 'win32', BUILD_MESSAGES.windowsNotExe('C:\\TeX\\latexmk.CMD')],
        ['C:\\TeX\\latexmk', 'win32', BUILD_MESSAGES.windowsNotExe('C:\\TeX\\latexmk')],
        ['C:\\TeX\\latexmk.EXE', 'win32', null],
        ['/Library/TeX/texbin/latexmk', 'darwin', null],
    ] as const)('Startprüfung %s (%s)', (latexmk, platform, expected) => {
        expect(launchBlocker({ latexmk, mainFile: 'x.tex', options: PDFLATEX }, platform)).toBe(expected);
    });

    it('fehlendes Perl (MiKTeX) verhindert den Start', () => {
        const request: BuildRequest = { latexmk: 'C:\\m\\latexmk.exe', mainFile: 'C:\\p\\main.tex', options: PDFLATEX, problems: [{ tool: 'perl', message: 'x' }] };
        expect(launchBlocker(request, 'win32')).toBe(BUILD_MESSAGES.perlMissing);
    });

    it('Startoptionen: nie Shell; Unix eigene Prozessgruppe, Windows ohne Konsolenfenster', () => {
        const unix = spawnOptionsFor('/p/main.tex', {}, 'linux');
        expect(unix).toMatchObject({ cwd: '/p', shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const windows = spawnOptionsFor('C:\\p\\main.tex', {}, 'win32');
        expect(windows).toMatchObject({ cwd: 'C:\\p', shell: false, detached: false, windowsHide: true });
    });

    it('Abbruchplan: taskkill mit eigener PID und /T /F, Unix die eigene Prozessgruppe', () => {
        expect(killPlanFor(4242, 'win32', { SYSTEMROOT: 'D:\\Win' })).toEqual({
            kind: 'taskkill', command: 'D:\\Win\\System32\\taskkill.exe', args: ['/PID', '4242', '/T', '/F'],
        });
        expect(killPlanFor(4242, 'darwin', {})).toEqual({ kind: 'processGroup', groupId: 4242 });
    });

    it('Aufräumen: latexmk -c -cd, ebenfalls mit „./“-Regel; Nachbardateien der Hauptdatei', () => {
        expect(cleanArguments('/p/main.tex', 'darwin')).toEqual(['-c', '-cd', 'main.tex']);
        expect(argumentsFor({ latexmk: 'l', mainFile: 'C:\\p\\-x.tex', options: PDFLATEX, task: 'clean' }, 'win32')).toEqual(['-c', '-cd', './-x.tex']);
        expect(argumentsFor({ latexmk: 'l', mainFile: '/p/main.tex', options: PDFLATEX }, 'linux')[0]).toBe('-pdf');
        expect(siblingPath('/p/Arbeit.v2.tex', '.log', 'linux')).toBe('/p/Arbeit.v2.log');
        expect(siblingPath('C:\\p\\main.tex', '.pdf', 'win32')).toBe('C:\\p\\main.pdf');
    });

    it('Zeilen über Stückgrenzen, CRLF und Rest ohne Umbruch', () => {
        const lines: string[] = [];
        const splitter = createLineSplitter((line) => lines.push(line));
        ['ers', 'te\r', '\nzwei', 'te\n\ndrit', 'te'].forEach((chunk) => splitter.push(chunk));
        splitter.flush();
        expect(lines).toEqual(['erste', 'zweite', '', 'dritte']);
    });
});

// ---------- Windows-Abbruch mit künstlichem Kindprozess ----------

class FakeChild extends EventEmitter {
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    constructor(readonly pid: number) {
        super();
    }
}

describe('Abbruch unter Windows (simuliert)', () => {
    it('ruft taskkill /PID <Kind-PID> /T /F ohne Shell auf und meldet „abgebrochen“', async () => {
        const calls: { command: string; args: readonly string[]; shell: unknown }[] = [];
        const child = new FakeChild(777);
        const spawn: SpawnFunction = (command, args, options) => {
            calls.push({ command, args, shell: options.shell });
            return calls.length === 1 ? child : new FakeChild(778);
        };
        const dependencies: BuildDependencies = { ...defaultBuildDependencies(), spawn, platform: 'win32', env: { SystemRoot: 'C:\\Windows' } };
        const runner = new BuildRunner(dependencies);
        const outcome = runner.start({ latexmk: 'C:\\m\\latexmk.exe', mainFile: 'C:\\p\\main.tex', options: PDFLATEX });
        const cancelled = runner.cancel();
        expect(runner.currentState).toBe('cancelling');
        expect(calls[1]).toEqual({ command: 'C:\\Windows\\System32\\taskkill.exe', args: ['/PID', '777', '/T', '/F'], shell: false });
        child.emit('close', 1, null);
        await cancelled;
        expect(await outcome).toMatchObject({ kind: 'finished', cancelled: true, ok: false, problem: null });
        expect(runner.currentState).toBe('idle');
    });

    it.each([
        ['exit ohne close (Enkel hält die Pipe)', true, BUILD_MESSAGES.outputHeldOpen, 1],
        ['weder exit noch close (taskkill wirkungslos)', false, BUILD_MESSAGES.cancelUnconfirmed, null],
    ] as const)('Frist nach dem Abbruch: %s', async (_name, emitExit, problem, exitCode) => {
        const child = new FakeChild(777);
        const spawn: SpawnFunction = () => child;
        const dependencies: BuildDependencies = {
            ...defaultBuildDependencies(), spawn, platform: 'win32', env: {}, cancelDeadlineMs: SHORT_DEADLINE_MS,
        };
        const runner = new BuildRunner(dependencies);
        const outcome = runner.start({ latexmk: 'C:\\m\\latexmk.exe', mainFile: 'C:\\p\\main.tex', options: PDFLATEX });
        const cancelled = runner.cancel();
        if (emitExit) child.emit('exit', 1, null);
        await cancelled;
        expect(await outcome).toMatchObject({ kind: 'finished', cancelled: true, ok: false, exitCode, problem });
        expect(child.stdout.destroyed && child.stderr.destroyed).toBe(true);
        expect(runner.currentState).toBe('idle');
        const next = runner.start({ latexmk: 'C:\\m\\latexmk.exe', mainFile: 'C:\\p\\main.tex', options: PDFLATEX });
        child.emit('close', 0, null);
        expect(await next).not.toMatchObject({ kind: 'rejected', reason: 'busy' });
    });
});

// ---------- Warteschlange mit künstlichen Kindprozessen ----------

const FAKE_REQUEST: BuildRequest = { latexmk: '/tex/latexmk', mainFile: '/p/main.tex', options: PDFLATEX };
const FIRST_FAKE_PID = 1001;
const missingStat: FileStat = () => Promise.reject(new Error('fehlt'));
const freshStat: FileStat = () => Promise.resolve({ mtimeMs: Date.now() });
const staleStat: FileStat = () => Promise.resolve({ mtimeMs: 0 });
const PARSED_WARNING: BuildIssue = { severity: 'warning', message: 'Reference `fig:fehlt\' undefined', file: '/p/main.tex', line: 3 };

function eventRecorder() {
    const events: { event: string; payload: unknown }[] = [];
    const emit: EventSender = (event, payload) => {
        events.push({ event, payload });
    };
    const statuses = (): BuildState[] =>
        events.filter((entry) => entry.event === 'build:status').map((entry) => (entry.payload as IpcEvents['build:status']).state);
    const finished = (): BuildFinishedEvent[] =>
        events.filter((entry) => entry.event === 'build:finished').map((entry) => entry.payload as BuildFinishedEvent);
    return { emit, statuses, finished };
}

function fakeSpawner() {
    const children: FakeChild[] = [];
    const calls: { command: string; args: readonly string[] }[] = [];
    const waiters: (() => void)[] = [];
    const spawn: SpawnFunction = (command, args) => {
        calls.push({ command, args });
        const child = new FakeChild(FIRST_FAKE_PID + children.length);
        children.push(child);
        waiters.splice(0).forEach((wake) => wake());
        return child;
    };
    const spawned = async (count: number): Promise<FakeChild> => {
        while (children.length < count) await new Promise<void>((resolve) => waiters.push(resolve));
        return children[count - 1] as FakeChild;
    };
    return { spawn, children, calls, spawned, lastFile: () => calls.map((call) => call.args.at(-1)) };
}

function finishChild(child: FakeChild, code: number | null = 0, signal: NodeJS.Signals | null = null): void {
    child.emit('exit', code, signal);
    child.emit('close', code, signal);
}

// Unix-Weg mit gefälschten Signalen: Die künstlichen PIDs dürfen nie an echte Prozessgruppen gehen.
function fakeQueue(options: Partial<BuildQueueOptions> = {}) {
    const spawner = fakeSpawner();
    const recorder = eventRecorder();
    const signals: { pid: number; signal: NodeJS.Signals }[] = [];
    const dependencies: BuildDependencies = {
        ...defaultBuildDependencies(), spawn: spawner.spawn, platform: 'linux', env: {},
        signal: (pid, signal) => void signals.push({ pid, signal }),
        exitCloseGraceMs: SHORT_DEADLINE_MS, cancelDeadlineMs: SHORT_DEADLINE_MS,
    };
    const queue = new BuildQueue({ emit: recorder.emit, dependencies, stat: missingStat, ...options });
    return { queue, spawner, recorder, signals };
}

describe('Warteschlange (künstliche Kindprozesse)', () => {
    it('nie parallel; Aufträge während eines Laufs werden zu EINEM Folgelauf (der letzte gewinnt), Status queued', async () => {
        const { queue, spawner, recorder } = fakeQueue();
        queue.request({ ...FAKE_REQUEST, mainFile: '/p/erster.tex' });
        queue.request({ ...FAKE_REQUEST, mainFile: '/p/zweiter.tex' });
        queue.request({ ...FAKE_REQUEST, mainFile: '/p/dritter.tex' });
        expect(spawner.children).toHaveLength(1);
        expect(queue.currentState).toBe('queued');
        finishChild(spawner.children[0] as FakeChild);
        finishChild(await spawner.spawned(2));
        await queue.whenIdle();
        expect(spawner.lastFile()).toEqual(['erster.tex', 'dritter.tex']);
        expect(recorder.statuses()).toEqual(['running', 'queued', 'running', 'idle']);
        expect(recorder.finished()).toEqual([
            { ok: true, cancelled: false, report: [], pdfPath: null, durationMs: expect.any(Number) },
            { ok: true, cancelled: false, report: [], pdfPath: null, durationMs: expect.any(Number) },
        ]);
    });

    it('Abbrechen verwirft den vorgemerkten Auftrag; ein Auftrag während des Abbruchs geht nicht verloren', async () => {
        const { queue, spawner, recorder, signals } = fakeQueue();
        queue.request(FAKE_REQUEST);
        queue.request({ ...FAKE_REQUEST, mainFile: '/p/vorgemerkt.tex' });
        const cancelled = queue.cancel();
        expect(queue.currentState).toBe('cancelling');
        expect(signals).toEqual([{ pid: -FIRST_FAKE_PID, signal: 'SIGTERM' }]);
        queue.request({ ...FAKE_REQUEST, mainFile: '/p/neu.tex' });
        finishChild(spawner.children[0] as FakeChild, null, 'SIGTERM');
        await cancelled;
        finishChild(await spawner.spawned(2));
        await queue.whenIdle();
        expect(spawner.lastFile()).toEqual(['main.tex', 'neu.tex']);
        expect(recorder.statuses()).toEqual(['running', 'queued', 'cancelling', 'queued', 'running', 'idle']);
        expect(recorder.finished().map(({ ok, cancelled: wasCancelled }) => ({ ok, wasCancelled }))).toEqual([
            { ok: false, wasCancelled: true },
            { ok: true, wasCancelled: false },
        ]);
    });

    it('Abbrechen ohne Folgeauftrag: abgebrochen, kein PDF, danach idle; ohne Lauf tut es nichts', async () => {
        const { queue, spawner, recorder } = fakeQueue({ stat: freshStat });
        await queue.cancel();
        expect(recorder.statuses()).toEqual([]);
        queue.request(FAKE_REQUEST);
        const cancelled = queue.cancel();
        finishChild(spawner.children[0] as FakeChild, null, 'SIGTERM');
        await cancelled;
        await queue.whenIdle();
        expect(recorder.finished()).toEqual([{ ok: false, cancelled: true, report: [], pdfPath: null, durationMs: expect.any(Number) }]);
        expect(recorder.statuses()).toEqual(['running', 'cancelling', 'idle']);
        expect(spawner.children).toHaveLength(1);
    });

    it('FakeChild ohne close nach exit (Enkel hält die Pipe): Abschluss nach der Frist, Gruppe mitgenommen, Problem gemeldet', async () => {
        const log = vi.fn();
        const { queue, spawner, recorder, signals } = fakeQueue({ log });
        queue.request(FAKE_REQUEST);
        const child = spawner.children[0] as FakeChild;
        child.emit('exit', 0, null);
        await queue.whenIdle();
        expect(recorder.finished()).toEqual([
            { ok: true, cancelled: false, report: [{ severity: 'warning', message: BUILD_MESSAGES.outputHeldAfterExit, file: null, line: null }], pdfPath: null, durationMs: expect.any(Number) },
        ]);
        expect(child.stdout.destroyed && child.stderr.destroyed).toBe(true);
        expect(signals).toEqual([{ pid: -FIRST_FAKE_PID, signal: 'SIGKILL' }]);
        expect(log).toHaveBeenCalledWith(BUILD_MESSAGES.outputHeldAfterExit);
    });

    it('Abbruch ohne exit und close (taskkill wirkungslos): nach der Frist „unbestätigt“, Warteschlange frei', async () => {
        const { queue, spawner, recorder } = fakeQueue();
        queue.request(FAKE_REQUEST);
        await queue.cancel();
        await queue.whenIdle();
        expect(recorder.finished()[0]).toMatchObject({ cancelled: true, report: [{ message: BUILD_MESSAGES.cancelUnconfirmed }] });
        expect(queue.currentState).toBe('idle');
        expect(queue.request(FAKE_REQUEST)).toBe(true);
        expect(spawner.children).toHaveLength(2);
    });

    it('Start verweigert (MiKTeX ohne Perl): build:finished mit Fehlermeldung, kein Prozess', async () => {
        const { queue, spawner, recorder } = fakeQueue();
        queue.request({ ...FAKE_REQUEST, problems: [{ tool: 'perl', message: 'x' }] });
        await queue.whenIdle();
        expect(spawner.children).toHaveLength(0);
        expect(recorder.finished()).toEqual([
            { ok: false, cancelled: false, report: [{ severity: 'error', message: BUILD_MESSAGES.perlMissing, file: null, line: null }], pdfPath: null, durationMs: 0 },
        ]);
    });
});

describe('Log-Hook und PDF', () => {
    it('Erfolg: parseLog bekommt <Hauptdatei>.log, Meldungen im Bericht, pdfPath neben der Hauptdatei', async () => {
        const parseLog = vi.fn(() => Promise.resolve([PARSED_WARNING]));
        const { queue, spawner, recorder } = fakeQueue({ parseLog, stat: freshStat });
        queue.request(FAKE_REQUEST);
        finishChild(spawner.children[0] as FakeChild);
        await queue.whenIdle();
        expect(parseLog).toHaveBeenCalledWith('/p/main.log');
        expect(recorder.finished()).toEqual([{ ok: true, cancelled: false, report: [PARSED_WARNING], pdfPath: '/p/main.pdf', durationMs: expect.any(Number) }]);
    });

    it('Fehlschlag mit altem Log: Log nicht ausgewertet, Hinweis mit Exit-Code', async () => {
        const parseLog = vi.fn(() => Promise.resolve([PARSED_WARNING]));
        const { queue, spawner, recorder } = fakeQueue({ parseLog, stat: staleStat });
        queue.request(FAKE_REQUEST);
        finishChild(spawner.children[0] as FakeChild, 12);
        await queue.whenIdle();
        expect(parseLog).not.toHaveBeenCalled();
        expect(recorder.finished()[0]).toMatchObject({ ok: false, report: [{ severity: 'error', message: BUILD_MESSAGES.exitFailed('Exit-Code 12') }] });
    });

    it('Fehler aus dem Log machen den Build ungültig, auch bei Exit 0; ohne Hinweis doppelt', async () => {
        const error: BuildIssue = { severity: 'error', message: 'Undefined control sequence.', file: '/p/main.tex', line: 2 };
        const { queue, spawner, recorder } = fakeQueue({ parseLog: () => Promise.resolve([error]), stat: freshStat });
        queue.request(FAKE_REQUEST);
        finishChild(spawner.children[0] as FakeChild, 0);
        queue.request(FAKE_REQUEST);
        finishChild(await spawner.spawned(2), 1);
        await queue.whenIdle();
        expect(recorder.finished().map((event) => [event.ok, event.report])).toEqual([[false, [error]], [false, [error]]]);
    });

    it('wirft der Parser, steht eine Warnung im Bericht statt eines Absturzes', async () => {
        const { queue, spawner, recorder } = fakeQueue({ parseLog: () => Promise.reject(new Error('kaputt')), stat: freshStat });
        queue.request(FAKE_REQUEST);
        finishChild(spawner.children[0] as FakeChild);
        await queue.whenIdle();
        expect(recorder.finished()[0]?.report).toEqual([{ severity: 'warning', message: BUILD_MESSAGES.logUnreadable('kaputt'), file: null, line: null }]);
    });
});

describe('Aufräumen und Beenden (künstlich)', () => {
    it('latexmk -c nur ohne laufenden Build; kein build:finished; Build danach normal', async () => {
        const { queue, spawner, recorder } = fakeQueue();
        queue.request(FAKE_REQUEST);
        expect(await queue.clean(FAKE_REQUEST)).toEqual({ kind: 'rejected', reason: 'busy', message: BUILD_MESSAGES.cleanBusy });
        finishChild(spawner.children[0] as FakeChild);
        await queue.whenIdle();
        const cleaning = queue.clean({ ...FAKE_REQUEST, mainFile: '/p/-x.tex' });
        expect(spawner.calls[1]?.args).toEqual(['-c', '-cd', './-x.tex']);
        queue.request(FAKE_REQUEST);
        expect(queue.currentState).toBe('queued');
        finishChild(spawner.children[1] as FakeChild);
        expect(await cleaning).toMatchObject({ kind: 'finished', exitCode: 0 });
        finishChild(await spawner.spawned(3));
        await queue.whenIdle();
        expect(recorder.finished()).toHaveLength(2);
    });

    it('shutdown: bricht ab, verwirft Vorgemerktes, nimmt nichts mehr an', async () => {
        const { queue, spawner, recorder } = fakeQueue();
        queue.request(FAKE_REQUEST);
        queue.request(FAKE_REQUEST);
        const stopping = queue.shutdown();
        finishChild(spawner.children[0] as FakeChild, null, 'SIGTERM');
        await stopping;
        expect(queue.request(FAKE_REQUEST)).toBe(false);
        expect(await queue.clean(FAKE_REQUEST)).toMatchObject({ kind: 'rejected', message: BUILD_MESSAGES.shuttingDown });
        expect(spawner.children).toHaveLength(1);
        expect(recorder.finished()).toEqual([expect.objectContaining({ cancelled: true })]);
        expect(queue.currentState).toBe('idle');
    });
});

// ---------- echte Prozesse mit Fake-latexmk ----------

const ownPids = new Set<number>();
let workDir = '';

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

// Ein verwaister Enkel wird von launchd/init übernommen und erst kurz danach eingesammelt (bis dahin Zombie).
async function waitUntilGone(pid: number): Promise<boolean> {
    const deadline = Date.now() + GONE_CHECK_LIMIT_MS;
    while (isAlive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, GONE_CHECK_STEP_MS));
    return !isAlive(pid);
}

interface FakeRun {
    readonly runner: BuildRunner;
    readonly lines: { line: string; stream: OutputStream }[];
    readonly states: BuildState[];
    readonly spawnCount: () => number;
    readonly waitForLine: (prefix: string) => Promise<string>;
    readonly start: () => Promise<BuildOutcome>;
}

function fakeRun(control: readonly string[]): FakeRun {
    const lines: { line: string; stream: OutputStream }[] = [];
    const states: BuildState[] = [];
    const waiters: { prefix: string; resolve: (line: string) => void }[] = [];
    let spawned = 0;
    const spawn: SpawnFunction = (_command, args, options) => {
        spawned++;
        const child = nodeSpawn(process.execPath, [FAKE_LATEXMK, ...control, ...args], options);
        if (child.pid !== undefined) ownPids.add(child.pid);
        return child;
    };
    const onLine = (line: string, stream: OutputStream): void => {
        lines.push({ line, stream });
        if (line.startsWith(GRANDCHILD_PREFIX)) ownPids.add(Number(line.slice(GRANDCHILD_PREFIX.length)));
        waiters.filter((waiter) => line.startsWith(waiter.prefix)).forEach((waiter) => waiter.resolve(line));
    };
    const runner = new BuildRunner({ ...defaultBuildDependencies(), spawn }, { onLine, onStatus: (state) => states.push(state) });
    const request: BuildRequest = { latexmk: join(workDir, 'bin', 'latexmk'), mainFile: join(workDir, 'main.tex'), options: PDFLATEX };
    const waitForLine = (prefix: string): Promise<string> => {
        const earlier = lines.find((entry) => entry.line.startsWith(prefix));
        if (earlier !== undefined) return Promise.resolve(earlier.line);
        return new Promise((resolve) => waiters.push({ prefix, resolve }));
    };
    return { runner, lines, states, spawnCount: () => spawned, waitForLine, start: () => runner.start(request) };
}

beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'latexeditor-build-'));
});

// Aufräumen nur über eigene PIDs (Kind und gemeldeter Enkel), nie über Namen.
afterEach(() => {
    for (const pid of ownPids) {
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // schon beendet
        }
    }
    ownPids.clear();
});

afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
});

describe('Build mit Fake-latexmk', () => {
    it('Erfolg: Argumente, Arbeitsordner, PATH, Ausgabe zeilenweise, Status running → idle', async () => {
        const run = fakeRun(['--fake-lines=3', '--fake-stderr']);
        const outcome = await run.start();
        expect(outcome).toMatchObject({ kind: 'finished', ok: true, cancelled: false, exitCode: 0 });
        const stdout = run.lines.filter((entry) => entry.stream === 'stdout').map((entry) => entry.line);
        expect(stdout).toContain(`ARGS ${JSON.stringify(buildArguments('main.tex', PDFLATEX, process.platform))}`);
        expect(stdout).toContain(`CWD ${await realpath(workDir)}`);
        expect(stdout).toContain(`PATH0 ${join(workDir, 'bin')}`);
        expect(stdout).toContain('MAX_PRINT_LINE 10000');
        expect(stdout.filter((line) => line.startsWith('Zeile'))).toEqual(['Zeile 1', 'Zeile 2', 'Zeile 3']);
        expect(stdout.at(-1)).toBe('Ende ohne Umbruch');
        expect(run.lines).toContainEqual({ line: 'Warnung auf stderr', stream: 'stderr' });
        expect(run.states).toEqual(['running', 'idle']);
    });

    it('Fehlschlag: Exit-Code 12 ergibt ok = false', async () => {
        const outcome = await fakeRun(['--fake-exit=12']).start();
        expect(outcome).toMatchObject({ kind: 'finished', ok: false, cancelled: false, exitCode: 12 });
    });

    it('nicht vorhandenes latexmk: Startfehler statt Absturz', async () => {
        const runner = new BuildRunner();
        const outcome = await runner.start({ latexmk: join(workDir, 'fehlt', 'latexmk'), mainFile: join(workDir, 'main.tex'), options: PDFLATEX });
        expect(outcome).toMatchObject({ kind: 'rejected', reason: 'launchFailed' });
        expect(runner.currentState).toBe('idle');
    });

    it('kein zweiter paralleler Lauf; Ausgabe kommt schon während des Laufs', async () => {
        const run = fakeRun([`--fake-hang-ms=${LONG_DOCUMENT_MS}`]);
        const first = run.start();
        await run.waitForLine('läuft');
        expect(await run.start()).toEqual({ kind: 'rejected', reason: 'busy', message: BUILD_MESSAGES.busy });
        expect(run.spawnCount()).toBe(1);
        await run.runner.cancel();
        expect(await first).toMatchObject({ cancelled: true });
    });

    it.each([
        ['Enkel endet mit SIGTERM', ['--fake-grandchild']],
        ['Enkel ignoriert SIGTERM (SIGKILL-Nachschlag)', ['--fake-grandchild', '--fake-grandchild-ignores-term']],
    ])('Abbruch eines 40-s-Dokuments in < 3 s, Kind und Enkel verschwunden: %s', async (name, extra) => {
        const run = fakeRun([`--fake-hang-ms=${LONG_DOCUMENT_MS}`, ...extra]);
        const outcome = run.start();
        const grandchildPid = Number((await run.waitForLine(GRANDCHILD_PREFIX)).slice(GRANDCHILD_PREFIX.length));
        await run.waitForLine('läuft');
        const childPid = [...ownPids].find((pid) => pid !== grandchildPid) ?? -1;
        expect(isAlive(childPid) && isAlive(grandchildPid)).toBe(true);

        const started = Date.now();
        await run.runner.cancel();
        const childGone = await waitUntilGone(childPid);
        const grandchildGone = await waitUntilGone(grandchildPid);
        const elapsed = Date.now() - started;
        console.log(`Abbruch (${name}): ${elapsed} ms`);

        expect(childGone && grandchildGone).toBe(true);
        expect(elapsed).toBeLessThan(CANCEL_BUDGET_MS);
        expect(await outcome).toMatchObject({ kind: 'finished', ok: false, cancelled: true });
        expect(run.states).toEqual(['running', 'cancelling', 'idle']);
    });

    it('Abbrechen ohne laufenden Build tut nichts', async () => {
        const run = fakeRun([]);
        await run.runner.cancel();
        expect(run.states).toEqual([]);
    });
});

function fakeLatexmkSpawn(control: readonly string[]): SpawnFunction {
    return (_command, args, options) => {
        const child = nodeSpawn(process.execPath, [FAKE_LATEXMK, ...control, ...args], options);
        if (child.pid !== undefined) ownPids.add(child.pid);
        return child;
    };
}

function lineWatcher() {
    const lines: string[] = [];
    const waiters: { prefix: string; resolve: (line: string) => void }[] = [];
    const onLine = (line: string): void => {
        lines.push(line);
        if (line.startsWith(GRANDCHILD_PREFIX)) ownPids.add(Number(line.slice(GRANDCHILD_PREFIX.length)));
        waiters.filter((waiter) => line.startsWith(waiter.prefix)).forEach((waiter) => waiter.resolve(line));
    };
    const waitFor = (prefix: string): Promise<string> => {
        const earlier = lines.find((line) => line.startsWith(prefix));
        return earlier !== undefined ? Promise.resolve(earlier) : new Promise((resolve) => waiters.push({ prefix, resolve }));
    };
    return { onLine, waitFor };
}

function fakeMainRequest(): BuildRequest {
    return { latexmk: join(workDir, 'bin', 'latexmk'), mainFile: join(workDir, 'main.tex'), options: PDFLATEX };
}

describe('Ausgabe-Datei und Beenden mit Fake-latexmk', () => {
    it('Ausgabe (stdout und stderr) steht zusätzlich in der Temp-Datei, je Lauf neu', async () => {
        const outputLogPath = join(workDir, 'latexmk-output.txt');
        await writeFile(outputLogPath, 'alter Inhalt\n');
        const runner = new BuildRunner({ ...defaultBuildDependencies(), spawn: fakeLatexmkSpawn(['--fake-lines=2', '--fake-stderr']) });
        const outcome = await runner.start({ ...fakeMainRequest(), outputLogPath });
        expect(outcome).toMatchObject({ kind: 'finished', ok: true, problem: null });
        const written = await readFile(outputLogPath, 'utf8');
        expect(written).not.toContain('alter Inhalt');
        expect(written).toContain('Zeile 2\r\n');
        expect(written).toContain('Warnung auf stderr');
        expect(written.endsWith('Ende ohne Umbruch')).toBe(true);
    });

    it('nicht schreibbare Temp-Datei: Build läuft trotzdem, Problem gemeldet', async () => {
        const runner = new BuildRunner({ ...defaultBuildDependencies(), spawn: fakeLatexmkSpawn([]) });
        const outcome = await runner.start({ ...fakeMainRequest(), outputLogPath: join(workDir, 'fehlt', 'out.txt') });
        expect(outcome).toMatchObject({ kind: 'finished', ok: true, problem: expect.stringContaining('Protokolldatei') });
    });

    it('Beenden der App während eines Builds: QuitTasks brechen ab, Kind und Enkel weg, dann quit()', async () => {
        const watcher = lineWatcher();
        const recorder = eventRecorder();
        const spawn = fakeLatexmkSpawn([`--fake-hang-ms=${LONG_DOCUMENT_MS}`, '--fake-grandchild', '--fake-grandchild-ignores-term']);
        const queue = new BuildQueue({ emit: recorder.emit, dependencies: { ...defaultBuildDependencies(), spawn }, onLine: watcher.onLine });
        const tasks = new QuitTasks();
        tasks.add(() => queue.shutdown());
        queue.request(fakeMainRequest());
        const grandchildPid = Number((await watcher.waitFor(GRANDCHILD_PREFIX)).slice(GRANDCHILD_PREFIX.length));
        await watcher.waitFor('läuft');
        const childPid = [...ownPids].find((pid) => pid !== grandchildPid) ?? -1;
        let quit: () => void = () => undefined;
        const quitCalled = new Promise<void>((resolve) => (quit = resolve));
        const preventDefault = vi.fn();
        const started = Date.now();
        createBeforeQuitHandler({ tasks, quit, log: () => undefined })({ preventDefault });
        await quitCalled;
        const gone = (await waitUntilGone(childPid)) && (await waitUntilGone(grandchildPid));
        console.log(`Abbruch beim Beenden: ${Date.now() - started} ms`);
        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(gone).toBe(true);
        expect(Date.now() - started).toBeLessThan(CANCEL_BUDGET_MS);
        expect(recorder.finished()).toEqual([expect.objectContaining({ ok: false, cancelled: true })]);
        expect(queue.request(fakeMainRequest())).toBe(false);
    });
});

// ---------- echter TeX-Lauf (nur mit LATEXEDITOR_REAL_TEX=1) ----------

function isGroupAlive(groupId: number): boolean {
    if (!HAS_PROCESS_GROUPS) throw new Error('Prozessgruppen gibt es unter Windows nicht');
    return isAlive(-groupId);
}

async function waitUntilGroupGone(groupId: number): Promise<boolean> {
    const deadline = Date.now() + GONE_CHECK_LIMIT_MS;
    while (isGroupAlive(groupId) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, GONE_CHECK_STEP_MS));
    return !isGroupAlive(groupId);
}

describe('Prüfhilfe Prozessgruppe', () => {
    it.runIf(HAS_PROCESS_GROUPS)('erkennt eine lebende eigene Gruppe und ihr Ende (sonst prüfte der Abbruchtest nichts)', async () => {
        const child = nodeSpawn(process.execPath, ['-e', `setTimeout(() => undefined, ${LONG_DOCUMENT_MS})`], {
            detached: true,
            stdio: 'ignore',
        });
        const groupId = child.pid ?? -1;
        ownPids.add(groupId);
        expect(isGroupAlive(groupId)).toBe(true);
        process.kill(-groupId, 'SIGKILL');
        expect(await waitUntilGroupGone(groupId)).toBe(true);
    });

    it.skipIf(HAS_PROCESS_GROUPS)('Windows: Gruppenprüfung verweigert, statt still „weg“ zu melden', () => {
        expect(() => isGroupAlive(1)).toThrow('Prozessgruppen');
    });
});

describe.skipIf(process.env.LATEXEDITOR_REAL_TEX !== '1')('echter latexmk-Lauf auf einer Kopie von HgbDemo', () => {
    it('kompiliert die Demo; einzige Verweis-Warnung ist fig:fehlt', { timeout: REAL_TEX_TIMEOUT_MS }, async () => {
        const tools = await detectTools();
        expect(tools.latexmk).not.toBeNull();
        const copy = await mkdtemp(join(tmpdir(), 'latexeditor-hgbdemo-'));
        try {
            await cp(DEMO_PROJECT, copy, { recursive: true });
            const lines: string[] = [];
            const runner = new BuildRunner(defaultBuildDependencies(), { onLine: (line) => lines.push(line) });
            const mainFile = join(copy, 'main.tex');
            const outcome = await runner.start({ latexmk: tools.latexmk ?? '', mainFile, options: PDFLATEX, problems: tools.problems });
            const log = await readFile(join(copy, 'main.log'), 'latin1');
            const referenceWarnings = log.match(/LaTeX Warning: Reference `[^']+'/g) ?? [];
            console.log(`Echter TeX-Lauf: ${JSON.stringify(outcome)}, ${lines.length} Zeilen, Verweis-Warnungen: ${[...new Set(referenceWarnings)].join(', ')}`);
            expect(outcome).toMatchObject({ kind: 'finished', ok: true });
            expect((await stat(join(copy, 'main.pdf'))).size).toBeGreaterThan(0);
            expect([...new Set(referenceWarnings)]).toEqual(["LaTeX Warning: Reference `fig:fehlt'"]);
        } finally {
            await rm(copy, { recursive: true, force: true });
        }
    });

    it('über die Warteschlange: build:finished mit PDF, Ausgabe-Datei, danach latexmk -c (PDF bleibt)', { timeout: REAL_TEX_TIMEOUT_MS }, async () => {
        const tools = await detectTools();
        const copy = await mkdtemp(join(tmpdir(), 'latexeditor-hgbdemo-'));
        const userData = await mkdtemp(join(tmpdir(), 'latexeditor-userdata-'));
        try {
            await cp(DEMO_PROJECT, copy, { recursive: true });
            const recorder = eventRecorder();
            const queue = new BuildQueue({ emit: recorder.emit });
            const request: BuildRequest = { latexmk: tools.latexmk ?? '', mainFile: join(copy, 'main.tex'), options: PDFLATEX, problems: tools.problems };
            const outputLogPath = join(userData, 'latexmk-output.txt');
            queue.request({ ...request, outputLogPath });
            await queue.whenIdle();
            console.log(`Echter Lauf über die Warteschlange: ${JSON.stringify(recorder.finished())}`);
            expect(recorder.finished()).toEqual([{ ok: true, cancelled: false, report: [], pdfPath: join(copy, 'main.pdf'), durationMs: expect.any(Number) }]);
            expect(await readFile(outputLogPath, 'utf8')).toContain('Latexmk');
            expect(await queue.clean(request)).toMatchObject({ kind: 'finished', exitCode: 0 });
            await expect(stat(join(copy, 'main.aux'))).rejects.toThrow();
            expect((await stat(join(copy, 'main.pdf'))).size).toBeGreaterThan(0);
        } finally {
            await rm(copy, { recursive: true, force: true });
            await rm(userData, { recursive: true, force: true });
        }
    });

    // Windows: die Enkel von latexmk kennt der Test nicht, ihr Ende prüft der Handtest (taskkill /T).
    it.runIf(HAS_PROCESS_GROUPS)('Abbruch eines rund 40 s rechnenden Dokuments: < 3 s, ganze Prozessgruppe weg', { timeout: REAL_TEX_TIMEOUT_MS }, async () => {
        const tools = await detectTools();
        const copy = await mkdtemp(join(tmpdir(), 'latexeditor-slow-'));
        let childPid: number | undefined;
        try {
            await writeFile(join(copy, 'langsam.tex'), SLOW_DOCUMENT);
            const spawn: SpawnFunction = (command, args, options) => {
                const child = nodeSpawn(command, [...args], options);
                childPid = child.pid;
                return child;
            };
            const runner = new BuildRunner({ ...defaultBuildDependencies(), spawn });
            const outcome = runner.start({ latexmk: tools.latexmk ?? '', mainFile: join(copy, 'langsam.tex'), options: PDFLATEX });
            await new Promise((resolve) => setTimeout(resolve, REAL_TEX_WARMUP_MS));
            const started = Date.now();
            await runner.cancel();
            // Negative PID: die ganze Prozessgruppe des eigenen Kindes
            const groupGone = await waitUntilGroupGone(childPid ?? 0);
            const elapsed = Date.now() - started;
            console.log(`Echter Abbruch: ${elapsed} ms, ${JSON.stringify(await outcome)}`);
            expect(groupGone).toBe(true);
            expect(elapsed).toBeLessThan(CANCEL_BUDGET_MS);
        } finally {
            if (childPid !== undefined && isGroupAlive(childPid)) process.kill(-childPid, 'SIGKILL');
            await rm(copy, { recursive: true, force: true });
        }
    });
});
