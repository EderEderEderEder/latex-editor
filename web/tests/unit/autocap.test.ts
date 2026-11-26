import { history, redo, undo } from '@codemirror/commands';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
    AUTOCORRECT_EVENT, autoCapitalizeExtension, autoCorrectionAt, isProseRange, observeTyping, wordEndOf,
} from '../../src/renderer/editor/autocap';
import type { AutoCapitalizeDeps } from '../../src/renderer/editor/autocap';
import type { CommandTarget } from '../../src/renderer/editor/typing';

// Autokorrektur der Großschreibung (W7-3) ohne DOM: Zustand mit Verlauf, getippt wird über Transaktionen mit
// `userEvent`, die Korrektur läuft wie im Editor erst nach dem Update (hier: von Hand ausgelöst).

class TypingHarness implements CommandTarget {
    state: EditorState;
    enabled = true;
    composing = false;
    private pending: (() => void)[] = [];
    readonly deps: AutoCapitalizeDeps = {
        isEnabled: () => this.enabled,
        schedule: (task) => this.pending.push(task),
    };

    constructor(text: string) {
        this.state = EditorState.create({
            doc: text,
            selection: EditorSelection.cursor(text.length),
            extensions: [history(), autoCapitalizeExtension({ path: '/p/a.tex' }, this.deps)],
        });
    }

    dispatch(transaction: Transaction): void {
        this.state = transaction.state;
        observeTyping([transaction], this, this.deps);
    }

    /** Eingabe am Cursor wie über den `inputHandler`, danach läuft die geplante Korrektur */
    type(text: string, userEvent = 'input.type'): void {
        const { from, to } = this.state.selection.main;
        this.dispatch(this.state.update({
            changes: { from, to, insert: text }, selection: EditorSelection.cursor(from + text.length), userEvent,
        }));
        this.flush();
    }

    typeAll(text: string): void {
        for (const character of text) this.type(character);
    }

    flush(): void {
        const tasks = this.pending;
        this.pending = [];
        for (const task of tasks) task();
    }

    get text(): string {
        return this.state.doc.toString();
    }

    undo(): void {
        undo({ state: this.state, dispatch: (tr) => { this.state = tr.state; } });
    }

    redo(): void {
        redo({ state: this.state, dispatch: (tr) => { this.state = tr.state; } });
    }
}

describe('Autokorrektur: Auslöser', () => {
    it('nach dem Leerzeichen hinter dem Wort wird der Satzanfang groß', () => {
        const editor = new TypingHarness('Das ist ein Satz. ');
        editor.typeAll('aber ');
        expect(editor.text).toBe('Das ist ein Satz. Aber ');
    });

    it('ohne Terminator passiert nichts, Satzzeichen und Klammer lösen aus', () => {
        const editor = new TypingHarness('Ein Satz. ');
        editor.typeAll('danach');
        expect(editor.text).toBe('Ein Satz. danach');
        editor.type('.');
        expect(editor.text).toBe('Ein Satz. Danach.');
        const bracket = new TypingHarness('Ein Satz. ');
        bracket.typeAll('danach)');
        expect(bracket.text).toBe('Ein Satz. Danach)');
    });

    it('Enter löst aus (`input.newline` und der Standardbefehl `input`)', () => {
        for (const event of ['input.newline', 'input']) {
            const editor = new TypingHarness('Ein Satz. ');
            editor.typeAll('neu');
            editor.type('\n', event);
            expect(editor.text).toBe('Ein Satz. Neu\n');
        }
    });

    it('korrigiert „DIe“ am Wortanfang (zwei Großbuchstaben)', () => {
        const editor = new TypingHarness('');
        editor.typeAll('DIe ');
        expect(editor.text).toBe('Die ');
    });

    it('Einfügen, Ersetzen einer Auswahl, IME und Korrektur selbst lösen nicht aus', () => {
        const editor = new TypingHarness('Satz. aber');
        editor.type(' ', 'input.paste');
        editor.type(' ', 'input.type.compose');
        expect(editor.text).toBe('Satz. aber  ');
        editor.state = editor.state.update({ selection: EditorSelection.range(10, 12) }).state;
        editor.type(' ');
        expect(editor.text).toBe('Satz. aber ');
        expect(wordEndOf(editor.state.update({ changes: { from: 0, insert: ' ' }, userEvent: AUTOCORRECT_EVENT }))).toBeNull();
    });

    it('läuft bei laufender IME-Komposition nicht, auch wenn die Änderung als Tippen kam', () => {
        const editor = new TypingHarness('Satz. ');
        editor.typeAll('aber');
        editor.composing = true;
        editor.type(' ');
        expect(editor.text).toBe('Satz. aber ');
    });

    it('Schalter aus: keine Korrektur', () => {
        const editor = new TypingHarness('Satz. ');
        editor.enabled = false;
        editor.typeAll('aber ');
        expect(editor.text).toBe('Satz. aber ');
    });

    it('verwirft die Korrektur, wenn der Text sich bis dahin geändert hat', () => {
        const editor = new TypingHarness('Satz. aber');
        const { from } = editor.state.selection.main;
        editor.dispatch(editor.state.update({ changes: { from, insert: ' ' }, userEvent: 'input.type' }));
        editor.dispatch(editor.state.update({ changes: { from: 0, insert: 'X' }, userEvent: 'input.type' }));
        editor.flush();
        expect(editor.text).toBe('XSatz. aber ');
    });

    it('nur für LaTeX: eine .bib-Datei bekommt die Erweiterung nicht', () => {
        expect(autoCapitalizeExtension({ path: '/p/lit.bib' })).toEqual([]);
        expect(autoCapitalizeExtension({ path: 'grant-1', name: 'lit.bib' })).toEqual([]);
    });
});

describe('Autokorrektur: nur im Fließtext', () => {
    it('nicht in Kommentaren, Formeln und Code', () => {
        for (const prefix of ['% Ein Satz. ', '$Ein Satz. ', '\\begin{lstlisting}\nEin Satz. ', '\\begin{equation}\nx. ']) {
            const editor = new TypingHarness(prefix);
            editor.typeAll('aber ');
            expect(editor.text).toBe(`${prefix}aber `);
        }
    });

    it('nicht in Befehlen und Schlüsseln', () => {
        const editor = new TypingHarness('Ein Satz. \\label{');
        editor.typeAll('fig ');
        expect(editor.text).toBe('Ein Satz. \\label{fig ');
    });

    it('nach geschlossener Formel und in der nächsten Zeile wieder', () => {
        const editor = new TypingHarness('$x$ ist da.\n');
        editor.typeAll('danach ');
        expect(editor.text).toBe('$x$ ist da.\nDanach ');
    });

    it('isProseRange: Kommentar, Befehl und Fließtext', () => {
        const state = EditorState.create({ doc: 'Text \\emph{wort} % rest\nZeile' });
        const doc = state.doc;
        expect(isProseRange(doc, 0, 4)).toBe(true);
        expect(isProseRange(doc, 11, 15)).toBe(true);
        expect(isProseRange(doc, 19, 23)).toBe(false);
        expect(isProseRange(doc, 5, 9)).toBe(false);
    });

    it('autoCorrectionAt: braucht den beendenden Terminator direkt hinter dem Wort', () => {
        const doc = EditorState.create({ doc: 'Satz. aber dann' }).doc;
        expect(autoCorrectionAt(doc, 10)).toEqual({ start: 6, end: 10, replacement: 'Aber' });
        expect(autoCorrectionAt(doc, 9)).toBeNull();
        expect(autoCorrectionAt(doc, doc.length)).toBeNull();
    });
});

describe('Autokorrektur: Verlauf', () => {
    it('Rückgängig macht nur die Korrektur rückgängig, Wiederholen bringt sie zurück', () => {
        const editor = new TypingHarness('Satz. ');
        editor.typeAll('aber ');
        expect(editor.text).toBe('Satz. Aber ');
        editor.undo();
        expect(editor.text).toBe('Satz. aber ');
        editor.redo();
        expect(editor.text).toBe('Satz. Aber ');
    });

    it('der Cursor bleibt hinter dem Leerzeichen, auch nach Rückgängig', () => {
        const editor = new TypingHarness('Satz. ');
        editor.typeAll('aber ');
        expect(editor.state.selection.main.head).toBe(11);
        editor.undo();
        expect(editor.state.selection.main.head).toBe(11);
    });

    it('das nächste Tippen bildet einen neuen Schritt: zweimal Rückgängig stellt erst die Korrektur, dann das Tippen zurück', () => {
        const editor = new TypingHarness('Satz. ');
        editor.typeAll('aber ');
        editor.typeAll('und');
        editor.undo();
        expect(editor.text).toBe('Satz. Aber ');
        editor.undo();
        expect(editor.text).toBe('Satz. aber ');
        editor.undo();
        expect(editor.text).toBe('Satz. ');
    });
});
