// Einfügen-Fenster (W4-10) mit den App-Singletons: Preload-API, Stores, Projektindex. Menü, Werkzeugleiste und
// Dialog holen ihre Abhängigkeiten von hier.
import { getApi } from '../ipc/api';
import { appUndoStore } from '../stores/appUndo';
import { editorStore } from '../stores/editor';
import { insertStore } from '../stores/insert';
import { overlayStore } from '../stores/overlays';
import { projectStore } from '../stores/project';
import { statusStore } from '../stores/status';
import { currentCompletionIndex } from './completionIndexRuntime';
import { openInsertDialog } from './insertActions';
import type { InsertDeps } from './insertDeps';
import type { InsertionKind } from './insertKinds';

const EDITOR_CONTENT_SELECTOR = '.editor-host .cm-content';
const DATE_PART_LENGTH = 2;
const MONTH_OFFSET = 1;

/** `JJJJ-MM-TT` nach Ortszeit */
export function todayText(now: Date = new Date()): string {
    const pad = (value: number): string => String(value).padStart(DATE_PART_LENGTH, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + MONTH_OFFSET)}-${pad(now.getDate())}`;
}

function focusEditorContent(): void {
    document.querySelector<HTMLElement>(EDITOR_CONTENT_SELECTOR)?.focus();
}

export function insertDeps(focusEditor: () => void = focusEditorContent): InsertDeps {
    return {
        api: getApi(),
        editor: editorStore,
        project: projectStore,
        insert: insertStore,
        overlays: overlayStore,
        appUndo: appUndoStore,
        completionIndex: currentCompletionIndex,
        report: (message) => statusStore.getState().show(message),
        today: () => todayText(),
        focusEditor,
    };
}

/** Öffnet das Fenster (Menü „Einfügen“, Werkzeugleiste) */
export function openInsertDialogFromApp(kind?: InsertionKind): void {
    openInsertDialog(insertDeps(), kind);
}
