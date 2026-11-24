import * as fsp from 'node:fs/promises';
import type { ProjectInfo, RecentProject } from '../../shared/contract';
import { IpcFailure } from '../../shared/ipcResult';
import type { GrantStore } from '../grants';
import type { IpcHandlers } from '../ipcHandlers';
import { detectMainFile, existingRecentEntries, RecentProjectsStore, scanProjectTree } from '../project';

// `project:open` und `project:recent` (W2-1). Das Projekt wird aus einer Gewährung der Art „project“ geöffnet
// (aus `dialog:openProject` oder `project:recent`); danach gilt es dem Main als „das aktuelle Projekt“ für `fs:*`.

export interface ProjectHandlerDependencies {
    readonly grants: GrantStore;
    readonly recent: RecentProjectsStore;
    readonly log?: (message: string) => void;
}

export type ProjectHandlers = Pick<IpcHandlers, 'project:open' | 'project:recent'>;

export const PROJECT_MESSAGES = {
    notADirectory: 'Der Projektordner existiert nicht mehr',
    recentNotSaved: (reason: string) => `„Zuletzt geöffnet“ nicht gespeichert: ${reason}`,
} as const;

async function assertDirectory(path: string): Promise<void> {
    const info = await fsp.stat(path).catch(() => null);
    if (info?.isDirectory() === true) return;
    throw new IpcFailure({ kind: 'notFound', message: PROJECT_MESSAGES.notADirectory });
}

// Ein Fehler in der Liste „Zuletzt geöffnet“ verhindert das Öffnen nicht.
async function rememberProject(path: string, deps: ProjectHandlerDependencies): Promise<void> {
    try {
        await deps.recent.add(path);
    } catch (error) {
        deps.log?.(PROJECT_MESSAGES.recentNotSaved(error instanceof Error ? error.message : String(error)));
    }
}

// Das bisherige Projekt bleibt, bis der neue Baum fertig gelesen ist (ein Fehler lässt es unberührt).
async function openProject(grantId: string, deps: ProjectHandlerDependencies): Promise<ProjectInfo> {
    const root = deps.grants.resolve(grantId, 'project');
    await assertDirectory(root);
    const { tree } = await scanProjectTree(root);
    const mainFile = await detectMainFile(tree);
    deps.grants.openProject(grantId);
    await rememberProject(root, deps);
    return { root, mainFile, tree };
}

async function listRecent(deps: ProjectHandlerDependencies): Promise<RecentProject[]> {
    const entries = await existingRecentEntries(deps.recent);
    return entries.map((entry) => ({ ...deps.grants.grant(entry.path, 'project'), openedAt: entry.openedAt }));
}

export function createProjectHandlers(deps: ProjectHandlerDependencies): ProjectHandlers {
    return {
        'project:open': (grantId) => openProject(grantId, deps),
        'project:recent': () => listRecent(deps),
    };
}
