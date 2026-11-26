import { useEffect, useState } from 'react';
import { onCursorActivity } from '../editor/cursorEvents';
import type { SessionView } from '../editor/session';
import { onWritingResult, wordCountOf } from '../editor/writingHints';
import { editorStore } from '../stores/editor';
import { createDebounced } from './debounce';
import { selectionWordCount } from './statusText';

/** Wie die Cursorposition: höchstens alle 150 ms, gezeichnet wird nur bei echter Änderung */
export const WORD_COUNT_DEBOUNCE_MS = 150;

export interface WordCounts {
    /** Wörter der Datei aus dem Analyse-Worker; `null`, solange noch keine Zahl vorliegt */
    readonly fileWords: number | null;
    /** Wörter der Auswahl (0 = keine); höchstens 50.000 Zeichen, direkt gezählt wie in Swift */
    readonly selectionWords: number;
}

const NO_COUNTS: WordCounts = { fileWords: null, selectionWords: 0 };

function readCounts(sessionView: SessionView): WordCounts {
    if (sessionView.session === null) return NO_COUNTS;
    const { state } = sessionView.view;
    return { fileWords: wordCountOf(state), selectionWords: selectionWordCount(state) };
}

function sameCounts(a: WordCounts, b: WordCounts): boolean {
    return a.fileWords === b.fileWords && a.selectionWords === b.selectionWords;
}

/** Wörter der Datei und der Auswahl des sichtbaren Views für die Statusleiste */
export function useWordCounts(sessionView: SessionView | null): WordCounts {
    const [counts, setCounts] = useState<WordCounts>(NO_COUNTS);
    useEffect(() => {
        if (sessionView === null) return;
        const read = (): void => {
            const next = readCounts(sessionView);
            setCounts((previous) => (sameCounts(previous, next) ? previous : next));
        };
        const debounced = createDebounced(read, WORD_COUNT_DEBOUNCE_MS);
        const stops = [onCursorActivity(debounced.call), onWritingResult(debounced.call), editorStore.subscribe(debounced.call)];
        read();
        return () => {
            debounced.cancel();
            for (const stop of stops) stop();
        };
    }, [sessionView]);
    return counts;
}
