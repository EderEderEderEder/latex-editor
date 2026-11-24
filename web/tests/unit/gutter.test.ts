import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { gutterExtension, gutterMarksOf, gutterTooltipOf, setGutterMarks } from '../../src/renderer/editor/gutter';
import type { GutterMark } from '../../src/renderer/editor/gutter';

const THREE_LINES = 'eins\nzwei\ndrei';

function stateWith(text: string, marks: readonly GutterMark[] = []): EditorState {
    const state = EditorState.create({ doc: text, extensions: gutterExtension({ path: '/x.tex' }) });
    return state.update({ effects: setGutterMarks(marks) }).state;
}

describe('gutter marks', () => {
    it('setzt Marken und liefert sie sortiert zurück', () => {
        const state = stateWith(THREE_LINES, [
            { line: 3, kind: 'box' },
            { line: 2, kind: 'warning', message: 'w' },
        ]);
        expect(gutterMarksOf(state).map((mark) => mark.line)).toEqual([2, 3]);
    });

    it('verwirft ungültige Zeilen', () => {
        const state = stateWith(THREE_LINES, [{ line: 0, kind: 'error' }, { line: 4, kind: 'error' }]);
        expect(gutterMarksOf(state)).toEqual([]);
    });

    it('Einfügen einer Zeile davor verschiebt die Marke', () => {
        const state = stateWith(THREE_LINES, [{ line: 2, kind: 'error', message: 'x' }]);
        const next = state.update({ changes: { from: 0, insert: 'neu\n' } }).state;
        expect(gutterMarksOf(next)).toEqual([{ line: 3, kind: 'error', message: 'x' }]);
    });

    it('Tippen in der Zeile lässt die Marke stehen', () => {
        const state = stateWith(THREE_LINES, [{ line: 2, kind: 'error' }]);
        const next = state.update({ changes: { from: 5, insert: 'abc' } }).state;
        expect(gutterMarksOf(next).map((mark) => mark.line)).toEqual([2]);
    });

    it('Löschen der Zeile entfernt die Marke, Nachbarn bleiben', () => {
        const state = stateWith(THREE_LINES, [
            { line: 1, kind: 'error' },
            { line: 2, kind: 'warning' },
            { line: 3, kind: 'box' },
        ]);
        const next = state.update({ changes: { from: 5, to: 10 } }).state;
        expect(gutterMarksOf(next).map((mark) => [mark.line, mark.kind])).toEqual([[1, 'error'], [2, 'box']]);
    });

    it('Löschen des Texts allein lässt die Marke auf der leeren Zeile', () => {
        const state = stateWith(THREE_LINES, [{ line: 2, kind: 'error' }]);
        const next = state.update({ changes: { from: 5, to: 9 } }).state;
        expect(gutterMarksOf(next).map((mark) => mark.line)).toEqual([2]);
    });

    it('Löschen der letzten Zeile samt vorherigem Umbruch entfernt die Marke', () => {
        const state = stateWith(THREE_LINES, [{ line: 3, kind: 'error' }]);
        const next = state.update({ changes: { from: 9, to: 14 } }).state;
        expect(gutterMarksOf(next)).toEqual([]);
    });

    it('Enter am Zeilenanfang nimmt die Marke mit der Zeile mit', () => {
        const state = stateWith(THREE_LINES, [{ line: 2, kind: 'error' }]);
        const next = state.update({ changes: { from: 5, insert: '\n' } }).state;
        expect(gutterMarksOf(next).map((mark) => mark.line)).toEqual([3]);
    });
});

describe('gutter tooltip und Reihenfolge', () => {
    const marks: GutterMark[] = [
        { line: 2, kind: 'box', message: 'Box' },
        { line: 2, kind: 'gitModified' },
        { line: 2, kind: 'error', message: 'Fehler' },
        { line: 2, kind: 'warning', message: 'Warnung' },
    ];

    it('Tooltip: Fehler vor Warnung vor Box vor Git', () => {
        const state = stateWith(THREE_LINES, marks);
        expect(gutterTooltipOf(state, 2).split('\n')).toEqual([
            'Fehler',
            'Warnung',
            'Box',
            'Geändert seit dem letzten Commit',
        ]);
        expect(gutterMarksOf(state).map((mark) => mark.kind)).toEqual(['error', 'warning', 'box', 'gitModified']);
    });

    it('Zeile ohne Marken: leerer Tooltip', () => {
        expect(gutterTooltipOf(stateWith(THREE_LINES, marks), 1)).toBe('');
        expect(gutterTooltipOf(stateWith(THREE_LINES, marks), 99)).toBe('');
    });

    it('neues Setzen ersetzt alle Marken', () => {
        const state = stateWith(THREE_LINES, marks);
        const next = state.update({ effects: setGutterMarks([{ line: 1, kind: 'gitAdded' }]) }).state;
        expect(gutterMarksOf(next)).toEqual([{ line: 1, kind: 'gitAdded' }]);
    });
});
