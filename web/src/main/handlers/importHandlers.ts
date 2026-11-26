import { join } from 'node:path';
import type { BibAppendResult, ImageImportResult } from '../../shared/contract';
import { IpcFailure } from '../../shared/ipcResult';
import { BibAppender } from '../bibAppend';
import { type FileStatLike, type GrantKind, type GrantStore, grantDroppedPaths } from '../grants';
import { importImage } from '../imageImport';
import type { IpcHandlers } from '../ipcHandlers';
import { type RealpathFunction, resolveRealPath } from '../paths';
import type { TextIoOptions } from '../textIo';
import { BACKUP_FOLDER_NAME } from './fsOpsHandlers';

// Bild-Import (W4-9), Literatur anhängen (W4-8) und Drag & Drop (`drop:grant`). Quellen kommen nur als
// `GrantId` (Dialog oder Drop, H1), Zielpfade werden gegen das Projekt des Main geprüft (Symlinks aufgelöst).

const IMAGE_SOURCE_KINDS: readonly GrantKind[] = ['importSource', 'pickedFile'];
const PATH_SEPARATOR_PATTERN = /\\/g;
const PARENT_SEGMENT = '..';

export const IMPORT_HANDLER_MESSAGES = {
    parentSegment: 'Pfade mit „..“ sind nicht erlaubt',
} as const;

export interface ImportHandlerDependencies {
    readonly grants: GrantStore;
    readonly userDataDir: string;
    readonly realpath?: RealpathFunction;
    readonly stat?: (target: string) => Promise<FileStatLike>;
    readonly textIo?: TextIoOptions;
}

export type ImportHandlers = Pick<IpcHandlers, 'drop:grant' | 'image:import' | 'bib:append' | 'bib:undo'>;

function rejectParentSegments(path: string): void {
    if (path.split(/[\\/]/).includes(PARENT_SEGMENT)) {
        throw new IpcFailure({ kind: 'forbiddenPath', message: IMPORT_HANDLER_MESSAGES.parentSegment });
    }
}

// Projektpfad mit `/` (so erwartet ihn `graphicsReference` und der Renderer).
function toProjectRelative(target: string, root: string, deps: ImportHandlerDependencies): string {
    const { path } = deps.grants.platform;
    return path.relative(root, target).replace(PATH_SEPARATOR_PATTERN, '/');
}

async function importImageHandler(sourceGrant: string, imagesDir: string, deps: ImportHandlerDependencies): Promise<ImageImportResult> {
    const { grants } = deps;
    const source = grants.resolveOneOf(sourceGrant, IMAGE_SOURCE_KINDS);
    rejectParentSegments(imagesDir);
    const directory = await grants.assertInProject(imagesDir, deps.realpath);
    const imported = await importImage(source, directory, { platform: grants.platform, realpath: deps.realpath, stat: deps.stat });
    const root = await resolveRealPath(grants.requireProject(), { platform: grants.platform, realpath: deps.realpath });
    // Nach dem Anlegen noch einmal prüfen: Ein Symlink, der erst jetzt hinausweist, zählt als außerhalb.
    await grants.assertInProject(imported.path, deps.realpath);
    return { relPath: toProjectRelative(imported.path, root, deps), reused: imported.reused };
}

async function bibAppendHandler(appender: BibAppender, bibPath: string, fragment: string, deps: ImportHandlerDependencies): Promise<BibAppendResult> {
    rejectParentSegments(bibPath);
    const target = await deps.grants.assertInProject(bibPath, deps.realpath);
    const result = await appender.append(target, fragment);
    return { ...result, path: bibPath };
}

export function createImportHandlers(deps: ImportHandlerDependencies): ImportHandlers {
    const { grants } = deps;
    const appender = new BibAppender({ backupDir: join(deps.userDataDir, BACKUP_FOLDER_NAME), textIo: deps.textIo });
    return {
        'drop:grant': (paths) => grantDroppedPaths(grants, paths, { platform: grants.platform, realpath: deps.realpath, stat: deps.stat }),
        'image:import': (sourceGrant, imagesDir) => importImageHandler(sourceGrant, imagesDir, deps),
        'bib:append': (bibPath, fragment) => bibAppendHandler(appender, bibPath, fragment, deps),
        'bib:undo': (token) => appender.undo(token),
    };
}
