// Projekt öffnen und wechseln (W2-3). Reihenfolge, damit nichts verloren geht:
// 1. ungespeicherte Tabs des alten Projekts klären (Abbrechen: nichts hat sich geändert),
// 2. Tab-Gedächtnis des alten Projekts schreiben und beenden (der Main kennt noch das alte Projekt),
// 3. `project:open` (Fehler: Gedächtnis des alten Projekts wieder aufnehmen),
// 4. Tabs des alten Projekts schließen, Store und Seitenleiste umstellen,
// 5. Tab-Gedächtnis des neuen Projekts wiederherstellen.
// Tabs von Dateien außerhalb des Projekts (Dialog-Kennungen) bleiben offen.
import type { GrantId, RendererApi } from '../../shared/contract';
import type { EditorStore } from '../stores/editor';
import type { ProjectStore } from '../stores/project';
import type { SidebarStore } from '../stores/sidebar';
import type { StatusMessage } from '../stores/status';
import { saveFile } from './fileActions';
import { toRelativePath } from './tabMemory';
import type { RestoreResult } from './tabMemory';
import type { TabCloseChoice } from './tabClose';

export interface ProjectFlowDeps {
    readonly api: Pick<RendererApi, 'project' | 'dialog' | 'fs'>;
    readonly project: ProjectStore;
    readonly editor: EditorStore;
    readonly sidebar: SidebarStore;
    readonly memory: {
        start(root: string): Promise<RestoreResult>;
        stop(): Promise<void>;
    };
    /** Nachfrage bei ungespeicherten Änderungen (dieselbe wie beim Schließen eines Tabs) */
    readonly ask: (name: string) => Promise<TabCloseChoice>;
    readonly report: (message: StatusMessage) => void;
}

export const PROJECT_FLOW_TEXTS = {
    openFailed: (detail: string) => `Projekt konnte nicht geöffnet werden: ${detail}`,
    skippedTabs: (count: number) =>
        count === 1 ? 'Ein gemerkter Tab konnte nicht geöffnet werden.' : `${count} gemerkte Tabs konnten nicht geöffnet werden.`,
} as const;

const switching = new WeakSet<ProjectStore>();

/** Offene Tabs, die zum aktuellen Projekt gehören */
export function projectTabPaths(deps: Pick<ProjectFlowDeps, 'project' | 'editor'>): string[] {
    const root = deps.project.getState().current?.root;
    if (root === undefined) return [];
    return deps.editor.getState().tabs.items.filter((path) => toRelativePath(root, path) !== null);
}

/** Fragt für jeden ungespeicherten Tab; `false`, wenn der Nutzer abbricht oder Speichern misslingt */
async function settleDirtyTabs(deps: ProjectFlowDeps, paths: readonly string[]): Promise<boolean> {
    for (const path of paths) {
        const info = deps.editor.getState().files[path];
        if (info?.isDirty !== true) continue;
        const choice = await deps.ask(info.title);
        if (choice === 'cancel') return false;
        if (choice === 'discard') continue;
        const saved = await saveFile({ api: deps.api, store: deps.editor, report: deps.report }, path);
        if (saved !== 'saved' && saved !== 'unchanged') return false;
    }
    return true;
}

async function restoreAndReport(deps: ProjectFlowDeps, root: string): Promise<void> {
    const restored = await deps.memory.start(root);
    if (restored.skipped > 0) deps.report({ text: PROJECT_FLOW_TEXTS.skippedTabs(restored.skipped), kind: 'info' });
}

async function switchTo(deps: ProjectFlowDeps, grantId: GrantId): Promise<boolean> {
    const oldTabs = projectTabPaths(deps);
    if (!(await settleDirtyTabs(deps, oldTabs))) return false;
    const previous = deps.project.getState().current;
    await deps.memory.stop();
    const opened = await deps.api.project.open(grantId);
    if (!opened.ok) {
        deps.report({ text: PROJECT_FLOW_TEXTS.openFailed(opened.error.message), kind: 'error' });
        if (previous !== null) await deps.memory.start(previous.root);
        return false;
    }
    for (const path of oldTabs) deps.editor.getState().close(path);
    if (previous?.root !== opened.value.root) deps.sidebar.getState().resetForProject();
    deps.project.getState().setProject(opened.value, grantId);
    await restoreAndReport(deps, opened.value.root);
    void deps.project.getState().loadRecent();
    return true;
}

/** Öffnet das Projekt mit dieser Kennung (aus Dialog oder „Zuletzt geöffnet“); ein zweiter Aufruf währenddessen entfällt */
export async function openProjectByGrant(deps: ProjectFlowDeps, grantId: GrantId): Promise<boolean> {
    if (switching.has(deps.project)) return false;
    switching.add(deps.project);
    try {
        return await switchTo(deps, grantId);
    } catch (error) {
        deps.report({ text: PROJECT_FLOW_TEXTS.openFailed(error instanceof Error ? error.message : String(error)), kind: 'error' });
        return false;
    } finally {
        switching.delete(deps.project);
    }
}

/** „Projekt öffnen …“: Ordnerdialog, dann öffnen; Abbrechen im Dialog ändert nichts */
export async function chooseAndOpenProject(deps: ProjectFlowDeps): Promise<boolean> {
    const picked = await deps.api.dialog.openProject();
    if (!picked.ok) {
        deps.report({ text: PROJECT_FLOW_TEXTS.openFailed(picked.error.message), kind: 'error' });
        return false;
    }
    return picked.value === null ? false : openProjectByGrant(deps, picked.value.grantId);
}
