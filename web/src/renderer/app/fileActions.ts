// Datei öffnen und speichern (W1-12b) gegen den IPC-Vertrag. Der Text bleibt in den Sitzungen; hier laufen nur
// Dialoge, Lesen/Schreiben und Meldungen. Fehler und Konflikte werden gemeldet, nie geworfen.
// Dialog-Dateien sind `FileTarget`s: Die `GrantId` ist Schlüssel der Sitzung, der Anzeigename kommt als `name`.
import type { FileFilter, GrantedPath, IpcError, IpcResult, RendererApi, TextFile, WriteResult } from '../../shared/contract';
import type { EditorSession } from '../editor/session';
import type { EditorStore } from '../stores/editor';
import type { StatusMessage } from '../stores/status';

export interface FileActionDeps {
    readonly api: Pick<RendererApi, 'dialog' | 'fs'>;
    readonly store: EditorStore;
    readonly report: (message: StatusMessage) => void;
}

export type SaveOutcome = 'saved' | 'unchanged' | 'conflict' | 'failed' | 'missing' | 'cancelled';

export const OPEN_FILTERS: readonly FileFilter[] = [
    { name: 'LaTeX, BibTeX und Text', extensions: ['tex', 'bib', 'sty', 'cls', 'bst', 'txt'] },
    { name: 'Alle Dateien', extensions: ['*'] },
];

interface SaveQueue {
    /** Laufendes Speichern je Sitzungsschlüssel */
    readonly running: Map<string, Promise<SaveOutcome>>;
    /** Vorgemerktes Nachspeichern (Strg+S während des Schreibens, N3), höchstens eins je Schlüssel */
    readonly queued: Map<string, Promise<SaveOutcome>>;
}

const saveQueues = new WeakMap<EditorStore, SaveQueue>();
const PATH_SEPARATOR = /[\\/]/;

export const SAVE_TEXTS = {
    saved: (name: string) => `Gespeichert: ${name}`,
    unchanged: 'Keine Änderungen zu speichern',
    conflict: (name: string) =>
        `Nicht gespeichert: „${name}“ wurde außerhalb des Editors geändert. Die Änderungen bleiben im Editor erhalten.`,
    failed: (name: string, detail: string) => `Speichern von „${name}“ fehlgeschlagen: ${detail}`,
    openFailed: (detail: string) => `Öffnen fehlgeschlagen: ${detail}`,
    alreadyOpen: (name: string) =>
        `Gespeichert unter „${name}“, aber diese Datei ist schon in einem anderen Tab geöffnet. Der Tab bleibt unverändert.`,
} as const;

function errorMessage(text: string): StatusMessage {
    return { text, kind: 'error' };
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function readGrantedFile(api: FileActionDeps['api'], grant: GrantedPath): Promise<IpcResult<TextFile>> {
    return api.fs.readText(grant.grantId);
}

function saveQueueOf(store: EditorStore): SaveQueue {
    const existing = saveQueues.get(store);
    if (existing !== undefined) return existing;
    const created: SaveQueue = { running: new Map(), queued: new Map() };
    saveQueues.set(store, created);
    return created;
}

async function openGrant(deps: FileActionDeps, grant: GrantedPath): Promise<void> {
    const read = await readGrantedFile(deps.api, grant);
    if (!read.ok) {
        deps.report(errorMessage(SAVE_TEXTS.openFailed(`${grant.name}: ${read.error.message}`)));
        return;
    }
    deps.store.getState().open(read.value, { asPreview: false });
}

/** Strg+O: Dialog, dann jede gewählte Datei lesen und als festen Tab öffnen */
export async function openFilesFromDialog(deps: FileActionDeps): Promise<void> {
    const picked = await deps.api.dialog.pickFiles({ title: 'Dateien öffnen', filters: OPEN_FILTERS, multiple: true });
    if (!picked.ok) {
        deps.report(errorMessage(SAVE_TEXTS.openFailed(picked.error.message)));
        return;
    }
    for (const grant of picked.value ?? []) await openGrant(deps, grant);
}

function failureMessage(name: string, error: IpcError): StatusMessage {
    if (error.kind === 'conflict') return errorMessage(SAVE_TEXTS.conflict(name));
    return errorMessage(SAVE_TEXTS.failed(name, error.message));
}

async function writeAndMark(deps: FileActionDeps, session: EditorSession): Promise<SaveOutcome> {
    const { path, name, encoding, eol, hash } = session.file;
    const snapshot = session.snapshotForSave();
    const written = await deps.api.fs.writeText(path, snapshot.text, encoding, eol, hash);
    if (!written.ok) {
        deps.report(failureMessage(name, written.error));
        return written.error.kind === 'conflict' ? 'conflict' : 'failed';
    }
    deps.store.getState().markSaved(path, snapshot, written.value);
    deps.report({ text: SAVE_TEXTS.saved(name), kind: 'info' });
    return 'saved';
}

/** Ein Speichervorgang; `quietIfUnchanged` beim Nachspeichern, wenn der erste Lauf schon alles geschrieben hat */
async function saveNow(deps: FileActionDeps, path: string, quietIfUnchanged: boolean): Promise<SaveOutcome> {
    const session = deps.store.getState().session(path);
    if (session === undefined) return 'missing';
    if (!session.isDirty) {
        if (!quietIfUnchanged) deps.report({ text: SAVE_TEXTS.unchanged, kind: 'info' });
        return 'unchanged';
    }
    try {
        return await writeAndMark(deps, session);
    } catch (error) {
        deps.report(errorMessage(SAVE_TEXTS.failed(session.file.name, describeError(error))));
        return 'failed';
    }
}

function startSave(deps: FileActionDeps, path: string, quietIfUnchanged: boolean): Promise<SaveOutcome> {
    const queue = saveQueueOf(deps.store);
    const run = saveNow(deps, path, quietIfUnchanged).finally(() => queue.running.delete(path));
    queue.running.set(path, run);
    return run;
}

/**
 * Strg+S: schreibt mit dem Hash vom Lesen als erwartetem Hash; ein fremder Hash ergibt einen Konflikt. Läuft für die
 * Datei schon ein Speichern, wird danach einmal nachgespeichert (der neueste Stand); weitere Aufrufe hängen sich an.
 */
export function saveFile(deps: FileActionDeps, path: string): Promise<SaveOutcome> {
    const queue = saveQueueOf(deps.store);
    const running = queue.running.get(path);
    if (running === undefined) return startSave(deps, path, false);
    const queued = queue.queued.get(path);
    if (queued !== undefined) return queued;
    const next = running.then(() => {
        queue.queued.delete(path);
        return startSave(deps, path, true);
    });
    queue.queued.set(path, next);
    return next;
}

export function saveActiveFile(deps: FileActionDeps): Promise<SaveOutcome> {
    const active = deps.store.getState().tabs.active;
    return active === null ? Promise.resolve('missing') : saveFile(deps, active);
}

async function writeAsAndRelocate(deps: FileActionDeps, session: EditorSession, grant: GrantedPath): Promise<SaveOutcome> {
    const { encoding, eol, path } = session.file;
    const snapshot = session.snapshotForSave();
    const written = await deps.api.fs.writeText(grant.grantId, snapshot.text, encoding, eol);
    if (!written.ok) {
        deps.report(failureMessage(grant.name, written.error));
        return 'failed';
    }
    return finishSaveAs(deps, path, grant, snapshot, written.value);
}

// Der Main vergibt für denselben Pfad dieselbe Kennung: Ist sie schon Schlüssel eines anderen Tabs, ist es dieselbe Datei.
function finishSaveAs(
    deps: FileActionDeps, oldPath: string, grant: GrantedPath, snapshot: ReturnType<EditorSession['snapshotForSave']>,
    written: WriteResult,
): SaveOutcome {
    const state = deps.store.getState();
    const newPath = grant.grantId;
    if (newPath !== oldPath && state.session(newPath) !== undefined) {
        deps.report(errorMessage(SAVE_TEXTS.alreadyOpen(grant.name)));
        return 'failed';
    }
    state.relocate(oldPath, newPath, grant.name);
    deps.store.getState().markSaved(newPath, snapshot, written);
    deps.report({ text: SAVE_TEXTS.saved(grant.name), kind: 'info' });
    return 'saved';
}

/** Vorschlag für „Speichern unter“: ein Projektpfad (der Main nimmt den Ordner nur im Projekt), sonst der Name */
function saveAsSuggestion(session: EditorSession): string {
    const { path, name } = session.file;
    return PATH_SEPARATOR.test(path) ? path : name;
}

/** Strg+Umschalt+S: Zieldatei wählen, schreiben, der Tab zieht auf die neue Datei um */
export async function saveFileAs(deps: FileActionDeps, path: string): Promise<SaveOutcome> {
    const session = deps.store.getState().session(path);
    if (session === undefined) return 'missing';
    const options = { title: 'Speichern unter', defaultPath: saveAsSuggestion(session), filters: OPEN_FILTERS };
    const picked = await deps.api.dialog.saveAs(options);
    if (!picked.ok) {
        deps.report(errorMessage(SAVE_TEXTS.failed(session.file.name, picked.error.message)));
        return 'failed';
    }
    if (picked.value === null) return 'cancelled';
    try {
        return await writeAsAndRelocate(deps, session, picked.value);
    } catch (error) {
        deps.report(errorMessage(SAVE_TEXTS.failed(picked.value.name, describeError(error))));
        return 'failed';
    }
}

export function saveActiveFileAs(deps: FileActionDeps): Promise<SaveOutcome> {
    const active = deps.store.getState().tabs.active;
    return active === null ? Promise.resolve('missing') : saveFileAs(deps, active);
}
