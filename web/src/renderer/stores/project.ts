// Projekt-Store (W2-3): das aktuelle Projekt (Name, Baum, Hauptdatei) und „Zuletzt geöffnet“. Hält nur Metadaten,
// nie Text. Der Baum wird nur ersetzt, wenn er sich wirklich geändert hat (Baum-Vergleich), damit Selektoren und die
// Zeilenliste nicht ohne Grund neu rechnen. Neu holen: `project:open` mit der Kennung des Projekts (der Vertrag kennt
// keinen leichteren Weg), entprellt nach `fs:changed` (`requestRefresh`).
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import type { AbsolutePath, DirectoryNode, GrantId, ProjectInfo, RecentProject, RendererApi } from '../../shared/contract';
import { sameTreeNode } from '../../shared/core/fileTree';
import { createDebounced } from '../app/debounce';

/** Ruhezeit nach dem letzten Hinweis „Baum geändert“, bevor der Baum neu geholt wird */
export const TREE_REFRESH_DELAY_MS = 400;

export interface ProjectView {
    readonly root: AbsolutePath;
    readonly name: string;
    readonly tree: DirectoryNode;
    readonly mainFile: AbsolutePath | null;
    readonly truncated: boolean;
}

export interface ProjectState {
    readonly current: ProjectView | null;
    /** Kennung, mit der das Projekt geöffnet wurde (zum Neuladen) */
    readonly grantId: GrantId | null;
    readonly recent: readonly RecentProject[];
    setProject(info: ProjectInfo, grantId: GrantId): void;
    clearProject(): void;
    /** Holt den Baum neu; `false` bei Fehler (der alte Baum bleibt) */
    refreshTree(): Promise<boolean>;
    requestRefresh(): void;
    loadRecent(): Promise<void>;
}

export type ProjectStore = StoreApi<ProjectState>;

export interface ProjectStoreDeps {
    readonly api: () => Pick<RendererApi, 'project'>;
    readonly delayMs?: number;
}

export function projectViewOf(info: ProjectInfo): ProjectView {
    return {
        root: info.root, name: info.tree.name, tree: info.tree, mainFile: info.mainFile, truncated: info.truncated === true,
    };
}

/** Behält das alte Objekt, wenn sich nichts geändert hat (Baum, Hauptdatei, Kürzung, Name) */
export function mergeProjectView(previous: ProjectView | null, next: ProjectView): ProjectView {
    if (previous === null || previous.root !== next.root) return next;
    const sameTree = sameTreeNode(previous.tree, next.tree);
    if (sameTree && previous.mainFile === next.mainFile && previous.truncated === next.truncated && previous.name === next.name) {
        return previous;
    }
    return { ...next, tree: sameTree ? previous.tree : next.tree };
}

function sameRecent(a: readonly RecentProject[], b: readonly RecentProject[]): boolean {
    return a.length === b.length &&
        a.every((entry, index) => entry.grantId === b[index]?.grantId && entry.name === b[index]?.name);
}

export function createProjectStore(deps: ProjectStoreDeps): ProjectStore {
    return createStore<ProjectState>()((set, get) => {
        let generation = 0;
        const refreshTree = async (): Promise<boolean> => {
            const { grantId, current } = get();
            if (grantId === null || current === null) return false;
            const ticket = generation;
            const result = await deps.api().project.open(grantId);
            // Ein Projektwechsel oder -schließen während des Ladens macht das Ergebnis ungültig
            if (!result.ok || ticket !== generation || get().grantId !== grantId) return false;
            const merged = mergeProjectView(get().current, projectViewOf(result.value));
            if (merged !== get().current) set({ current: merged });
            return true;
        };
        const debounced = createDebounced(() => void refreshTree(), deps.delayMs ?? TREE_REFRESH_DELAY_MS);
        return {
            current: null,
            grantId: null,
            recent: [],
            setProject: (info, grantId) => {
                generation++;
                debounced.cancel();
                set({ current: projectViewOf(info), grantId });
            },
            clearProject: () => {
                generation++;
                debounced.cancel();
                if (get().current !== null) set({ current: null, grantId: null });
            },
            refreshTree,
            requestRefresh: () => debounced.call(),
            loadRecent: async () => {
                const result = await deps.api().project.recent();
                if (result.ok && !sameRecent(get().recent, result.value)) set({ recent: result.value });
            },
        };
    });
}

function rendererApi(): RendererApi {
    return (globalThis as unknown as { api: RendererApi }).api;
}

export const projectStore = createProjectStore({ api: rendererApi });

export function useProjectStore<T>(selector: (state: ProjectState) => T): T {
    return useStore(projectStore, selector);
}
