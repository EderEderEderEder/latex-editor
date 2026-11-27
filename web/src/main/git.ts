import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import path from 'node:path';
import type { AbsolutePath, GitStatus, GitStatusEntry } from '../shared/contract';
import { IpcFailure } from '../shared/ipcResult';
import { killPlanFor, type SignalFunction, type SpawnedProcess, type SpawnFunction } from './build';
import { type GitStatusSnapshot, gitErrorFor, parseStatus, projectPathFor, projectPrefix } from './gitStatus';
import { comparisonKey, isPathWithin, normalizeAbsolutePath, type PathPlatform, type RealpathFunction, resolveRealPath } from './paths';
import { defaultToolsContext, type Environment, findExecutable, gitMissingMessage, isWindowsPlatform, readEnv } from './tools';

// Git-Runner (W6-2, Vorlage `swift/Sources/LatexEditor/Model/Git.swift` und `GitStore.swift`): startet git ohne
// Shell mit fester Umgebung (keine Abfragen, keine optionalen Sperren, englische Meldungen), mit Zeitlimit und
// Abbruch des ganzen Prozessbaums wie `build.ts`. Alle Aufrufe laufen nacheinander (`GitQueue`), wartende
// Statusabfragen werden zusammengefasst. Die App fragt nie nach Passwörtern und schreibt nie die Git-Konfiguration.

export const STATUS_ARGUMENTS = ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'] as const;
const DISCOVER_ARGUMENTS = ['rev-parse', '--show-toplevel', '--absolute-git-dir'] as const;
const DISCOVER_LINE_COUNT = 2;
const NOT_A_REPOSITORY_MARKERS = ['not a git repository', 'must be run in a work tree'];

// Lokale Befehle; Netzbefehle (W6-6) bekommen ein eigenes, längeres Limit.
export const LOCAL_TIMEOUT_MS = 30_000;
export const GIT_KILL_GRACE_MS = 1_000;
// Hält ein Enkel (z. B. ssh) die Pipe nach dem Abbruch offen, wird sie spätestens dann getrennt.
export const GIT_CLOSE_DEADLINE_MS = 3_000;
// Schutz gegen eine ausufernde Ausgabe (riesiges Repository, Endlosschleife eines Hooks).
export const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const MILLISECONDS_PER_SECOND = 1_000;

const POSIX_SYSTEM_PATHS: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
    darwin: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
};
const LINUX_SYSTEM_PATH = '/usr/local/bin:/usr/bin:/bin';
const WINDOWS_SYSTEM_ROOT_DEFAULT = 'C:\\Windows';

// Überschreiben jede Einstellung der Umgebung (Werte aus `shared/spec/git-status.json`, Gruppe `environment`).
const FIXED_ENVIRONMENT: Readonly<Record<string, string>> = {
    // Englische Meldungen, damit `gitErrorFor` sie erkennt
    LC_ALL: 'C',
    // Nie nach Passwörtern fragen, nie Editor oder Pager öffnen
    GIT_TERMINAL_PROMPT: '0',
    GIT_EDITOR: 'true',
    GIT_PAGER: 'cat',
    // Leer statt fehlend: git fällt dann weder auf `core.askPass` noch auf `SSH_ASKPASS` zurück.
    GIT_ASKPASS: '',
    SSH_ASKPASS_REQUIRE: 'never',
    // Git Credential Manager (Git für Windows): nie ein Anmeldefenster öffnen
    GCM_INTERACTIVE: 'never',
    // `git status` schreibt sonst den Index neu (index.lock, Änderungen, die niemand angestoßen hat)
    GIT_OPTIONAL_LOCKS: '0',
    // Pfade mit `*`, `?` oder `:` sind Dateinamen, keine Muster
    GIT_LITERAL_PATHSPECS: '1',
    // Netzwerk: abbrechen, wenn 30 s lang weniger als 1 KB/s ankommt
    GIT_HTTP_LOW_SPEED_LIMIT: '1000',
    GIT_HTTP_LOW_SPEED_TIME: '30',
};
// SSH ohne Rückfragen und mit Zeitlimit; eine eigene Einstellung des Nutzers hat Vorrang.
const SSH_COMMAND = 'ssh -o BatchMode=yes -o ConnectTimeout=15';
const SSH_COMMAND_KEY = 'GIT_SSH_COMMAND';
// Geerbt (z. B. App aus einem Git-Hook gestartet) würden sie git auf ein anderes Repository lenken.
const INHERITED_REPOSITORY_VARIABLES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];

export const GIT_RUNNER_MESSAGES = {
    launchFailed: (detail: string) => `Git konnte nicht gestartet werden: ${detail}`,
    timeout: (seconds: number) => `Git hat nicht innerhalb von ${seconds} s geantwortet und wurde beendet.`,
    aborted: 'Der Git-Aufruf wurde abgebrochen.',
    outputTooLarge: 'Die Ausgabe von Git war zu groß und wurde abgebrochen.',
    notARepository: 'Der Projektordner gehört zu keinem Git-Repository.',
    rootMismatch: (root: string) => `Der Projektordner liegt nicht im gefundenen Git-Repository (${root}).`,
} as const;

// ---------- Git finden ----------

/** Erster Kandidat, der ausführbar ist (Swift `GitLocator.locate(in:isExecutable:)`) */
export async function locateGit(candidates: readonly string[], isExecutable: (file: string) => Promise<boolean>): Promise<string | null> {
    for (const candidate of candidates) if (await isExecutable(candidate)) return candidate;
    return null;
}

/** Git über die Werkzeugsuche (`tools.ts`: PATH, Git für Windows, Homebrew; nie `/usr/bin/git` unter macOS) */
export async function findGit(): Promise<AbsolutePath | null> {
    return (await findExecutable('git', defaultToolsContext())).found;
}

// ---------- Umgebung ----------

function systemPath(base: Environment, platform: NodeJS.Platform): string {
    if (!isWindowsPlatform(platform)) return POSIX_SYSTEM_PATHS[platform] ?? LINUX_SYSTEM_PATH;
    const systemRoot = readEnv(base, 'SystemRoot', platform) ?? WINDOWS_SYSTEM_ROOT_DEFAULT;
    return [path.win32.join(systemRoot, 'System32'), systemRoot].join(path.win32.delimiter);
}

function withoutKeys(base: Environment, removed: readonly string[], platform: NodeJS.Platform): Record<string, string> {
    const windows = isWindowsPlatform(platform);
    const isRemoved = (key: string) => removed.some((name) => (windows ? name.toUpperCase() === key.toUpperCase() : name === key));
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(base)) if (value !== undefined && !isRemoved(key)) result[key] = value;
    return result;
}

/** Umgebung für jeden Git-Aufruf: Systempfad vor dem geerbten PATH, feste Werte überschreiben `base` */
export function gitEnvironment(base: Environment, platform: NodeJS.Platform): Record<string, string> {
    const environment = withoutKeys(base, INHERITED_REPOSITORY_VARIABLES, platform);
    const windows = isWindowsPlatform(platform);
    const pathKey = Object.keys(environment).find((key) => (windows ? key.toUpperCase() === 'PATH' : key === 'PATH')) ?? 'PATH';
    const inherited = environment[pathKey];
    const delimiter = windows ? path.win32.delimiter : path.posix.delimiter;
    const system = systemPath(base, platform);
    environment[pathKey] = inherited === undefined || inherited === '' ? system : system + delimiter + inherited;
    if (readEnv(environment, SSH_COMMAND_KEY, platform) === undefined) environment[SSH_COMMAND_KEY] = SSH_COMMAND;
    return { ...environment, ...FIXED_ENVIRONMENT };
}

// ---------- ein Aufruf ----------

export interface GitProcessDependencies {
    readonly spawn: SpawnFunction;
    readonly signal: SignalFunction;
    readonly platform: NodeJS.Platform;
    readonly env: Environment;
    readonly killGraceMs: number;
    readonly closeDeadlineMs: number;
}

export function defaultGitProcessDependencies(): GitProcessDependencies {
    return {
        spawn: (command, args, options) => nodeSpawn(command, [...args], options),
        signal: (pid, signal) => {
            process.kill(pid, signal);
        },
        platform: process.platform,
        env: process.env,
        killGraceMs: GIT_KILL_GRACE_MS,
        closeDeadlineMs: GIT_CLOSE_DEADLINE_MS,
    };
}

export interface GitInvocation {
    readonly git: AbsolutePath;
    readonly args: readonly string[];
    readonly cwd: AbsolutePath;
    readonly timeoutMs: number;
    // Nur Tests: eigene, leere Git-Konfiguration (`GIT_CONFIG_GLOBAL` …) oder `GIT_CONFIG_COUNT` statt `-c`.
    readonly extraEnv?: Readonly<Record<string, string>>;
    readonly abortSignal?: AbortSignal;
}

export type GitInterruption = 'timeout' | 'aborted' | 'outputTooLarge';

export interface GitOutput {
    readonly exitCode: number | null;
    readonly stdout: Buffer;
    readonly stderr: string;
    readonly interrupted: GitInterruption | null;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function launchFailure(error: unknown): IpcFailure {
    return new IpcFailure({ kind: 'gitFailed', message: GIT_RUNNER_MESSAGES.launchFailed(describeError(error)) });
}

export function gitSpawnOptions(invocation: GitInvocation, deps: GitProcessDependencies): SpawnOptions {
    const windows = isWindowsPlatform(deps.platform);
    return {
        cwd: invocation.cwd,
        env: { ...gitEnvironment(deps.env, deps.platform), ...invocation.extraEnv },
        shell: false,
        // Unix: eigene Prozessgruppe, damit der Abbruch auch ssh oder Hooks trifft. Windows: kein Konsolenfenster.
        detached: !windows,
        windowsHide: true,
        // Kein stdin: git kann so nie auf eine Eingabe warten.
        stdio: ['ignore', 'pipe', 'pipe'],
    };
}

/** Startet git einmal; lehnt nur ab, wenn der Start scheitert. Exit-Code und Abbruch stehen im Ergebnis. */
export function runGit(invocation: GitInvocation, deps: GitProcessDependencies = defaultGitProcessDependencies()): Promise<GitOutput> {
    if (invocation.abortSignal?.aborted === true) {
        return Promise.resolve({ exitCode: null, stdout: Buffer.alloc(0), stderr: '', interrupted: 'aborted' });
    }
    return new Promise((resolve, reject) => {
        let child: SpawnedProcess;
        try {
            child = deps.spawn(invocation.git, invocation.args, gitSpawnOptions(invocation, deps));
        } catch (error) {
            reject(launchFailure(error));
            return;
        }
        new GitRun(child, invocation, deps, resolve, reject).start();
    });
}

class GitRun {
    private readonly stdout: Buffer[] = [];
    private readonly stderr: Buffer[] = [];
    private outputBytes = 0;
    private interrupted: GitInterruption | null = null;
    private settled = false;
    private readonly timers: NodeJS.Timeout[] = [];
    private readonly onAbort = () => this.interrupt('aborted');

    constructor(
        private readonly child: SpawnedProcess,
        private readonly invocation: GitInvocation,
        private readonly deps: GitProcessDependencies,
        private readonly resolve: (output: GitOutput) => void,
        private readonly reject: (error: IpcFailure) => void,
    ) {}

    start(): void {
        this.child.stdout?.on('data', (chunk: Buffer) => this.collect(this.stdout, chunk));
        this.child.stderr?.on('data', (chunk: Buffer) => this.collect(this.stderr, chunk));
        this.child.on('error', (error) => this.fail(error));
        this.child.on('close', (code) => this.finish(code));
        this.timers.push(setTimeout(() => this.interrupt('timeout'), this.invocation.timeoutMs));
        this.invocation.abortSignal?.addEventListener('abort', this.onAbort, { once: true });
    }

    private collect(target: Buffer[], chunk: Buffer): void {
        this.outputBytes += chunk.length;
        if (this.outputBytes > MAX_GIT_OUTPUT_BYTES) {
            this.interrupt('outputTooLarge');
            return;
        }
        target.push(chunk);
    }

    private interrupt(reason: GitInterruption): void {
        if (this.settled || this.interrupted !== null) return;
        this.interrupted = reason;
        this.terminateTree();
        this.timers.push(setTimeout(() => this.forceFinish(), this.deps.closeDeadlineMs));
    }

    private forceFinish(): void {
        this.child.stdout?.destroy();
        this.child.stderr?.destroy();
        this.finish(null);
    }

    private fail(error: Error): void {
        if (this.settled) return;
        this.release();
        this.reject(launchFailure(error));
    }

    private finish(code: number | null): void {
        if (this.settled) return;
        this.release();
        const stderr = Buffer.concat(this.stderr).toString('utf8');
        this.resolve({ exitCode: code, stdout: Buffer.concat(this.stdout), stderr, interrupted: this.interrupted });
    }

    private release(): void {
        this.settled = true;
        this.timers.forEach(clearTimeout);
        this.invocation.abortSignal?.removeEventListener('abort', this.onAbort);
        // Nach einem Abbruch die restliche Gruppe (Enkel, die SIGTERM ignorieren) mitnehmen.
        if (this.interrupted !== null && !isWindowsPlatform(this.deps.platform)) this.signalGroup('SIGKILL');
    }

    // Nur die eigene Kind-PID (Unix: deren Prozessgruppe; Windows: taskkill /T /F), nie nach Namen.
    private terminateTree(): void {
        const pid = this.child.pid;
        if (pid === undefined) return;
        const plan = killPlanFor(pid, this.deps.platform, this.deps.env);
        if (plan.kind === 'processGroup') {
            this.signalGroup('SIGTERM');
            this.timers.push(setTimeout(() => this.signalGroup('SIGKILL'), this.deps.killGraceMs));
            return;
        }
        try {
            const killer = this.deps.spawn(plan.command, plan.args, { shell: false, windowsHide: true, stdio: 'ignore' });
            // Scheitert taskkill, bleibt die Frist (`closeDeadlineMs`).
            killer.on('error', () => undefined);
        } catch {
            return;
        }
    }

    // ESRCH heißt „Gruppe schon leer“; der Abbruch darf nie werfen.
    private signalGroup(signal: NodeJS.Signals): void {
        const pid = this.child.pid;
        if (pid === undefined) return;
        try {
            this.deps.signal(-pid, signal);
        } catch {
            return;
        }
    }
}

/** Ausgabe bei Exit-Code 0, sonst ein `IpcFailure` mit deutschem Text (`gitErrorFor`) */
export function checkedOutput(output: GitOutput, timeoutMs: number): Buffer {
    if (output.interrupted === 'timeout') {
        throw new IpcFailure({ kind: 'gitFailed', message: GIT_RUNNER_MESSAGES.timeout(Math.round(timeoutMs / MILLISECONDS_PER_SECOND)) });
    }
    if (output.interrupted === 'aborted') throw new IpcFailure({ kind: 'gitFailed', message: GIT_RUNNER_MESSAGES.aborted });
    if (output.interrupted === 'outputTooLarge') throw new IpcFailure({ kind: 'gitFailed', message: GIT_RUNNER_MESSAGES.outputTooLarge });
    if (output.exitCode === 0) return output.stdout;
    const stdout = output.stdout.toString('utf8');
    throw new IpcFailure(gitErrorFor([output.stderr, stdout].filter((part) => part !== '').join('\n')));
}

// ---------- Warteschlange ----------

/** Git-Aufrufe nie gleichzeitig (Konflikte um index.lock). Wartende Statusabfragen mit gleichem Schlüssel teilen sich einen Lauf. */
export class GitQueue<Coalesced> {
    private tail: Promise<void> = Promise.resolve();
    private waiting: { readonly key: string; readonly result: Promise<Coalesced> } | null = null;

    run<T>(task: () => Promise<T>): Promise<T> {
        const result = this.tail.then(task);
        this.tail = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }

    // Läuft schon eine Abfrage, kommt eine neue danach (sie soll den Stand nach dem Anstoß sehen).
    runCoalesced(key: string, task: () => Promise<Coalesced>): Promise<Coalesced> {
        if (this.waiting !== null && this.waiting.key === key) return this.waiting.result;
        const result: Promise<Coalesced> = this.run(() => {
            if (this.waiting?.result === result) this.waiting = null;
            return task();
        });
        this.waiting = { key, result };
        return result;
    }
}

// ---------- Repository und Status ----------

export interface GitRepository {
    /** Echter Pfad der Wurzel des Arbeitsverzeichnisses (Arbeitsordner aller Aufrufe) */
    readonly root: AbsolutePath;
    readonly gitDirectory: AbsolutePath;
    /** Projektordner in der Form, die der Renderer kennt (Pfade im Status entstehen daraus) */
    readonly projectRoot: AbsolutePath;
    /** Projektordner relativ zur Wurzel mit `/`, `null`, wenn er die Wurzel ist */
    readonly prefix: string | null;
}

export interface GitContext {
    readonly git: AbsolutePath;
    readonly platform: PathPlatform;
    readonly process?: GitProcessDependencies;
    readonly extraEnv?: Readonly<Record<string, string>>;
    readonly realpath?: RealpathFunction;
    readonly timeoutMs?: number;
    readonly abortSignal?: AbortSignal;
}

function invocationFor(context: GitContext, args: readonly string[], cwd: AbsolutePath): GitInvocation {
    const { git, extraEnv, abortSignal } = context;
    return { git, args, cwd, timeoutMs: context.timeoutMs ?? LOCAL_TIMEOUT_MS, ...(extraEnv && { extraEnv }), ...(abortSignal && { abortSignal }) };
}

export async function runChecked(context: GitContext, args: readonly string[], cwd: AbsolutePath): Promise<Buffer> {
    const invocation = invocationFor(context, args, cwd);
    return checkedOutput(await runGit(invocation, context.process), invocation.timeoutMs);
}

function isNotARepository(message: string): boolean {
    return NOT_A_REPOSITORY_MARKERS.some((marker) => message.includes(marker));
}

/** Sucht das Repository, zu dem der Projektordner gehört; `null`: kein Repository (auch im `.git`-Ordner selbst) */
export async function discoverRepository(context: GitContext, projectRoot: AbsolutePath): Promise<GitRepository | null> {
    const invocation = invocationFor(context, DISCOVER_ARGUMENTS, projectRoot);
    const output = await runGit(invocation, context.process);
    if (output.interrupted === null && output.exitCode !== 0 && isNotARepository(output.stderr)) return null;
    const text = checkedOutput(output, invocation.timeoutMs).toString('utf8');
    const lines = text.split('\n').map((line) => line.replace(/\r$/, '')).filter((line) => line !== '');
    const [rootLine, gitDirectoryLine] = lines;
    if (lines.length !== DISCOVER_LINE_COUNT || rootLine === undefined || gitDirectoryLine === undefined) return null;
    return repositoryFor(context, rootLine, gitDirectoryLine, projectRoot);
}

// Git liefert echte Pfade (`/private/var/…`, unter Windows `C:/…`); verglichen wird nur aufgelöst gegen aufgelöst.
async function repositoryFor(context: GitContext, rootLine: string, gitDirectoryLine: string, projectRoot: AbsolutePath): Promise<GitRepository> {
    const { platform } = context;
    const options = context.realpath === undefined ? { platform } : { platform, realpath: context.realpath };
    const root = await resolveRealPath(normalizeAbsolutePath(rootLine, platform), options);
    const realProject = await resolveRealPath(projectRoot, options);
    if (!isPathWithin(realProject, root, platform)) {
        throw new IpcFailure({ kind: 'gitFailed', message: GIT_RUNNER_MESSAGES.rootMismatch(root) });
    }
    const gitDirectory = normalizeAbsolutePath(gitDirectoryLine, platform);
    return { root, gitDirectory, projectRoot, prefix: projectPrefix(root, realProject, platform) };
}

/** Nur Dateien im Projektordner; bereitgestellte außerhalb werden gezählt (Swift `GitStore.applyFiltered`) */
export function toGitStatus(snapshot: GitStatusSnapshot, repository: GitRepository, platform: PathPlatform): GitStatus {
    const toProject = (repositoryPath: string) => projectPathFor(repositoryPath, repository.projectRoot, repository.prefix, platform);
    const entries: GitStatusEntry[] = [];
    let stagedOutsideProject = 0;
    for (const record of snapshot.entries) {
        const projectPath = toProject(record.path);
        if (projectPath === null) {
            if (record.indexKind !== null) stagedOutsideProject += 1;
            continue;
        }
        const originalPath = record.originalPath === null ? null : toProject(record.originalPath);
        entries.push({ path: projectPath, originalPath, staged: record.indexKind, unstaged: record.worktreeKind });
    }
    const { head, commit, upstream, ahead, behind } = snapshot.branch;
    return { branch: head, commit, upstream, ahead, behind, entries, stagedOutsideProject };
}

// ---------- Dienst je App-Lauf ----------

export interface GitServiceOptions {
    readonly platform: PathPlatform;
    readonly locate?: () => Promise<AbsolutePath | null>;
    readonly process?: GitProcessDependencies;
    readonly extraEnv?: Readonly<Record<string, string>>;
    readonly realpath?: RealpathFunction;
    readonly timeoutMs?: number;
}

/** Status des Projekts; merkt sich Git und das gefundene Repository (nur positive Funde, „kein Repository“ wird neu geprüft) */
export class GitService {
    private readonly queue = new GitQueue<GitStatus>();
    private readonly lifetime = new AbortController();
    private git: AbsolutePath | null = null;
    private repository: { readonly key: string; readonly value: GitRepository } | null = null;

    constructor(private readonly options: GitServiceOptions) {}

    status(projectRoot: AbsolutePath): Promise<GitStatus> {
        return this.queue.runCoalesced(comparisonKey(projectRoot, this.options.platform), () => this.readStatus(projectRoot));
    }

    // Beim Beenden: laufende und künftige Aufrufe brechen ab.
    dispose(): void {
        this.lifetime.abort();
    }

    private async readStatus(projectRoot: AbsolutePath): Promise<GitStatus> {
        const context = await this.context();
        const repository = await this.repositoryFor(context, projectRoot);
        try {
            const output = await runChecked(context, STATUS_ARGUMENTS, repository.root);
            return toGitStatus(parseStatus(output.toString('utf8')), repository, this.options.platform);
        } catch (error) {
            // Repository inzwischen gelöscht oder verschoben: beim nächsten Mal neu suchen.
            this.repository = null;
            throw error;
        }
    }

    private async context(): Promise<GitContext> {
        this.git ??= await (this.options.locate ?? findGit)();
        if (this.git === null) {
            const platform = this.options.process?.platform ?? process.platform;
            throw new IpcFailure({ kind: 'gitMissing', message: gitMissingMessage(platform) });
        }
        const { platform, extraEnv, realpath, timeoutMs } = this.options;
        return {
            git: this.git, platform, abortSignal: this.lifetime.signal,
            ...(this.options.process && { process: this.options.process }),
            ...(extraEnv && { extraEnv }), ...(realpath && { realpath }), ...(timeoutMs !== undefined && { timeoutMs }),
        };
    }

    private async repositoryFor(context: GitContext, projectRoot: AbsolutePath): Promise<GitRepository> {
        const key = comparisonKey(projectRoot, this.options.platform);
        if (this.repository?.key === key) return this.repository.value;
        this.repository = null;
        const found = await discoverRepository(context, projectRoot);
        if (found === null) throw new IpcFailure({ kind: 'notARepository', message: GIT_RUNNER_MESSAGES.notARepository });
        this.repository = { key, value: found };
        return found;
    }
}
