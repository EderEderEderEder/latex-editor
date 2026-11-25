import type { RecoveryEntry, RecoveryItem } from '../../shared/contract';
import type { GrantStore } from '../grants';
import type { IpcHandlers } from '../ipcHandlers';
import { isGrantId } from '../ipcValidation';
import { isPathWithin, rebaseToProjectRoot, type RealpathFunction, resolveRealPath } from '../paths';
import type { PendingBackup, RecoveryStore } from '../recovery';
import { resolveFileTarget } from './fsHandlers';

// `recovery:save/list/delete` (W2-14). Das Ziel ist wie bei `fs:*` ein Projektpfad oder eine `GrantId`; der Main
// wandelt es in den echten Pfad (der Renderer sieht nie einen Pfad außerhalb des Projekts). Beim Auflisten werden
// Dateien außerhalb des Projekts frisch gewährt: Die alten Kennungen gelten nur für den früheren App-Lauf.

export interface RecoveryHandlerDependencies {
    readonly grants: GrantStore;
    readonly store: RecoveryStore;
    readonly realpath?: RealpathFunction;
}

export type RecoveryHandlers = Pick<IpcHandlers, 'recovery:save' | 'recovery:list' | 'recovery:delete'>;

// Eine Datei gehört zum Projekt, wenn der Renderer sie als Projektpfad schickt oder ihr gewährter Pfad darin liegt.
function projectRootOf(target: string, path: string, deps: RecoveryHandlerDependencies): string | null {
    const root = deps.grants.currentProject;
    if (root === null) return null;
    if (!isGrantId(target)) return root;
    return isPathWithin(path, root, deps.grants.platform) ? root : null;
}

async function save(entry: RecoveryEntry, deps: RecoveryHandlerDependencies): Promise<void> {
    const path = await resolveFileTarget(entry.path, 'write', deps);
    const projectRoot = projectRootOf(entry.path, path, deps);
    await deps.store.write({ path, text: entry.text, savedAt: entry.savedAt, projectRoot });
}

async function remove(target: string, deps: RecoveryHandlerDependencies): Promise<void> {
    await deps.store.remove(await resolveFileTarget(target, 'write', deps));
}

async function toItem({ backup, diskState }: PendingBackup, deps: RecoveryHandlerDependencies): Promise<RecoveryItem> {
    const { grants, realpath } = deps;
    const { name, text, savedAt } = backup;
    if (backup.projectRoot === null) {
        return { path: grants.grant(backup.path, 'pickedFile').grantId, name, text, savedAt, diskState };
    }
    // Der Renderer kennt Projektpfade in der Form der Wurzel, nicht den aufgelösten Pfad (z. B. `/private/var/…`).
    const options = realpath === undefined ? { platform: grants.platform } : { platform: grants.platform, realpath };
    const realRoot = await resolveRealPath(backup.projectRoot, options);
    const path = rebaseToProjectRoot(backup.path, realRoot, backup.projectRoot, grants.platform);
    return { path, name, text, savedAt, diskState };
}

async function list(deps: RecoveryHandlerDependencies): Promise<RecoveryItem[]> {
    const pending = await deps.store.pending(deps.grants.currentProject);
    const items: RecoveryItem[] = [];
    for (const entry of pending) items.push(await toItem(entry, deps));
    return items;
}

export function createRecoveryHandlers(deps: RecoveryHandlerDependencies): RecoveryHandlers {
    return {
        'recovery:save': (entry) => save(entry, deps),
        'recovery:list': () => list(deps),
        'recovery:delete': (target) => remove(target, deps),
    };
}
