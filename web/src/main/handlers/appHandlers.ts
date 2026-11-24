import { GrantStore } from '../grants';
import { createHandlerRegistry, type IpcHandlers } from '../ipcHandlers';
import type { QuitTasks } from '../lifecycle';
import type { PathPlatform } from '../paths';
import { createSettingsHandlers, SettingsService } from '../settings';
import { createDialogHandlers, type DialogLike } from './dialogHandlers';
import { createFsHandlers } from './fsHandlers';

// Verdrahtung der echten Handler für einen App-Lauf, ohne Electron (`index.ts` reicht `dialog`,
// Hauptfenster und `userData`-Ordner herein). Alle übrigen Kanäle bleiben Platzhalter.

export interface AppHandlerOptions<W> {
    readonly userDataDir: string;
    readonly dialog: DialogLike<W>;
    readonly window: () => W | null;
    readonly platform: PathPlatform;
    readonly quitTasks: QuitTasks;
    readonly log: (message: string) => void;
}

export interface AppHandlers {
    readonly handlers: IpcHandlers;
    readonly grants: GrantStore;
    readonly settings: SettingsService;
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
        ...createSettingsHandlers(settings),
        ...createDialogHandlers({ dialog, grants, window, platform }),
        ...createFsHandlers({ grants }),
    });
    return { handlers, grants, settings };
}
