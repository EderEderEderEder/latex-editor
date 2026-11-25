// Die Befehle der App mit den App-Singletons (Stores, Preload-API); `activeView` liefert den sichtbaren Editor.
import type { EditorView } from '@codemirror/view';
import { getApi } from '../ipc/api';
import { editorStore } from '../stores/editor';
import { overlayStore } from '../stores/overlays';
import { sidebarStore } from '../stores/sidebar';
import { useSettingsStore } from '../stores/settings';
import { statusStore } from '../stores/status';
import { viewModeStore } from '../stores/viewMode';
import type { StatusMessage } from '../stores/status';
import { BUILD_TOOLBAR_TEXTS } from '../ui/BuildToolbar';
import { buildStore, compileOnSave } from './buildRuntime';
import { createCommandRegistry } from './commands';
import type { CommandDeps, CommandRegistry } from './commands';
import type { FileActionDeps } from './fileActions';
import { projectFlowDeps, revealDeps } from './projectRuntime';
import { tabClosePrompt } from './tabClosePrompt';

export function reportStatus(message: StatusMessage): void {
    statusStore.getState().show(message);
}

function appFileActions(): FileActionDeps {
    return {
        api: getApi(), store: editorStore, report: reportStatus, onSaved: (path) => compileOnSave.notifySaved(path),
    };
}

export function createAppCommandDeps(activeView: () => EditorView | null): CommandDeps {
    const focusEditor = (): void => activeView()?.focus();
    return {
        fileActions: appFileActions,
        tabClose: () => ({ ...appFileActions(), ask: (name) => tabClosePrompt.ask(name) }),
        projectFlow: projectFlowDeps,
        editor: editorStore,
        build: buildStore,
        overlays: overlayStore,
        sidebar: sidebarStore,
        viewMode: viewModeStore,
        settings: useSettingsStore,
        activeView,
        focusEditor,
        reveal: () => revealDeps(focusEditor),
        report: reportStatus,
        confirmClean: () => window.confirm(BUILD_TOOLBAR_TEXTS.cleanQuestion),
    };
}

export function createAppCommandRegistry(activeView: () => EditorView | null): CommandRegistry {
    return createCommandRegistry(createAppCommandDeps(activeView));
}
