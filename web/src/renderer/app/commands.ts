// Befehlsregister: commandId → Funktion. Quelle der IDs ist das Menü (`main/menuTemplate.ts`, `menu:command`).
// Jedes Kürzel hat genau einen Weg (sonst feuerte es doppelt):
// - Menü-Accelerator (Strg+W, Strg+P, Strg+G, Strg+N, Strg+Umschalt+O, Strg+J, Strg+Umschalt+N; macOS ⌥⌘Z/⌥⇧⌘Z für
//   Datei-Aktionen): löst `menu:command` aus, hier registriert. Im Dateibaum gilt Strg+Z zusätzlich den Datei-Aktionen.
// - Renderer (`app/shortcuts.ts` und CodeMirror): Strg+O/S/Umschalt+S/B/., F8, Strg+Tab, Zoom, Suchen, Ersetzen,
//   Rückgängig/Wiederholen; das Menü zeigt sie nur an (`displayOnly`), die Befehle hier gelten für Mausklicks im Menü.
// - Ausschneiden/Kopieren/Einfügen/Alles auswählen: Electron-Rollen, nicht hier.
import { redo, undo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';
import type { Unsubscribe } from '../../shared/contract';
import { openReplacePanel } from '../editor/search';
import { onMainEvent } from '../ipc/events';
import type { EditorStore } from '../stores/editor';
import type { OverlayStore } from '../stores/overlays';
import type { SidebarStore, SidebarTab } from '../stores/sidebar';
import type { StatusMessage } from '../stores/status';
import type { ViewModeStore } from '../stores/viewMode';
import type { BuildStore } from '../stores/build';
import { saveActiveFile, saveActiveFileAs, saveFile, openFilesFromDialog } from './fileActions';
import type { FileActionDeps } from './fileActions';
import { dirtyPaths } from './closeFlow';
import { goToIssue } from './issueActions';
import { createNewFile } from './newFile';
import { beginNewEntry, redoFileAction, undoFileAction } from './projectFileActions';
import type { ProjectFileActionDeps } from './projectFileActions';
import { chooseAndOpenProject } from './projectFlow';
import type { RevealDeps } from './revealLine';
import type { ProjectFlowDeps } from './projectFlow';
import { revealCursorInPdf, SYNCTEX_TEXTS } from './synctexFlow';
import type { SyncTeXFlowDeps } from './synctexFlow';
import { closeActiveTabWithPrompt } from './tabClose';
import type { TabCloseDeps } from './tabClose';
import { changeEditorZoom } from './zoom';
import type { ViewMode } from './viewModeLogic';
import type { ZoomDirection, ZoomSettingsStore } from './zoom';

export type CommandHandler = () => void | Promise<void>;
export type CommandRegistry = ReadonlyMap<string, CommandHandler>;

/** Einstellungen, die Befehle brauchen: Zoom, „Beim Speichern kompilieren“, „PDF folgt Cursor“ (ein gemeinsamer Zustandstyp) */
export interface CommandSettingsStore {
    getState(): ReturnType<ZoomSettingsStore['getState']> & {
        readonly values: { readonly compilesOnSave: boolean; readonly pdfFollowsCursor: boolean };
        set(key: 'compilesOnSave' | 'pdfFollowsCursor', value: boolean): Promise<void>;
    };
}

export interface CommandDeps {
    readonly fileActions: () => FileActionDeps;
    readonly tabClose: () => TabCloseDeps;
    readonly projectFlow: () => ProjectFlowDeps;
    readonly editor: EditorStore;
    readonly build: Pick<BuildStore, 'getState'>;
    readonly overlays: OverlayStore;
    readonly sidebar: SidebarStore;
    readonly viewMode: ViewModeStore;
    readonly settings: CommandSettingsStore;
    readonly activeView: () => EditorView | null;
    readonly focusEditor: () => void;
    /** Abhängigkeiten für den Sprung zu einer Meldung (öffnet Datei, setzt Cursor) */
    readonly reveal: () => RevealDeps;
    readonly report: (message: StatusMessage) => void;
    /** Rückfrage vor „Hilfsdateien löschen“; `true` = löschen */
    readonly confirmClean: () => boolean;
    /** Abhängigkeiten der SyncTeX-Abläufe (Strg+J) */
    readonly syncTeX: () => SyncTeXFlowDeps;
    /** Datei-Aktionen im Projekt und ihr App-Rückgängig (W2-9) */
    readonly projectFileActions: () => ProjectFileActionDeps;
}

function fileCommands(deps: CommandDeps): [string, CommandHandler][] {
    return [
        ['file.openProject', () => void chooseAndOpenProject(deps.projectFlow())],
        ['file.openFile', () => openFilesFromDialog(deps.fileActions())],
        ['file.new', async () => void (await createNewFile(deps.fileActions()))],
        ['file.save', async () => void (await saveActiveFile(deps.fileActions()))],
        ['file.saveAs', async () => void (await saveActiveFileAs(deps.fileActions()))],
        ['file.saveAll', () => saveAllDirtyTabs(deps.fileActions())],
        ['file.closeTab', async () => void (await closeActiveTabWithPrompt(deps.tabClose()))],
        ['file.newProjectFile', () => beginNewEntry(deps.projectFileActions(), 'file')],
        ['file.newFolder', () => beginNewEntry(deps.projectFileActions(), 'directory')],
        ['file.undoFileAction', async () => void (await undoFileAction(deps.projectFileActions()))],
        ['file.redoFileAction', async () => void (await redoFileAction(deps.projectFileActions()))],
    ];
}

/** Speichert alle geänderten Tabs mit der vorhandenen Speicherfunktion (Fehler meldet `saveFile` selbst) */
export async function saveAllDirtyTabs(deps: FileActionDeps): Promise<void> {
    for (const path of dirtyPaths(deps.store)) await saveFile(deps, path);
}

function gotoLineCommand(deps: CommandDeps): CommandHandler {
    return () => {
        if (deps.editor.getState().activeSession() === null) return;
        deps.overlays.getState().show('gotoLine');
    };
}

function editCommands(deps: CommandDeps): [string, CommandHandler][] {
    const withView = (run: (view: EditorView) => void): CommandHandler => () => {
        const view = deps.activeView();
        if (view === null) return;
        run(view);
        view.focus();
    };
    return [
        ['edit.undo', withView((view) => void undo(view))],
        ['edit.redo', withView((view) => void redo(view))],
        ['edit.find', withView((view) => void openSearchPanel(view))],
        ['edit.replace', withView((view) => void openReplacePanel(view))],
        ['edit.gotoLine', gotoLineCommand(deps)],
        ['edit.quickOpen', () => deps.overlays.getState().show('quickOpen')],
    ];
}

function zoomCommand(deps: CommandDeps, direction: ZoomDirection): CommandHandler {
    return () => changeEditorZoom(deps.settings, direction, (text) => deps.report({ text, kind: 'error' }));
}

function sidebarCommand(deps: CommandDeps, tab: SidebarTab): CommandHandler {
    return () => deps.sidebar.getState().setTab(tab);
}

function viewModeCommand(deps: CommandDeps, mode: ViewMode): CommandHandler {
    return () => deps.viewMode.getState().setMode(mode);
}

function viewCommands(deps: CommandDeps): [string, CommandHandler][] {
    return [
        ['view.mode.editor', viewModeCommand(deps, 'editor')],
        ['view.mode.split', viewModeCommand(deps, 'split')],
        ['view.mode.pdf', viewModeCommand(deps, 'pdf')],
        ['view.zoomIn', zoomCommand(deps, 'in')],
        ['view.zoomOut', zoomCommand(deps, 'out')],
        ['view.zoomReset', zoomCommand(deps, 'reset')],
        ['view.sidebarFiles', sidebarCommand(deps, 'files')],
        ['view.sidebarOutline', sidebarCommand(deps, 'outline')],
        ['view.sidebarIssues', sidebarCommand(deps, 'issues')],
        ['view.synctexForward', async () => void (await revealCursorInPdf(deps.syncTeX(), 'explicit'))],
        ['view.toggleFollowCursor', () => toggleFollowCursor(deps)],
        ['view.nextTab', () => deps.editor.getState().activateNext()],
        ['view.previousTab', () => deps.editor.getState().activatePrevious()],
    ];
}

function reportSettingFailure(deps: CommandDeps, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    deps.report({ text: `Einstellung nicht gespeichert: ${detail}`, kind: 'error' });
}

/** „PDF folgt Cursor“ ein/aus (Standard aus wie Swift); die Statusleiste nennt den neuen Zustand */
async function toggleFollowCursor(deps: CommandDeps): Promise<void> {
    const state = deps.settings.getState();
    const next = !state.values.pdfFollowsCursor;
    try {
        await state.set('pdfFollowsCursor', next);
    } catch (error) {
        reportSettingFailure(deps, error);
        return;
    }
    deps.report({ text: next ? SYNCTEX_TEXTS.followOn : SYNCTEX_TEXTS.followOff, kind: 'info' });
}

function toggleCompileOnSave(deps: CommandDeps): Promise<void> {
    const state = deps.settings.getState();
    return state.set('compilesOnSave', !state.values.compilesOnSave).catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        deps.report({ text: `Einstellung nicht gespeichert: ${detail}`, kind: 'error' });
    });
}

function issueCommand(deps: CommandDeps, direction: 'next' | 'previous'): CommandHandler {
    return () => goToIssue(deps.reveal(), deps.build, direction);
}

function projectCommands(deps: CommandDeps): [string, CommandHandler][] {
    return [
        ['project.compile', async () => void (await deps.build.getState().compile())],
        ['project.cancel', () => deps.build.getState().cancel()],
        ['project.clean', async () => void (deps.confirmClean() && (await deps.build.getState().clean()))],
        ['project.toggleCompileOnSave', () => toggleCompileOnSave(deps)],
        ['project.showIssues', sidebarCommand(deps, 'issues')],
        ['project.nextIssue', issueCommand(deps, 'next')],
        ['project.previousIssue', issueCommand(deps, 'previous')],
    ];
}

export function createCommandRegistry(deps: CommandDeps): CommandRegistry {
    return new Map<string, CommandHandler>([
        ...fileCommands(deps),
        ...editCommands(deps),
        ...viewCommands(deps),
        ...projectCommands(deps),
    ]);
}

/** Führt einen Befehl aus; unbekannte IDs werden ignoriert, Fehler als Meldung gezeigt (nie geworfen) */
export async function runCommand(registry: CommandRegistry, commandId: string, report: CommandDeps['report']): Promise<void> {
    const handler = registry.get(commandId);
    if (handler === undefined) return;
    try {
        await handler();
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        report({ text: `Befehl fehlgeschlagen: ${detail}`, kind: 'error' });
    }
}

/** Abonniert `menu:command` des Mains; die Rückgabe meldet wieder ab */
export function connectMenuCommands(registry: CommandRegistry, report: CommandDeps['report']): Unsubscribe {
    return onMainEvent('menu:command', ({ commandId }) => void runCommand(registry, commandId, report));
}
