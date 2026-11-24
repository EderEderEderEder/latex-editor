// Abhängigkeiten der Projekt-Oberfläche aus den App-Singletons (wie `fileActionDeps` in `ui/EditorPane.tsx`).
import { getApi } from '../ipc/api';
import { editorStore } from '../stores/editor';
import { projectStore } from '../stores/project';
import { sidebarStore } from '../stores/sidebar';
import { statusStore } from '../stores/status';
import { tabClosePrompt } from './tabClosePrompt';
import { tabMemoryRuntime } from './tabMemoryRuntime';
import type { ProjectFileDeps } from './projectFiles';
import type { ProjectFlowDeps } from './projectFlow';
import type { RevealDeps } from './revealLine';

const report: ProjectFileDeps['report'] = (message) => statusStore.getState().show(message);

export function projectFlowDeps(): ProjectFlowDeps {
    return {
        api: getApi(),
        project: projectStore,
        editor: editorStore,
        sidebar: sidebarStore,
        memory: tabMemoryRuntime,
        ask: (name) => tabClosePrompt.ask(name),
        report,
    };
}

export function projectFileDeps(): ProjectFileDeps {
    return { api: getApi(), store: editorStore, report };
}

export function revealDeps(focusEditor: () => void): RevealDeps {
    return { ...projectFileDeps(), focusEditor };
}
