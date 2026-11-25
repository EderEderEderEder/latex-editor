// Datei-Aktionen (W2-9): Tabs schließen, wenn ihre Datei in den Papierkorb geht, und beim Rückgängig wieder öffnen.
// Ungespeicherter Text eines geschlossenen Tabs lebt nur im Rückgängig-Schritt (nie im Store) und kommt beim
// Wiederherstellen als Änderung zurück, damit nichts verloren geht.
import type { AbsolutePath } from '../../shared/contract';
import { tabsUnder } from '../../shared/core/tabs';
import type { SelectionSnapshot } from '../editor/session';
import type { EditorStore } from '../stores/editor';

export interface ClosedTab {
    readonly path: AbsolutePath;
    readonly wasPreview: boolean;
    readonly wasActive: boolean;
    readonly selection: SelectionSnapshot;
    /** Text mit LF, nur wenn der Tab ungespeicherte Änderungen hatte */
    readonly unsavedText: string | null;
}

export type OpenFile = (path: AbsolutePath, asPreview: boolean) => Promise<boolean>;

/** Tabs der Datei bzw. des Ordners mit ungespeichertem Stand (ohne zu schließen) */
export function snapshotTabsUnder(editor: EditorStore, path: AbsolutePath): ClosedTab[] {
    const state = editor.getState();
    return tabsUnder(state.tabs, path).flatMap((tabPath) => {
        const session = state.session(tabPath);
        if (session === undefined) return [];
        return [{
            path: tabPath,
            wasPreview: state.tabs.preview === tabPath,
            wasActive: state.tabs.active === tabPath,
            selection: session.selection,
            unsavedText: session.isDirty ? session.snapshotForSave().text : null,
        }];
    });
}

export function closeTabs(editor: EditorStore, tabs: readonly ClosedTab[]): void {
    for (const tab of tabs) editor.getState().close(tab.path);
}

/** Öffnet die Tabs wieder (aktiver zuletzt) und setzt ungespeicherten Text und Auswahl zurück */
export async function reopenTabs(editor: EditorStore, open: OpenFile, tabs: readonly ClosedTab[]): Promise<void> {
    const ordered = [...tabs.filter((tab) => !tab.wasActive), ...tabs.filter((tab) => tab.wasActive)];
    for (const tab of ordered) {
        if (!(await open(tab.path, tab.wasPreview))) continue;
        const session = editor.getState().session(tab.path);
        if (session === undefined) continue;
        if (tab.unsavedText !== null) session.replaceText(tab.unsavedText);
        session.select(tab.selection);
    }
}
