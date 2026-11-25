// Datei-Aktionen (W2-9): Rückgängig-Schritte (Vorlage `FileUndo.swift`). Jede Kennung des Main (`fs:restore`) nimmt
// ihren Schritt zurück und liefert die Kennung für den Gegenschritt; so wechseln Rückgängig und Wiederholen ab.
// - Anwesenheit (Anlegen, Duplizieren, Papierkorb): Eintrag weg (Tabs schließen, Stand merken) oder zurück (Tabs auf).
// - Ort (Umbenennen, Verschieben): Eintrag zurück an den alten Ort, Tabs ziehen mit, Verweise werden zurückgesetzt.
import type { AbsolutePath, UndoToken } from '../../shared/contract';
import type { AppUndoAction, AppUndoStep } from '../stores/appUndo';
import { afterRemoved, FILE_ACTION_TEXTS, refreshAndReveal, restoreToken } from './projectFileActionsCore';
import type { ProjectFileActionDeps } from './projectFileActionsCore';
import { mapPath } from './projectFileActionsNames';
import { applyFileEdits, invertTextEdits } from './projectFileActionsReferences';
import type { MoveDirection, ReferenceContext, TextEdit } from './projectFileActionsReferences';
import { closeTabs, reopenTabs, snapshotTabsUnder } from './projectFileActionsTabs';
import type { ClosedTab } from './projectFileActionsTabs';

const UNCHANGED: AppUndoStep = { changed: false };
const CHANGED: AppUndoStep = { changed: true };

// ---------- Anwesenheit ----------

interface PresenceState {
    token: UndoToken;
    tabs: readonly ClosedTab[];
}

async function removeEntry(deps: ProjectFileActionDeps, path: AbsolutePath, state: PresenceState): Promise<AppUndoStep> {
    const tabs = snapshotTabsUnder(deps.editor, path);
    const next = await restoreToken(deps, state.token);
    if (next === null) return UNCHANGED;
    state.token = next;
    state.tabs = tabs;
    closeTabs(deps.editor, tabs);
    await afterRemoved(deps);
    return CHANGED;
}

async function bringBackEntry(deps: ProjectFileActionDeps, path: AbsolutePath, state: PresenceState): Promise<AppUndoStep> {
    const next = await restoreToken(deps, state.token);
    if (next === null) return UNCHANGED;
    state.token = next;
    await refreshAndReveal(deps, path);
    await reopenTabs(deps.editor, deps.open, state.tabs);
    return CHANGED;
}

/**
 * `isPresent`: Der Eintrag ist nach der Aktion da (Anlegen, Duplizieren) → Rückgängig entfernt ihn (in den Papierkorb).
 * Sonst (Papierkorb) holt Rückgängig ihn zurück; `tabs` sind die dabei geschlossenen Tabs.
 */
export function presenceUndo(
    deps: ProjectFileActionDeps, title: string, path: AbsolutePath, token: UndoToken, isPresent: boolean,
    tabs: readonly ClosedTab[] = [],
): AppUndoAction {
    const state: PresenceState = { token, tabs };
    const remove = () => removeEntry(deps, path, state);
    const bringBack = () => bringBackEntry(deps, path, state);
    return { title, undo: isPresent ? remove : bringBack, redo: isPresent ? bringBack : remove };
}

// ---------- Ort und Verweise ----------

/** Änderungen einer Datei in Vorwärtsform (gelten für den Text, wenn der Eintrag bei `source` liegt) */
export interface AppliedFile {
    readonly atSource: AbsolutePath;
    readonly edits: readonly TextEdit[];
}

export interface AppliedEdits {
    readonly files: readonly AppliedFile[];
    readonly failures: readonly string[];
}

/** Wendet je Datei ihre Änderungen an; die Datei liegt dabei dort, wohin `move` sie gebracht hat */
export async function applyAll(
    deps: ProjectFileActionDeps, context: ReferenceContext, files: readonly AppliedFile[], move: MoveDirection,
): Promise<AppliedEdits> {
    const applied: AppliedFile[] = [];
    const failures: string[] = [];
    for (const file of files) {
        const path = mapPath(file.atSource, context.source, move.to);
        const result = await applyFileEdits(deps, context, path, file.edits, move);
        if (result.applied.length > 0) applied.push({ atSource: file.atSource, edits: result.applied });
        if (result.failure !== null) failures.push(result.failure);
    }
    return { files: applied, failures };
}

interface RelocationState {
    token: UndoToken;
    files: readonly AppliedFile[];
}

function stepWith(failures: readonly string[]): AppUndoStep {
    return failures.length === 0 ? CHANGED : { changed: true, warning: FILE_ACTION_TEXTS.referenceUndoFailures(failures) };
}

async function relocateBack(deps: ProjectFileActionDeps, context: ReferenceContext, state: RelocationState): Promise<AppUndoStep> {
    const next = await restoreToken(deps, state.token);
    if (next === null) return UNCHANGED;
    state.token = next;
    deps.editor.getState().relocate(context.target, context.source);
    const inverse = state.files.map((file) => ({ atSource: file.atSource, edits: invertTextEdits(file.edits) }));
    const result = await applyAll(deps, context, inverse, { from: context.target, to: context.source });
    // Wieder in Vorwärtsform für das nächste Wiederholen
    state.files = result.files.map((file) => ({ atSource: file.atSource, edits: invertTextEdits(file.edits) }));
    await refreshAndReveal(deps, context.source);
    return stepWith(result.failures);
}

async function relocateForward(deps: ProjectFileActionDeps, context: ReferenceContext, state: RelocationState): Promise<AppUndoStep> {
    const next = await restoreToken(deps, state.token);
    if (next === null) return UNCHANGED;
    state.token = next;
    deps.editor.getState().relocate(context.source, context.target);
    const result = await applyAll(deps, context, state.files, { from: context.source, to: context.target });
    state.files = result.files;
    await refreshAndReveal(deps, context.target);
    return stepWith(result.failures);
}

/** Umbenennen/Verschieben samt angepasster Verweise als EIN Schritt */
export function relocationUndo(
    deps: ProjectFileActionDeps, title: string, context: ReferenceContext, token: UndoToken, files: readonly AppliedFile[],
): AppUndoAction {
    const state: RelocationState = { token, files };
    return {
        title,
        undo: () => relocateBack(deps, context, state),
        redo: () => relocateForward(deps, context, state),
    };
}
