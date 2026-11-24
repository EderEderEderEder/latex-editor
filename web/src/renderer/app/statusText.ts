// Texte der Statusleiste (Zeile/Spalte, Datei, Kodierung/Zeilenende), ohne DOM.
import type { EditorState } from '@codemirror/state';
import type { LineEnding, TextEncoding } from '../../shared/contract';

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

export interface StatusBarInput {
    /** Anzeigename der aktiven Datei (nie der Sitzungsschlüssel); `null` ohne Datei */
    readonly name: string | null;
    readonly encoding: TextEncoding;
    readonly eol: LineEnding;
    readonly position: CursorPosition | null;
}

export interface StatusBarTexts {
    readonly fileName: string;
    /** Leer ohne Datei */
    readonly format: string;
    /** Leer ohne Datei */
    readonly position: string;
}

export function buildStatusBarTexts(input: StatusBarInput): StatusBarTexts {
    if (input.name === null) return { fileName: NO_FILE_TEXT, format: '', position: '' };
    return {
        fileName: input.name,
        format: formatFormat(input.encoding, input.eol),
        position: input.position === null ? '' : formatPosition(input.position),
    };
}
