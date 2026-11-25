// Dateiliste für „Schnell öffnen“: relative Projektpfade (mit „/“) der editierbaren Dateien, offene Tabs markiert.
import type { AbsolutePath } from '../../shared/contract';
import { isEditableTextFile } from '../../shared/core/fileTypes';
import { collectFiles } from '../../shared/core/fileTree';
import type { QuickOpenFile } from '../../shared/core/quickOpen';
import type { ProjectView } from '../stores/project';

export interface QuickOpenList {
    readonly files: readonly QuickOpenFile[];
    /** relativer Pfad → absoluter Pfad (Schlüssel der Sitzung) */
    readonly absolutePaths: ReadonlyMap<string, AbsolutePath>;
}

function relativeTo(root: AbsolutePath, path: AbsolutePath): string | null {
    const prefix = root.replace(/[\\/]+$/, '');
    if (!path.startsWith(prefix) || !/[\\/]/.test(path.charAt(prefix.length))) return null;
    return path.slice(prefix.length + 1).replace(/\\/g, '/');
}

export function quickOpenFilesOf(project: ProjectView | null, openPaths: readonly string[]): QuickOpenList {
    const files: QuickOpenFile[] = [];
    const absolutePaths = new Map<string, AbsolutePath>();
    if (project === null) return { files, absolutePaths };
    const open = new Set(openPaths);
    for (const file of collectFiles(project.tree.children)) {
        const relative = relativeTo(project.root, file.path);
        if (relative === null || file.isBuildFile === true || !isEditableTextFile(file.name)) continue;
        files.push({ path: relative, isOpen: open.has(file.path) });
        absolutePaths.set(relative, file.path);
    }
    return { files, absolutePaths };
}
