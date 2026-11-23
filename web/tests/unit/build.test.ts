import { spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { cp, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
    BUILD_MESSAGES,
    buildArguments,
    buildEnvironment,
    type BuildDependencies,
    type BuildOutcome,
    BuildRunner,
    type BuildRequest,
    createLineSplitter,
    defaultBuildDependencies,
    killPlanFor,
    launchBlocker,
    type OutputStream,
    type SpawnFunction,
    spawnOptionsFor,
} from '../../src/main/build';
import { detectTools } from '../../src/main/tools';
import type { BuildState } from '../../src/shared/contract';

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
