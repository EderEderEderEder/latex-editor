import type { BuildIssue } from '../../shared/contract';
import type { LogParser as BuildLogParser } from '../build';
import type { TrashItem } from '../fsOps';
import { GrantStore } from '../grants';
import type { EventSender } from '../ipc';
import { createHandlerRegistry, type IpcHandlers } from '../ipcHandlers';
import type { QuitTasks } from '../lifecycle';
import { createLogParser, type ParseWorkerFactory, workerThreadFactory } from '../logParser';
import type { PathPlatform } from '../paths';
import { RecentProjectsStore } from '../project';
import { createSettingsHandlers, SettingsService } from '../settings';
import { createProjectHandlers } from './projectHandlers';
import { createBuildHandlers } from './buildHandlers';
import { createDialogHandlers, type DialogLike } from './dialogHandlers';
import { createFsHandlers } from './fsHandlers';
import { createFsOpsHandlers } from './fsOpsHandlers';
import { createTabMemoryHandlers, TabMemoryStore } from './tabMemoryHandlers';
import { createProjectWatch, type ProjectWatch, type ProjectWatchOptions } from './watchHandlers';

// Verdrahtung der echten Handler für einen App-Lauf, ohne Electron (`index.ts` reicht `dialog`,
// Hauptfenster und `userData`-Ordner herein). Alle übrigen Kanäle bleiben Platzhalter.

export interface AppHandlerOptions<W> {
    readonly userDataDir: string;
    readonly dialog: DialogLike<W>;
    readonly window: () => W | null;
    readonly platform: PathPlatform;
    readonly quitTasks: QuitTasks;
    readonly log: (message: string) => void;
    // `app:confirmClose`: Der Renderer hat Ungespeichertes geklärt (K1, `CloseGuard.confirm`).
    readonly confirmClose: () => void;
    // Ereignisse an das Hauptfenster (`build:status`, `build:finished`); ohne (Tests) gehen sie verloren.
    readonly emit?: EventSender;
    // `fs:trash` (in `index.ts` `shell.trashItem`); ohne meldet `fs:trash` einen Fehler.
    readonly trashItem?: TrashItem;
    // Gebündelte `parse.worker`-Datei; ohne bleibt `build:finished.report` ohne Meldungen aus dem Log.
    readonly parseWorkerScript?: string;
    // Nur für Tests: Worker und Überwacher ohne echten Thread bzw. ohne `fs.watch`.
    readonly createParseWorker?: ParseWorkerFactory;
    readonly createWatcher?: ProjectWatchOptions['createWatcher'];
}

export interface AppHandlers {
    readonly handlers: IpcHandlers;
    readonly grants: GrantStore;
    readonly settings: SettingsService;
    // Dateiüberwachung (`fs:changed`); `null` ohne `emit`. `rescan()` bei Fenster-Fokus und nach `build:finished`.
    readonly watch: ProjectWatch | null;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

const BIBER_LOG_EXTENSION = '.blg';

// Nur die Felder des Vertrags (`BuildIssue`); `id` und `detail` des Parsers gehen nicht über IPC.
function toBuildIssue(issue: BuildIssue): BuildIssue {
    return { severity: issue.severity, message: issue.message, file: issue.file, line: issue.line };
}

// latexmk läuft mit `-cd` ohne Ausgabeordner: Log und Biber-Log liegen neben der Hauptdatei, deren Ordner
// auch die relativen Pfade im Log auflöst.
export function createBuildLogParser<W>(options: AppHandlerOptions<W>): BuildLogParser | undefined {
    const createWorker = options.createParseWorker
        ?? (options.parseWorkerScript === undefined ? undefined : workerThreadFactory(options.parseWorkerScript));
    if (createWorker === undefined) return undefined;
    const parser = createLogParser({ createWorker });
    options.quitTasks.add(() => parser.dispose());
    const { path } = options.platform;
    return async (logPath) => {
        const { dir, name } = path.parse(logPath);
        const issues = await parser.parseLogFile(logPath, path.join(dir, name + BIBER_LOG_EXTENSION), dir);
        return issues.map(toBuildIssue);
    };
}

function createWatch<W>(options: AppHandlerOptions<W>, grants: GrantStore): ProjectWatch | null {
    const { emit, quitTasks, log } = options;
    return createProjectWatch({ grants, emit, quitTasks, log, createWatcher: options.createWatcher });
}

function createSettings<W>(options: AppHandlerOptions<W>): SettingsService {
    const settings = new SettingsService(options.userDataDir, {
        onSaveError: (error) => options.log(`Einstellungen nicht gespeichert: ${describeError(error)}`),
    });
    options.quitTasks.add(() => settings.flush());
    return settings;
}

export function createAppHandlers<W>(options: AppHandlerOptions<W>): AppHandlers {
    const { dialog, window, platform, userDataDir, quitTasks, log } = options;
    // Eine Gewährungsliste je App-Lauf: Kennungen verfallen beim Beenden.
    const grants = new GrantStore({ platform });
    const settings = createSettings(options);
    const watch = createWatch(options, grants);
    const emit = options.emit ?? (() => undefined);
    const parseLog = createBuildLogParser(options);
    const handlers = createHandlerRegistry({
        'app:confirmClose': () => Promise.resolve(options.confirmClose()),
        ...createSettingsHandlers(settings),
        ...createDialogHandlers({ dialog, grants, window, platform }),
        ...createFsHandlers({ grants, watch }),
        ...createFsOpsHandlers({ grants, userDataDir, trashItem: options.trashItem }),
        ...createTabMemoryHandlers(new TabMemoryStore({ userDataDir, grants })),
        ...createProjectHandlers({ grants, recent: new RecentProjectsStore(userDataDir, platform), log }),
        ...createBuildHandlers({ grants, emit, quitTasks, userDataDir, log, watch, parseLog }),
    });
    return { handlers, grants, settings, watch };
}
