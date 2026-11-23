import { describe, expect, it } from 'vitest';
import { redo, undo } from '@codemirror/commands';
import type { EditorState, TransactionSpec } from '@codemirror/state';
import type { LineEnding, TextFile } from '../../src/shared/contract';
import { syntaxHighlighting } from '../../src/renderer/editor/language';
import {
    EditorSession, SessionRegistry, clampSelection, highlightingOf, minimalReplacement,
} from '../../src/renderer/editor/session';

// Sitzungen ohne DOM: nur `EditorState`, Befehle über `dispatch` der Sitzung.

const LONG_LINE_COUNT = 2_000;
const SAVED = { hash: 'gespeichert', mtime: 1 } as const;

function file(path: string, text: string, eol: LineEnding = 'lf'): TextFile {
    return { path, text, encoding: 'utf8', eol, hash: 'h', mtime: 0 };
}

function run(session: EditorSession, command: typeof undo): boolean {
    return command({ state: session.state, dispatch: (tr) => session.dispatch(tr) });
}

function type(session: EditorSession, at: number, text: string, extra: TransactionSpec = {}): void {
    session.dispatch({ changes: { from: at, insert: text }, userEvent: 'input.type', ...extra });
}

function docOf(state: EditorState): string {
    return state.doc.toString();
}

describe('Sitzung: Undo je Datei', () => {
    it('jede Sitzung hat ihren eigenen Verlauf', () => {
        const a = new EditorSession(file('/p/a.tex', 'A'));
        const b = new EditorSession(file('/p/b.tex', 'B'));
        type(a, 1, '1');
        type(b, 1, '2');
        expect(run(b, undo)).toBe(true);
        expect(docOf(b.state)).toBe('B');
        expect(docOf(a.state)).toBe('A1');
        expect(run(b, undo)).toBe(false);
        expect(run(a, undo)).toBe(true);
        expect(docOf(a.state)).toBe('A');
    });
});

describe('Sitzung: Auswahl', () => {
    it('gemerkte Auswahl wird auf die Textlänge geklemmt (lang → kurz)', () => {
        const session = new EditorSession(file('/p/kurz.tex', 'kurz'), { selection: { anchor: 9_999, head: -5 } });
        expect(session.selection).toEqual({ anchor: 4, head: 0 });
        session.select({ anchor: 2, head: 50 });
        expect(session.selection).toEqual({ anchor: 2, head: 4 });
    });

    it('clampSelection bleibt im Dokument', () => {
        const range = clampSelection({ anchor: Number.NaN, head: 3.7 }, 2).main;
        expect([range.anchor, range.head]).toEqual([0, 2]);
    });
});

describe('Sitzung: minimaler Ersatz bei externer Änderung', () => {
    it('ersetzt nur den Bereich zwischen gemeinsamem Anfang und Ende', () => {
        expect(minimalReplacement('abcXdef', 'abcYYdef')).toEqual({ from: 3, to: 4, insert: 'YY' });
        expect(minimalReplacement('gleich', 'gleich')).toBeNull();
    });

    it('trennt kein Ersatzpaar (zwei Emojis mit gleicher erster Hälfte)', () => {
        const change = minimalReplacement('x😀', 'x😁');
        expect(change).toEqual({ from: 1, to: 3, insert: '😁' });
    });

    it('ist ein einziger Undo-Schritt, Auswahl davor bleibt', () => {
        const long = Array.from({ length: LONG_LINE_COUNT }, (_, index) => `Zeile ${index}`).join('\n');
        const session = new EditorSession(file('/p/lang.tex', long));
        session.select({ anchor: 3, head: 3 });
        const changed = long.replace('Zeile 1500', 'Zeile 1500 neu').replace('Zeile 1800', 'weg');
        session.replaceText(changed);
        expect(docOf(session.state)).toBe(changed);
        expect(session.selection).toEqual({ anchor: 3, head: 3 });
        expect(run(session, undo)).toBe(true);
        expect(docOf(session.state)).toBe(long);
        expect(run(session, undo)).toBe(false);
    });

    it('verschmilzt nicht mit vorherigem Tippen', () => {
        const session = new EditorSession(file('/p/a.tex', 'abc'));
        type(session, 3, 'd');
        session.replaceText('Xabcd');
        run(session, undo);
        expect(docOf(session.state)).toBe('abcd');
    });

    it('Neuladen von der Platte gilt als gespeichert', () => {
        const session = new EditorSession(file('/p/a.tex', 'alt'));
        session.reloadFromDisk({ ...file('/p/a.tex', 'neu'), hash: 'h2', mtime: 5 });
        expect(docOf(session.state)).toBe('neu');
        expect(session.isDirty).toBe(false);
        expect(session.file).toMatchObject({ hash: 'h2', mtime: 5 });
    });
});

describe('Sitzung: Zeilenenden', () => {
    it('lineSeparator folgt eol; Text zum Speichern hat LF', () => {
        const session = new EditorSession(file('/p/win.tex', 'a\nb', 'crlf'));
        expect(session.state.lineBreak).toBe('\r\n');
        expect(session.state.doc.lines).toBe(2);
        expect(session.state.sliceDoc()).toBe('a\r\nb');
        expect(session.snapshotForSave().text).toBe('a\nb');
        expect(new EditorSession(file('/p/unix.tex', 'a\nb')).state.lineBreak).toBe('\n');
    });

    it('eingefügtes LF in einer CRLF-Datei wird ein echter Zeilenumbruch', () => {
        const session = new EditorSession(file('/p/win.tex', 'x', 'crlf'));
        session.dispatch({ changes: { from: 1, insert: 'a\nb\rc' }, selection: { anchor: 6 } });
        expect(session.state.doc.lines).toBe(3);
        expect(session.state.sliceDoc()).toBe('xa\r\nb\r\nc');
        expect(session.selection.head).toBe(session.state.doc.length);
    });

    it('eingefügtes CRLF in einer LF-Datei hinterlässt kein CR', () => {
        const session = new EditorSession(file('/p/unix.tex', ''));
        session.dispatch({ changes: { from: 0, insert: 'a\r\nb\r\n' } });
        expect(session.state.sliceDoc()).toBe('a\nb\n');
    });
});

describe('Sitzung: Sprache', () => {
    it('Sprache nach Endung, Wechsel beim Umbenennen per Compartment', () => {
        const session = new EditorSession(file('/p/main.tex', '\\section{x}'));
        type(session, 0, '%');
        expect(highlightingOf(session.state)).toBe(syntaxHighlighting('latex'));
        session.relocate('/p/quellen.bib');
        expect(session.language).toBe('bibtex');
        expect(highlightingOf(session.state)).toBe(syntaxHighlighting('bibtex'));
        expect(run(session, undo)).toBe(true);
        expect(docOf(session.state)).toBe('\\section{x}');
    });
});

describe('Sitzung: isDirty aus dem Verlauf', () => {
    it('Rückgängig bis zum gespeicherten Stand ist nicht geändert, Wiederholen wieder geändert', () => {
        const changes: boolean[] = [];
        const session = new EditorSession(file('/p/a.tex', 'a'), { onDirtyChange: (_s, dirty) => changes.push(dirty) });
        expect(session.isDirty).toBe(false);
        type(session, 1, 'b');
        type(session, 2, 'c');
        expect(session.isDirty).toBe(true);
        run(session, undo);
        expect(session.isDirty).toBe(false);
        run(session, redo);
        expect(session.isDirty).toBe(true);
        expect(changes).toEqual([true, false, true]);
    });

    it('Speichern setzt den Vergleichspunkt; Tippen danach ist ein neuer Undo-Schritt', () => {
        const session = new EditorSession(file('/p/a.tex', ''));
        type(session, 0, 'a');
        session.markSaved(session.snapshotForSave(), SAVED);
        expect(session.isDirty).toBe(false);
        expect(session.file).toMatchObject(SAVED);
        type(session, 1, 'b');
        expect(session.isDirty).toBe(true);
        run(session, undo);
        expect(docOf(session.state)).toBe('a');
        expect(session.isDirty).toBe(false);
        run(session, undo);
        expect(session.isDirty).toBe(true);
    });

    it('Änderung während des Speicherns bleibt geändert', () => {
        const session = new EditorSession(file('/p/a.tex', ''));
        type(session, 0, 'a');
        const snapshot = session.snapshotForSave();
        type(session, 1, 'b', { annotations: [] });
        session.markSaved(snapshot, SAVED);
        expect(session.isDirty).toBe(true);
    });

    it('neue Änderung nach Rückgängig verwirft den gespeicherten Stand nicht fälschlich', () => {
        const session = new EditorSession(file('/p/a.tex', 'x'));
        type(session, 1, 'a');
        session.markSaved(session.snapshotForSave(), SAVED);
        run(session, undo);
        type(session, 1, 'a');
        // gleicher Text wie gespeichert, aber auf anderem Weg: der Zähler meldet geändert (wie Swift)
        expect(session.isDirty).toBe(true);
        expect(run(session, redo)).toBe(false);
    });
});

describe('Sitzungsverwaltung', () => {
    it('Schließen gibt die Sitzung frei', () => {
        const registry = new SessionRegistry();
        const session = registry.create(file('/p/a.tex', 'Inhalt'));
        expect(registry.get('/p/a.tex')).toBe(session);
        registry.close('/p/a.tex');
        expect(registry.get('/p/a.tex')).toBeUndefined();
        expect(registry.size).toBe(0);
        expect(session.isDisposed).toBe(true);
        expect(session.state.doc.length).toBe(0);
    });

    it('Umbenennen behält Sitzung samt Verlauf unter neuem Pfad', () => {
        const registry = new SessionRegistry();
        const session = registry.create(file('/p/a.tex', 'a'));
        registry.relocate('/p/a.tex', '/p/b.tex');
        expect(registry.get('/p/b.tex')).toBe(session);
        expect(registry.get('/p/a.tex')).toBeUndefined();
        expect(session.path).toBe('/p/b.tex');
    });
});
