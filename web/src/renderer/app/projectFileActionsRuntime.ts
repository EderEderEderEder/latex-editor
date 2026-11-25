// Datei-Aktionen mit den App-Singletons (Stores, Preload-API, Dialoge), wie `projectRuntime.ts`.
import type { Unsubscribe } from '../../shared/contract';
import type { NamePlatform } from '../../shared/core/fileNames';
import { getApi } from '../ipc/api';
import { appUndoStore } from '../stores/appUndo';
import type { AppUndoStore } from '../stores/appUndo';
import { editorStore } from '../stores/editor';
import { projectStore } from '../stores/project';
import type { ProjectStore } from '../stores/project';
import { sidebarStore } from '../stores/sidebar';
import { statusStore } from '../stores/status';
import { saveFile } from './fileActions';
import { openProjectFile } from './projectFiles';
import type { ProjectFileActionDeps } from './projectFileActionsCore';
import { fileActionPrompts } from './projectFileActionsPrompts';
import { projectFileDeps } from './projectRuntime';

const WINDOWS_MARKER = 'Windows';

/** Der Renderer kennt das Betriebssystem nur über die Kennung des Browsers; der Main prüft ohnehin noch einmal */
export function rendererNamePlatform(): NamePlatform {
    return { windows: typeof navigator !== 'undefined' && navigator.userAgent.includes(WINDOWS_MARKER) };
}

export function projectFileActionDeps(): ProjectFileActionDeps {
    const report: ProjectFileActionDeps['report'] = (message) => statusStore.getState().show(message);
    const api = getApi();
    return {
        api,
        editor: editorStore,
        project: projectStore,
        sidebar: sidebarStore,
        undo: appUndoStore,
        ask: fileActionPrompts,
        report,
        platform: rendererNamePlatform(),
        open: (path, asPreview) => openProjectFile(projectFileDeps(), path, asPreview),
        save: (path) => saveFile({ api, store: editorStore, report }, path),
    };
}

/** Rückgängig-Schritte gehören zu einem Projekt: Wechsel oder Schließen leert den Stapel */
export function connectAppUndoToProject(project: ProjectStore = projectStore, undo: AppUndoStore = appUndoStore): Unsubscribe {
    return project.subscribe((state, previous) => {
        if (state.current?.root !== previous.current?.root) undo.getState().clear();
    });
}
