import { useEffect, useState } from 'react';
import { onCursorActivity } from '../editor/cursorEvents';
import type { SessionView } from '../editor/session';
import { editorStore } from '../stores/editor';
import { createDebounced } from './debounce';
import { cursorPositionOf, samePosition } from './statusText';
import type { CursorPosition } from './statusText';

export const CURSOR_DEBOUNCE_MS = 150;

/** Zeile/Spalte des sichtbaren Views; gezeichnet wird nur bei echter Änderung und höchstens alle 150 ms */
export function useCursorPosition(sessionView: SessionView | null): CursorPosition | null {
    const [position, setPosition] = useState<CursorPosition | null>(null);
    useEffect(() => {
        if (sessionView === null) return;
        const read = (): void => {
            const next = sessionView.session === null ? null : cursorPositionOf(sessionView.view.state);
            setPosition((previous) => (samePosition(previous, next) ? previous : next));
        };
        const debounced = createDebounced(read, CURSOR_DEBOUNCE_MS);
        const stopCursor = onCursorActivity(debounced.call);
        const stopStore = editorStore.subscribe(debounced.call);
        read();
        return () => {
            debounced.cancel();
            stopCursor();
            stopStore();
        };
    }, [sessionView]);
    return position;
}
