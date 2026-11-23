import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { AbsolutePath, BuildOptions, BuildState, EpochMillis, LatexEngine, ToolProblem } from '../shared/contract';
import { type Environment, isWindowsPlatform, readEnv } from './tools';

// Rohfassung des Build-Runners (Spike S4): startet latexmk ohne Shell, streamt die Ausgabe zeilenweise
// und bricht den ganzen Prozessbaum über die eigene Kind-PID ab. Warteschlange und Zusammenfassen
// folgen in W2-10. Ohne Electron; Prozessstart, Signale und Plattform sind einspeisbar.

export type OutputStream = 'stdout' | 'stderr';

export interface SpawnedProcess {
    readonly pid?: number | undefined;
    readonly stdout: Readable | null;
    readonly stderr: Readable | null;
    on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
}

export type SpawnFunction = (command: string, args: readonly string[], options: SpawnOptions) => SpawnedProcess;
export type SignalFunction = (pid: number, signal: NodeJS.Signals) => void;

export interface BuildDependencies {
    readonly spawn: SpawnFunction;
    readonly signal: SignalFunction;
    readonly platform: NodeJS.Platform;
    readonly env: Environment;
    readonly now: () => EpochMillis;
    readonly killGraceMs: number;
}

export interface BuildRequest {
    readonly latexmk: AbsolutePath;
    readonly mainFile: AbsolutePath;
    readonly options: BuildOptions;
    // Probleme aus `detectTools`; ein fehlendes Perl unter MiKTeX verhindert den Start.
    readonly problems?: readonly ToolProblem[];
}

export interface BuildListener {
    readonly onLine?: (line: string, stream: OutputStream) => void;
    readonly onStatus?: (state: BuildState, startedAt: EpochMillis | null) => void;
}

export type BuildOutcome =
    | {
          readonly kind: 'finished';
          readonly ok: boolean;
          readonly cancelled: boolean;
          readonly exitCode: number | null;
          readonly signal: NodeJS.Signals | null;
          readonly durationMs: number;
      }
    | { readonly kind: 'rejected'; readonly reason: 'busy' | 'blocked' | 'launchFailed'; readonly message: string };

export type KillPlan =
    | { readonly kind: 'taskkill'; readonly command: string; readonly args: readonly string[] }
    | { readonly kind: 'processGroup'; readonly groupId: number };

// Nach SIGTERM an die Gruppe so lange warten, dann SIGKILL (Abbruch muss unter 3 s bleiben).
export const KILL_GRACE_MS = 1_000;
const ENGINE_FLAGS: Readonly<Record<LatexEngine, string>> = { pdflatex: '-pdf', xelatex: '-xelatex', lualatex: '-lualatex' };
const COMMON_ARGUMENTS = ['-synctex=1', '-interaction=nonstopmode', '-file-line-error', '-cd'];
// Verhindert Zeilenumbrüche im Log bei 79 Zeichen, die sonst Pfade und Meldungen zerreißen.
const LOG_LINE_SETTINGS: Readonly<Record<string, string>> = { max_print_line: '10000', error_line: '254', half_error_line: '238' };
const WINDOWS_EXECUTABLE_EXTENSION = '.exe';
const WINDOWS_SYSTEM_ROOT_DEFAULT = 'C:\\Windows';
const LINE_BREAK = /\r?\n/;

export const BUILD_MESSAGES = {
    busy: 'Es läuft bereits ein Build. Ein zweiter Lauf startet nicht parallel.',
    windowsNotExe: (file: string) =>
        `latexmk muss unter Windows eine .exe sein (${file}). Skripte (.bat/.cmd) lassen sich ohne Shell nicht starten.`,
    perlMissing: 'latexmk kann nicht starten: MiKTeX braucht dafür Perl.',
    launchFailed: (detail: string) => `latexmk ließ sich nicht starten: ${detail}`,
} as const;

export function buildArguments(mainFile: AbsolutePath, options: BuildOptions, platform: NodeJS.Platform): string[] {
    const pathModule = isWindowsPlatform(platform) ? path.win32 : path.posix;
    return [ENGINE_FLAGS[options.engine], ...COMMON_ARGUMENTS, pathModule.basename(mainFile)];
}

// Ordner von latexmk vorne in PATH: pdflatex, biber usw. liegen daneben, und eine GUI-App erbt den Shell-PATH nicht.
export function buildEnvironment(base: Environment, latexmk: AbsolutePath, platform: NodeJS.Platform): Record<string, string> {
    const pathModule = isWindowsPlatform(platform) ? path.win32 : path.posix;
    const environment: Record<string, string> = {};
    for (const [key, value] of Object.entries(base)) if (value !== undefined) environment[key] = value;
    const pathKey = Object.keys(environment).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
    const inherited = readEnv(base, 'PATH', platform);
    const prefix = pathModule.dirname(latexmk);
    environment[pathKey] = inherited ? prefix + pathModule.delimiter + inherited : prefix;
    return { ...environment, ...LOG_LINE_SETTINGS };
}

// Liefert eine Meldung, wenn latexmk nicht gestartet werden darf, sonst `null`.
export function launchBlocker(request: BuildRequest, platform: NodeJS.Platform): string | null {
    if (request.problems?.some((problem) => problem.tool === 'perl')) return BUILD_MESSAGES.perlMissing;
    if (!isWindowsPlatform(platform)) return null;
    // Node startet .bat/.cmd ohne Shell nicht (EINVAL seit CVE-2024-27980), mit Shell wären Argumente unsicher.
    const extension = path.win32.extname(request.latexmk).toLowerCase();
    return extension === WINDOWS_EXECUTABLE_EXTENSION ? null : BUILD_MESSAGES.windowsNotExe(request.latexmk);
}

export function spawnOptionsFor(mainFile: AbsolutePath, env: Record<string, string>, platform: NodeJS.Platform): SpawnOptions {
    const windows = isWindowsPlatform(platform);
    return {
        cwd: (windows ? path.win32 : path.posix).dirname(mainFile),
        env,
        shell: false,
        // Unix: eigene Prozessgruppe, damit der Abbruch auch pdflatex/biber trifft. Windows: sonst neues Konsolenfenster.
        detached: !windows,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    };
}

// Nur die eigene Kind-PID, nie nach Namen. taskkill mit vollem Pfad, damit kein fremdes taskkill aus PATH läuft.
export function killPlanFor(pid: number, platform: NodeJS.Platform, env: Environment): KillPlan {
    if (!isWindowsPlatform(platform)) return { kind: 'processGroup', groupId: pid };
    const systemRoot = readEnv(env, 'SystemRoot', platform) ?? WINDOWS_SYSTEM_ROOT_DEFAULT;
    const command = path.win32.join(systemRoot, 'System32', 'taskkill.exe');
    return { kind: 'taskkill', command, args: ['/PID', String(pid), '/T', '/F'] };
}

export interface LineSplitter {
    push(chunk: string): void;
    flush(): void;
}

export function createLineSplitter(onLine: (line: string) => void): LineSplitter {
    let pending = '';
    return {
        push(chunk) {
            const parts = (pending + chunk).split(LINE_BREAK);
            pending = parts.pop() ?? '';
            parts.forEach(onLine);
        },
        flush() {
            const rest = pending.replace(/\r$/, '');
            pending = '';
            if (rest !== '') onLine(rest);
        },
    };
}

export function defaultBuildDependencies(): BuildDependencies {
    return {
        spawn: (command, args, options) => nodeSpawn(command, [...args], options),
        signal: (pid, signal) => {
            process.kill(pid, signal);
        },
        platform: process.platform,
        env: process.env,
        now: Date.now,
        killGraceMs: KILL_GRACE_MS,
    };
}

interface ActiveRun {
    readonly child: SpawnedProcess;
    readonly pid: number | undefined;
    readonly startedAt: EpochMillis;
    readonly done: Promise<BuildOutcome>;
    cancelRequested: boolean;
    killTimer: NodeJS.Timeout | null;
}

export class BuildRunner {
    private state: BuildState = 'idle';
    private active: ActiveRun | null = null;

    constructor(
        private readonly dependencies: BuildDependencies = defaultBuildDependencies(),
        private readonly listener: BuildListener = {},
    ) {}

    get currentState(): BuildState {
        return this.state;
    }

    start(request: BuildRequest): Promise<BuildOutcome> {
        if (this.active !== null) return Promise.resolve(rejected('busy', BUILD_MESSAGES.busy));
        const blocker = launchBlocker(request, this.dependencies.platform);
        if (blocker !== null) return Promise.resolve(rejected('blocked', blocker));
        const { platform, env } = this.dependencies;
        const options = spawnOptionsFor(request.mainFile, buildEnvironment(env, request.latexmk, platform), platform);
        const args = buildArguments(request.mainFile, request.options, platform);
        let child: SpawnedProcess;
        try {
            child = this.dependencies.spawn(request.latexmk, args, options);
        } catch (error) {
            return Promise.resolve(rejected('launchFailed', BUILD_MESSAGES.launchFailed(describeError(error))));
        }
        return this.track(child);
    }

    // Wartet, bis der Lauf samt Kindern beendet ist. Ohne laufenden Build tut es nichts.
    async cancel(): Promise<void> {
        const run = this.active;
        if (run === null) return;
        if (!run.cancelRequested) {
            run.cancelRequested = true;
            this.setState('cancelling', run.startedAt);
            this.terminateTree(run);
        }
        await run.done;
    }

    private track(child: SpawnedProcess): Promise<BuildOutcome> {
        const startedAt = this.dependencies.now();
        let settle: (outcome: BuildOutcome) => void = () => undefined;
        const done = new Promise<BuildOutcome>((resolve) => (settle = resolve));
        const run: ActiveRun = { child, pid: child.pid, startedAt, done, cancelRequested: false, killTimer: null };
        this.active = run;
        this.setState('running', startedAt);
        const splitters = this.attachOutput(child);
        let settled = false;
        const finish = (outcome: BuildOutcome): void => {
            if (settled) return;
            settled = true;
            splitters.forEach((splitter) => splitter.flush());
            this.release(run);
            settle(outcome);
        };
        child.on('error', (error) => finish(rejected('launchFailed', BUILD_MESSAGES.launchFailed(error.message))));
        child.on('close', (code, signal) => finish(this.finishedOutcome(run, code, signal)));
        return done;
    }

    private attachOutput(child: SpawnedProcess): LineSplitter[] {
        const streams: [Readable | null, OutputStream][] = [[child.stdout, 'stdout'], [child.stderr, 'stderr']];
        return streams.flatMap(([stream, name]) => {
            if (stream === null) return [];
            const splitter = createLineSplitter((line) => this.listener.onLine?.(line, name));
            stream.setEncoding('utf8');
            stream.on('data', (chunk: string) => splitter.push(chunk));
            return [splitter];
        });
    }

    private finishedOutcome(run: ActiveRun, code: number | null, signal: NodeJS.Signals | null): BuildOutcome {
        const cancelled = run.cancelRequested;
        const durationMs = this.dependencies.now() - run.startedAt;
        return { kind: 'finished', ok: code === 0 && !cancelled, cancelled, exitCode: code, signal, durationMs };
    }

    private release(run: ActiveRun): void {
        if (run.killTimer !== null) clearTimeout(run.killTimer);
        run.killTimer = null;
        // Restliche Gruppenmitglieder (Enkel, die SIGTERM ignorieren und keine Pipe mehr halten) mitnehmen.
        if (run.cancelRequested && run.pid !== undefined && !isWindowsPlatform(this.dependencies.platform)) {
            this.signalGroup(run.pid, 'SIGKILL');
        }
        this.active = null;
        this.setState('idle', null);
    }

    private terminateTree(run: ActiveRun): void {
        if (run.pid === undefined) return;
        const plan = killPlanFor(run.pid, this.dependencies.platform, this.dependencies.env);
        if (plan.kind === 'taskkill') {
            this.runTaskkill(plan);
            return;
        }
        this.signalGroup(plan.groupId, 'SIGTERM');
        run.killTimer = setTimeout(() => this.signalGroup(plan.groupId, 'SIGKILL'), this.dependencies.killGraceMs);
    }

    private runTaskkill(plan: Extract<KillPlan, { kind: 'taskkill' }>): void {
        try {
            const killer = this.dependencies.spawn(plan.command, plan.args, { shell: false, windowsHide: true, stdio: 'ignore' });
            killer.on('error', () => undefined);
        } catch {
            // Ohne taskkill bleibt nur das Warten auf das Ende des Laufs; W2-10 meldet das in der Oberfläche.
        }
    }

    // Negative PID = ganze Prozessgruppe, deren Kennung die PID des eigenen Kindes ist.
    // ESRCH heißt „Gruppe schon leer“; andere Fehler darf der Abbruch ebenfalls nicht werfen (läuft auch im close-Handler).
    private signalGroup(groupId: number, signal: NodeJS.Signals): void {
        try {
            this.dependencies.signal(-groupId, signal);
        } catch {
            return;
        }
    }

    private setState(state: BuildState, startedAt: EpochMillis | null): void {
        if (this.state === state) return;
        this.state = state;
        this.listener.onStatus?.(state, startedAt);
    }
}

function rejected(reason: 'busy' | 'blocked' | 'launchFailed', message: string): BuildOutcome {
    return { kind: 'rejected', reason, message };
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
