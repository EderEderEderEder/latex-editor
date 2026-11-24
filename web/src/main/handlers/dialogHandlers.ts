import type { FileFilter, GrantedPath, PickFilesOptions, SaveAsOptions } from '../../shared/contract';
import { IpcFailure } from '../../shared/ipcResult';
import type { GrantStore } from '../grants';
import type { IpcHandlers } from '../ipcHandlers';
import { isPathWithin, type PathPlatform } from '../paths';

// Dialog-Handler (H1): Jeder gewählte Pfad wird im Main als Gewährung abgelegt, der Renderer bekommt
// nur `GrantedPath {grantId, name}`. Electrons `dialog` und das Hauptfenster kommen als Parameter
// herein, damit Vitest ohne Electron prüft (`index.ts` reicht die echten Objekte durch).

export type OpenDialogProperty = 'openFile' | 'openDirectory' | 'multiSelections' | 'createDirectory';
export type SaveDialogProperty = 'createDirectory' | 'showOverwriteConfirmation';

export interface DialogFilter {
    name: string;
    extensions: string[];
}

export interface OpenDialogOptionsLike {
    title?: string;
    filters?: DialogFilter[];
    properties: OpenDialogProperty[];
}

export interface SaveDialogOptionsLike {
    title?: string;
    defaultPath?: string;
    filters?: DialogFilter[];
    properties: SaveDialogProperty[];
}

export interface DialogLike<W> {
    showOpenDialog(window: W, options: OpenDialogOptionsLike): Promise<{ canceled: boolean; filePaths: string[] }>;
    showSaveDialog(window: W, options: SaveDialogOptionsLike): Promise<{ canceled: boolean; filePath?: string }>;
}

export interface DialogHandlerDependencies<W> {
    readonly dialog: DialogLike<W>;
    readonly grants: GrantStore;
    // Elternfenster der Dialoge (Hauptfenster); `null`, solange keins existiert.
    readonly window: () => W | null;
    readonly platform: PathPlatform;
}

export type DialogHandlers = Pick<IpcHandlers, 'dialog:pickFiles' | 'dialog:saveAs' | 'dialog:openProject'>;

const LATEX_EXTENSIONS = ['tex', 'bib', 'sty', 'cls'];
const TEXT_EXTENSIONS = [...LATEX_EXTENSIONS, 'bst', 'bbx', 'cbx', 'dtx', 'ins', 'txt', 'csv', 'dat'];

export const DEFAULT_FILE_FILTERS: readonly FileFilter[] = [
    { name: 'LaTeX-Dateien', extensions: LATEX_EXTENSIONS },
    { name: 'Alle Textdateien', extensions: TEXT_EXTENSIONS },
];

export const DIALOG_TITLES = {
    pickFiles: 'Dateien wählen',
    saveAs: 'Speichern unter',
    openProject: 'Projektordner öffnen',
} as const;

const NO_WINDOW_MESSAGE = 'Kein Hauptfenster für den Dialog';
const LEADING_DOT = /^\./;

function requireWindow<W>(deps: DialogHandlerDependencies<W>): W {
    const window = deps.window();
    if (window === null) throw new IpcFailure({ kind: 'internal', message: NO_WINDOW_MESSAGE });
    return window;
}

// Electron erwartet Endungen ohne Punkt und veränderbare Listen.
function toDialogFilters(filters: readonly FileFilter[] | undefined): DialogFilter[] {
    const source = filters === undefined || filters.length === 0 ? DEFAULT_FILE_FILTERS : filters;
    return source.map((filter) => ({
        name: filter.name,
        extensions: filter.extensions.map((extension) => extension.replace(LEADING_DOT, '')),
    }));
}

export function toOpenFileOptions(options: PickFilesOptions): OpenDialogOptionsLike {
    const properties: OpenDialogProperty[] = options.multiple === true ? ['openFile', 'multiSelections'] : ['openFile'];
    return { title: options.title ?? DIALOG_TITLES.pickFiles, filters: toDialogFilters(options.filters), properties };
}

// Den Vorschlag übernimmt der Dialog nur mit Ordner, wenn er im aktuellen Projekt liegt; sonst nur den Namen,
// damit der Renderer den Dialog nicht in beliebige Ordner lenkt.
function saveDefaultPath(defaultPath: string | undefined, deps: DialogHandlerDependencies<unknown>): string | undefined {
    if (defaultPath === undefined) return undefined;
    const project = deps.grants.currentProject;
    try {
        if (project !== null && isPathWithin(defaultPath, project, deps.platform)) return defaultPath;
    } catch {
        // Kein gültiger absoluter Pfad: unten bleibt nur der Name.
    }
    return deps.platform.path.basename(defaultPath) || undefined;
}

export function toSaveOptions(options: SaveAsOptions, deps: DialogHandlerDependencies<unknown>): SaveDialogOptionsLike {
    return {
        title: options.title ?? DIALOG_TITLES.saveAs,
        defaultPath: saveDefaultPath(options.defaultPath, deps),
        filters: toDialogFilters(options.filters),
        properties: ['createDirectory', 'showOverwriteConfirmation'],
    };
}

async function pickFiles<W>(deps: DialogHandlerDependencies<W>, options: PickFilesOptions): Promise<GrantedPath[] | null> {
    const result = await deps.dialog.showOpenDialog(requireWindow(deps), toOpenFileOptions(options));
    if (result.canceled || result.filePaths.length === 0) return null;
    const chosen = options.multiple === true ? result.filePaths : result.filePaths.slice(0, 1);
    return chosen.map((path) => deps.grants.grant(path, 'pickedFile'));
}

async function saveAs<W>(deps: DialogHandlerDependencies<W>, options: SaveAsOptions): Promise<GrantedPath | null> {
    const result = await deps.dialog.showSaveDialog(requireWindow(deps), toSaveOptions(options, deps));
    if (result.canceled || result.filePath === undefined || result.filePath.length === 0) return null;
    return deps.grants.grant(result.filePath, 'saveTarget');
}

async function openProject<W>(deps: DialogHandlerDependencies<W>): Promise<GrantedPath | null> {
    const options: OpenDialogOptionsLike = {
        title: DIALOG_TITLES.openProject,
        properties: ['openDirectory', 'createDirectory'],
    };
    const result = await deps.dialog.showOpenDialog(requireWindow(deps), options);
    const [root] = result.filePaths;
    if (result.canceled || root === undefined) return null;
    return deps.grants.grant(root, 'project');
}

export function createDialogHandlers<W>(deps: DialogHandlerDependencies<W>): DialogHandlers {
    return {
        'dialog:pickFiles': (options) => pickFiles(deps, options),
        'dialog:saveAs': (options) => saveAs(deps, options),
        'dialog:openProject': () => openProject(deps),
    };
}
