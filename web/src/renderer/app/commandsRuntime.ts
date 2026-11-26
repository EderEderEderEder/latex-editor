// Die Befehle der App mit den App-Singletons (Stores, Preload-API); `activeView` liefert den sichtbaren Editor.
// Dazu die SyncTeX-Verdrahtung (W3-5): Die PDF-Ansicht meldet sich im `syncTeXViewerSlot` an.
import type { EditorView } from '@codemirror/view';
import type { Unsubscribe } from '../../shared/contract';
import type { PdfPoint } from '../../shared/core/synctexCoordinates';
import { onCursorActivity } from '../editor/cursorEvents';
import { setSpellMenuOpener } from '../editor/spell';
import { getApi } from '../ipc/api';
import { onMainEvent } from '../ipc/events';
import { editorStore } from '../stores/editor';
import { overlayStore } from '../stores/overlays';
import { pdfStore } from '../stores/pdf';
import { projectStore } from '../stores/project';
import { sidebarStore } from '../stores/sidebar';
import { useSettingsStore } from '../stores/settings';
import { statusStore } from '../stores/status';
import { syncTeXStore } from '../stores/synctex';
import { viewModeStore } from '../stores/viewMode';
import type { StatusMessage } from '../stores/status';
import { BUILD_TOOLBAR_TEXTS } from '../ui/BuildToolbar';
import { buildStore, compileOnSave } from './buildRuntime';
import { createCommandRegistry } from './commands';
import { startCompletionIndex } from './completionIndexRuntime';
import type { CommandDeps, CommandRegistry } from './commands';
import type { FileActionDeps } from './fileActions';
import { projectFileActionDeps } from './projectFileActionsRuntime';
import { projectFlowDeps, revealDeps } from './projectRuntime';
import { showSpellMenu } from './spellMenu';
import { connectSyncTeX, createViewerSlot, showPdfPointInEditor } from './synctexFlow';
import type { SyncTeXFlowDeps } from './synctexFlow';
import { tabClosePrompt } from './tabClosePrompt';

const EDITOR_CONTENT_SELECTOR = '.editor-host .cm-content';

/** Die eine PDF-Ansicht (`ui/PDFPane.tsx`) meldet sich hier an und ab */
export const syncTeXViewerSlot = createViewerSlot();

export function reportStatus(message: StatusMessage): void {
    statusStore.getState().show(message);
}

function appFileActions(): FileActionDeps {
    return {
        api: getApi(), store: editorStore, report: reportStatus, onSaved: (path) => compileOnSave.notifySaved(path),
    };
}

// Nach einem Moduswechsel („PDF“ → „Geteilt“) ist der Editor erst nach dem nächsten Zeichnen sichtbar und fokussierbar.
function focusEditorAfterLayout(): void {
    requestAnimationFrame(() => document.querySelector<HTMLElement>(EDITOR_CONTENT_SELECTOR)?.focus());
}

export function syncTeXFlowDeps(focusEditor: () => void = focusEditorAfterLayout): SyncTeXFlowDeps {
    return {
        api: getApi(),
        editor: editorStore,
        project: projectStore,
        pdf: pdfStore,
        viewMode: viewModeStore,
        synctex: syncTeXStore,
        viewer: () => syncTeXViewerSlot.get(),
        reveal: () => revealDeps(focusEditor),
        report: reportStatus,
    };
}

/** ⌘-Klick bzw. Strg-Klick ins PDF (Rückwärtssuche) */
export function showPdfPointInEditorFromApp(page: number, point: PdfPoint): void {
    void showPdfPointInEditor(syncTeXFlowDeps(), page, point);
}

/** `synctex:ready`, Projektwechsel und „PDF folgt Cursor“; die Rückgabe meldet wieder ab */
export function connectAppSyncTeX(): Unsubscribe {
    return connectSyncTeX({
        flow: () => syncTeXFlowDeps(),
        store: syncTeXStore,
        project: projectStore,
        followsCursor: () => useSettingsStore.getState().values.pdfFollowsCursor,
        onReady: (listener) => onMainEvent('synctex:ready', listener),
        onCursorActivity,
    });
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
        syncTeX: () => syncTeXFlowDeps(focusEditor),
        projectFileActions: projectFileActionDeps,
    };
}

export function createAppCommandRegistry(activeView: () => EditorView | null): CommandRegistry {
    // Projektindex der Vervollständigung (W4-6): einmal je App-Lauf, der Worker entsteht mit der ersten Anfrage
    startCompletionIndex();
    // Kontextmenü der Rechtschreibung (W7-2): React-Komponente, deshalb hier und nicht in `editor/spell.ts`
    setSpellMenuOpener(showSpellMenu);
    return createCommandRegistry(createAppCommandDeps(activeView));
}
