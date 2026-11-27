// Einfügen-Fenster (W4-10): Öffnen und Einfügen (Vorlage `InsertActions.swift`). Ablauf beim Einfügen: Projektkatalog
// frisch lesen (Labels müssen eindeutig sein, der Bildpfad hängt von `\graphicspath` ab), Blocker prüfen, ggf. Bild
// kopieren, dann EIN Undo-Schritt im Editor. Eine Quelle geht in die `.bib` und wird auf Wunsch gleich zitiert.
import { makeInsertionContext } from '../../shared/core/insertion';
import type { InsertionContext } from '../../shared/core/insertion';
import type { EditorSession } from '../editor/session';
import { insertIntoSession } from './insertApply';
import { isTexName, loadInsertCatalog } from './insertCatalog';
import type { InsertDeps } from './insertDeps';
import { prepareImageReference, messageOfError } from './insertImage';
import { isBlockKind, KIND_TITLES, usesSelectionAsContent } from './insertKinds';
import type { InsertionKind } from './insertKinds';
import { blockerOf, generateInsertion, MAXIMUM_SELECTION_CHARS, sourceDraftOf } from './insertLogic';
import type { GenerateInput, InsertCatalog } from './insertLogic';
import { appendSource, SOURCE_TEXTS } from './insertSource';

export const INSERT_STATUS_TEXTS = {
    inserted: (kind: InsertionKind) => `${KIND_TITLES[kind]} eingefügt.`,
    catalogFailed: (detail: string) => `Projektkatalog nicht gelesen: ${detail}`,
} as const;

/** Der Fokus geht erst nach dem Entfernen des modalen Dialogs zurück in den Editor (vorher ist der Rest der Seite gesperrt) */
const FOCUS_DELAY_MS = 0;

function focusEditorLater(deps: Pick<InsertDeps, 'focusEditor'>): void {
    setTimeout(deps.focusEditor, FOCUS_DELAY_MS);
}

/** Nur die jüngste Anfrage des Katalogs zählt (Öffnen, erneutes Lesen beim Einfügen) */
let catalogTicket = 0;

/** Die vordere Datei, wenn es eine `.tex`-Datei ist (nur dort lässt sich Text einfügen) */
export function activeTexSession(deps: Pick<InsertDeps, 'editor'>): EditorSession | null {
    const session = deps.editor.getState().activeSession();
    return session !== null && !session.isDisposed && isTexName(session.file.name) ? session : null;
}

function selectedTextOf(session: EditorSession): string {
    const { from, to } = session.state.selection.main;
    return to - from > MAXIMUM_SELECTION_CHARS ? '' : session.state.sliceDoc(from, to);
}

function contextOf(session: EditorSession): InsertionContext {
    const { from, to } = session.state.selection.main;
    return makeInsertionContext(session.state.doc.toString(), { location: from, length: to - from }, session.file.name);
}

export function generateInputOf(deps: Pick<InsertDeps, 'insert' | 'today'>, catalog: InsertCatalog): GenerateInput {
    const state = deps.insert.getState();
    return { kind: state.kind, settings: state, catalog, today: deps.today() };
}

/** Liest den Projektkatalog neu und gibt ihn dem Fenster; Fehler stehen im Fenster */
export async function refreshInsertCatalog(deps: InsertDeps): Promise<void> {
    const ticket = ++catalogTicket;
    try {
        const catalog = await loadInsertCatalog(deps);
        if (ticket === catalogTicket && deps.insert.getState().isOpen) deps.insert.getState().setCatalog(catalog);
    } catch (error) {
        if (ticket === catalogTicket) deps.insert.getState().setError(INSERT_STATUS_TEXTS.catalogFailed(messageOfError(error)));
    }
}

/** Öffnet das Fenster (mit `kind` bei diesem Baustein, sonst beim zuletzt benutzten); markierter Text wird Inhalt */
export function openInsertDialog(deps: InsertDeps, kind?: InsertionKind): void {
    deps.overlays.getState().close();
    const session = activeTexSession(deps);
    deps.insert.getState().open({
        kind,
        selectedText: session === null ? '' : selectedTextOf(session),
        context: session === null ? null : contextOf(session),
        canInsertIntoEditor: session !== null,
    });
    void refreshInsertCatalog(deps);
}

export function closeInsertDialog(deps: Pick<InsertDeps, 'insert' | 'focusEditor'>): void {
    catalogTicket++;
    deps.insert.getState().close();
    focusEditorLater(deps);
}

function finish(deps: InsertDeps, text: string): void {
    catalogTicket++;
    deps.insert.getState().close();
    deps.report({ text, kind: 'info' });
    focusEditorLater(deps);
}

async function insertBlockOrInline(deps: InsertDeps, input: GenerateInput, session: EditorSession): Promise<void> {
    const reference = input.kind === 'image' ? await prepareImageReference(deps, input.settings, input.catalog) : undefined;
    const text = generateInsertion(reference === undefined ? input : { ...input, imageReference: reference });
    insertIntoSession(session, text, { isBlock: isBlockKind(input.kind), replacesSelection: usesSelectionAsContent(input.kind) });
    if (input.kind === 'image') deps.project.getState().requestRefresh();
    finish(deps, INSERT_STATUS_TEXTS.inserted(input.kind));
}

/** Eintrag in die Literaturdatei, danach auf Wunsch `\cite{…}` an der Cursorposition */
async function insertSourceEntry(deps: InsertDeps, input: GenerateInput, session: EditorSession | null): Promise<void> {
    const draft = sourceDraftOf(input.settings, input.catalog, input.today);
    const target = input.catalog.bibliography;
    if (!draft.ok || target === null) return;
    let status: string;
    try {
        status = await appendSource(deps, draft.entry, draft.key, target);
    } catch (error) {
        deps.insert.getState().setError(SOURCE_TEXTS.writeFailed(target.name, messageOfError(error)));
        return;
    }
    const citation = generateInsertion(input);
    if (citation !== '' && session !== null) insertIntoSession(session, citation, { isBlock: false, replacesSelection: false });
    deps.insert.getState().resetSource();
    finish(deps, status);
}

async function runInsert(deps: InsertDeps): Promise<void> {
    const catalog = await loadInsertCatalog(deps);
    deps.insert.getState().setCatalog(catalog);
    const input = generateInputOf(deps, catalog);
    const session = activeTexSession(deps);
    const blocker = blockerOf(input, session !== null);
    if (blocker !== null) {
        deps.insert.getState().setError(blocker);
        return;
    }
    if (input.kind === 'source') await insertSourceEntry(deps, input, session);
    else if (session !== null) await insertBlockOrInline(deps, input, session);
}

/** „Einfügen“ bzw. „Quelle anlegen“; Fehler (Bild, Literaturdatei) bleiben im Fenster stehen, es schließt dann nicht */
export async function performInsert(deps: InsertDeps): Promise<void> {
    if (deps.insert.getState().isBusy) return;
    deps.insert.getState().setBusy(true);
    deps.insert.getState().setError(null);
    try {
        await runInsert(deps);
    } catch (error) {
        deps.insert.getState().setError(messageOfError(error));
    } finally {
        deps.insert.getState().setBusy(false);
    }
}
