// Sicherung ungespeicherten Texts (W2-14, Vorbild Swift `RecoveryStore`): Solange ein Tab ungespeicherte Änderungen hat,
// geht sein Text entprellt an den Main (`recovery:save`): 2 s nach der letzten Änderung, spätestens 10 s nach der
// letzten Sicherung. Der Text kommt aus der Editor-Sitzung, nie aus einem Store. Gelöscht wird nur, wenn der Tab
// wieder „unverändert“ ist (Speichern, Rückgängig bis zum Plattenstand, Neuladen) oder umzieht (Speichern unter,
// Umbenennen). Beim Schließen eines ungespeicherten Tabs und beim „Nicht speichern“ im Fenster-Dialog bleibt die
// Sicherung bewusst erhalten (Plan K1): Sie wird vorher noch einmal geschrieben und beim nächsten Start angeboten.
import type { IpcResult, RecoveryEntry, RendererApi } from '../../shared/contract';
import { revisionOf } from '../editor/session';
import type { EditorSession } from '../editor/session';
import type { EditorStore, EditorStoreState } from '../stores/editor';
import type { StatusMessage } from '../stores/status';

export const RECOVERY_QUIET_MS = 2000;
export const RECOVERY_MAX_WAIT_MS = 10_000;
export const RECOVERY_POLL_MS = 500;

export const RECOVERY_TEXTS = {
    writeFailed: (name: string, detail: string) =>
        `Die automatische Sicherung von „${name}“ ist fehlgeschlagen: ${detail} ` +
        'Ungespeicherte Änderungen sind bis zum nächsten Speichern nicht gesichert.',
} as const;

export interface RecoveryDeps {
    readonly api: Pick<RendererApi, 'recovery'>;
    readonly store: EditorStore;
    readonly report: (message: StatusMessage) => void;
    readonly now?: () => number;
    readonly quietMs?: number;
    readonly maxWaitMs?: number;
    readonly pollMs?: number;
}

interface Tracked {
    seenRevision: number;
    changedAt: number;
    backedRevision: number | null;
    backedAt: number;
}

export class RecoveryController {
    private readonly tracked = new Map<string, Tracked>();
    private timer: ReturnType<typeof setInterval> | null = null;
    private queue: Promise<void> = Promise.resolve();
    private reportedFailure = false;
    private stopped = false;
    private readonly unsubscribe: () => void;

    constructor(private readonly deps: RecoveryDeps) {
        this.unsubscribe = deps.store.subscribe((state, previous) => {
            if (state.files !== previous.files) this.sync(state);
        });
        this.sync(deps.store.getState());
    }

    /** Schreibt alle ungesicherten Stände sofort und wartet, bis alle Aufträge durch sind */
    async flush(): Promise<void> {
        for (const [path, entry] of this.tracked) {
            const session = this.liveSession(path);
            if (session !== null) this.backUp(path, session, entry);
        }
        await this.queue;
    }

    async stop(): Promise<void> {
        await this.flush();
        this.stopped = true;
        this.unsubscribe();
        this.stopTimer();
        this.tracked.clear();
    }

    private now(): number {
        return (this.deps.now ?? Date.now)();
    }

    private liveSession(path: string): EditorSession | null {
        const session = this.deps.store.getState().session(path);
        return session !== undefined && !session.isDisposed && session.isDirty ? session : null;
    }

    private sync(state: EditorStoreState): void {
        if (this.stopped) return;
        for (const [path, info] of Object.entries(state.files)) {
            if (info.isDirty && !this.tracked.has(path)) this.startTracking(path);
        }
        for (const path of [...this.tracked.keys()]) {
            const info = state.files[path];
            if (info === undefined) this.handleGone(path);
            else if (!info.isDirty) this.handleClean(path);
        }
    }

    private startTracking(path: string): void {
        const session = this.deps.store.getState().session(path);
        if (session === undefined) return;
        const now = this.now();
        this.tracked.set(path, { seenRevision: revisionOf(session.state), changedAt: now, backedRevision: null, backedAt: now });
        this.timer ??= setInterval(() => this.tick(), this.deps.pollMs ?? RECOVERY_POLL_MS);
    }

    private stopTimer(): void {
        if (this.timer === null) return;
        clearInterval(this.timer);
        this.timer = null;
    }

    private untrack(path: string): void {
        this.tracked.delete(path);
        if (this.tracked.size === 0) this.stopTimer();
    }

    /** Wieder unverändert (gespeichert, zurückgesetzt, neu geladen): die Sicherung ist überholt */
    private handleClean(path: string): void {
        this.untrack(path);
        this.enqueueDelete(path);
    }

    /** Tab weg: geschlossen (die Sitzung lebt noch, Sicherung bleibt) oder umgezogen (alte Sicherung löschen) */
    private handleGone(path: string): void {
        const entry = this.tracked.get(path);
        const session = this.liveSession(path);
        this.untrack(path);
        if (session !== null && entry !== undefined) {
            this.backUp(path, session, entry);
            return;
        }
        this.enqueueDelete(path);
    }

    private tick(): void {
        const now = this.now();
        const { quietMs = RECOVERY_QUIET_MS, maxWaitMs = RECOVERY_MAX_WAIT_MS } = this.deps;
        for (const [path, entry] of this.tracked) {
            const session = this.liveSession(path);
            if (session === null) continue;
            const revision = revisionOf(session.state);
            if (revision !== entry.seenRevision) {
                entry.seenRevision = revision;
                entry.changedAt = now;
            }
            const due = now - entry.changedAt >= quietMs || now - entry.backedAt >= maxWaitMs;
            if (due && revision !== entry.backedRevision) this.backUp(path, session, entry);
        }
    }

    /** Liest den Text jetzt (synchron, bevor eine Sitzung freigegeben wird) und reiht das Schreiben ein */
    private backUp(path: string, session: EditorSession, entry: Tracked): void {
        const revision = revisionOf(session.state);
        if (revision === entry.backedRevision) return;
        entry.backedRevision = revision;
        entry.backedAt = this.now();
        this.enqueueSave({ path, text: session.snapshotForSave().text, savedAt: this.now() }, session.file.name);
    }

    private enqueue(job: () => Promise<void>): void {
        this.queue = this.queue.then(() => job().catch(() => undefined));
    }

    private enqueueDelete(path: string): void {
        this.enqueue(async () => {
            await this.deps.api.recovery.delete(path);
        });
    }

    private enqueueSave(entry: RecoveryEntry, name: string): void {
        this.enqueue(async () => this.noteResult(name, await this.deps.api.recovery.save(entry)));
    }

    // Einmal je Fehlerserie melden, damit beim Weitertippen nicht alle paar Sekunden ein Hinweis erscheint.
    private noteResult(name: string, result: IpcResult<void>): void {
        if (result.ok) {
            this.reportedFailure = false;
            return;
        }
        if (this.reportedFailure) return;
        this.reportedFailure = true;
        this.deps.report({ text: RECOVERY_TEXTS.writeFailed(name, result.error.message), kind: 'error' });
    }
}

// ---------- Ein Controller je App-Lauf ----------

let active: RecoveryController | null = null;

export function startRecovery(deps: RecoveryDeps): RecoveryController {
    const controller = new RecoveryController(deps);
    active = controller;
    return controller;
}

export async function stopRecovery(controller: RecoveryController): Promise<void> {
    if (active === controller) active = null;
    await controller.stop();
}

/** Für `closeFlow`: sichert noch einmal alle ungespeicherten Texte (ohne Controller wirkungslos) */
export const recoveryRuntime = {
    flush: async (): Promise<void> => {
        await active?.flush();
    },
};
