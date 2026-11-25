// Datei-Aktionen (W2-9): gemeinsame Abhängigkeiten, Texte und kleine Schritte für `projectFileActions.ts` und
// `projectFileActionsUndo.ts` (Baum neu holen, Eintrag zeigen, Rückgängig-Kennung des Main einlösen).
import type { AbsolutePath, RendererApi, UndoToken } from '../../shared/contract';
import type { NamePlatform } from '../../shared/core/fileNames';
import type { AppUndoStore } from '../stores/appUndo';
import type { ProjectStore, ProjectView } from '../stores/project';
import type { SidebarStore } from '../stores/sidebar';
import type { StatusMessage } from '../stores/status';
import type { FileActionAsk } from './projectFileActionsPrompts';
import { findNode } from './projectFileActionsNames';
import type { ReferenceDeps } from './projectFileActionsReferences';
import type { OpenFile } from './projectFileActionsTabs';
import { revealInTree } from './treeReveal';

export interface ProjectFileActionDeps extends ReferenceDeps {
    readonly api: Pick<RendererApi, 'fs'>;
    readonly project: Pick<ProjectStore, 'getState'>;
    readonly sidebar: SidebarStore;
    readonly undo: Pick<AppUndoStore, 'getState'>;
    readonly ask: FileActionAsk;
    readonly report: (message: StatusMessage) => void;
    /** Für die Namensprüfung beim Tippen (Windows hat zusätzliche Verbote) */
    readonly platform: NamePlatform;
    /** Projektdatei öffnen (Vorschau-Tab oder fest) */
    readonly open: OpenFile;
}

export const FILE_ACTION_TEXTS = {
    newFile: 'Neue Datei',
    newFolder: 'Neuer Ordner',
    rename: 'Umbenennen',
    move: 'Verschieben',
    duplicate: 'Duplizieren',
    trash: 'In den Papierkorb legen',
    create: 'Anlegen',
    placeholderFile: 'z. B. einleitung (Endung .tex wird ergänzt)',
    placeholderFolder: 'Ordnername',
    placeholderRename: 'Neuer Name',
    noProject: 'Kein Projekt geöffnet.',
    projectRoot: 'Der Projektordner selbst kann hier nicht geändert werden.',
    intoItself: 'Ein Ordner kann nicht in sich selbst verschoben werden.',
    trashTitle: (name: string) => `„${name}“ in den Papierkorb legen?`,
    trashDetail: 'Der Eintrag wird in den Papierkorb gelegt und kann dort wiederhergestellt werden.',
    trashUndoHint: 'Datei → „Datei-Aktion rückgängig“ holt ihn zurück.',
    trashMain: 'Achtung: Das ist die Hauptdatei des Projekts.',
    trashDirty: (names: readonly string[]) =>
        `Ungespeicherte Änderungen: ${names.join(', ')}. Der Tab wird geschlossen; „Datei-Aktion rückgängig“ holt Datei und Änderungen zurück.`,
    trashFailed: (name: string, detail: string) => `„${name}“ konnte nicht in den Papierkorb gelegt werden: ${detail}`,
    referencesTitle: (name: string) => `Verweise auf „${name}“ anpassen?`,
    referencesDetail: (count: number, files: number) =>
        `${count} Verweis${count === 1 ? '' : 'e'} in ${files} Datei${files === 1 ? '' : 'en'} würden sonst ins Leere zeigen.`,
    onlyRename: 'Nur umbenennen',
    onlyMove: 'Nur verschieben',
    referenceFailures: (name: string, failures: readonly string[]) =>
        `„${name}“ wurde umbenannt bzw. verschoben, aber diese Verweise konnten nicht angepasst werden und zeigen jetzt ins Leere – bitte von Hand ändern: ${failures.join('; ')}`,
    referenceUndoFailures: (failures: readonly string[]) => `Verweise nicht zurückgesetzt – bitte prüfen: ${failures.join('; ')}`,
    failed: (action: string, detail: string) => `${action} nicht möglich: ${detail}`,
    created: (name: string) => `Angelegt: ${name}`,
    renamed: (from: string, to: string) => `Umbenannt: ${from} → ${to}`,
    moved: (name: string, folder: string) => `Verschoben: ${name} → ${folder}`,
    duplicated: (name: string) => `Dupliziert: ${name}`,
    trashed: (name: string) => `„${name}“ liegt im Papierkorb.`,
    withReferences: (message: string, count: number) => `${message} (${count} Verweis${count === 1 ? '' : 'e'} angepasst)`,
} as const;

export function currentProject(deps: ProjectFileActionDeps): ProjectView | null {
    const project = deps.project.getState().current;
    if (project === null) deps.report({ text: FILE_ACTION_TEXTS.noProject, kind: 'error' });
    return project;
}

export function reportError(deps: ProjectFileActionDeps, text: string): void {
    deps.report({ text, kind: 'error' });
}

/** Baum neu holen und den Eintrag zeigen (Ordner darüber aufklappen, Zeile wählen) */
export async function refreshAndReveal(deps: ProjectFileActionDeps, path: AbsolutePath | null): Promise<void> {
    await deps.project.getState().refreshTree();
    if (path !== null) revealInTree(deps.sidebar, deps.project.getState().current, path);
}

/** Nach dem Entfernen: Baum neu; ohne offene Tabs die Hauptdatei öffnen (wie Swift `removeToTrash`) */
export async function afterRemoved(deps: ProjectFileActionDeps): Promise<void> {
    await deps.project.getState().refreshTree();
    const project = deps.project.getState().current;
    const main = project?.mainFile ?? null;
    if (project === null || main === null || deps.editor.getState().tabs.items.length > 0) return;
    if (findNode(project.tree, main) !== null) await deps.open(main, false);
}

/** Löst eine Rückgängig-Kennung des Main ein; liefert die Kennung für den Gegenschritt oder `null` (gemeldet) */
export async function restoreToken(deps: ProjectFileActionDeps, token: UndoToken): Promise<UndoToken | null> {
    const result = await deps.api.fs.restore(token);
    if (result.ok) return result.value;
    reportError(deps, result.error.message);
    return null;
}
