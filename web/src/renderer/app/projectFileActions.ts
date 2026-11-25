// Datei-Aktionen im Projekt (W2-9, Vorlage `FileActions.swift`): Neue Datei, Neuer Ordner, Umbenennen, Verschieben,
// Duplizieren, In den Papierkorb legen. Ablauf je Aktion: Namensprüfung, Dialog, Main-Aufruf (`fs:*`), Baum neu, Tabs
// folgen (Sitzungen ziehen mit, ungespeicherte Änderungen bleiben), Verweise anpassen (nach Rückfrage), ein Schritt im
// App-Rückgängig. Fehler werden gemeldet, nie geworfen. Den Text hält nur der Editor; hier laufen nur Abläufe.
import type { AbsolutePath, FileOpResult, IpcResult } from '../../shared/contract';
import { isEditableTextFile } from '../../shared/core/fileTypes';
import { IpcFailure } from '../../shared/ipcResult';
import { APP_UNDO_TEXTS } from '../stores/appUndo';
import type { AppUndoOutcome } from '../stores/appUndo';
import type { ProjectView } from '../stores/project';
import { currentProject, FILE_ACTION_TEXTS, reportError, afterRemoved, refreshAndReveal } from './projectFileActionsCore';
import type { ProjectFileActionDeps } from './projectFileActionsCore';
import {
    childOf, finalName, findNode, isSameOrInside, locationText, moveTargets, nameOf, parentOf, relativeToRoot,
    siblingNames, targetFolder, validateEntryName,
} from './projectFileActionsNames';
import type { NameContext } from './projectFileActionsNames';
import type { NamePromptKind, ReferenceQuestion, TrashQuestion } from './projectFileActionsPrompts';
import { planEditCount, planLines, planReferenceEdits } from './projectFileActionsReferences';
import type { ReferenceContext, ReferencePlan } from './projectFileActionsReferences';
import { closeTabs, snapshotTabsUnder } from './projectFileActionsTabs';
import type { ClosedTab } from './projectFileActionsTabs';
import { applyAll, presenceUndo, relocationUndo } from './projectFileActionsUndo';
import type { AppliedEdits } from './projectFileActionsUndo';

export { FILE_ACTION_TEXTS } from './projectFileActionsCore';
export type { ProjectFileActionDeps } from './projectFileActionsCore';

export type EntryKind = 'file' | 'directory';

// ---------- Anlegen ----------

function nameContext(deps: ProjectFileActionDeps, kind: NamePromptKind, folder: AbsolutePath, original?: NameContext['original']) {
    const tree = deps.project.getState().current?.tree;
    const siblings = tree === undefined ? [] : siblingNames(tree, folder);
    return { kind, platform: deps.platform, siblings, original };
}

/** Legt an, öffnet eine neue Textdatei als festen Tab; liefert eine Fehlermeldung (der Dialog bleibt offen) oder `null` */
export async function createEntry(
    deps: ProjectFileActionDeps, folder: AbsolutePath, rawName: string, kind: EntryKind,
): Promise<string | null> {
    const result = await deps.api.fs.create(folder, rawName.trim(), kind);
    if (!result.ok) return result.error.message;
    const { path, undoToken } = result.value;
    await refreshAndReveal(deps, path);
    if (kind === 'file' && isEditableTextFile(nameOf(path))) await deps.open(path, false);
    const title = kind === 'file' ? FILE_ACTION_TEXTS.newFile : FILE_ACTION_TEXTS.newFolder;
    deps.undo.getState().push(presenceUndo(deps, title, path, undoToken, true));
    deps.report({ text: FILE_ACTION_TEXTS.created(nameOf(path)), kind: 'info' });
    return null;
}

/** „Neue Datei …“ / „Neuer Ordner …“: in `folder`, sonst im gewählten Ordner bzw. dem der gewählten Datei */
export async function beginNewEntry(deps: ProjectFileActionDeps, kind: EntryKind, folder?: AbsolutePath): Promise<void> {
    const project = currentProject(deps);
    if (project === null) return;
    const target = folder ?? targetFolder(project.tree, deps.sidebar.getState().selectedPath);
    const promptKind: NamePromptKind = kind === 'file' ? 'newFile' : 'newFolder';
    await deps.ask.askName({
        kind: promptKind,
        title: kind === 'file' ? FILE_ACTION_TEXTS.newFile : FILE_ACTION_TEXTS.newFolder,
        actionTitle: FILE_ACTION_TEXTS.create,
        placeholder: kind === 'file' ? FILE_ACTION_TEXTS.placeholderFile : FILE_ACTION_TEXTS.placeholderFolder,
        location: locationText(project.root, target),
        initialName: '',
        selectsBaseName: false,
        validate: (name) => validateEntryName(name, nameContext(deps, promptKind, target)),
        submit: (name) => createEntry(deps, target, name, kind),
    });
}

/** Duplizieren (nur Dateien wie in Swift): Kopie daneben, als fester Tab geöffnet */
export async function duplicateEntry(deps: ProjectFileActionDeps, path: AbsolutePath): Promise<boolean> {
    const result = await deps.api.fs.duplicate(path);
    if (!result.ok) {
        reportError(deps, FILE_ACTION_TEXTS.failed(FILE_ACTION_TEXTS.duplicate, result.error.message));
        return false;
    }
    const copy = result.value.path;
    await refreshAndReveal(deps, copy);
    if (isEditableTextFile(nameOf(copy))) await deps.open(copy, false);
    deps.undo.getState().push(presenceUndo(deps, FILE_ACTION_TEXTS.duplicate, copy, result.value.undoToken, true));
    deps.report({ text: FILE_ACTION_TEXTS.duplicated(nameOf(copy)), kind: 'info' });
    return true;
}

// ---------- Umbenennen und Verschieben ----------

interface RelocationRequest {
    readonly source: AbsolutePath;
    /** Erwartetes Ziel (für die Verweise); maßgeblich ist, was der Main meldet */
    readonly target: AbsolutePath;
    readonly title: string;
    readonly skipTitle: string;
    readonly run: () => Promise<IpcResult<FileOpResult>>;
    readonly doneText: (target: AbsolutePath) => string;
}

function referenceQuestion(plan: ReferencePlan, itemName: string, skipTitle: string): ReferenceQuestion {
    const files = plan.files.length;
    return {
        title: FILE_ACTION_TEXTS.referencesTitle(itemName),
        detail: FILE_ACTION_TEXTS.referencesDetail(planEditCount(plan), files),
        lines: planLines(plan),
        skipTitle,
    };
}

function emptyContext(project: ProjectView, source: AbsolutePath, target: AbsolutePath): ReferenceContext {
    return { root: project.root, source, target, mainAtSource: project.mainFile ?? '', graphicsDirectories: [] };
}

async function applyPlan(
    deps: ProjectFileActionDeps, plan: ReferencePlan | null, context: ReferenceContext, update: boolean,
): Promise<AppliedEdits> {
    if (plan === null || !update) return { files: [], failures: [] };
    const files = plan.files.map((file) => ({ atSource: file.atSource, edits: file.edits }));
    return applyAll(deps, context, files, { from: context.source, to: context.target });
}

function reportRelocation(
    deps: ProjectFileActionDeps, target: AbsolutePath, done: string, failures: readonly string[], count: number,
): void {
    if (failures.length > 0) {
        reportError(deps, FILE_ACTION_TEXTS.referenceFailures(nameOf(target), failures));
        return;
    }
    deps.report({ text: count > 0 ? FILE_ACTION_TEXTS.withReferences(done, count) : done, kind: 'info' });
}

/** Gemeinsamer Ablauf (Swift `relocate`): Verweise suchen und nachfragen, ausführen, Tabs nachziehen, Verweise anpassen */
async function relocateEntry(deps: ProjectFileActionDeps, request: RelocationRequest): Promise<string | null> {
    const project = currentProject(deps);
    if (project === null) return FILE_ACTION_TEXTS.noProject;
    const plan = await planReferenceEdits(deps, project, request.source, request.target);
    const itemName = nameOf(request.source);
    const choice = plan === null ? 'skip' : await deps.ask.askReferenceUpdate(referenceQuestion(plan, itemName, request.skipTitle));
    if (choice === 'cancel') return null;
    const result = await request.run();
    if (!result.ok) return result.error.message;
    const target = result.value.path;
    if (target === request.source) return null;
    deps.editor.getState().relocate(request.source, target);
    const context = plan === null ? emptyContext(project, request.source, target) : { ...plan.context, target };
    const applied = await applyPlan(deps, plan, context, choice === 'update');
    await refreshAndReveal(deps, target);
    deps.undo.getState().push(relocationUndo(deps, request.title, context, result.value.undoToken, applied.files));
    const count = applied.files.reduce((sum, file) => sum + file.edits.length, 0);
    reportRelocation(deps, target, request.doneText(target), applied.failures, count);
    return null;
}

function renameContext(project: ProjectView, deps: ProjectFileActionDeps, path: AbsolutePath): NameContext | null {
    const node = findNode(project.tree, path);
    if (node === null || path === project.root) return null;
    const original = { name: nameOf(path), isDirectory: node.kind === 'directory' };
    return nameContext(deps, 'rename', parentOf(path), original);
}

/** Umbenennen; liefert eine Fehlermeldung (der Dialog bleibt offen) oder `null` */
export async function renameEntry(deps: ProjectFileActionDeps, path: AbsolutePath, rawName: string): Promise<string | null> {
    const project = currentProject(deps);
    const context = project === null ? null : renameContext(project, deps, path);
    if (context === null) return FILE_ACTION_TEXTS.projectRoot;
    let name: string;
    try {
        name = finalName(rawName, context);
    } catch (error) {
        return error instanceof IpcFailure ? error.error.message : String(error);
    }
    if (name === nameOf(path)) return null;
    return relocateEntry(deps, {
        source: path, target: childOf(parentOf(path), name), title: FILE_ACTION_TEXTS.rename,
        skipTitle: FILE_ACTION_TEXTS.onlyRename, run: () => deps.api.fs.rename(path, name),
        doneText: (target) => FILE_ACTION_TEXTS.renamed(nameOf(path), nameOf(target)),
    });
}

export async function beginRename(deps: ProjectFileActionDeps, path: AbsolutePath): Promise<void> {
    const project = currentProject(deps);
    if (project === null || renameContext(project, deps, path) === null) return;
    await deps.ask.askName({
        kind: 'rename',
        title: FILE_ACTION_TEXTS.rename,
        actionTitle: FILE_ACTION_TEXTS.rename,
        placeholder: FILE_ACTION_TEXTS.placeholderRename,
        location: locationText(project.root, parentOf(path)),
        initialName: nameOf(path),
        selectsBaseName: true,
        validate: (name) => {
            const current = deps.project.getState().current;
            const context = current === null ? null : renameContext(current, deps, path);
            return context === null ? FILE_ACTION_TEXTS.projectRoot : validateEntryName(name, context);
        },
        submit: (name) => renameEntry(deps, path, name),
    });
}

function moveProblem(project: ProjectView, path: AbsolutePath, targetDir: AbsolutePath): string | null {
    if (path === project.root) return FILE_ACTION_TEXTS.projectRoot;
    if (isSameOrInside(targetDir, path)) return FILE_ACTION_TEXTS.intoItself;
    return null;
}

/** Verschieben in `targetDir` (Ziehen im Baum oder „Verschieben nach …“); `true`, wenn es geschah */
export async function moveEntry(deps: ProjectFileActionDeps, path: AbsolutePath, targetDir: AbsolutePath): Promise<boolean> {
    const project = currentProject(deps);
    if (project === null || parentOf(path) === targetDir) return false;
    const problem = moveProblem(project, path, targetDir);
    if (problem !== null) {
        reportError(deps, problem);
        return false;
    }
    const folderLabel = relativeToRoot(project.root, targetDir) || project.name;
    const error = await relocateEntry(deps, {
        source: path, target: childOf(targetDir, nameOf(path)), title: FILE_ACTION_TEXTS.move,
        skipTitle: FILE_ACTION_TEXTS.onlyMove, run: () => deps.api.fs.move(path, targetDir),
        doneText: (target) => FILE_ACTION_TEXTS.moved(nameOf(target), folderLabel),
    });
    if (error !== null) reportError(deps, FILE_ACTION_TEXTS.failed(FILE_ACTION_TEXTS.move, error));
    return error === null;
}

/** „Verschieben nach …“: Zielordner im Dialog wählen */
export async function beginMove(deps: ProjectFileActionDeps, path: AbsolutePath): Promise<void> {
    const project = currentProject(deps);
    if (project === null || path === project.root) return;
    const targets = moveTargets(project.tree, path);
    const chosen = await deps.ask.askMoveTarget({ itemName: nameOf(path), targets, initialPath: parentOf(path) });
    if (chosen !== null) await moveEntry(deps, path, chosen);
}

// ---------- Papierkorb ----------

function trashQuestion(project: ProjectView, path: AbsolutePath, tabs: readonly ClosedTab[]): TrashQuestion {
    const detail: string[] = [FILE_ACTION_TEXTS.trashDetail, FILE_ACTION_TEXTS.trashUndoHint];
    if (project.mainFile !== null && isSameOrInside(project.mainFile, path)) detail.push(FILE_ACTION_TEXTS.trashMain);
    const dirty = tabs.filter((tab) => tab.unsavedText !== null).map((tab) => nameOf(tab.path));
    if (dirty.length > 0) detail.push(FILE_ACTION_TEXTS.trashDirty(dirty));
    return { title: FILE_ACTION_TEXTS.trashTitle(nameOf(path)), detail };
}

/** In den Papierkorb legen (nach Bestätigung); der Main sichert vorher eine Kopie für das Rückgängig */
export async function trashEntry(deps: ProjectFileActionDeps, path: AbsolutePath): Promise<boolean> {
    const project = currentProject(deps);
    if (project === null) return false;
    if (path === project.root) {
        reportError(deps, FILE_ACTION_TEXTS.projectRoot);
        return false;
    }
    if (!(await deps.ask.confirmTrash(trashQuestion(project, path, snapshotTabsUnder(deps.editor, path))))) return false;
    const tabs = snapshotTabsUnder(deps.editor, path);
    const result = await deps.api.fs.trash(path);
    if (!result.ok) {
        reportError(deps, FILE_ACTION_TEXTS.trashFailed(nameOf(path), result.error.message));
        return false;
    }
    closeTabs(deps.editor, tabs);
    await afterRemoved(deps);
    deps.undo.getState().push(presenceUndo(deps, FILE_ACTION_TEXTS.trash, path, result.value, false, tabs));
    deps.report({ text: FILE_ACTION_TEXTS.trashed(nameOf(path)), kind: 'info' });
    return true;
}

// ---------- Rückgängig und Wiederholen (Menü Datei, Strg+Z im Dateibaum) ----------

export type UndoCommandDeps = Pick<ProjectFileActionDeps, 'undo' | 'report'>;

function reportOutcome(deps: UndoCommandDeps, outcome: AppUndoOutcome, direction: 'undo' | 'redo'): boolean {
    switch (outcome.kind) {
        case 'done': {
            const done = direction === 'undo' ? APP_UNDO_TEXTS.undone(outcome.title) : APP_UNDO_TEXTS.redone(outcome.title);
            if (outcome.warning === null) deps.report({ text: done, kind: 'info' });
            else deps.report({ text: APP_UNDO_TEXTS.withWarning(done, outcome.warning), kind: 'error' });
            return true;
        }
        case 'empty':
            deps.report({ text: direction === 'undo' ? APP_UNDO_TEXTS.nothingToUndo : APP_UNDO_TEXTS.nothingToRedo, kind: 'info' });
            return false;
        case 'busy':
            deps.report({ text: APP_UNDO_TEXTS.busy, kind: 'info' });
            return false;
        case 'failed':
            // Den Grund hat der Schritt selbst gemeldet (z. B. „existiert schon; nichts wurde überschrieben“)
            return false;
    }
}

export async function undoFileAction(deps: UndoCommandDeps): Promise<boolean> {
    return reportOutcome(deps, await deps.undo.getState().undo(), 'undo');
}

export async function redoFileAction(deps: UndoCommandDeps): Promise<boolean> {
    return reportOutcome(deps, await deps.undo.getState().redo(), 'redo');
}
