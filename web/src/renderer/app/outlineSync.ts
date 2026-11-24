// Hält die Gliederung mit dem sichtbaren Editor in Takt: Cursorzeile → aktueller Abschnitt, Textänderung → neu parsen
// (der Store entprellt). Wie `useCursorPosition`: Meldungen höchstens alle 150 ms, gesetzt wird nur bei Änderung.
import { useEffect } from 'react';
import { onCursorActivity } from '../editor/cursorEvents';
import type { SessionView } from '../editor/session';
import { editorStore } from '../stores/editor';
import type { OutlineStoreState } from '../stores/outline';
import { outlineStore } from './outlineRuntime';
import { createDebounced } from './debounce';
import { CURSOR_DEBOUNCE_MS } from './useCursorPosition';
import { cursorPositionOf } from './statusText';

export interface OutlineSyncMemory {
    readonly path: string | null;
    /** Dokument beim letzten Abgleich (Identität genügt: CodeMirror-Dokumente sind unveränderlich) */
    readonly doc: unknown;
}

export interface EditorSnapshot {
    readonly path: string;
    readonly line: number;
    readonly doc: unknown;
}

export const OUTLINE_SYNC_START: OutlineSyncMemory = { path: null, doc: null };

/** Ein Abgleichschritt; neu geparst wird nur, wenn in derselben Datei der Text ein anderer ist (kein Parsen beim Tabwechsel) */
export function syncOutline(
    outline: Pick<OutlineStoreState, 'updateCursor' | 'requestRefresh'>, memory: OutlineSyncMemory, view: EditorSnapshot | null,
): OutlineSyncMemory {
    if (view === null) return OUTLINE_SYNC_START;
    outline.updateCursor(view.path, view.line);
    if (memory.path === view.path && memory.doc !== view.doc) outline.requestRefresh();
    return { path: view.path, doc: view.doc };
}

function snapshotOf(sessionView: SessionView): EditorSnapshot | null {
    const session = sessionView.session;
    if (session === null) return null;
    const state = sessionView.view.state;
    return { path: session.path, line: cursorPositionOf(state).line, doc: state.doc };
}

export function useOutlineSync(sessionView: SessionView | null): void {
    useEffect(() => {
        if (sessionView === null) return;
        let memory = OUTLINE_SYNC_START;
        const run = (): void => {
            memory = syncOutline(outlineStore.getState(), memory, snapshotOf(sessionView));
        };
        const debounced = createDebounced(run, CURSOR_DEBOUNCE_MS);
        const stopCursor = onCursorActivity(debounced.call);
        const stopStore = editorStore.subscribe(debounced.call);
        run();
        return () => {
            debounced.cancel();
            stopCursor();
            stopStore();
        };
    }, [sessionView]);
}
