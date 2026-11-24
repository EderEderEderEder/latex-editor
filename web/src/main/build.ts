import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { stat as nativeStat } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type {
    AbsolutePath,
    BuildIssue,
    BuildOptions,
    BuildState,
    EpochMillis,
    IpcEvents,
    LatexEngine,
    ToolProblem,
} from '../shared/contract';
import type { EventSender } from './ipc';
import { type Environment, isWindowsPlatform, readEnv } from './tools';

// Build-Pipeline (W2-10): `BuildRunner` startet genau einen latexmk-Lauf ohne Shell, streamt die Ausgabe
// zeilenweise (und in eine Datei) und bricht den ganzen Prozessbaum über die eigene Kind-PID ab.
// `BuildQueue` darüber: nie parallel, Aufträge während eines Laufs werden zu einem Folgelauf zusammengefasst,
// sendet `build:status`/`build:finished`. Ohne Electron; Prozessstart, Signale und Plattform sind einspeisbar.

export type OutputStream = 'stdout' | 'stderr';

export interface SpawnedProcess {
    readonly pid?: number | undefined;
    readonly stdout: Readable | null;
    readonly stderr: Readable | null;
    on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
    on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
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
    // Spätestens so lange nach dem Abbruch gilt der Lauf als beendet, auch ohne `close`.
    readonly cancelDeadlineMs: number;
    // So lange nach `exit` ohne Abbruch auf `close` warten (ein Enkel kann die Ausgabe-Pipe offen halten).
    readonly exitCloseGraceMs: number;
}

// compile: kompilieren; clean: `latexmk -c` (Hilfsdateien löschen, das PDF bleibt).
export type BuildTask = 'compile' | 'clean';

export interface BuildRequest {
    readonly latexmk: AbsolutePath;
    readonly mainFile: AbsolutePath;
    readonly options: BuildOptions;
    // Probleme aus `detectTools`; ein fehlendes Perl unter MiKTeX verhindert den Start.
    readonly problems?: readonly ToolProblem[];
    readonly task?: BuildTask;
    // Ausgabe von latexmk (stdout und stderr) zusätzlich in diese Datei (App-Datenordner), je Lauf neu.
    readonly outputLogPath?: AbsolutePath;
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
          // Hinweis, wenn der Abbruch nicht sauber bestätigt wurde (sonst `null`)
          readonly problem: string | null;
      }
    | { readonly kind: 'rejected'; readonly reason: 'busy' | 'blocked' | 'launchFailed'; readonly message: string };

export type KillPlan =
    | { readonly kind: 'taskkill'; readonly command: string; readonly args: readonly string[] }
    | { readonly kind: 'processGroup'; readonly groupId: number };

// Nach SIGTERM an die Gruppe so lange warten, dann SIGKILL (Abbruch muss unter 3 s bleiben).
export const KILL_GRACE_MS = 1_000;
// Windows: taskkill erreicht nicht immer alle Enkel; hält einer die Pipe offen, kommt `close` nie.
const CANCEL_CLOSE_EXTRA_MS = 2_000;
export const CANCEL_DEADLINE_MS = KILL_GRACE_MS + CANCEL_CLOSE_EXTRA_MS;
export const EXIT_CLOSE_GRACE_MS = 2_000;
// Beginnt der Dateiname damit, läse latexmk ihn als Option.
const OPTION_PREFIX = '-';
const CURRENT_DIRECTORY_PREFIX = './';
const ENGINE_FLAGS: Readonly<Record<LatexEngine, string>> = { pdflatex: '-pdf', xelatex: '-xelatex', lualatex: '-lualatex' };
const COMMON_ARGUMENTS = ['-synctex=1', '-interaction=nonstopmode', '-file-line-error', '-cd'];
const CLEAN_ARGUMENTS = ['-c', '-cd'];
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
    outputHeldOpen: 'latexmk ist abgebrochen, aber ein Unterprozess hielt die Ausgabe offen; sie wurde getrennt.',
    outputHeldAfterExit: 'latexmk ist beendet, aber ein Unterprozess hielt die Ausgabe offen; er wurde beendet.',
    cancelUnconfirmed: 'Der Abbruch ließ sich nicht bestätigen: latexmk läuft womöglich noch (Task-Manager prüfen).',
    taskkillFailed: (detail: string) => `taskkill ließ sich nicht starten: ${detail}`,
    outputLogFailed: (detail: string) => `Die Ausgabe von latexmk ließ sich nicht in die Protokolldatei schreiben: ${detail}`,
    cleanBusy: 'Während des Kompilierens lassen sich die Hilfsdateien nicht löschen.',
    shuttingDown: 'Die App wird beendet; es startet kein Build mehr.',
    exitFailed: (detail: string) => `latexmk ist fehlgeschlagen (${detail}). Details im Log.`,
    logUnreadable: (detail: string) => `Das Log ließ sich nicht auswerten: ${detail}`,
} as const;

function pathModuleFor(platform: NodeJS.Platform): typeof path.posix {
    return isWindowsPlatform(platform) ? path.win32 : path.posix;
}

// Nur der Name (Arbeitsordner ist der Ordner der Hauptdatei); `./` davor, wenn er mit `-` beginnt.
function fileArgument(mainFile: AbsolutePath, platform: NodeJS.Platform): string {
    const name = pathModuleFor(platform).basename(mainFile);
    return name.startsWith(OPTION_PREFIX) ? CURRENT_DIRECTORY_PREFIX + name : name;
}

export function buildArguments(mainFile: AbsolutePath, options: BuildOptions, platform: NodeJS.Platform): string[] {
    return [ENGINE_FLAGS[options.engine], ...COMMON_ARGUMENTS, fileArgument(mainFile, platform)];
}

export function cleanArguments(mainFile: AbsolutePath, platform: NodeJS.Platform): string[] {
    return [...CLEAN_ARGUMENTS, fileArgument(mainFile, platform)];
}

export function argumentsFor(request: BuildRequest, platform: NodeJS.Platform): string[] {
    if (request.task === 'clean') return cleanArguments(request.mainFile, platform);
    return buildArguments(request.mainFile, request.options, platform);
}

// `<Hauptdatei ohne Endung><extension>` im Ordner der Hauptdatei (dorthin schreibt latexmk mit `-cd`).
export function siblingPath(mainFile: AbsolutePath, extension: string, platform: NodeJS.Platform): AbsolutePath {
    const pathModule = pathModuleFor(platform);
    const stem = pathModule.basename(mainFile, pathModule.extname(mainFile));
    return pathModule.join(pathModule.dirname(mainFile), stem + extension);
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
        cancelDeadlineMs: CANCEL_DEADLINE_MS,
        exitCloseGraceMs: EXIT_CLOSE_GRACE_MS,
    };
}

// ---------- Ausgabe zusätzlich in eine Datei ----------

interface OutputLog {
    write(chunk: string): void;
    // Liefert eine Fehlermeldung, wenn das Schreiben scheiterte, sonst `null`.
    close(): Promise<string | null>;
}

// Ein Schreibfehler hält den Build nicht auf; er wird im Ergebnis als Problem gemeldet.
function openOutputLog(target: AbsolutePath | undefined): OutputLog | null {
    if (target === undefined) return null;
    const stream = createWriteStream(target, { flags: 'w', encoding: 'utf8' });
    let failure: string | null = null;
    stream.on('error', (error) => {
        failure = error.message;
    });
    return {
        write: (chunk) => {
            if (failure === null) stream.write(chunk);
        },
        close: () =>
            new Promise((resolve) => {
                if (stream.closed) {
                    resolve(failure);
                    return;
                }
                stream.once('close', () => resolve(failure));
                stream.end();
            }),
    };
}

// ---------- ein Lauf ----------

interface ProcessExit {
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
}

interface ActiveRun {
    readonly child: SpawnedProcess;
    readonly pid: number | undefined;
    readonly startedAt: EpochMillis;
    readonly done: Promise<BuildOutcome>;
    readonly settle: (outcome: BuildOutcome) => void;
    finish: (outcome: BuildOutcome) => void;
    settled: boolean;
    cancelRequested: boolean;
    // Ein Unterprozess hielt die Pipe nach `exit` offen: beim Abschluss die Gruppe mitnehmen.
    forced: boolean;
    killProblem: string | null;
    killTimer: NodeJS.Timeout | null;
    deadlineTimer: NodeJS.Timeout | null;
    exitTimer: NodeJS.Timeout | null;
    exit: ProcessExit | null;
}

function createRun(child: SpawnedProcess, startedAt: EpochMillis): ActiveRun {
    let settle: (outcome: BuildOutcome) => void = () => undefined;
    const done = new Promise<BuildOutcome>((resolve) => (settle = resolve));
    return {
        child, pid: child.pid, startedAt, done, settle, finish: () => undefined, settled: false,
        cancelRequested: false, forced: false, killProblem: null,
        killTimer: null, deadlineTimer: null, exitTimer: null, exit: null,
    };
}

function withProblem(outcome: BuildOutcome, problem: string | null): BuildOutcome {
    if (problem === null || outcome.kind !== 'finished' || outcome.problem !== null) return outcome;
    return { ...outcome, problem };
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
        const outputLog = openOutputLog(request.outputLogPath);
        let child: SpawnedProcess;
        try {
            child = this.dependencies.spawn(request.latexmk, argumentsFor(request, platform), options);
        } catch (error) {
            void outputLog?.close();
            return Promise.resolve(rejected('launchFailed', BUILD_MESSAGES.launchFailed(describeError(error))));
        }
        return this.track(child, outputLog);
    }

    // Wartet, bis der Lauf samt Kindern beendet ist. Ohne laufenden Build tut es nichts.
    async cancel(): Promise<void> {
        const run = this.active;
        if (run === null) return;
        if (!run.cancelRequested) {
            run.cancelRequested = true;
            this.setState('cancelling', run.startedAt);
            this.terminateTree(run);
            run.deadlineTimer = setTimeout(() => this.forceFinish(run), this.dependencies.cancelDeadlineMs);
        }
        await run.done;
    }

    private track(child: SpawnedProcess, outputLog: OutputLog | null): Promise<BuildOutcome> {
        const run = createRun(child, this.dependencies.now());
        this.active = run;
        this.setState('running', run.startedAt);
        const splitters = this.attachOutput(child, outputLog);
        run.finish = (outcome) => this.finishRun(run, splitters, outputLog, outcome);
        child.on('error', (error) => run.finish(rejected('launchFailed', BUILD_MESSAGES.launchFailed(error.message))));
        child.on('exit', (code, signal) => this.onExit(run, { code, signal }));
        child.on('close', (code, signal) => run.finish(this.finishedOutcome(run, { code, signal }, null)));
        return run.done;
    }

    private finishRun(run: ActiveRun, splitters: LineSplitter[], outputLog: OutputLog | null, outcome: BuildOutcome): void {
        if (run.settled) return;
        run.settled = true;
        splitters.forEach((splitter) => splitter.flush());
        this.release(run);
        if (outputLog === null) {
            run.settle(outcome);
            return;
        }
        void outputLog.close().then((failure) => {
            run.settle(withProblem(outcome, failure === null ? null : BUILD_MESSAGES.outputLogFailed(failure)));
        });
    }

    // Ohne Abbruch: kommt `close` nach `exit` nicht bald, hält ein Unterprozess die Pipe offen.
    private onExit(run: ActiveRun, exit: ProcessExit): void {
        run.exit = exit;
        if (run.cancelRequested || run.settled) return;
        run.exitTimer = setTimeout(() => {
            run.forced = true;
            this.forceFinish(run);
        }, this.dependencies.exitCloseGraceMs);
    }

    // Frist abgelaufen: Pipes trennen und über `exit` (oder ohne) abschließen, damit der Runner nicht in
    // `running`/`cancelling` hängen bleibt und neue Builds nicht für immer `busy` sind.
    private forceFinish(run: ActiveRun): void {
        run.child.stdout?.destroy();
        run.child.stderr?.destroy();
        run.finish(this.finishedOutcome(run, run.exit ?? { code: null, signal: null }, forcedProblem(run)));
    }

    private attachOutput(child: SpawnedProcess, outputLog: OutputLog | null): LineSplitter[] {
        const streams: [Readable | null, OutputStream][] = [[child.stdout, 'stdout'], [child.stderr, 'stderr']];
        return streams.flatMap(([stream, name]) => {
            if (stream === null) return [];
            const splitter = createLineSplitter((line) => this.listener.onLine?.(line, name));
            stream.setEncoding('utf8');
            stream.on('data', (chunk: string) => {
                outputLog?.write(chunk);
                splitter.push(chunk);
            });
            return [splitter];
        });
    }

    private finishedOutcome(run: ActiveRun, exit: ProcessExit, problem: string | null): BuildOutcome {
        const cancelled = run.cancelRequested;
        const durationMs = this.dependencies.now() - run.startedAt;
        const { code, signal } = exit;
        const reported = problem ?? run.killProblem;
        return { kind: 'finished', ok: code === 0 && !cancelled, cancelled, exitCode: code, signal, durationMs, problem: reported };
    }

    private release(run: ActiveRun): void {
        for (const timer of [run.killTimer, run.deadlineTimer, run.exitTimer]) if (timer !== null) clearTimeout(timer);
        run.killTimer = null;
        run.deadlineTimer = null;
        run.exitTimer = null;
        // Restliche Gruppenmitglieder (Enkel, die SIGTERM ignorieren oder die Pipe hielten) mitnehmen.
        const sweep = run.cancelRequested || run.forced;
        if (sweep && run.pid !== undefined && !isWindowsPlatform(this.dependencies.platform)) {
            this.signalGroup(run.pid, 'SIGKILL');
        }
        this.active = null;
        this.setState('idle', null);
    }

    private terminateTree(run: ActiveRun): void {
        if (run.pid === undefined) return;
        const plan = killPlanFor(run.pid, this.dependencies.platform, this.dependencies.env);
        if (plan.kind === 'taskkill') {
            this.runTaskkill(run, plan);
            return;
        }
        this.signalGroup(plan.groupId, 'SIGTERM');
        run.killTimer = setTimeout(() => this.signalGroup(plan.groupId, 'SIGKILL'), this.dependencies.killGraceMs);
    }

    // Scheitert taskkill, bleibt nur die Frist; die Ursache steht dann im Ergebnis (`problem`).
    private runTaskkill(run: ActiveRun, plan: Extract<KillPlan, { kind: 'taskkill' }>): void {
        try {
            const killer = this.dependencies.spawn(plan.command, plan.args, { shell: false, windowsHide: true, stdio: 'ignore' });
            killer.on('error', (error) => {
                run.killProblem = BUILD_MESSAGES.taskkillFailed(error.message);
            });
        } catch (error) {
            run.killProblem = BUILD_MESSAGES.taskkillFailed(describeError(error));
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

function forcedProblem(run: ActiveRun): string {
    if (!run.cancelRequested) return BUILD_MESSAGES.outputHeldAfterExit;
    return run.exit === null ? BUILD_MESSAGES.cancelUnconfirmed : BUILD_MESSAGES.outputHeldOpen;
}

function rejected(reason: 'busy' | 'blocked' | 'launchFailed', message: string): BuildOutcome {
    return { kind: 'rejected', reason, message };
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// ---------- Warteschlange und Ereignisse ----------

// Hook für den Log-Parser (W2-11): liest `<Hauptdatei>.log` und liefert die Meldungen; Standard ohne Meldungen.
export type LogParser = (logPath: AbsolutePath) => Promise<readonly BuildIssue[]>;
export const NO_LOG_PARSER: LogParser = () => Promise.resolve([]);

export type BuildFinishedEvent = IpcEvents['build:finished'];
export type FileStat = (target: string) => Promise<{ readonly mtimeMs: number }>;

export interface BuildQueueOptions {
    // Sendet `build:status` und `build:finished` (in `index.ts` an `webContents.send` des Hauptfensters).
    readonly emit: EventSender;
    readonly dependencies?: BuildDependencies;
    readonly parseLog?: LogParser;
    readonly stat?: FileStat;
    readonly log?: (message: string) => void;
    // Ausgabe zeilenweise während des Laufs (z. B. für eine spätere Live-Protokollansicht).
    readonly onLine?: (line: string, stream: OutputStream) => void;
}

// Dateisysteme speichern Änderungszeiten teils nur sekundengenau (wie Swift `timestampTolerance`).
const LOG_TIMESTAMP_TOLERANCE_MS = 1_000;
const LOG_EXTENSION = '.log';
const PDF_EXTENSION = '.pdf';

function issue(severity: BuildIssue['severity'], message: string): BuildIssue {
    return { severity, message, file: null, line: null };
}

export function exitDetail(outcome: Extract<BuildOutcome, { kind: 'finished' }>): string {
    return outcome.exitCode !== null ? `Exit-Code ${outcome.exitCode}` : `Signal ${outcome.signal ?? 'unbekannt'}`;
}

// Nie zwei latexmk-Läufe gleichzeitig. Aufträge während eines Laufs werden zu EINEM Folgelauf zusammengefasst
// (der letzte gewinnt, Status `queued`); „Abbrechen“ verwirft auch den vorgemerkten Auftrag. `clean` läuft nur,
// wenn nichts läuft. Nach `shutdown` (Beenden der App) startet nichts mehr.
export class BuildQueue {
    private readonly runner: BuildRunner;
    private readonly dependencies: BuildDependencies;
    private state: BuildState = 'idle';
    private startedAt: EpochMillis | null = null;
    private pending: BuildRequest | null = null;
    private active: Promise<void> | null = null;
    private closed = false;

    constructor(private readonly options: BuildQueueOptions) {
        this.dependencies = options.dependencies ?? defaultBuildDependencies();
        this.runner = new BuildRunner(this.dependencies, options.onLine === undefined ? {} : { onLine: options.onLine });
    }

    get currentState(): BuildState {
        return this.state;
    }

    // Wartet, bis die Warteschlange leer ist (für Tests und das Beenden).
    whenIdle(): Promise<void> {
        return this.active ?? Promise.resolve();
    }

    // `false`, wenn die App beendet wird (kein Start mehr).
    request(request: BuildRequest): boolean {
        if (this.closed) return false;
        this.pending = { ...request, task: 'compile' };
        if (this.active !== null) {
            this.setState('queued', this.startedAt);
            return true;
        }
        this.active = this.drain(null);
        return true;
    }

    async cancel(): Promise<void> {
        this.pending = null;
        if (this.active === null) return;
        this.setState('cancelling', this.startedAt);
        await this.runner.cancel();
    }

    // Beim Beenden der App: nichts Neues mehr, laufenden Build abbrechen und sein Ende abwarten.
    async shutdown(): Promise<void> {
        this.closed = true;
        await this.cancel();
        await this.whenIdle();
    }

    clean(request: BuildRequest): Promise<BuildOutcome> {
        if (this.closed) return Promise.resolve(rejected('blocked', BUILD_MESSAGES.shuttingDown));
        if (this.active !== null) return Promise.resolve(rejected('busy', BUILD_MESSAGES.cleanBusy));
        this.setState('running', this.dependencies.now());
        const outcome = this.runner.start({ ...request, task: 'clean' });
        this.active = this.drain(outcome.then(() => undefined));
        return outcome;
    }

    private async drain(first: Promise<void> | null): Promise<void> {
        try {
            if (first !== null) await first;
            while (this.pending !== null && !this.closed) {
                const request = this.pending;
                this.pending = null;
                await this.compile(request);
            }
        } finally {
            this.active = null;
            this.pending = null;
            this.setState('idle', null);
        }
    }

    private async compile(request: BuildRequest): Promise<void> {
        const startedAt = this.dependencies.now();
        this.setState('running', startedAt);
        const outcome = await this.runner.start(request);
        if (outcome.kind === 'finished' && outcome.problem !== null) this.options.log?.(outcome.problem);
        this.options.emit('build:finished', await this.finishedEvent(request, outcome, startedAt));
    }

    private async finishedEvent(request: BuildRequest, outcome: BuildOutcome, startedAt: EpochMillis): Promise<BuildFinishedEvent> {
        if (outcome.kind === 'rejected') {
            return { ok: false, cancelled: false, report: [issue('error', outcome.message)], pdfPath: null, durationMs: 0 };
        }
        const problems = outcome.problem === null ? [] : [issue('warning', outcome.problem)];
        const { durationMs } = outcome;
        // Nach einem Abbruch sind Log und PDF halb geschrieben: nichts davon auswerten.
        if (outcome.cancelled) return { ok: false, cancelled: true, report: problems, pdfPath: null, durationMs };
        const report = [...problems, ...(await this.logReport(request.mainFile, outcome, startedAt))];
        const ok = outcome.ok && !report.some((entry) => entry.severity === 'error');
        return { ok, cancelled: false, report, pdfPath: await this.existingPdf(request.mainFile), durationMs };
    }

    // Wie Swift: nach Erfolg gilt auch ein älteres Log („alles aktuell“), nach einem Fehlschlag nur eines aus
    // diesem Lauf. Fehlschlag ohne erkannte Fehler: Hinweis auf das Log.
    private async logReport(
        mainFile: AbsolutePath,
        outcome: Extract<BuildOutcome, { kind: 'finished' }>,
        startedAt: EpochMillis,
    ): Promise<BuildIssue[]> {
        const logPath = siblingPath(mainFile, LOG_EXTENSION, this.dependencies.platform);
        const fresh = outcome.exitCode === 0 || (await this.modifiedSince(logPath, startedAt));
        const issues = fresh ? await this.parseSafely(logPath) : [];
        if (outcome.exitCode === 0 || issues.some((entry) => entry.severity === 'error')) return issues;
        return [issue('error', BUILD_MESSAGES.exitFailed(exitDetail(outcome))), ...issues];
    }

    private async parseSafely(logPath: AbsolutePath): Promise<BuildIssue[]> {
        try {
            return [...(await (this.options.parseLog ?? NO_LOG_PARSER)(logPath))];
        } catch (error) {
            return [issue('warning', BUILD_MESSAGES.logUnreadable(describeError(error)))];
        }
    }

    private async modifiedSince(target: AbsolutePath, since: EpochMillis): Promise<boolean> {
        try {
            const { mtimeMs } = await (this.options.stat ?? nativeStat)(target);
            return mtimeMs >= since - LOG_TIMESTAMP_TOLERANCE_MS;
        } catch {
            return false;
        }
    }

    private async existingPdf(mainFile: AbsolutePath): Promise<AbsolutePath | null> {
        const pdfPath = siblingPath(mainFile, PDF_EXTENSION, this.dependencies.platform);
        try {
            await (this.options.stat ?? nativeStat)(pdfPath);
            return pdfPath;
        } catch {
            return null;
        }
    }

    private setState(state: BuildState, startedAt: EpochMillis | null): void {
        this.startedAt = startedAt;
        if (this.state === state) return;
        this.state = state;
        this.options.emit('build:status', { state, startedAt });
    }
}
