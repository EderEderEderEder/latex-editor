import type { AbsolutePath, BuildOptions, ToolsInfo } from '../../shared/contract';
import { IpcFailure } from '../../shared/ipcResult';
import {
    BUILD_MESSAGES,
    type BuildDependencies,
    type BuildOutcome,
    BuildQueue,
    type BuildRequest,
    exitDetail,
    type LogParser,
} from '../build';
import type { GrantStore } from '../grants';
import type { EventSender } from '../ipc';
import type { IpcHandlers } from '../ipcHandlers';
import { isGrantId } from '../ipcValidation';
import type { QuitTasks } from '../lifecycle';
import { currentPathPlatform, rebaseToProjectRoot, resolveRealPath } from '../paths';
import type { RealpathFunction } from '../paths';
import { detectTools as nativeDetectTools } from '../tools';
import type { ProjectWatch } from './watchHandlers';

// Kanäle `tools:detect`, `build:start`, `build:cancel`, `build:clean`. Die Hauptdatei muss (aufgelöst) im
// aktuellen Projekt liegen; Gewährungen (Einzeldateien außerhalb) werden nicht kompiliert. Ereignisse gehen
// über `emit` an das Hauptfenster; das Beenden der App bricht einen laufenden Build ab (`QuitTasks`).
// Die Dateiüberwachung kennt vor jedem Lauf das Build-PDF und prüft nach `build:finished` den Baum (Sicherheitsnetz).

export type BuildWatchHooks = Pick<ProjectWatch, 'setBuildOutputs' | 'rescan'>;

export interface BuildHandlerDependencies {
    readonly grants: GrantStore;
    readonly emit: EventSender;
    readonly quitTasks: QuitTasks;
    readonly userDataDir: string;
    readonly log: (message: string) => void;
    readonly detectTools?: () => Promise<ToolsInfo>;
    readonly buildDependencies?: BuildDependencies;
    readonly parseLog?: LogParser;
    readonly realpath?: RealpathFunction;
    readonly watch?: BuildWatchHooks | null;
}

export type BuildHandlers = Pick<IpcHandlers, 'tools:detect' | 'build:start' | 'build:cancel' | 'build:clean'>;

// Rohe Ausgabe des letzten Laufs (für die Protokollansicht), je Lauf überschrieben.
export const BUILD_OUTPUT_FILE_NAME = 'latexmk-output.txt';
const TEX_EXTENSION = '.tex';
const PDF_EXTENSION = '.pdf';

export const BUILD_HANDLER_MESSAGES = {
    notInProject: 'Kompilieren lässt sich nur eine Datei im geöffneten Projekt.',
    notTex: 'Kompilieren lässt sich nur eine .tex-Datei.',
    latexmkMissing: 'latexmk wurde nicht gefunden.',
    cleanFailed: (detail: string) => `Aufräumen ist fehlgeschlagen (${detail}).`,
} as const;

interface BuildContext {
    readonly deps: BuildHandlerDependencies;
    readonly queue: BuildQueue;
    tools: ToolsInfo | null;
}

async function resolveMainFile(mainFile: AbsolutePath, deps: BuildHandlerDependencies): Promise<AbsolutePath> {
    if (isGrantId(mainFile)) throw new IpcFailure({ kind: 'forbiddenPath', message: BUILD_HANDLER_MESSAGES.notInProject });
    const resolved = await deps.grants.assertInProject(mainFile, deps.realpath);
    const extension = deps.grants.platform.path.extname(resolved).toLowerCase();
    if (extension !== TEX_EXTENSION) throw new IpcFailure({ kind: 'invalidInput', message: BUILD_HANDLER_MESSAGES.notTex });
    return resolved;
}

// Werkzeuge einmal je App-Lauf suchen (die Meldungen raten zum Neustart nach der Installation); `tools:detect` frischt auf.
async function detect(context: BuildContext): Promise<ToolsInfo> {
    context.tools = await (context.deps.detectTools ?? nativeDetectTools)();
    return context.tools;
}

async function prepareRequest(context: BuildContext, mainFile: AbsolutePath, options: BuildOptions): Promise<BuildRequest> {
    const resolved = await resolveMainFile(mainFile, context.deps);
    const tools = context.tools ?? (await detect(context));
    if (tools.latexmk === null) {
        const message = tools.problems.find((problem) => problem.tool === 'latexmk')?.message ?? BUILD_HANDLER_MESSAGES.latexmkMissing;
        throw new IpcFailure({ kind: 'notFound', message });
    }
    return { latexmk: tools.latexmk, mainFile: resolved, options, problems: tools.problems };
}

// Nur das PDF: alle übrigen Build-Dateien filtert die Überwachung ohnehin (`isBuildFileName`).
function buildOutputsOf(mainFile: AbsolutePath, deps: BuildHandlerDependencies): AbsolutePath[] {
    const { path } = deps.grants.platform;
    const { dir, name } = path.parse(mainFile);
    return [path.join(dir, name + PDF_EXTENSION)];
}

async function startBuild(context: BuildContext, mainFile: AbsolutePath, options: BuildOptions): Promise<void> {
    const request = await prepareRequest(context, mainFile, options);
    context.deps.watch?.setBuildOutputs(buildOutputsOf(request.mainFile, context.deps));
    const outputLogPath = context.deps.grants.platform.path.join(context.deps.userDataDir, BUILD_OUTPUT_FILE_NAME);
    const accepted = context.queue.request({ ...request, outputLogPath });
    if (!accepted) throw new IpcFailure({ kind: 'conflict', message: BUILD_MESSAGES.shuttingDown });
}

function cleanFailure(outcome: BuildOutcome): IpcFailure | null {
    if (outcome.kind === 'rejected') {
        return new IpcFailure({ kind: outcome.reason === 'busy' ? 'conflict' : 'io', message: outcome.message });
    }
    if (outcome.cancelled || outcome.exitCode === 0) return null;
    return new IpcFailure({ kind: 'io', message: BUILD_HANDLER_MESSAGES.cleanFailed(exitDetail(outcome)) });
}

// Das PDF bleibt; die Rückfrage („Hilfsdateien löschen?“) stellt der Renderer vorher.
async function cleanBuild(context: BuildContext, mainFile: AbsolutePath): Promise<void> {
    const request = await prepareRequest(context, mainFile, { engine: 'pdflatex' });
    const failure = cleanFailure(await context.queue.clean(request));
    if (failure !== null) throw failure;
}

// Erst das Ereignis an den Renderer, dann der Abgleich: `fs:changed` folgt so nach `build:finished`.
function rescanAfterBuild(emit: EventSender, watch: BuildWatchHooks | null | undefined): EventSender {
    if (watch === undefined || watch === null) return emit;
    return (event, payload) => {
        emit(event, payload);
        if (event === 'build:finished') void watch.rescan();
    };
}

// Meldungen tragen aufgelöste Pfade (`realpath`); die Oberfläche kennt das Projekt in der Form der Gewährung.
function parseLogInProjectForm(deps: BuildHandlerDependencies, parse: LogParser): LogParser {
    return async (logPath) => {
        const issues = await parse(logPath);
        const root = deps.grants.currentProject;
        if (root === null) return issues;
        const platform = currentPathPlatform();
        const realRoot = await resolveRealPath(root, deps.realpath === undefined ? {} : { realpath: deps.realpath });
        return issues.map((issue) =>
            issue.file === null ? issue : { ...issue, file: rebaseToProjectRoot(issue.file, realRoot, root, platform) },
        );
    };
}

export function createBuildHandlers(deps: BuildHandlerDependencies): BuildHandlers {
    const queue = new BuildQueue({
        emit: rescanAfterBuild(deps.emit, deps.watch),
        log: (message) => deps.log(`Build: ${message}`),
        ...(deps.buildDependencies === undefined ? {} : { dependencies: deps.buildDependencies }),
        ...(deps.parseLog === undefined ? {} : { parseLog: parseLogInProjectForm(deps, deps.parseLog) }),
    });
    const context: BuildContext = { deps, queue, tools: null };
    deps.quitTasks.add(() => queue.shutdown());
    return {
        'tools:detect': () => detect(context),
        'build:start': (mainFile, options) => startBuild(context, mainFile, options),
        'build:cancel': () => queue.cancel(),
        'build:clean': (mainFile) => cleanBuild(context, mainFile),
    };
}
