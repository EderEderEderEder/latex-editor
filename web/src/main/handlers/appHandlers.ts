import { GrantStore } from '../grants';
import type { EventSender } from '../ipc';
import { createHandlerRegistry, type IpcHandlers } from '../ipcHandlers';
import type { QuitTasks } from '../lifecycle';
import type { PathPlatform } from '../paths';
import { RecentProjectsStore } from '../project';
import { createSettingsHandlers, SettingsService } from '../settings';
import { createProjectHandlers } from './projectHandlers';
import { createBuildHandlers } from './buildHandlers';
import { createDialogHandlers, type DialogLike } from './dialogHandlers';
import { createFsHandlers } from './fsHandlers';
import { createFsOpsHandlers } from './fsOpsHandlers';
import { createTabMemoryHandlers, TabMemoryStore } from './tabMemoryHandlers';
import { createProjectWatch, type ProjectWatch } from './watchHandlers';

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

export function createAppHandlers<W>(options: AppHandlerOptions<W>): AppHandlers {
    const { dialog, window, platform } = options;
    // Eine Gewährungsliste je App-Lauf: Kennungen verfallen beim Beenden.
    const grants = new GrantStore({ platform });
    const settings = new SettingsService(options.userDataDir, {
        onSaveError: (error) => options.log(`Einstellungen nicht gespeichert: ${describeError(error)}`),
    });
    options.quitTasks.add(() => settings.flush());
    const handlers = createHandlerRegistry({
        'app:confirmClose': () => Promise.resolve(options.confirmClose()),
        ...createSettingsHandlers(settings),
        ...createDialogHandlers({ dialog, grants, window, platform }),
        ...createFsHandlers({ grants }),
        ...createFsOpsHandlers({ grants, userDataDir: options.userDataDir }),
        ...createTabMemoryHandlers(new TabMemoryStore({ userDataDir: options.userDataDir, grants })),
        ...createProjectHandlers({ grants, recent: new RecentProjectsStore(options.userDataDir, platform), log: options.log }),
        ...createBuildHandlers({ grants, emit: options.emit ?? (() => undefined), quitTasks: options.quitTasks, userDataDir: options.userDataDir, log: options.log }),
    });
    const watch = createProjectWatch({ grants, emit: options.emit, quitTasks: options.quitTasks, log: options.log });
    return { handlers, grants, settings, watch };
}
