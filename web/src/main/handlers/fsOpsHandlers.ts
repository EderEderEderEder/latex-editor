import { join } from 'node:path';
import type { GrantId } from '../../shared/contract';
import { FsOps, type FsOpsDependencies, type TrashItem } from '../fsOps';
import { checkImportSource, FILE_IMPORT_RULES, type FileStatLike, type GrantKind, type GrantStore } from '../grants';
import type { IpcHandlers } from '../ipcHandlers';
import type { RealpathFunction } from '../paths';

// Dateiaktionen (W2-7) über IPC. Projektpfade prüft `FsOps` gegen das aktuelle Projekt des Main; Importquellen
// kommen nur als `GrantId` (Dialog „Dateien wählen“ oder Drop, H1) und werden vor dem Kopieren erneut geprüft
// (kein UNC, Endung, Größe, reguläre Datei). Papierkorb (`shell.trashItem`) reicht `index.ts` herein.

// Unterordner im App-Datenordner (`userData`) für Sicherungen vor dem Papierkorb.
export const BACKUP_FOLDER_NAME = 'Ablage';

const IMPORT_GRANT_KINDS: readonly GrantKind[] = ['importSource', 'pickedFile'];

export interface FsOpsHandlerDependencies {
    readonly grants: GrantStore;
    readonly userDataDir: string;
    readonly trashItem?: TrashItem;
    readonly realpath?: RealpathFunction;
    readonly stat?: (target: string) => Promise<FileStatLike>;
    readonly ops?: Partial<Pick<FsOpsDependencies, 'createToken' | 'rename' | 'sleep'>>;
}

export type FsOpsHandlers = Pick<
    IpcHandlers,
    'fs:create' | 'fs:rename' | 'fs:move' | 'fs:duplicate' | 'fs:import' | 'fs:trash' | 'fs:restore'
>;

async function resolveImportSources(grantIds: readonly GrantId[], deps: FsOpsHandlerDependencies): Promise<string[]> {
    const { platform } = deps.grants;
    const sources: string[] = [];
    for (const grantId of grantIds) {
        const granted = deps.grants.resolveOneOf(grantId, IMPORT_GRANT_KINDS);
        sources.push(await checkImportSource(granted, FILE_IMPORT_RULES, { platform, realpath: deps.realpath, stat: deps.stat }));
    }
    return sources;
}

export function createFsOps(deps: FsOpsHandlerDependencies): FsOps {
    const { grants } = deps;
    return new FsOps({
        ...deps.ops,
        platform: grants.platform,
        projectRoot: () => grants.requireProject(),
        backupDir: join(deps.userDataDir, BACKUP_FOLDER_NAME),
        trashItem: deps.trashItem,
        realpath: deps.realpath,
    });
}

export function createFsOpsHandlers(deps: FsOpsHandlerDependencies): FsOpsHandlers {
    const ops = createFsOps(deps);
    return {
        'fs:create': (parentDir, name, kind) => ops.create(parentDir, name, kind),
        'fs:rename': (path, newName) => ops.rename(path, newName),
        'fs:move': (path, targetDir) => ops.move(path, targetDir),
        'fs:duplicate': (path) => ops.duplicate(path),
        'fs:import': async (grantIds, targetDir) => ops.importFiles(await resolveImportSources(grantIds, deps), targetDir),
        'fs:trash': (path) => ops.trash(path),
        'fs:restore': (token) => ops.restore(token),
    };
}
