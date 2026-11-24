// „Kompilieren beim Speichern“ (Einstellung `compilesOnSave`): Nach dem erfolgreichen Speichern einer `.tex`- oder
// `.bib`-Datei im Projekt startet entprellt ein Build. Mehrere Speichervorgänge kurz hintereinander ergeben einen Lauf;
// läuft schon einer, fasst der Main den Auftrag zusammen (nie parallel). Der Zeitgeber ist einspeisbar.
import { relativeToProject } from './pathBarData';

export const COMPILE_ON_SAVE_DELAY_MS = 400;
const WATCHED_FILE = /\.(tex|bib)$/i;

export interface BuildTimer {
    set(callback: () => void, delayMs: number): unknown;
    clear(handle: unknown): void;
}

export interface CompileOnSaveDeps {
    readonly isEnabled: () => boolean;
    readonly root: () => string | null;
    readonly compile: () => void;
    readonly timer?: BuildTimer;
    readonly delayMs?: number;
}

export interface CompileOnSave {
    /** Meldet eine erfolgreich gespeicherte Datei (Projektpfad oder Kennung) */
    notifySaved(path: string): void;
    cancel(): void;
}

const browserTimer: BuildTimer = {
    set: (callback, delayMs) => setTimeout(callback, delayMs),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createCompileOnSave(deps: CompileOnSaveDeps): CompileOnSave {
    const timer = deps.timer ?? browserTimer;
    let handle: unknown;
    let isScheduled = false;
    const cancel = (): void => {
        if (!isScheduled) return;
        timer.clear(handle);
        isScheduled = false;
    };
    const fire = (): void => {
        isScheduled = false;
        if (deps.isEnabled()) deps.compile();
    };
    return {
        cancel,
        notifySaved: (path) => {
            if (!deps.isEnabled() || !WATCHED_FILE.test(path)) return;
            if (relativeToProject(deps.root(), path) === null) return;
            cancel();
            handle = timer.set(fire, deps.delayMs ?? COMPILE_ON_SAVE_DELAY_MS);
            isScheduled = true;
        },
    };
}
