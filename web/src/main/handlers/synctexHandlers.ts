import type { AbsolutePath, IpcEvents, SyncTexBackwardResult, SyncTexForwardResult } from '../../shared/contract';
import { IpcFailure } from '../../shared/ipcResult';
import type { GrantStore } from '../grants';
import type { EventSender } from '../ipc';
import type { IpcHandler, IpcHandlers } from '../ipcHandlers';
import type { QuitTasks } from '../lifecycle';
import { isInsideProject, type RealpathFunction, rebaseToProjectRoot, resolveRealPath } from '../paths';
import { type SyncTeXBackend, SyncTeXClient, SyncTeXClientError, type SyncTeXWorkerFactory } from '../synctexClient';
import { type PdfStat, SyncTeXService } from '../synctexService';

// Kanäle `synctex:forward` (Datei + Zeile → Seite + Rechtecke) und `synctex:backward` (Seite + Punkt → Datei + Zeile)
// und das Nachladen nach `build:finished` bzw. `project:open`. Absenderprüfung und `{ok, value}` übernimmt `ipc.ts`.
// Ohne Projekt oder ohne geladene Daten liefern beide `null`; `forward` nimmt nur Dateien im Projekt an,
// `backward` liefert nur Projektdateien, in der Form der Projektwurzel (wie die Log-Meldungen im Build-Bericht).

export type SyncTeXHandlers = Pick<IpcHandlers, 'synctex:forward' | 'synctex:backward'>;

export interface SyncTeXHandlerDependencies {
    readonly grants: GrantStore;
    readonly backend: SyncTeXBackend;
    readonly service: SyncTeXService;
    readonly realpath?: RealpathFunction | undefined;
}

export interface SyncTeXFeatureOptions {
    readonly grants: GrantStore;
    readonly emit: EventSender;
    readonly quitTasks: QuitTasks;
    readonly log: (message: string) => void;
    readonly createWorker: SyncTeXWorkerFactory;
    readonly realpath?: RealpathFunction | undefined;
    readonly stat?: PdfStat | undefined;
    readonly timeoutMs?: number | undefined;
}

export interface SyncTeXFeature {
    readonly handlers: SyncTeXHandlers;
    readonly service: SyncTeXService;
    /** Leitet alle Ereignisse weiter; nach `build:finished` mit PDF werden die SyncTeX-Daten neu geladen */
    observeBuildEvents(emit: EventSender): EventSender;
    /** `project:open`, danach Nachladen neben der erkannten Hauptdatei */
    reloadOnProjectOpen(open: IpcHandler<'project:open'>): IpcHandler<'project:open'>;
}

// Die Worker-Antwort `notFound` heißt „keine Daten geladen“ (z. B. nach einem Neustart mit fehlender Datei).
async function queryOrNull<T>(query: () => Promise<T | null>): Promise<T | null> {
    try {
        return await query();
    } catch (error) {
        if (!(error instanceof SyncTeXClientError)) throw error;
        if (error.error.kind === 'notFound') return null;
        throw new IpcFailure(error.error);
    }
}

function realPathOptions(deps: SyncTeXHandlerDependencies): { platform: GrantStore['platform']; realpath?: RealpathFunction } {
    const platform = deps.grants.platform;
    return deps.realpath === undefined ? { platform } : { platform, realpath: deps.realpath };
}

// Gesucht wird mit dem aufgelösten Pfad: SyncTeX nennt die Pfade, mit denen TeX lief (latexmk mit aufgelöster Hauptdatei).
async function forward(deps: SyncTeXHandlerDependencies, file: AbsolutePath, line: number): Promise<SyncTexForwardResult | null> {
    if (deps.grants.currentProject === null || !deps.service.hasData) return null;
    const resolved = await deps.grants.assertInProject(file, deps.realpath);
    return queryOrNull(() => deps.backend.forward(resolved, line));
}

// SyncTeX nennt aufgelöste Pfade (`realpath`, unter macOS `/private/var/…`), die Oberfläche kennt das Projekt in
// der Form der Gewährung: erst in diese Form bringen, dann prüfen (lexikalisch und aufgelöst, Symlinks nach außen).
async function projectFormPath(file: string, root: string, deps: SyncTeXHandlerDependencies): Promise<string | null> {
    const options = realPathOptions(deps);
    try {
        const realRoot = await resolveRealPath(root, options);
        const rebased = rebaseToProjectRoot(file, realRoot, root, options.platform);
        return (await isInsideProject(rebased, root, options)) ? rebased : null;
    } catch (error) {
        // Kein absoluter Pfad in der SyncTeX-Datei (`normalizeAbsolutePath`): keine Projektdatei.
        if (error instanceof IpcFailure) return null;
        throw error;
    }
}

async function backward(deps: SyncTeXHandlerDependencies, page: number, x: number, y: number): Promise<SyncTexBackwardResult | null> {
    const root = deps.grants.currentProject;
    if (root === null || !deps.service.hasData) return null;
    const result = await queryOrNull(() => deps.backend.backward(page, x, y));
    if (result === null) return null;
    const file = await projectFormPath(result.file, root, deps);
    return file === null ? null : { file, line: result.line };
}

export function createSyncTeXHandlers(deps: SyncTeXHandlerDependencies): SyncTeXHandlers {
    return {
        'synctex:forward': (file, line) => forward(deps, file, line),
        'synctex:backward': (page, x, y) => backward(deps, page, x, y),
    };
}

// Auch nach einem Build mit Fehlern: latexmk (`nonstopmode`) schreibt PDF und SyncTeX trotzdem, und die PDF-Ansicht
// zeigt das neue PDF. Nach einem Abbruch sind die Dateien halb geschrieben (`pdfPath` ist dann `null`).
export function observeBuildEvents(emit: EventSender, service: SyncTeXService): EventSender {
    return (event, payload) => {
        emit(event, payload);
        if (event !== 'build:finished') return;
        const finished = payload as IpcEvents['build:finished'];
        if (finished.cancelled || finished.pdfPath === null) return;
        void service.reloadBeside(finished.pdfPath);
    };
}

export function reloadOnProjectOpen(open: IpcHandler<'project:open'>, service: SyncTeXService): IpcHandler<'project:open'> {
    return async (grantId) => {
        const info = await open(grantId);
        if (info.mainFile !== null) void service.reloadBeside(info.mainFile);
        return info;
    };
}

export function createSyncTeXFeature(options: SyncTeXFeatureOptions): SyncTeXFeature {
    const { grants, emit, log, realpath } = options;
    const client = new SyncTeXClient({ createWorker: options.createWorker, timeoutMs: options.timeoutMs });
    const service = new SyncTeXService({ backend: client, platform: grants.platform, emit, log, stat: options.stat, realpath });
    const unsubscribe = grants.onProjectChanged(() => service.reset());
    options.quitTasks.add(() => {
        unsubscribe();
        client.dispose();
    });
    return {
        handlers: createSyncTeXHandlers({ grants, backend: client, service, realpath }),
        service,
        observeBuildEvents: (target) => observeBuildEvents(target, service),
        reloadOnProjectOpen: (open) => reloadOnProjectOpen(open, service),
    };
}
