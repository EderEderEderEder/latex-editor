// Datei öffnen und speichern (W1-12b) gegen den IPC-Vertrag. Der Text bleibt in den Sitzungen; hier laufen nur
// Dialoge, Lesen/Schreiben und Meldungen. Fehler und Konflikte werden gemeldet, nie geworfen.
//
// LÜCKE im Vertrag (Bericht W1-12b): `dialog:pickFiles` und `dialog:saveAs` liefern nur eine `GrantedPath`
// (Kennung + Name), aber `fs:readText`/`fs:writeText` nehmen einen `AbsolutePath`, und es gibt keinen Kanal
// „gewährte Datei lesen/schreiben“. Bis der Main das klärt, geben `readGrantedFile`/`writeGrantedFile` die
// Kennung als Pfad weiter; nur diese zwei Funktionen müssen dann angepasst werden.
import type {
    FileFilter, GrantedPath, IpcError, IpcResult, LineEnding, RendererApi, TextEncoding, TextFile, WriteResult,
} from '../../shared/contract';
import type { EditorSession } from '../editor/session';
import type { EditorStore } from '../stores/editor';
import type { StatusMessage } from '../stores/status';
import { fileNameOf } from './statusText';

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

const savesInFlight = new Set<string>();

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

export function readGrantedFile(api: FileActionDeps['api'], grant: GrantedPath): Promise<IpcResult<TextFile>> {
    return api.fs.readText(grant.grantId);
}

function writeGrantedFile(
    api: FileActionDeps['api'], grant: GrantedPath, text: string, encoding: TextEncoding, eol: LineEnding,
): Promise<IpcResult<WriteResult>> {
    return api.fs.writeText(grant.grantId, text, encoding, eol);
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
    const { path, encoding, eol, hash } = session.file;
    const name = fileNameOf(path);
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

/** Strg+S: schreibt mit dem Hash vom Lesen als erwartetem Hash; ein fremder Hash ergibt einen Konflikt */
export async function saveFile(deps: FileActionDeps, path: string): Promise<SaveOutcome> {
    const session = deps.store.getState().session(path);
    if (session === undefined) return 'missing';
    if (!session.isDirty) {
        deps.report({ text: SAVE_TEXTS.unchanged, kind: 'info' });
        return 'unchanged';
    }
    if (savesInFlight.has(path)) return 'unchanged';
    savesInFlight.add(path);
    try {
        return await writeAndMark(deps, session);
    } catch (error) {
        deps.report(errorMessage(SAVE_TEXTS.failed(fileNameOf(path), error instanceof Error ? error.message : String(error))));
        return 'failed';
    } finally {
        savesInFlight.delete(path);
    }
}

export function saveActiveFile(deps: FileActionDeps): Promise<SaveOutcome> {
    const active = deps.store.getState().tabs.active;
    return active === null ? Promise.resolve('missing') : saveFile(deps, active);
}

async function writeAsAndRelocate(deps: FileActionDeps, session: EditorSession, grant: GrantedPath): Promise<SaveOutcome> {
    const { encoding, eol, path } = session.file;
    const snapshot = session.snapshotForSave();
    const written = await writeGrantedFile(deps.api, grant, snapshot.text, encoding, eol);
    if (!written.ok) {
        deps.report(failureMessage(grant.name, written.error));
        return 'failed';
    }
    // Lücke: der Schreibkanal nennt den Zielpfad nicht, deshalb wird er über die Gewährung nachgelesen.
    const target = await readGrantedFile(deps.api, grant);
    if (!target.ok) {
        deps.report(errorMessage(SAVE_TEXTS.failed(grant.name, target.error.message)));
        return 'failed';
    }
    return finishSaveAs(deps, path, target.value.path, snapshot, written.value);
}

function finishSaveAs(
    deps: FileActionDeps, oldPath: string, newPath: string, snapshot: ReturnType<EditorSession['snapshotForSave']>,
    written: WriteResult,
): SaveOutcome {
    const state = deps.store.getState();
    const name = fileNameOf(newPath);
    if (newPath !== oldPath && state.session(newPath) !== undefined) {
        deps.report(errorMessage(SAVE_TEXTS.alreadyOpen(name)));
        return 'failed';
    }
    if (newPath !== oldPath) state.relocate(oldPath, newPath);
    deps.store.getState().markSaved(newPath, snapshot, written);
    deps.report({ text: SAVE_TEXTS.saved(name), kind: 'info' });
    return 'saved';
}

/** Strg+Umschalt+S: Zieldatei wählen, schreiben, der Tab zieht auf die neue Datei um */
export async function saveFileAs(deps: FileActionDeps, path: string): Promise<SaveOutcome> {
    const session = deps.store.getState().session(path);
    if (session === undefined) return 'missing';
    const picked = await deps.api.dialog.saveAs({ title: 'Speichern unter', defaultPath: path, filters: OPEN_FILTERS });
    if (!picked.ok) {
        deps.report(errorMessage(SAVE_TEXTS.failed(fileNameOf(path), picked.error.message)));
        return 'failed';
    }
    if (picked.value === null) return 'cancelled';
    try {
        return await writeAsAndRelocate(deps, session, picked.value);
    } catch (error) {
        deps.report(errorMessage(SAVE_TEXTS.failed(picked.value.name, error instanceof Error ? error.message : String(error))));
        return 'failed';
    }
}

export function saveActiveFileAs(deps: FileActionDeps): Promise<SaveOutcome> {
    const active = deps.store.getState().tabs.active;
    return active === null ? Promise.resolve('missing') : saveFileAs(deps, active);
}
