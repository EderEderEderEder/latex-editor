import { spawn as nodeSpawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { GitStatus } from '../../src/shared/contract';
import {
    checkedOutput,
    defaultGitProcessDependencies,
    findGit,
    GIT_RUNNER_MESSAGES,
    type GitContext,
    type GitProcessDependencies,
    GitQueue,
    GitService,
    runChecked,
    runGit,
} from '../../src/main/git';
import { GrantStore } from '../../src/main/grants';
import { createGitHandlers } from '../../src/main/handlers/gitHandlers';
import { currentPathPlatform } from '../../src/main/paths';
import { IpcFailure } from '../../src/shared/ipcResult';

// Git-Runner mit echten, temporären Repositories (nie ein echtes Repository des Nutzers). Die Konfiguration
// des Nutzers bleibt unberührt: `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` zeigen auf eine leere Datei, die Identität
// kommt per `-c`, `GIT_CEILING_DIRECTORIES` verhindert, dass git über den Temp-Ordner hinaus sucht.

const GIT = await findGit();
const PLATFORM = currentPathPlatform();
const IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];
const AUTOCRLF = ['-c', 'core.autocrlf=true'];
// Dieselbe Einstellung für den Dienst, ohne Konfigurationsdatei (wie `-c`)
const AUTOCRLF_ENV = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.autocrlf', GIT_CONFIG_VALUE_0: 'true' };
const MTIME_SHIFT_SECONDS = 10;
const HANG_TIMEOUT_MS = 1_000;
const CANCEL_BUDGET_MS = 3_000;
const GONE_CHECK_LIMIT_MS = 1_000;
const GONE_CHECK_STEP_MS = 20;
const GRANDCHILD_PREFIX = 'GRANDCHILD ';

// Hängendes Fake-Git: startet einen Enkel (gleiche Prozessgruppe), meldet dessen PID und wartet.
const HANGING_GIT = [
    "const { spawn } = require('node:child_process');",
    "const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 60000);'], { stdio: 'ignore' });",
    "process.stdout.write('GRANDCHILD ' + grandchild.pid + '\\n');",
    'setInterval(() => {}, 1000);',
    'setTimeout(() => process.exit(0), 60000);',
].join('\n');

let base: string;
let isolation: Record<string, string>;
const cleanups: string[] = [];

beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'git-runner-'));
    const emptyConfig = join(base, 'leer.gitconfig');
    await writeFile(emptyConfig, '');
    isolation = {
        GIT_CONFIG_GLOBAL: emptyConfig,
        GIT_CONFIG_SYSTEM: emptyConfig,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CEILING_DIRECTORIES: await realpath(base),
    };
});

afterAll(async () => {
    await rm(base, { recursive: true, force: true });
});

afterEach(async () => {
    for (const folder of cleanups.splice(0)) await rm(folder, { recursive: true, force: true });
});

function context(extraEnv: Record<string, string> = {}): GitContext {
    return { git: GIT ?? '', platform: PLATFORM, extraEnv: { ...isolation, ...extraEnv } };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
    return (await runChecked(context(), [...IDENTITY, ...args], cwd)).toString('utf8');
}

// Ordner unter dem Temp-Ordner in der Form von `tmpdir()` (macOS: `/var/…`, git meldet `/private/var/…`).
async function temporaryFolder(): Promise<string> {
    const folder = await mkdtemp(join(base, 'repo-'));
    cleanups.push(folder);
    return folder;
}

async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
    for (const [name, text] of Object.entries(files)) {
        await mkdir(dirname(join(root, name)), { recursive: true });
        await writeFile(join(root, name), text);
    }
}

async function repositoryWith(files: Record<string, string>, configArgs: string[] = []): Promise<string> {
    const root = await temporaryFolder();
    await git(root, 'init', '-q');
    await writeFiles(root, files);
    await git(root, ...configArgs, 'add', '-A');
    await git(root, ...configArgs, 'commit', '-q', '-m', 'Anfang');
    return root;
}

// Inhalt gleich, Zeitstempel neu: ein normales `git status` würde den Index auffrischen und neu schreiben.
async function touch(file: string): Promise<void> {
    const later = new Date(Date.now() + MTIME_SHIFT_SECONDS * 1000);
    await utimes(file, later, later);
}

function service(extraEnv: Record<string, string> = {}, process?: GitProcessDependencies): GitService {
    return new GitService({
        platform: PLATFORM,
        locate: () => Promise.resolve(GIT),
        extraEnv: { ...isolation, ...extraEnv },
        ...(process && { process }),
    });
}

function relativeEntries(status: GitStatus, root: string) {
    return status.entries.map((entry) => ({
        path: entry.path.slice(root.length + 1).normalize('NFC'),
        originalPath: entry.originalPath?.slice(root.length + 1).normalize('NFC') ?? null,
        staged: entry.staged,
        unstaged: entry.unstaged,
    }));
}

async function errorOf(promise: Promise<unknown>): Promise<IpcFailure['error']> {
    const failure = await promise.then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(IpcFailure);
    return (failure as IpcFailure).error;
}

describe.skipIf(GIT === null)('Git-Runner mit temporären Repositories', () => {
    it('Status verändert den Index nicht (optionale Sperren aus); ohne die Sperre würde git ihn neu schreiben', async () => {
        const root = await repositoryWith({ 'a.tex': 'a\n' });
        await touch(join(root, 'a.tex'));
        const index = join(root, '.git', 'index');
        const before = await readFile(index);
        const status = await service().status(root);
        expect(status.entries).toEqual([]);
        expect((await readFile(index)).equals(before)).toBe(true);
        // Gegenprobe: mit optionalen Sperren schreibt dasselbe `git status` den Index neu.
        await runChecked(context({ GIT_OPTIONAL_LOCKS: '1' }), ['status', '--porcelain=v2'], root);
        expect((await readFile(index)).equals(before)).toBe(false);
    });

    it('Zweig, geändert, bereitgestellt, nicht versioniert mit Umlauten; Ignoriertes fehlt; Pfade in der Projektform', async () => {
        const root = await repositoryWith({ 'kapitel/Größe.tex': 'g\n', '.gitignore': '*.aux\n' });
        await writeFiles(root, { 'kapitel/Größe.tex': 'G\n', 'neu ä.tex': 'n\n', 'main.aux': 'x\n', 'bilder/ß.tex': 's\n' });
        await git(root, 'add', 'bilder/ß.tex');
        const status = await service().status(root);
        expect(status).toMatchObject({ branch: 'main', upstream: null, ahead: 0, behind: 0, stagedOutsideProject: 0 });
        expect(status.commit).toMatch(/^[0-9a-f]{40,64}$/);
        expect(status.entries.every((entry) => entry.path.startsWith(root + PLATFORM.path.sep))).toBe(true);
        expect(relativeEntries(status, root)).toEqual([
            { path: 'bilder/ß.tex', originalPath: null, staged: 'added', unstaged: null },
            { path: 'kapitel/Größe.tex', originalPath: null, staged: null, unstaged: 'modified' },
            { path: 'neu ä.tex', originalPath: null, staged: null, unstaged: 'untracked' },
        ]);
    });

    it('Umbenennung mit git mv: neuer Pfad mit ursprünglichem Pfad, bereitgestellt', async () => {
        const root = await repositoryWith({ 'alt.tex': 'Inhalt\n' });
        await git(root, 'mv', 'alt.tex', 'neu name.tex');
        expect(relativeEntries(await service().status(root), root)).toEqual([
            { path: 'neu name.tex', originalPath: 'alt.tex', staged: 'renamed', unstaged: null },
        ]);
    });

    it('CRLF-Datei unter core.autocrlf=true (nur für diesen Aufruf): keine Scheinänderung, Index byte-gleich', async () => {
        const root = await repositoryWith({ 'crlf.tex': 'a\r\nb\r\n' }, AUTOCRLF);
        await touch(join(root, 'crlf.tex'));
        const index = join(root, '.git', 'index');
        const before = await readFile(index);
        expect((await service(AUTOCRLF_ENV).status(root)).entries).toEqual([]);
        expect((await readFile(index)).equals(before)).toBe(true);
        expect(await readFile(join(root, 'crlf.tex'), 'utf8')).toBe('a\r\nb\r\n');
    });

    it('Projekt im Unterordner: nur dessen Dateien, Bereitgestelltes außerhalb wird gezählt', async () => {
        const root = await repositoryWith({ 'README.md': 'r\n', 'thesis/main.tex': 'm\n', 'thesis-alt/main.tex': 'a\n' });
        await writeFiles(root, { 'README.md': 'R\n', 'thesis/main.tex': 'M\n', 'thesis-alt/main.tex': 'A\n' });
        await git(root, 'add', 'README.md');
        const project = join(root, 'thesis');
        const status = await service().status(project);
        expect(status.stagedOutsideProject).toBe(1);
        expect(status.entries).toEqual([{ path: join(project, 'main.tex'), originalPath: null, staged: null, unstaged: 'modified' }]);
    });

    it('neues Repository ohne Commit: commit null, Zweig bekannt', async () => {
        const root = await temporaryFolder();
        await git(root, 'init', '-q');
        await writeFiles(root, { 'main.tex': 'm\n' });
        const status = await service().status(root);
        expect(status).toMatchObject({ branch: 'main', commit: null });
        expect(relativeEntries(status, root)).toEqual([{ path: 'main.tex', originalPath: null, staged: null, unstaged: 'untracked' }]);
    });

    it('kein Repository: notARepository; später angelegt: wird gefunden; ohne Git: gitMissing', async () => {
        const folder = await temporaryFolder();
        const runner = service();
        expect(await errorOf(runner.status(folder))).toEqual({ kind: 'notARepository', message: GIT_RUNNER_MESSAGES.notARepository });
        await git(folder, 'init', '-q');
        expect((await runner.status(folder)).entries).toEqual([]);
        const withoutGit = new GitService({ platform: PLATFORM, locate: () => Promise.resolve(null) });
        expect((await errorOf(withoutGit.status(folder))).kind).toBe('gitMissing');
    });

    it('gleichzeitige Statusabfragen teilen sich einen Lauf', async () => {
        const root = await repositoryWith({ 'a.tex': 'a\n' });
        let spawns = 0;
        const defaults = defaultGitProcessDependencies();
        const counting: GitProcessDependencies = { ...defaults, spawn: (command, args, options) => (spawns++, defaults.spawn(command, args, options)) };
        const runner = service({}, counting);
        const results = await Promise.all([runner.status(root), runner.status(root), runner.status(root)]);
        expect(results[1]).toBe(results[0]);
        // rev-parse (Repository suchen) und ein status
        expect(spawns).toBe(2);
    });

    it('Handler git:status: nur das aktuelle Projekt des Main, ohne Projekt notFound', async () => {
        const root = await repositoryWith({ 'a.tex': 'a\n' });
        await writeFiles(root, { 'a.tex': 'b\n' });
        const grants = new GrantStore({ platform: PLATFORM });
        const handlers = createGitHandlers({ grants, service: { locate: () => Promise.resolve(GIT), extraEnv: isolation } });
        expect((await errorOf(handlers['git:status']())).kind).toBe('notFound');
        grants.openProject(grants.grant(root, 'project').grantId);
        const status = await handlers['git:status']();
        expect(status.entries).toEqual([{ path: join(root, 'a.tex'), originalPath: null, staged: null, unstaged: 'modified' }]);
    });
});

// ---------- Zeitlimit und Abbruch mit hängendem Fake-Git ----------

interface HangingSpawner {
    readonly dependencies: GitProcessDependencies;
    readonly pids: number[];
}

function hangingSpawner(): HangingSpawner {
    const pids: number[] = [];
    const dependencies: GitProcessDependencies = {
        ...defaultGitProcessDependencies(),
        spawn: (_command, args, options) => {
            const child = nodeSpawn(process.execPath, ['-e', HANGING_GIT, ...args], options);
            if (child.pid !== undefined) pids.push(child.pid);
            return child;
        },
    };
    return { dependencies, pids };
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function expectGone(pids: readonly number[]): Promise<void> {
    const deadline = Date.now() + GONE_CHECK_LIMIT_MS;
    while (pids.some(isAlive) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, GONE_CHECK_STEP_MS));
    expect(pids.filter(isAlive)).toEqual([]);
}

function grandchildPid(stdout: Buffer): number | null {
    const line = stdout.toString('utf8').split('\n').find((entry) => entry.startsWith(GRANDCHILD_PREFIX));
    return line === undefined ? null : Number(line.slice(GRANDCHILD_PREFIX.length));
}

describe('Zeitlimit und Abbruch (Fake-Git, Node-Skript)', () => {
    it('Zeitlimit beendet den ganzen Prozessbaum und liefert eine verständliche Meldung', async () => {
        const spawner = hangingSpawner();
        const started = Date.now();
        const output = await runGit({ git: 'fake-git', args: ['status'], cwd: tmpdir(), timeoutMs: HANG_TIMEOUT_MS }, spawner.dependencies);
        expect(Date.now() - started).toBeLessThan(HANG_TIMEOUT_MS + CANCEL_BUDGET_MS);
        expect(output).toMatchObject({ exitCode: null, interrupted: 'timeout' });
        const grandchild = grandchildPid(output.stdout);
        expect(grandchild).not.toBeNull();
        await expectGone([...spawner.pids, grandchild ?? 0]);
        expect(() => checkedOutput(output, HANG_TIMEOUT_MS)).toThrow(GIT_RUNNER_MESSAGES.timeout(1));
    });

    it('dispose bricht einen laufenden Statusaufruf ab; danach startet nichts mehr', async () => {
        const spawner = hangingSpawner();
        const runner = new GitService({ platform: PLATFORM, locate: () => Promise.resolve('fake-git'), process: spawner.dependencies, timeoutMs: 60_000 });
        const pending = runner.status(tmpdir());
        while (spawner.pids.length === 0) await new Promise((resolve) => setTimeout(resolve, GONE_CHECK_STEP_MS));
        runner.dispose();
        expect(await errorOf(pending)).toEqual({ kind: 'gitFailed', message: GIT_RUNNER_MESSAGES.aborted });
        await expectGone(spawner.pids);
        expect(await errorOf(runner.status(tmpdir()))).toEqual({ kind: 'gitFailed', message: GIT_RUNNER_MESSAGES.aborted });
        expect(spawner.pids).toHaveLength(1);
    });

    it('nicht startbares Git: gitFailed mit Meldung', async () => {
        const missing = join(tmpdir(), 'gibt-es-nicht', 'git');
        const failure = await runGit({ git: missing, args: ['status'], cwd: tmpdir(), timeoutMs: HANG_TIMEOUT_MS }).then(() => null, (error: unknown) => error);
        expect(failure).toBeInstanceOf(IpcFailure);
        expect((failure as IpcFailure).error.kind).toBe('gitFailed');
    });
});

// ---------- Warteschlange ----------

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((done) => (resolve = done));
    return { promise, resolve };
}

describe('GitQueue', () => {
    it('führt Aufträge nacheinander aus, auch nach einem Fehler', async () => {
        const queue = new GitQueue<string>();
        const order: string[] = [];
        const gate = deferred();
        const first = queue.run(async () => {
            order.push('erster Start');
            await gate.promise;
            order.push('erster Ende');
            throw new Error('kaputt');
        });
        const second = queue.run(() => {
            order.push('zweiter');
            return Promise.resolve('ok');
        });
        await Promise.resolve();
        gate.resolve();
        await expect(first).rejects.toThrow('kaputt');
        expect(await second).toBe('ok');
        expect(order).toEqual(['erster Start', 'erster Ende', 'zweiter']);
    });

    it('wartende Abfragen mit gleichem Schlüssel teilen sich einen Lauf; während eines Laufs folgt genau einer', async () => {
        const queue = new GitQueue<number>();
        let runs = 0;
        const gate = deferred();
        const task = async () => {
            runs += 1;
            await gate.promise;
            return runs;
        };
        const first = queue.runCoalesced('a', task);
        await Promise.resolve();
        const second = queue.runCoalesced('a', task);
        const third = queue.runCoalesced('a', task);
        const other = queue.runCoalesced('b', task);
        gate.resolve();
        expect(await first).toBe(1);
        expect(await second).toBe(2);
        expect(third).toBe(second);
        expect(await other).toBe(3);
    });
});
