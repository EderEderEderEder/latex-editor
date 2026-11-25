// Extern geänderte offene Dateien (W2-13, Vorbild Swift `DocumentSession.syncWithDisk`/`keepLocalVersion`):
// `fs:changed` (auch das Sicherheitsnetz des Mains bei Fenster-Fokus und nach dem Build) merkt offene Tabs vor; nach
// kurzer Ruhe wird jede Datei neu gelesen und mit dem zuletzt bekannten Plattenstand (Hash der Sitzung) verglichen.
// - gleicher Hash: eigenes Speichern oder schon bekannt, nichts tun,
// - Tab unverändert: still neu laden mit minimalem Ersatz (Cursor, Scrollposition, Einklappen bleiben), Verlauf leer,
// - Tab geändert: nie überschreiben, Konfliktleiste (`stores/diskConflict.ts`, `ui/ConflictBar.tsx`),
// - Datei fehlt: Hinweis „gelöscht“, der Tab behält seinen Text.
// Je Datei höchstens ein Lesen gleichzeitig; Antworten, die eine Nutzeraktion oder ein Speichern überholt hat, verfallen.
import type { AbsolutePath, IpcEvents, RecoveryEntry, RendererApi, TextFile, Unsubscribe } from '../../shared/contract';
import { revisionOf } from '../editor/session';
import type { EditorSession } from '../editor/session';
import type { DiskConflictStore } from '../stores/diskConflict';
import type { EditorStore, EditorStoreState } from '../stores/editor';
import type { StatusMessage } from '../stores/status';

/** Ruhezeit nach dem letzten `fs:changed`; der Main hat schon 300 ms entprellt, hier werden nur Folgen gebündelt */
export const DISK_SYNC_DEBOUNCE_MS = 100;
/** NUL kommt in LaTeX-Quelltext nicht vor: der Inhalt gilt als binär und wird nicht in den Editor geladen */
const BINARY_MARKER = '\u0000';

export const DISK_SYNC_TEXTS = {
    notLoaded: (name: string) =>
        `„${name}“ wurde außerhalb des Editors geändert, ist aber zu groß oder keine Textdatei und wird nicht neu geladen.`,
    readFailed: (name: string, detail: string) =>
        `„${name}“ wurde außerhalb des Editors geändert, ließ sich aber nicht lesen: ${detail}`,
    backupFailed: (name: string, detail: string) =>
        `Platten-Version nicht geladen: Die eigene Version von „${name}“ ließ sich nicht sichern (${detail}).`,
    backupLost: (name: string, detail: string) =>
        `Platten-Version von „${name}“ geladen, aber die Sicherung der eigenen Version ist fehlgeschlagen (${detail}). ` +
        'Rückgängig holt sie zurück.',
    diskLoaded: (name: string) =>
        `Platten-Version von „${name}“ geladen. Die eigene Version ist gesichert; Rückgängig holt sie zurück.`,
    keptMine: (name: string) =>
        `Eigene Version von „${name}“ behalten. Speichern überschreibt die Datei auf der Festplatte.`,
    recreated: (name: string) => `„${name}“ wurde neu angelegt.`,
    recreateFailed: (name: string, detail: string) => `„${name}“ ließ sich nicht neu anlegen: ${detail}`,
    actionFailed: (detail: string) => `Abgleich mit der Festplatte fehlgeschlagen: ${detail}`,
} as const;

export interface DiskSyncDeps {
    readonly api: Pick<RendererApi, 'fs' | 'recovery'>;
    readonly store: EditorStore;
    readonly conflicts: DiskConflictStore;
    readonly report: (message: StatusMessage) => void;
    /** Wartet, bis die laufende Sicherung (`recoveryRuntime.flush`) ihre Aufträge erledigt hat */
    readonly settleRecovery?: () => Promise<void>;
    readonly debounceMs?: number;
    readonly now?: () => number;
}

type ReadOutcome =
    | { readonly kind: 'file'; readonly file: TextFile }
    | { readonly kind: 'missing' }
    | { readonly kind: 'failed'; readonly message: string; readonly unloadable: boolean };

interface Backup {
    readonly entry: RecoveryEntry;
    readonly revision: number;
}

type DiskAction = (session: EditorSession, epoch: number) => Promise<void>;

/** Vergleichsschlüssel wie im Main (`watch.ts`): Namen in NFC und NFD sind dieselbe Datei */
function comparisonKey(path: string): string {
    return path.normalize('NFC');
}

function isLoadable(file: TextFile): boolean {
    return !file.text.includes(BINARY_MARKER);
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class DiskSync {
    private readonly pending = new Set<AbsolutePath>();
    private readonly running = new Map<AbsolutePath, Promise<void>>();
    private readonly rerun = new Set<AbsolutePath>();
    /** Laufende Nutzeraktionen je Datei und ihre Epoche (jede Aktion erhöht sie, ältere Antworten verfallen) */
    private readonly busy = new Map<AbsolutePath, number>();
    private readonly epochs = new Map<AbsolutePath, number>();
    private timer: ReturnType<typeof setTimeout> | null = null;
    private stopped = false;
    private readonly unsubscribe: Unsubscribe;

    constructor(private readonly deps: DiskSyncDeps) {
        this.unsubscribe = deps.store.subscribe((state, previous) => {
            if (state.files !== previous.files) this.reviewConflicts(state);
        });
    }

    /** `fs:changed`: offene Dateien darunter vormerken; gelesen wird nach `DISK_SYNC_DEBOUNCE_MS` Ruhe */
    handleChanged(event: IpcEvents['fs:changed']): void {
        if (this.stopped || event.paths.length === 0) return;
        const open = this.openPathsByKey();
        for (const path of event.paths) {
            const target = open.get(comparisonKey(path));
            if (target !== undefined) this.pending.add(target);
        }
        if (this.pending.size > 0) this.schedule();
    }

    /** „Platten-Version laden“: eigene Version sichern, dann den Plattenstand übernehmen (ein Undo-Schritt) */
    loadDiskVersion(path: AbsolutePath): Promise<void> {
        return this.runAction(path, (session, epoch) => this.discardForDisk(session, epoch));
    }

    /** „Meine Version behalten“: Plattenhash übernehmen, der Tab bleibt geändert */
    keepMine(path: AbsolutePath): Promise<void> {
        return this.runAction(path, async (session) => this.keepLocal(session));
    }

    /** „Neu anlegen“ nach externem Löschen: schreibt den Editortext ohne erwarteten Hash */
    recreate(path: AbsolutePath): Promise<void> {
        return this.runAction(path, (session, epoch) => this.writeMissing(session, epoch));
    }

    /** Für Tests und geordnetes Beenden: wartet, bis kein Lesen mehr läuft */
    async whenIdle(): Promise<void> {
        while (this.running.size > 0) await Promise.allSettled([...this.running.values()]);
    }

    stop(): void {
        this.stopped = true;
        this.unsubscribe();
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        this.pending.clear();
        this.rerun.clear();
    }

    // ---------- Abgleich je Datei ----------

    private schedule(): void {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = null;
            const paths = [...this.pending];
            this.pending.clear();
            for (const path of paths) this.check(path);
        }, this.deps.debounceMs ?? DISK_SYNC_DEBOUNCE_MS);
    }

    /** Höchstens ein Lesen je Datei; Meldungen währenddessen ergeben genau ein weiteres Lesen danach */
    private check(path: AbsolutePath): void {
        if (this.stopped) return;
        if (this.running.has(path)) {
            this.rerun.add(path);
            return;
        }
        const run = this.syncOnce(path)
            .catch((error: unknown) => this.report(DISK_SYNC_TEXTS.actionFailed(describeError(error))))
            .finally(() => {
                this.running.delete(path);
                if (this.rerun.delete(path)) this.check(path);
            });
        this.running.set(path, run);
    }

    private async syncOnce(path: AbsolutePath): Promise<void> {
        const session = this.liveSession(path);
        if (session === null) return;
        const epoch = this.epochOf(path);
        const knownHash = session.file.hash;
        const outcome = await this.read(path);
        if (this.stopped || this.liveSession(path) !== session) return;
        // Eine Nutzeraktion lief dazwischen; sie prüft am Ende selbst neu.
        if (this.isBusy(path) || this.epochOf(path) !== epoch) return;
        // Inzwischen gespeichert: die Antwort kann älter sein als das eigene Schreiben, also noch einmal lesen.
        if (session.file.hash !== knownHash) {
            this.rerun.add(path);
            return;
        }
        this.apply(session, outcome);
    }

    private apply(session: EditorSession, outcome: ReadOutcome): void {
        if (outcome.kind === 'missing') {
            this.markDeleted(session);
            return;
        }
        if (outcome.kind === 'failed') {
            const { name } = session.file;
            const text = outcome.unloadable ? DISK_SYNC_TEXTS.notLoaded(name) : DISK_SYNC_TEXTS.readFailed(name, outcome.message);
            this.report(text);
            return;
        }
        this.applyFile(session, outcome.file);
    }

    private applyFile(session: EditorSession, file: TextFile): void {
        const conflicts = this.deps.conflicts.getState();
        if (file.hash === session.file.hash) {
            conflicts.clear(session.path);
            return;
        }
        if (!isLoadable(file)) {
            this.report(DISK_SYNC_TEXTS.notLoaded(session.file.name));
            return;
        }
        if (!session.isDirty) {
            this.reloadSilently(session, file);
            return;
        }
        const disk = { hash: file.hash, mtime: file.mtime };
        conflicts.set(session.path, { kind: 'changed', knownHash: session.file.hash, disk });
    }

    private reloadSilently(session: EditorSession, file: TextFile): void {
        session.replaceFromDisk(file);
        this.deps.store.getState().refreshFile(session.path);
        this.deps.conflicts.getState().clear(session.path);
    }

    private markDeleted(session: EditorSession): void {
        this.deps.conflicts.getState().set(session.path, { kind: 'deleted', knownHash: session.file.hash, disk: null });
    }

    /** Überholte Hinweise entfernen; ist ein Tab mit Konflikt wieder „unverändert“ (Rückgängig), still neu laden */
    private reviewConflicts(state: EditorStoreState): void {
        const toCheck: AbsolutePath[] = [];
        this.deps.conflicts.getState().retain((path, conflict) => {
            const session = state.session(path);
            if (session === undefined || session.isDisposed || session.file.hash !== conflict.knownHash) return false;
            if (conflict.kind === 'changed' && !session.isDirty) toCheck.push(path);
            return true;
        });
        for (const path of toCheck) this.check(path);
    }

    // ---------- Nutzeraktionen der Konfliktleiste ----------

    private async runAction(path: AbsolutePath, action: DiskAction): Promise<void> {
        const session = this.liveSession(path);
        if (session === null || this.stopped) return;
        const epoch = this.epochOf(path) + 1;
        this.epochs.set(path, epoch);
        this.busy.set(path, (this.busy.get(path) ?? 0) + 1);
        try {
            await action(session, epoch);
        } catch (error) {
            this.report(DISK_SYNC_TEXTS.actionFailed(describeError(error)));
        } finally {
            this.release(path);
            // Was während der Aktion auf der Platte geschah, wurde verworfen: einmal nachprüfen.
            this.check(path);
        }
    }

    private async discardForDisk(session: EditorSession, epoch: number): Promise<void> {
        const outcome = await this.read(session.path);
        if (!this.isCurrentAction(session, epoch)) return;
        if (outcome.kind !== 'file') return this.apply(session, outcome);
        if (!isLoadable(outcome.file)) return this.report(DISK_SYNC_TEXTS.notLoaded(session.file.name));
        const backup = await this.backUp(session);
        if (backup === null || !this.isCurrentAction(session, epoch)) return;
        // Weitergetippt, während gesichert wurde: nichts verwerfen, was nicht gesichert ist.
        if (revisionOf(session.state) !== backup.revision) return;
        session.reloadFromDisk(outcome.file);
        this.deps.store.getState().refreshFile(session.path);
        this.deps.conflicts.getState().clear(session.path);
        await this.keepBackup(session.file.name, backup);
    }

    /** Ohne Sicherung wird nichts verworfen */
    private async backUp(session: EditorSession): Promise<Backup | null> {
        const snapshot = session.snapshotForSave();
        const entry: RecoveryEntry = { path: session.path, text: snapshot.text, savedAt: (this.deps.now ?? Date.now)() };
        const result = await this.deps.api.recovery.save(entry);
        if (result.ok) return { entry, revision: snapshot.revision };
        this.report(DISK_SYNC_TEXTS.backupFailed(session.file.name, result.error.message));
        return null;
    }

    /**
     * Nach dem Neuladen ist der Tab „unverändert“, und die laufende Sicherung (`app/recovery.ts`) löscht ihren Eintrag
     * für die Datei. Erst danach noch einmal schreiben, damit die verworfene Version bis zum nächsten Start erhalten bleibt.
     */
    private async keepBackup(name: string, backup: Backup): Promise<void> {
        await this.deps.settleRecovery?.();
        const result = await this.deps.api.recovery.save(backup.entry);
        if (!result.ok) {
            this.report(DISK_SYNC_TEXTS.backupLost(name, result.error.message));
            return;
        }
        this.deps.report({ text: DISK_SYNC_TEXTS.diskLoaded(name), kind: 'info' });
    }

    private keepLocal(session: EditorSession): void {
        const conflict = this.deps.conflicts.getState().conflicts[session.path];
        if (conflict?.kind !== 'changed' || conflict.disk === null) return;
        session.acceptDiskVersion(conflict.disk);
        this.deps.store.getState().refreshFile(session.path);
        this.deps.conflicts.getState().clear(session.path);
        this.deps.report({ text: DISK_SYNC_TEXTS.keptMine(session.file.name), kind: 'info' });
    }

    private async writeMissing(session: EditorSession, epoch: number): Promise<void> {
        const outcome = await this.read(session.path);
        if (!this.isCurrentAction(session, epoch)) return;
        // Inzwischen wieder da: nicht blind überschreiben, sondern wie eine externe Änderung behandeln.
        if (outcome.kind !== 'missing') return this.apply(session, outcome);
        const snapshot = session.snapshotForSave();
        const { encoding, eol, name } = session.file;
        const written = await this.deps.api.fs.writeText(session.path, snapshot.text, encoding, eol);
        if (!written.ok) return this.report(DISK_SYNC_TEXTS.recreateFailed(name, written.error.message));
        if (this.liveSession(session.path) !== session) return;
        this.deps.store.getState().markSaved(session.path, snapshot, written.value);
        this.deps.conflicts.getState().clear(session.path);
        this.deps.report({ text: DISK_SYNC_TEXTS.recreated(name), kind: 'info' });
    }

    // ---------- Hilfen ----------

    private async read(path: AbsolutePath): Promise<ReadOutcome> {
        try {
            const result = await this.deps.api.fs.readText(path);
            if (result.ok) return { kind: 'file', file: result.value };
            if (result.error.kind === 'notFound') return { kind: 'missing' };
            return { kind: 'failed', message: result.error.message, unloadable: result.error.kind === 'invalidInput' };
        } catch (error) {
            return { kind: 'failed', message: describeError(error), unloadable: false };
        }
    }

    private openPathsByKey(): Map<string, AbsolutePath> {
        const open = new Map<string, AbsolutePath>();
        for (const path of Object.keys(this.deps.store.getState().files)) open.set(comparisonKey(path), path);
        return open;
    }

    private liveSession(path: AbsolutePath): EditorSession | null {
        const session = this.deps.store.getState().session(path);
        return session !== undefined && !session.isDisposed ? session : null;
    }

    private isCurrentAction(session: EditorSession, epoch: number): boolean {
        return !this.stopped && this.liveSession(session.path) === session && this.epochOf(session.path) === epoch;
    }

    private epochOf(path: AbsolutePath): number {
        return this.epochs.get(path) ?? 0;
    }

    private isBusy(path: AbsolutePath): boolean {
        return (this.busy.get(path) ?? 0) > 0;
    }

    private release(path: AbsolutePath): void {
        const remaining = (this.busy.get(path) ?? 1) - 1;
        if (remaining > 0) this.busy.set(path, remaining);
        else this.busy.delete(path);
    }

    private report(text: string): void {
        this.deps.report({ text, kind: 'error' });
    }
}

// ---------- Ein Abgleich je App-Lauf (die Konfliktleiste ruft die Aktionen hierüber) ----------

let active: DiskSync | null = null;

export function startDiskSync(deps: DiskSyncDeps): DiskSync {
    active?.stop();
    const sync = new DiskSync(deps);
    active = sync;
    return sync;
}

export function stopDiskSync(sync: DiskSync): void {
    if (active === sync) active = null;
    sync.stop();
}

export const diskSyncRuntime = {
    loadDiskVersion: (path: AbsolutePath): Promise<void> => active?.loadDiskVersion(path) ?? Promise.resolve(),
    keepMine: (path: AbsolutePath): Promise<void> => active?.keepMine(path) ?? Promise.resolve(),
    recreate: (path: AbsolutePath): Promise<void> => active?.recreate(path) ?? Promise.resolve(),
};
