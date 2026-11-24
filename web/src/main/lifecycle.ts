// Beenden und zweite Instanz (Befund M5). Ohne Electron: `index.ts` reicht `app`/`BrowserWindow`
// nur über die kleinen Schnittstellen hier herein, damit Vitest die Abläufe prüft.

export type QuitTask = () => Promise<void> | void;

// Höchstens so lange hält das Aufräumen das Beenden auf. Etwas über der Abbruchfrist des Builds
// (`CANCEL_DEADLINE_MS` = 3 s), damit ein unbestätigter Abbruch noch gemeldet wird, bevor die App endet.
export const QUIT_CLEANUP_TIMEOUT_MS = 3_500;

// Aufräumarbeiten beim Beenden: Einstellungen sichern, Build abbrechen (`buildHandlers`), später Wächter und Worker.
export class QuitTasks {
    private readonly tasks = new Set<QuitTask>();

    add(task: QuitTask): () => void {
        this.tasks.add(task);
        return () => {
            this.tasks.delete(task);
        };
    }

    get size(): number {
        return this.tasks.size;
    }

    // Führt alle Aufgaben parallel aus; Fehler werden gemeldet, halten das Beenden aber nicht auf.
    async runAll(log: (message: string) => void, timeoutMs = QUIT_CLEANUP_TIMEOUT_MS): Promise<void> {
        const runs = [...this.tasks].map(async (task) => {
            try {
                await task();
            } catch (error) {
                log(`Aufräumen beim Beenden fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<void>((resolve) => {
            timer = setTimeout(() => {
                log('Aufräumen beim Beenden: Frist abgelaufen');
                resolve();
            }, timeoutMs);
        });
        await Promise.race([Promise.all(runs).then(() => undefined), timeout]);
        clearTimeout(timer);
    }
}

export interface PreventableEvent {
    preventDefault(): void;
}

export interface QuitHandlerOptions {
    readonly tasks: QuitTasks;
    readonly quit: () => void;
    readonly log: (message: string) => void;
    readonly timeoutMs?: number;
}

// Für `app.on('before-quit')`: Das erste Beenden wird aufgehalten, bis die Aufgaben fertig sind
// (oder die Frist abläuft), dann beendet `quit()` die App wirklich. Weitere Versuche dazwischen warten.
export function createBeforeQuitHandler(options: QuitHandlerOptions): (event: PreventableEvent) => void {
    let phase: 'idle' | 'cleaning' | 'done' = 'idle';
    return (event) => {
        if (phase === 'done') return;
        event.preventDefault();
        if (phase === 'cleaning') return;
        phase = 'cleaning';
        void options.tasks.runAll(options.log, options.timeoutMs).then(() => {
            phase = 'done';
            options.quit();
        });
    };
}

export interface WindowLike {
    isDestroyed(): boolean;
    isMinimized(): boolean;
    restore(): void;
    show(): void;
    focus(): void;
}

// Für `app.on('second-instance')`: das vorhandene Fenster nach vorn holen.
export function bringToFront(window: WindowLike | null): void {
    if (window === null || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
}

// ---------- Nachfrage beim Schließen mit Ungespeichertem (K1) ----------

export interface ClosableWindow {
    isDestroyed(): boolean;
    close(): void;
    destroy(): void;
}

export interface CloseGuardOptions {
    // Schickt `app:closeRequested` an den Renderer; `false`, wenn er nicht antworten kann (lädt noch, abgestürzt,
    // Stub-Preload ohne IPC): dann schließt das Fenster ohne Nachfrage, statt sich nie schließen zu lassen.
    readonly requestConfirmation: () => boolean;
    readonly log: (message: string) => void;
}

// open: nichts angefragt; asking: der Renderer fragt nach (oder hat abgebrochen, das erfährt der Main nicht);
// confirmed: der Renderer hat bestätigt, Fenster und Beenden laufen ohne neue Nachfrage durch.
export type ClosePhase = 'open' | 'asking' | 'confirmed';

// Zustandsmaschine „Schließen angefragt → bestätigt“ ohne Electron. `index.ts` hängt `onWindowClose` an
// `win.on('close')`, `interceptQuit` vor das Aufräumen in `before-quit` und `confirm` an `app:confirmClose`.
export class CloseGuard {
    private current: ClosePhase = 'open';

    constructor(private readonly options: CloseGuardOptions) {}

    get phase(): ClosePhase {
        return this.current;
    }

    // Für `win.on('close')`: aufhalten und den Renderer fragen; ein erneutes Schließen fragt erneut an
    // (der Renderer zeigt die Nachfrage nur einmal).
    onWindowClose(event: PreventableEvent): void {
        if (this.current === 'confirmed') return;
        if (!this.options.requestConfirmation()) {
            this.current = 'confirmed';
            return;
        }
        event.preventDefault();
        this.current = 'asking';
    }

    // Für `app:confirmClose`: nur nach einer Anfrage; zerstört das Fenster (`destroy` löst kein `close` aus).
    confirm(window: ClosableWindow | null): void {
        if (this.current !== 'asking') {
            this.options.log('Schließen bestätigt, ohne dass gefragt wurde: ignoriert');
            return;
        }
        this.current = 'confirmed';
        if (window !== null && !window.isDestroyed()) window.destroy();
    }

    // Für `before-quit` (⌘Q, Dock, `app.quit()`): Solange das Fenster offen und nicht bestätigt ist, wird das
    // Beenden aufgehalten und stattdessen das Fenster geschlossen; nach der Bestätigung beendet
    // `window-all-closed` die App erneut. `true` heißt: aufgehalten, das Aufräumen wartet.
    interceptQuit(event: PreventableEvent, window: ClosableWindow | null): boolean {
        if (this.current === 'confirmed' || window === null || window.isDestroyed()) return false;
        event.preventDefault();
        window.close();
        return true;
    }
}

// `before-quit` mit Nachfrage: erst die Nachfrage (CloseGuard), danach das Aufräumen (`createBeforeQuitHandler`).
export function createGuardedQuitHandler(
    guard: CloseGuard,
    window: () => ClosableWindow | null,
    cleanup: (event: PreventableEvent) => void,
): (event: PreventableEvent) => void {
    return (event) => {
        if (guard.interceptQuit(event, window())) return;
        cleanup(event);
    };
}
