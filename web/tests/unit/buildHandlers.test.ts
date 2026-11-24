import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type BuildDependencies, defaultBuildDependencies, type SpawnFunction } from '../../src/main/build';
import { GrantStore } from '../../src/main/grants';
import {
    BUILD_HANDLER_MESSAGES,
    BUILD_OUTPUT_FILE_NAME,
    type BuildHandlers,
    createBuildHandlers,
} from '../../src/main/handlers/buildHandlers';
import type { EventSender } from '../../src/main/ipc';
import { QuitTasks } from '../../src/main/lifecycle';
import { currentPathPlatform } from '../../src/main/paths';
import type { IpcEvents, ToolsInfo } from '../../src/shared/contract';

const PDFLATEX = { engine: 'pdflatex' } as const;
const FAKE_PID = 4711;
const FAKE_TOOLS: ToolsInfo = { latexmk: '/tex/bin/latexmk', git: null, synctexRef: null, distro: 'texlive', problems: [] };

class FakeChild extends EventEmitter {
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    readonly pid = FAKE_PID;
}

let base: string;
let project: string;
let outside: string;

beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'build-handlers-')));
    project = join(base, 'Projekt');
    outside = join(base, 'Fremd');
    await mkdir(project);
    await mkdir(outside);
    await writeFile(join(project, 'main.tex'), '\\documentclass{article}\n');
    await writeFile(join(project, 'notizen.txt'), 'x\n');
    await writeFile(join(outside, 'fremd.tex'), '\\documentclass{article}\n');
});

afterEach(async () => {
    await rm(base, { recursive: true, force: true });
});

interface Setup {
    readonly handlers: BuildHandlers;
    readonly grants: GrantStore;
    readonly quitTasks: QuitTasks;
    readonly children: FakeChild[];
    readonly calls: { command: string; args: readonly string[]; cwd: unknown }[];
    readonly events: { event: string; payload: unknown }[];
}

// Gefälschter Prozessstart und gefälschte Signale: kein echter latexmk, keine echten PIDs.
function setup(tools: ToolsInfo = FAKE_TOOLS, openProject = true): Setup {
    const grants = new GrantStore({ platform: currentPathPlatform() });
    if (openProject) grants.openProject(grants.grant(project, 'project').grantId);
    const children: FakeChild[] = [];
    const calls: Setup['calls'] = [];
    const spawn: SpawnFunction = (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd });
        const child = new FakeChild();
        children.push(child);
        return child;
    };
    const buildDependencies: BuildDependencies = { ...defaultBuildDependencies(), spawn, signal: () => undefined };
    const events: Setup['events'] = [];
    const emit: EventSender = (event, payload) => void events.push({ event, payload });
    const quitTasks = new QuitTasks();
    const handlers = createBuildHandlers({
        grants, emit, quitTasks, userDataDir: base, log: () => undefined, buildDependencies, detectTools: () => Promise.resolve(tools),
    });
    return { handlers, grants, quitTasks, children, calls, events };
}

function finishChild(child: FakeChild | undefined, code: number | null = 0): void {
    child?.emit('exit', code, null);
    child?.emit('close', code, null);
}

async function errorOf(action: () => Promise<unknown>): Promise<{ kind: string; message: string } | null> {
    try {
        await action();
        return null;
    } catch (error) {
        return (error as { error?: { kind: string; message: string } }).error ?? { kind: 'other', message: String(error) };
    }
}

// Die Warteschlange arbeitet über Promises weiter; der Test lässt die Ereignisschleife laufen, bis es so weit ist.
async function waitFor(condition: () => boolean): Promise<void> {
    while (!condition()) await new Promise((resolve) => setImmediate(resolve));
}

function lastState(events: Setup['events']): string | undefined {
    const statuses = events.filter((entry) => entry.event === 'build:status');
    return (statuses.at(-1)?.payload as IpcEvents['build:status'] | undefined)?.state;
}

describe('tools:detect', () => {
    it('liefert das Ergebnis der Werkzeugsuche, build:start nutzt es', async () => {
        const { handlers, calls, children } = setup();
        expect(await handlers['tools:detect']()).toEqual(FAKE_TOOLS);
        await handlers['build:start'](join(project, 'main.tex'), PDFLATEX);
        expect(calls[0]).toMatchObject({ command: FAKE_TOOLS.latexmk, cwd: project });
        expect(calls[0]?.args.at(-1)).toBe('main.tex');
        finishChild(children[0]);
    });

    it('ohne latexmk: build:start mit der Meldung der Werkzeugsuche abgelehnt, kein Prozess', async () => {
        const missing: ToolsInfo = { ...FAKE_TOOLS, latexmk: null, problems: [{ tool: 'latexmk', message: 'bitte installieren' }] };
        const { handlers, calls } = setup(missing);
        expect(await errorOf(() => handlers['build:start'](join(project, 'main.tex'), PDFLATEX))).toEqual({
            kind: 'notFound', message: 'bitte installieren',
        });
        expect(calls).toHaveLength(0);
    });
});

describe('build:start nur für die Hauptdatei im Projekt', () => {
    it.each([
        ['außerhalb des Projekts', () => join(outside, 'fremd.tex'), 'forbiddenPath'],
        ['mit „..“ aus dem Projekt heraus', () => join(project, '..', 'Fremd', 'fremd.tex'), 'forbiddenPath'],
        ['eine Gewährung statt eines Pfads', () => 'grant-1234', 'forbiddenPath'],
        ['keine .tex-Datei', () => join(project, 'notizen.txt'), 'invalidInput'],
    ])('abgelehnt: %s', async (_name, target, kind) => {
        const { handlers, calls } = setup();
        expect(await errorOf(() => handlers['build:start'](target(), PDFLATEX))).toMatchObject({ kind });
        expect(await errorOf(() => handlers['build:clean'](target()))).toMatchObject({ kind });
        expect(calls).toHaveLength(0);
    });

    it('ohne geöffnetes Projekt abgelehnt', async () => {
        const { handlers, calls } = setup(FAKE_TOOLS, false);
        expect(await errorOf(() => handlers['build:start'](join(project, 'main.tex'), PDFLATEX))).toMatchObject({ kind: 'notFound' });
        expect(calls).toHaveLength(0);
    });
});

describe('Ereignisse und Abbruch', () => {
    it('build:status und build:finished kommen über emit an', async () => {
        const { handlers, children, events } = setup();
        await handlers['build:start'](join(project, 'main.tex'), PDFLATEX);
        await handlers['build:start'](join(project, 'main.tex'), PDFLATEX);
        expect(events.map((entry) => entry.event)).toEqual(['build:status', 'build:status']);
        expect(events[0]?.payload).toEqual({ state: 'running', startedAt: expect.any(Number) });
        expect(events[1]?.payload).toMatchObject({ state: 'queued' });
        finishChild(children[0]);
        await waitFor(() => children.length === 2);
        finishChild(children[1]);
        await waitFor(() => lastState(events) === 'idle');
        const finished = events.filter((entry) => entry.event === 'build:finished').map((entry) => entry.payload);
        expect(finished).toEqual([
            { ok: true, cancelled: false, report: [], pdfPath: null, durationMs: expect.any(Number) },
            { ok: true, cancelled: false, report: [], pdfPath: null, durationMs: expect.any(Number) },
        ]);
    });

    it('build:cancel bricht ab; das Beenden der App (QuitTasks) ebenso, danach startet nichts mehr', async () => {
        const { handlers, children, events, quitTasks } = setup();
        expect(quitTasks.size).toBe(1);
        await handlers['build:start'](join(project, 'main.tex'), PDFLATEX);
        const cancelled = handlers['build:cancel']();
        finishChild(children[0], null);
        await cancelled;
        await handlers['build:start'](join(project, 'main.tex'), PDFLATEX);
        await waitFor(() => children.length === 2);
        const quitting = quitTasks.runAll(() => undefined);
        finishChild(children[1], null);
        await quitting;
        const finished = events.filter((entry) => entry.event === 'build:finished').map((entry) => entry.payload);
        expect(finished).toEqual([expect.objectContaining({ cancelled: true }), expect.objectContaining({ cancelled: true })]);
        expect(await errorOf(() => handlers['build:start'](join(project, 'main.tex'), PDFLATEX))).toMatchObject({ kind: 'conflict' });
    });

    it('Ausgabe-Datei liegt im App-Datenordner', async () => {
        const { handlers, children, events } = setup();
        await handlers['build:start'](join(project, 'main.tex'), PDFLATEX);
        children[0]?.stdout.end('Latexmk: fertig\n');
        await new Promise((resolve) => setImmediate(resolve));
        finishChild(children[0]);
        await waitFor(() => lastState(events) === 'idle');
        expect(await readFile(join(base, BUILD_OUTPUT_FILE_NAME), 'utf8')).toBe('Latexmk: fertig\n');
    });
});

describe('build:clean', () => {
    it('während eines Builds abgelehnt; Exit-Code ≠ 0 wird gemeldet; Erfolg ohne Fehler', async () => {
        const { handlers, children, calls, events } = setup();
        await handlers['build:start'](join(project, 'main.tex'), PDFLATEX);
        expect(await errorOf(() => handlers['build:clean'](join(project, 'main.tex')))).toMatchObject({ kind: 'conflict' });
        finishChild(children[0]);
        await waitFor(() => lastState(events) === 'idle');
        const failing = handlers['build:clean'](join(project, 'main.tex'));
        await waitFor(() => children.length === 2);
        finishChild(children[1], 3);
        expect(await errorOf(() => failing)).toEqual({ kind: 'io', message: BUILD_HANDLER_MESSAGES.cleanFailed('Exit-Code 3') });
        expect(calls[1]?.args).toEqual(['-c', '-cd', 'main.tex']);
        const succeeding = handlers['build:clean'](join(project, 'main.tex'));
        await waitFor(() => children.length === 3);
        finishChild(children[2]);
        await expect(succeeding).resolves.toBeUndefined();
    });
});
