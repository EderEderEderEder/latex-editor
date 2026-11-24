import type { ContentHash } from '../../shared/contract';
import type { GrantStore } from '../grants';
import type { EventSender } from '../ipc';
import type { QuitTasks } from '../lifecycle';
import { describeWatchError, type FileWatcher, ProjectWatcher } from '../watch';

// Dateiüberwachung je Projekt (W2-2): startet beim Projektwechsel (`GrantStore.onProjectChanged`), schickt
// `fs:changed` über `emit` an das Hauptfenster und endet beim nächsten Wechsel oder beim Beenden (`QuitTasks`).
// Keine Anfragekanäle: Build (`build:finished`) und Fenster-Fokus rufen `rescan()` direkt im Main auf.

export interface ProjectWatchOptions {
    readonly grants: GrantStore;
    // Ohne Ereignisweg (z. B. Tests ohne Fenster) gibt es keine Überwachung.
    readonly emit: EventSender | undefined;
    readonly quitTasks: QuitTasks;
    readonly log: (message: string) => void;
    readonly createWatcher?: (onError: (error: Error) => void) => FileWatcher;
}

export interface ProjectWatch {
    // Sicherheitsnetz statt Polling: nach `build:finished`, bei Fenster-Fokus.
    rescan(): Promise<void>;
    // Nach `fs:writeText` mit dem Hash aus `WriteResult`: das Echo des eigenen Speicherns entfällt.
    ignoreOwnWrite(path: string, hash: ContentHash): void;
    // Vor dem Build: Build-PDF (bekannter Pfad), damit jeder Lauf keinen eigenen Stapel auslöst.
    setBuildOutputs(paths: readonly string[]): void;
}

export const WATCH_MESSAGES = {
    unavailable: (reason: string) =>
        `Dateiüberwachung nicht verfügbar (${reason}); Änderungen von außen erscheinen erst nach Fokuswechsel oder Build`,
    startFailed: (reason: string) => `Dateiüberwachung nicht gestartet: ${reason}`,
} as const;

function describe(error: unknown): string {
    return error instanceof Error ? describeWatchError(error) : String(error);
}

export function createProjectWatch(options: ProjectWatchOptions): ProjectWatch | null {
    const { emit, grants, log } = options;
    if (emit === undefined) return null;
    const create = options.createWatcher ?? ((onError) => new ProjectWatcher({ onError }));
    let current: FileWatcher | null = null;
    const switchTo = (root: string | null): void => {
        current?.stop();
        current = null;
        if (root === null) return;
        const watcher = create((error) => log(WATCH_MESSAGES.unavailable(describe(error))));
        current = watcher;
        watcher.start(root, (batch) => emit('fs:changed', batch)).catch((error: unknown) => log(WATCH_MESSAGES.startFailed(describe(error))));
    };
    const unsubscribe = grants.onProjectChanged(switchTo);
    if (grants.currentProject !== null) switchTo(grants.currentProject);
    options.quitTasks.add(() => {
        unsubscribe();
        switchTo(null);
    });
    return {
        rescan: () => current?.rescan() ?? Promise.resolve(),
        ignoreOwnWrite: (path, hash) => current?.ignoreOwnWrite(path, hash),
        setBuildOutputs: (paths) => current?.setBuildOutputs(paths),
    };
}
