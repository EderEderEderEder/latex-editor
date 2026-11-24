// Zeigt die offene Datei im Baum: klappt die Ordner darüber auf und wählt die Zeile (Vorlage: `reveal` in `FileTreeView`).
import type { ProjectView } from '../stores/project';
import type { SidebarStore } from '../stores/sidebar';
import { ancestorFolders } from '../../shared/core/fileTree';

/** `true`, wenn die Datei im Baum steht. Schreibt nur, wenn sich etwas ändert (jede Änderung rechnet die Zeilen neu). */
export function revealInTree(sidebar: SidebarStore, project: ProjectView | null, path: string | null): boolean {
    if (project === null || path === null) return false;
    const folders = ancestorFolders(project.tree, path);
    if (folders === null) return false;
    const state = sidebar.getState();
    state.expandFolders(folders);
    state.select(path);
    return true;
}
