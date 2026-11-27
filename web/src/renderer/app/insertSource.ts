// Einfügen-Fenster (W4-10): neue Quelle in die Literaturdatei (Vorlage `AppModel.appendToBibliography`). Ist die
// `.bib` im Editor offen, kommt der Eintrag in den Puffer (ein Undo-Schritt, gespeichert wird von Hand); sonst hängt
// der Main ihn atomar an (`bib:append`, Sicherung, Kodierung bleibt). Das Anhängen auf der Platte ist ein Schritt des
// App-Rückgängig (`bib:undo`, „Datei-Aktion rückgängig“).
import type { UndoToken } from '../../shared/contract';
import { unwrap } from '../../shared/ipcResult';
import type { AppUndoAction, AppUndoStep } from '../stores/appUndo';
import { appendToOpenBibliography } from './insertApply';
import type { InsertDeps } from './insertDeps';
import type { BibliographyTarget } from './insertLogic';

export const SOURCE_TEXTS = {
    createdOnDisk: (key: string, file: string) => `Quelle „${key}“ in ${file} angelegt (rückgängig: Datei → Datei-Aktion rückgängig).`,
    createdInBuffer: (key: string, file: string) => `Quelle „${key}“ in ${file} eingefügt (noch nicht gespeichert).`,
    undoTitle: (key: string) => `Quelle „${key}“ anlegen`,
    writeFailed: (file: string, detail: string) => `${file} konnte nicht geschrieben werden: ${detail}`,
} as const;

const UNCHANGED: AppUndoStep = { changed: false };
const CHANGED: AppUndoStep = { changed: true };

/** Rückgängig nimmt den angehängten Eintrag zurück, Wiederholen hängt ihn erneut an (neue Kennung) */
function appendUndoAction(deps: InsertDeps, title: string, path: string, entry: string, first: UndoToken): AppUndoAction {
    let token = first;
    return {
        title,
        undo: async () => {
            try {
                unwrap(await deps.api.bib.undo(token));
                return CHANGED;
            } catch {
                return UNCHANGED;
            }
        },
        redo: async () => {
            try {
                token = unwrap(await deps.api.bib.append(path, entry)).undoToken;
                return CHANGED;
            } catch {
                return UNCHANGED;
            }
        },
    };
}

/** Legt den Eintrag an und liefert die Meldung für die Statusleiste; Fehler des Mains werden geworfen */
export async function appendSource(deps: InsertDeps, entry: string, key: string, target: BibliographyTarget): Promise<string> {
    const session = deps.editor.getState().session(target.path);
    if (session !== undefined && !session.isDisposed) {
        appendToOpenBibliography(session, entry);
        return SOURCE_TEXTS.createdInBuffer(key, target.name);
    }
    const result = unwrap(await deps.api.bib.append(target.path, entry));
    deps.appUndo.getState().push(appendUndoAction(deps, SOURCE_TEXTS.undoTitle(key), target.path, entry, result.undoToken));
    return SOURCE_TEXTS.createdOnDisk(key, target.name);
}
