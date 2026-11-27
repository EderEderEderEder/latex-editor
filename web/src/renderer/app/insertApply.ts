// Einfügen-Fenster (W4-10): der Text kommt als EIN Undo-Schritt in die Sitzung (Vorlage `EditorTextView.perform` und
// `insertIntoOpenBibliography` der Swift-Version). Blöcke werden über `adjustBlock` sauber in eigene Zeilen gesetzt,
// der Cursor steht danach hinter dem eingefügten Text.
import { isolateHistory } from '@codemirror/commands';
import { Text } from '@codemirror/state';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { appendix } from '../../shared/core/bib/sourceBuilder';
import { adjustBlock } from '../../shared/core/insertion';
import type { EditorSession } from '../editor/session';

export const INSERT_USER_EVENT = 'input.insert';
const LINE_FEED = '\n';

export interface InsertPlacement {
    readonly isBlock: boolean;
    /** Markierten Text ersetzen (Code, Gleichung, Liste) statt dahinter einzufügen */
    readonly replacesSelection: boolean;
}

function textOf(value: string): Text {
    return Text.of(value.split(LINE_FEED));
}

/** Der Block mit Zeilenumbrüchen davor/danach, soweit nötig; nur das Umfeld der Stelle wird gelesen, nicht das Dokument */
function placedText(state: EditorState, text: string, from: number, to: number, isBlock: boolean): string {
    if (!isBlock) return text;
    const windowStart = Math.max(0, from - 1);
    const windowEnd = Math.min(state.doc.length, to + 1);
    const around = state.doc.sliceString(windowStart, windowEnd);
    return adjustBlock(text, around, { location: from - windowStart, length: to - from });
}

/** Die Transaktion für „Einfügen“ an der Hauptauswahl: ein Verlaufsschritt, Cursor dahinter, Stelle sichtbar */
export function insertionTransaction(state: EditorState, text: string, placement: InsertPlacement): TransactionSpec {
    const { from, to } = state.selection.main;
    const start = placement.replacesSelection ? from : to;
    const placed = placedText(state, text, start, to, placement.isBlock);
    return {
        changes: { from: start, to, insert: textOf(placed) },
        selection: { anchor: start + placed.length },
        effects: EditorView.scrollIntoView(start + placed.length, { y: 'nearest' }),
        annotations: isolateHistory.of('full'),
        userEvent: INSERT_USER_EVENT,
    };
}

export function insertIntoSession(session: EditorSession, text: string, placement: InsertPlacement): void {
    session.dispatch(insertionTransaction(session.state, text, placement));
}

/** Hängt einen Eintrag ans Ende einer offenen Literaturdatei (ein Verlaufsschritt, Auswahl bleibt, gespeichert wird von Hand) */
export function appendToOpenBibliography(session: EditorSession, entry: string): void {
    const { doc } = session.state;
    const addition = appendix(entry, doc.toString());
    session.dispatch({
        changes: { from: doc.length, insert: textOf(addition) },
        annotations: isolateHistory.of('full'),
        userEvent: INSERT_USER_EVENT,
    });
}
