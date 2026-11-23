// Beenden und zweite Instanz (Befund M5). Ohne Electron: `index.ts` reicht `app`/`BrowserWindow`
// nur über die kleinen Schnittstellen hier herein, damit Vitest die Abläufe prüft.

export type QuitTask = () => Promise<void> | void;

// Höchstens so lange hält das Aufräumen das Beenden auf (Build-Abbruch braucht unter 3 s).
export const QUIT_CLEANUP_TIMEOUT_MS = 3_000;

// Aufräumarbeiten beim Beenden. W2-10 trägt hier `runner.cancel()` ein, später Wächter und Worker.
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
