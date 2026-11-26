// Texte der Statusleiste (Zeile/Spalte, Datei, Kodierung/Zeilenende), ohne DOM.
import type { EditorState } from '@codemirror/state';
import type { LineEnding, TextEncoding } from '../../shared/contract';
import { countWords } from '../../shared/core/latex/wordCounter';

export interface CursorPosition {
    /** 1-basiert */
    readonly line: number;
    /** 1-basiert, in UTF-16-Einheiten (Tab zählt 1) */
    readonly column: number;
}

const ENCODING_LABELS: Readonly<Record<TextEncoding, string>> = { utf8: 'UTF-8', latin1: 'Latin-1' };
const EOL_LABELS: Readonly<Record<LineEnding, string>> = { lf: 'LF', crlf: 'CRLF' };
const PATH_SEPARATOR = /[\\/]/;
const FORMAT_SEPARATOR = ' · ';
const NO_FILE_TEXT = 'Keine Datei geöffnet';

export function cursorPositionOf(state: EditorState): CursorPosition {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    return { line: line.number, column: head - line.from + 1 };
}

export function samePosition(a: CursorPosition | null, b: CursorPosition | null): boolean {
    if (a === null || b === null) return a === b;
    return a.line === b.line && a.column === b.column;
}

export function formatPosition(position: CursorPosition): string {
    return `Zeile ${position.line}, Spalte ${position.column}`;
}

export function formatFormat(encoding: TextEncoding, eol: LineEnding): string {
    return `${ENCODING_LABELS[encoding]}${FORMAT_SEPARATOR}${EOL_LABELS[eol]}`;
}

export function fileNameOf(path: string): string {
    return path.split(PATH_SEPARATOR).at(-1) ?? path;
}

/** Längere Auswahlen werden nicht gezählt (wie `maximumSelectedTextLength` in Swift) */
export const MAX_SELECTED_TEXT_LENGTH = 50_000;
const WORD_NUMBER_LOCALE = 'de-DE';
const SELECTED_SUFFIX = ' ausgewählt';

/** „1 Wort“, „2 Wörter“, „1.234 Wörter“ (wie `wordsText` in Swift) */
export function formatWordCount(count: number): string {
    return count === 1 ? '1 Wort' : `${count.toLocaleString(WORD_NUMBER_LOCALE)} Wörter`;
}

/** Wörter der Hauptauswahl; 0 ohne Auswahl und bei zu langer Auswahl */
export function selectionWordCount(state: EditorState): number {
    const { from, to } = state.selection.main;
    if (to === from || to - from > MAX_SELECTED_TEXT_LENGTH) return 0;
    return countWords(state.doc.sliceString(from, to));
}

export interface StatusBarInput {
    /** Anzeigename der aktiven Datei (nie der Sitzungsschlüssel); `null` ohne Datei */
    readonly name: string | null;
    readonly encoding: TextEncoding;
    readonly eol: LineEnding;
    readonly position: CursorPosition | null;
    /** Wörter der Datei laut Analyse-Worker; `null`, solange noch keine Zahl vorliegt */
    readonly fileWords?: number | null;
    /** Wörter der Auswahl; 0 = keine Auswahl */
    readonly selectionWords?: number;
}

export interface StatusBarTexts {
    readonly fileName: string;
    /** Leer ohne Datei */
    readonly format: string;
    /** Leer ohne Datei */
    readonly position: string;
    /** „N Wörter“ der Datei; leer ohne Datei oder ohne Zahl */
    readonly words: string;
    /** „N Wörter ausgewählt“; leer ohne Auswahl */
    readonly selectionWords: string;
}

export function buildStatusBarTexts(input: StatusBarInput): StatusBarTexts {
    if (input.name === null) return { fileName: NO_FILE_TEXT, format: '', position: '', words: '', selectionWords: '' };
    const { fileWords = null, selectionWords = 0 } = input;
    return {
        words: fileWords === null ? '' : formatWordCount(fileWords),
        selectionWords: selectionWords > 0 ? `${formatWordCount(selectionWords)}${SELECTED_SUFFIX}` : '',
        fileName: input.name,
        format: formatFormat(input.encoding, input.eol),
        position: input.position === null ? '' : formatPosition(input.position),
    };
}
