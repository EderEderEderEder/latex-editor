import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
    buildStatusBarTexts, cursorPositionOf, fileNameOf, formatFormat, formatPosition, formatWordCount, samePosition,
    selectionWordCount, MAX_SELECTED_TEXT_LENGTH,
} from '../../src/renderer/app/statusText';

describe('Statusleiste: Zeile und Spalte', () => {
    it('zählt ab 1 und rechnet die Spalte in der Zeile', () => {
        const state = EditorState.create({ doc: 'abc\nde\nfgh', selection: { anchor: 5 } });
        expect(cursorPositionOf(state)).toEqual({ line: 2, column: 2 });
        expect(cursorPositionOf(EditorState.create({ doc: 'abc' }))).toEqual({ line: 1, column: 1 });
    });

    it('nimmt bei einer Auswahl das Ende, an dem der Cursor steht', () => {
        const state = EditorState.create({ doc: 'abc\nde', selection: { anchor: 0, head: 6 } });
        expect(cursorPositionOf(state)).toEqual({ line: 2, column: 3 });
    });

    it('formatiert auf Deutsch und vergleicht Positionen', () => {
        expect(formatPosition({ line: 12, column: 3 })).toBe('Zeile 12, Spalte 3');
        expect(samePosition({ line: 1, column: 1 }, { line: 1, column: 1 })).toBe(true);
        expect(samePosition({ line: 1, column: 1 }, { line: 1, column: 2 })).toBe(false);
        expect(samePosition(null, null)).toBe(true);
        expect(samePosition(null, { line: 1, column: 1 })).toBe(false);
    });
});

describe('Statusleiste: Datei und Format', () => {
    it('zeigt Kodierung und Zeilenende', () => {
        expect(formatFormat('utf8', 'lf')).toBe('UTF-8 · LF');
        expect(formatFormat('latin1', 'crlf')).toBe('Latin-1 · CRLF');
    });

    it('nimmt den Dateinamen aus POSIX- und Windows-Pfaden', () => {
        expect(fileNameOf('/p/kapitel/eins.tex')).toBe('eins.tex');
        expect(fileNameOf('C:\\Arbeit\\eins.tex')).toBe('eins.tex');
    });

    it('baut die drei Texte; ohne Datei bleiben Format und Position leer', () => {
        expect(
            buildStatusBarTexts({ name: 'a.tex', encoding: 'utf8', eol: 'crlf', position: { line: 2, column: 5 } }),
        ).toEqual({
            fileName: 'a.tex', format: 'UTF-8 · CRLF', position: 'Zeile 2, Spalte 5', words: '', selectionWords: '',
        });
        expect(buildStatusBarTexts({ name: null, encoding: 'utf8', eol: 'lf', position: null })).toEqual({
            fileName: 'Keine Datei geöffnet', format: '', position: '', words: '', selectionWords: '',
        });
    });
});

describe('Statusleiste: Wortzähler (W7-3)', () => {
    it('formatiert Einzahl, Mehrzahl und Tausenderpunkt wie die Swift-Version', () => {
        expect(formatWordCount(0)).toBe('0 Wörter');
        expect(formatWordCount(1)).toBe('1 Wort');
        expect(formatWordCount(1234)).toBe('1.234 Wörter');
    });

    it('zeigt Datei- und Auswahlwörter nur mit Datei und Zahl', () => {
        const base = { name: 'a.tex', encoding: 'utf8', eol: 'lf', position: null } as const;
        expect(buildStatusBarTexts({ ...base, fileWords: 12, selectionWords: 1 })).toMatchObject({
            words: '12 Wörter', selectionWords: '1 Wort ausgewählt',
        });
        expect(buildStatusBarTexts({ ...base, fileWords: null, selectionWords: 0 })).toMatchObject({ words: '', selectionWords: '' });
        expect(buildStatusBarTexts({ name: null, encoding: 'utf8', eol: 'lf', position: null, fileWords: 5 }).words).toBe('');
    });

    it('zählt die Auswahl (Fließtext ohne Befehle), nicht bei leerer oder zu langer Auswahl', () => {
        const doc = 'Eins \\textbf{zwei drei} vier';
        expect(selectionWordCount(EditorState.create({ doc, selection: { anchor: 0, head: doc.length } }))).toBe(4);
        expect(selectionWordCount(EditorState.create({ doc, selection: { anchor: 3 } }))).toBe(0);
        const long = 'wort '.repeat(MAX_SELECTED_TEXT_LENGTH);
        expect(selectionWordCount(EditorState.create({ doc: long, selection: { anchor: 0, head: long.length } }))).toBe(0);
    });
});
