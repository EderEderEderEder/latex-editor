import { history, undoDepth } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import type { TextFile } from '../../src/shared/contract';
import { insertionTransaction } from '../../src/renderer/app/insertApply';
import type { InsertPlacement } from '../../src/renderer/app/insertApply';
import { firstNewRowIndex, previewRows, segmentsOf } from '../../src/renderer/app/insertPreview';
import { EditorSession } from '../../src/renderer/editor/session';

const BLOCK: InsertPlacement = { isBlock: true, replacesSelection: false };
const INLINE: InsertPlacement = { isBlock: false, replacesSelection: false };
const REPLACING_BLOCK: InsertPlacement = { isBlock: true, replacesSelection: true };

function stateWith(text: string, anchor: number, head = anchor): EditorState {
    return EditorState.create({ doc: text, selection: EditorSelection.single(anchor, head), extensions: [history()] });
}

function apply(text: string, anchor: number, head: number, insert: string, placement: InsertPlacement): EditorState {
    const state = stateWith(text, anchor, head);
    return state.update(insertionTransaction(state, insert, placement)).state;
}

describe('Einfügen an Cursor und Auswahl', () => {
    it('Block am Zeilenanfang bleibt, mitten in der Zeile beginnt er in einer neuen', () => {
        expect(apply('a\nb', 2, 2, 'X\n', BLOCK).doc.toString()).toBe('a\nX\nb');
        expect(apply('a b', 2, 2, 'X\n', BLOCK).doc.toString()).toBe('a \nX\nb');
    });

    it('folgt direkt ein Zeilenumbruch, entfällt der letzte des Blocks; am Dateiende bleibt er', () => {
        expect(apply('a\nb', 1, 1, 'X\n', BLOCK).doc.toString()).toBe('a\nX\nb');
        expect(apply('a', 1, 1, 'X\n', BLOCK).doc.toString()).toBe('a\nX\n');
    });

    it('Cursor steht hinter dem eingefügten Text, nichts bleibt markiert', () => {
        const state = apply('ab', 1, 1, '\\ref{x}', INLINE);
        expect(state.doc.toString()).toBe('a\\ref{x}b');
        expect(state.selection.main).toMatchObject({ anchor: 8, head: 8 });
    });

    it('ohne Ersetzen kommt der Text hinter die Auswahl, mit Ersetzen an ihre Stelle', () => {
        expect(apply('vor MARK nach', 4, 8, '[X]', INLINE).doc.toString()).toBe('vor MARK[X] nach');
        expect(apply('vor MARK nach', 4, 8, 'X\n', REPLACING_BLOCK).doc.toString()).toBe('vor \nX\n nach');
    });

    it('ist genau ein Undo-Schritt', () => {
        const state = apply('a b', 2, 2, 'X\n', BLOCK);
        expect(undoDepth(state)).toBe(1);
    });
});

describe('Einfügen in eine Sitzung mit Windows-Zeilenenden', () => {
    it('der Block wird zu echten Zeilen (CRLF in der Datei, LF im Dokument)', () => {
        const file: TextFile = { path: '/p/a.tex', name: 'a.tex', text: 'eins\nzwei', encoding: 'utf8', eol: 'crlf', hash: 'h', mtime: 0 };
        const session = new EditorSession(file);
        session.select({ anchor: 4, head: 4 });
        session.dispatch(insertionTransaction(session.state, '\\begin{x}\n\\end{x}\n', BLOCK));
        expect(session.state.doc.lines).toBe(4);
        expect(session.state.doc.line(2).text).toBe('\\begin{x}');
        expect(session.state.doc.toString()).toBe('eins\n\\begin{x}\n\\end{x}\nzwei');
        expect(session.isDirty).toBe(true);
    });
});

describe('Vorschau-Zeilen', () => {
    it('färbt mit den Token-Arten des Editors und lässt nichts aus', () => {
        const rows = previewRows([{ number: 3, text: '\\label{a} % x', isNew: true }], 'latex');
        expect(rows[0]?.segments.map((segment) => segment.text).join('')).toBe('\\label{a} % x');
        expect(rows[0]?.segments.some((segment) => segment.kind === 'comment')).toBe(true);
        expect(rows[0]).toMatchObject({ number: 3, isNew: true });
    });

    it('BibTeX hat eigene Zustände über Zeilen hinweg', () => {
        const rows = previewRows([
            { number: 1, text: '@book{k,', isNew: false },
            { number: 2, text: '\ttitle={Ein Titel}', isNew: false },
            { number: 3, text: '}', isNew: false },
        ], 'bibtex');
        expect(rows.every((row) => row.segments.map((segment) => segment.text).join('') === row.text)).toBe(true);
        expect(rows[0]?.segments.some((segment) => segment.kind !== null)).toBe(true);
    });

    it('überlappende oder zu lange Spannen werden gekürzt, die erste neue Zeile ist der Scrollanker', () => {
        expect(segmentsOf('abcdef', [{ kind: 'a', location: 0, length: 4 }, { kind: 'b', location: 2, length: 10 }]))
            .toEqual([{ text: 'abcd', kind: 'a' }, { text: 'ef', kind: 'b' }]);
        const rows = previewRows([{ number: 1, text: 'x', isNew: false }, { number: 2, text: 'y', isNew: true }], 'latex');
        expect(firstNewRowIndex(rows)).toBe(1);
        expect(firstNewRowIndex(previewRows([{ number: 1, text: 'x', isNew: false }], 'latex'))).toBeNull();
    });
});
