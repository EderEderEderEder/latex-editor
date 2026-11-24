import { describe, expect, it } from 'vitest';
import { history, redo, undo } from '@codemirror/commands';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
    DEFAULT_TEXT_EDITING_SETTINGS, applyEdit, deleteBackward, deleteLines, duplicateLines, indent, insertTab,
    moveLines, newline, outdent, toggleComment, typed, wrap,
    type Selection, type TextEdit, type TextEditingSettings,
} from '../../src/shared/core/textEditing';
import {
    TYPING_EVENTS, TYPING_KEYS, applyTextEdit, isImeActive, typedCharacterEdit, typingCommands, typingExtension,
    typingKeymap, typingSettings, undoStepOnEditKindChange, type CommandTarget, type TypingCommand,
} from '../../src/renderer/editor/typing';

// Tippen ohne DOM: `EditorState` mit `history`, Befehle und Eingabe über ein Testziel `{ state, dispatch }`.

const TWO_SPACES: TextEditingSettings = { ...DEFAULT_TEXT_EDITING_SETTINGS, indentUnit: '  ' };
const AUTO_PAIR_OFF: TextEditingSettings = { ...DEFAULT_TEXT_EDITING_SETTINGS, autoPairBrackets: false };
const RANDOM_CASE_COUNT = 400;
const LCG_MULTIPLIER = 1_103_515_245;
const LCG_INCREMENT = 12_345;
const LCG_MODULUS = 2 ** 31;

// MARK: Markierungsnotation: `|` Cursor, `«…»` Auswahl

function parseMarked(marked: string): { text: string; selection: Selection } {
    const start = marked.indexOf('«');
    if (start !== -1) {
        const end = marked.indexOf('»');
        return { text: marked.replace('«', '').replace('»', ''), selection: { from: start, to: end - 1 } };
    }
    const cursor = marked.indexOf('|');
    return { text: marked.replace('|', ''), selection: { from: cursor, to: cursor } };
}

function renderMarked(state: EditorState): string {
    const text = state.doc.toString();
    const { from, to } = state.selection.main;
    if (from === to) return `${text.slice(0, from)}|${text.slice(from)}`;
    return `${text.slice(0, from)}«${text.slice(from, to)}»${text.slice(to)}`;
}

interface Ime {
    composing?: boolean;
    compositionStarted?: boolean;
}

/** Ein Editor ohne DOM: Zustand, Befehle, Eingabe wie über `inputHandler` und Rückgängig */
class TestEditor {
    state: EditorState;
    readonly target: CommandTarget;

    constructor(marked: string, extensions: Extension[] = [], ime: Ime = {}) {
        const { text, selection } = parseMarked(marked);
        this.state = EditorState.create({
            doc: text,
            selection: EditorSelection.single(selection.from, selection.to),
            extensions: [history(), ...extensions],
        });
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const editor = this;
        this.target = {
            get state() { return editor.state; },
            dispatch: (transaction) => { editor.state = transaction.state; },
            ...ime,
        };
    }

    get marked(): string { return renderMarked(this.state); }
    get text(): string { return this.state.doc.toString(); }

    run(command: TypingCommand): boolean { return command(this.target); }

    undo(): void { undo(this.target); }

    redo(): void { redo(this.target); }

    select(anchor: number, head: number): void {
        this.state = this.state.update({ selection: EditorSelection.single(anchor, head) }).state;
    }

    /** Wie `handleTypedInput`: erst die Tipp-Logik, sonst normales Einfügen von CodeMirror */
    type(characters: string): void {
        for (const character of characters) {
            const { from, to } = this.state.selection.main;
            const edit = typedCharacterEdit(this.state, from, to, character);
            if (edit !== null) {
                applyTextEdit(this.target, edit, TYPING_EVENTS.type);
                continue;
            }
            this.state = this.state.update({
                changes: { from, to, insert: character },
                selection: { anchor: from + character.length },
                userEvent: TYPING_EVENTS.type,
            }).state;
        }
    }
}

function edited(marked: string, command: TypingCommand, extensions: Extension[] = []): string | null {
    const editor = new TestEditor(marked, extensions);
    return editor.run(command) ? editor.marked : null;
}

const withSettings = (settings: TextEditingSettings): Extension[] => [typingSettings.of(settings)];

// MARK: applyTextEdit

describe('applyTextEdit: eine Transaktion, ein Undo-Schritt', () => {
    it('wendet Ersetzungen und Auswahl an und setzt die userEvent-Annotation', () => {
        const editor = new TestEditor('a|b');
        const edit: TextEdit = { changes: [{ from: 1, to: 1, insert: 'XY' }], selection: { from: 2, to: 3 } };
        const transactions: Transaction[] = [];
        applyTextEdit({
            state: editor.state,
            dispatch: (transaction) => transactions.push(transaction),
        }, edit, TYPING_EVENTS.format);
        expect(transactions).toHaveLength(1);
        expect(transactions[0]?.annotation(Transaction.userEvent)).toBe(TYPING_EVENTS.format);
        expect(transactions[0]?.newDoc.toString()).toBe('aXYb');
        expect(transactions[0]?.newSelection.main).toMatchObject({ from: 2, to: 3 });
    });

    it('mehrere Ersetzungen (Ausgangsoffsets) in einem Undo-Schritt', () => {
        const editor = new TestEditor('abcdef|');
        const edit: TextEdit = {
            changes: [{ from: 0, to: 1, insert: 'A' }, { from: 4, to: 5, insert: 'EE' }],
            selection: { from: 0, to: 0 },
        };
        applyTextEdit(editor.target, edit, TYPING_EVENTS.format);
        expect(editor.text).toBe('AbcdEEf');
        editor.undo();
        expect(editor.text).toBe('abcdef');
        expect(undo(editor.target)).toBe(false);
    });

    it('wirkungslose Ersetzungen entfallen (Ausrücken ohne Einrückung ändert nichts)', () => {
        const editor = new TestEditor('x|');
        expect(editor.run(typingCommands.outdent)).toBe(true);
        expect(editor.marked).toBe('x|');
        expect(undo(editor.target)).toBe(false);
    });

    it('klemmt die Auswahl auf die neue Textlänge', () => {
        const editor = new TestEditor('abc|');
        applyTextEdit(editor.target, { changes: [{ from: 0, to: 3, insert: '' }], selection: { from: 9, to: 9 } }, 'input');
        expect(editor.marked).toBe('|');
    });

    it('Rückgängig und Wiederholen stellen genau einen Schritt wieder her', () => {
        const editor = new TestEditor('«eins\nzwei»');
        editor.run(typingCommands.toggleComment);
        expect(editor.text).toBe('% eins\n% zwei');
        editor.undo();
        expect(editor.text).toBe('eins\nzwei');
        editor.redo();
        expect(editor.text).toBe('% eins\n% zwei');
    });
});

// MARK: Eingetippte Zeichen

describe('typedCharacterEdit (inputHandler)', () => {
    it('Klammern schließen, überspringen und paarweise löschen', () => {
        const editor = new TestEditor('|');
        editor.type('\\emph{');
        expect(editor.marked).toBe('\\emph{|}');
        editor.type('x}');
        expect(editor.marked).toBe('\\emph{x}|');
        editor.type(' \\ref{');
        expect(editor.text).toBe('\\emph{x} \\ref{}');
        expect(editor.run(typingCommands.deleteBackward)).toBe(true);
        expect(editor.marked).toBe('\\emph{x} \\ref|');
    });

    it('Auswahl wird umschlossen und bleibt ausgewählt', () => {
        const editor = new TestEditor('a «bc» d');
        editor.type('{');
        expect(editor.marked).toBe('a {«bc»} d');
        expect(editor.state.selection.ranges).toHaveLength(1);
    });

    it('das Paar ist ein Undo-Schritt', () => {
        const editor = new TestEditor('x|');
        editor.type('(');
        expect(editor.text).toBe('x()');
        editor.undo();
        expect(editor.text).toBe('x');
    });

    it('ein Unicode-Zeichen vor dem Cursor (UTF-16 doppelt) verschiebt das Paar richtig', () => {
        const editor = new TestEditor('😀|');
        editor.type('{');
        expect(editor.marked).toBe('😀{|}');
    });

    it('normal tippen (null): andere Zeichen, Ersetzungsbereich, mehrere Zeichen, Mehrfachauswahl, schreibgeschützt', () => {
        const state = EditorState.create({ doc: 'a c', selection: EditorSelection.single(1) });
        expect(typedCharacterEdit(state, 1, 1, 'a')).toBeNull();
        expect(typedCharacterEdit(state, 0, 1, '{')).toBeNull();
        expect(typedCharacterEdit(state, 1, 1, '{}')).toBeNull();
        expect(typedCharacterEdit(state, 1, 1, '\\begin{x}')).toBeNull();
        expect(typedCharacterEdit(state, 1, 1, '{')).not.toBeNull();

        const multi = EditorState.create({
            doc: 'abc',
            selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(2)]),
            extensions: EditorState.allowMultipleSelections.of(true),
        });
        expect(typedCharacterEdit(multi, 0, 0, '{')).toBeNull();

        const readOnly = EditorState.create({
            doc: 'abc', selection: EditorSelection.single(1), extensions: EditorState.readOnly.of(true),
        });
        expect(typedCharacterEdit(readOnly, 1, 1, '{')).toBeNull();
    });

    it('abschaltbar: ohne automatisches Schließen wird normal getippt', () => {
        const editor = new TestEditor('|', withSettings(AUTO_PAIR_OFF));
        editor.type('{');
        expect(editor.text).toBe('{');
        expect(editor.run(typingCommands.deleteBackward)).toBe(false);
    });
});

// MARK: IME-Schutz

describe('IME-Schutz', () => {
    it('isImeActive: composing oder compositionStarted', () => {
        expect(isImeActive({})).toBe(false);
        expect(isImeActive({ composing: false, compositionStarted: false })).toBe(false);
        expect(isImeActive({ composing: true })).toBe(true);
        expect(isImeActive({ compositionStarted: true })).toBe(true);
    });

    it.each([
        ['composing', { composing: true }],
        ['compositionStarted', { compositionStarted: true }],
    ])('kein Befehl greift ein (%s)', (_name, ime) => {
        for (const [name, command] of Object.entries(typingCommands)) {
            const editor = new TestEditor('\\begin{itemize}|', [], ime);
            expect(editor.run(command), name).toBe(false);
            expect(editor.text, name).toBe('\\begin{itemize}');
        }
    });
});

// MARK: Befehle

describe('Befehle über die Tasten', () => {
    it('Enter: Einrückung, \\end und \\item; leerer Punkt beendet die Liste', () => {
        const editor = new TestEditor('\t\\begin{itemize}|');
        editor.run(typingCommands.newline);
        expect(editor.text).toBe('\t\\begin{itemize}\n\t\t\\item \n\t\\end{itemize}');
        editor.type('Eins');
        editor.run(typingCommands.newline);
        expect(editor.text).toBe('\t\\begin{itemize}\n\t\t\\item Eins\n\t\t\\item \n\t\\end{itemize}');
        editor.run(typingCommands.newline);
        expect(editor.marked).toBe('\t\\begin{itemize}\n\t\t\\item Eins\n\t\t|\n\t\\end{itemize}');
    });

    it('Enter in normaler Zeile übernimmt nur die Einrückung', () => {
        expect(edited('  abc|def', typingCommands.newline)).toBe('  abc\n  |def');
    });

    it('Enter mit Einstellung „2 Leerzeichen“', () => {
        expect(edited('\\begin{center}|', typingCommands.newline, withSettings(TWO_SPACES)))
            .toBe('\\begin{center}\n  |\n\\end{center}');
    });

    it('Rückschritt: nur zwischen leerem Paar, sonst false (CodeMirror löscht)', () => {
        expect(edited('{|}', typingCommands.deleteBackward)).toBe('|');
        expect(edited('ab|', typingCommands.deleteBackward)).toBeNull();
        expect(edited('«a»', typingCommands.deleteBackward)).toBeNull();
    });

    it('Tab: Tabulator einfügen, mit mehrzeiliger Auswahl Zeilen einrücken; ⇧Tab rückt aus', () => {
        expect(edited('a|b', typingCommands.insertTab)).toBe('a\t|b');
        expect(edited('«a\nb»', typingCommands.insertTab)).toBe('«\ta\n\tb»');
        expect(edited('\ta|', typingCommands.outdent)).toBe('a|');
        expect(edited('a|', typingCommands.insertTab, withSettings(TWO_SPACES))).toBe('a  |');
        expect(edited('«  a\n  b»', typingCommands.outdent, withSettings(TWO_SPACES))).toBe('«a\nb»');
    });

    it('Kommentar ein und aus', () => {
        const editor = new TestEditor('erste\nzwei|te');
        editor.run(typingCommands.toggleComment);
        expect(editor.marked).toBe('erste\n% zwei|te');
        editor.run(typingCommands.toggleComment);
        expect(editor.text).toBe('erste\nzweite');
    });

    it('Zeilen verschieben und am Rand ablehnen', () => {
        expect(edited('erste\n«zweite»', typingCommands.moveLinesUp)).toBe('«zweite»\nerste');
        expect(edited('«erste»\nzweite', typingCommands.moveLinesDown)).toBe('zweite\n«erste»');
        expect(edited('«erste»\nzweite', typingCommands.moveLinesUp)).toBeNull();
        expect(edited('erste\n«zweite»', typingCommands.moveLinesDown)).toBeNull();
    });

    it('Zeilen doppeln: nach unten wandert die Auswahl mit, nach oben bleibt sie', () => {
        expect(edited('a|\nb', typingCommands.duplicateLinesDown)).toBe('a\na|\nb');
        expect(edited('a|\nb', typingCommands.duplicateLinesUp)).toBe('a|\na\nb');
        expect(edited('«a\nb»', typingCommands.duplicateLinesUp)).toBe('«a\nb»\na\nb');
    });

    it('Zeilen löschen', () => {
        expect(edited('a\nb|\nc', typingCommands.deleteLines)).toBe('a\n|c');
        expect(edited('a\nb|', typingCommands.deleteLines)).toBe('a|');
    });

    it('Fett, Kursiv, Schreibmaschine: umschließen, wieder herausnehmen, ohne Auswahl leer', () => {
        expect(edited('«erste»', typingCommands.bold)).toBe('\\textbf{«erste»}');
        expect(edited('\\textbf{«erste»}', typingCommands.bold)).toBe('«erste»');
        expect(edited('«x»', typingCommands.italic)).toBe('\\emph{«x»}');
        expect(edited('a|', typingCommands.monospace)).toBe('a\\texttt{|}');
    });

    it('Mehrfachauswahl und Schreibschutz: kein Eingriff', () => {
        const multi = EditorState.create({
            doc: 'a\nb',
            selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(2)]),
            extensions: EditorState.allowMultipleSelections.of(true),
        });
        const editor = new TestEditor('x|');
        editor.state = multi;
        expect(editor.run(typingCommands.newline)).toBe(false);
        const readOnly = new TestEditor('x|', [EditorState.readOnly.of(true)]);
        expect(readOnly.run(typingCommands.newline)).toBe(false);
    });

    it('jeder Befehl ist genau ein Undo-Schritt, auch kurz hintereinander', () => {
        const editor = new TestEditor('«erste\nzweite»');
        editor.run(typingCommands.toggleComment);
        editor.run(typingCommands.insertTab);
        editor.run(typingCommands.bold);
        const afterAll = editor.text;
        editor.undo();
        expect(editor.text).not.toBe(afterAll);
        expect(editor.text).toBe('\t% erste\n\t% zweite');
        editor.undo();
        expect(editor.text).toBe('% erste\n% zweite');
        editor.undo();
        expect(editor.text).toBe('erste\nzweite');
    });

    it('Enter ist ein eigener Schritt, auch wenn direkt davor und danach getippt wird', () => {
        const editor = new TestEditor('|');
        editor.type('ab');
        editor.run(typingCommands.newline);
        editor.type('cd');
        expect(editor.text).toBe('ab\ncd');
        editor.undo();
        expect(editor.text).toBe('ab\n');
        editor.undo();
        expect(editor.text).toBe('ab');
        editor.undo();
        expect(editor.text).toBe('');
    });

    it('Wechsel zwischen Tippen und Löschen beginnt einen neuen Schritt; gleiche Art bleibt zusammen', () => {
        const editor = new TestEditor('|', [undoStepOnEditKindChange]);
        editor.type('\\ref{');
        expect(editor.text).toBe('\\ref{}');
        editor.run(typingCommands.deleteBackward);
        expect(editor.text).toBe('\\ref');
        editor.undo();
        expect(editor.text).toBe('\\ref{}');
        editor.undo();
        expect(editor.text).toBe('');
    });
});

// MARK: Tastenbelegung und Erweiterung

describe('typingKeymap und typingExtension', () => {
    it('jede Taste kommt genau einmal vor', () => {
        const keys = typingKeymap.map((binding) => binding.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys).toEqual(expect.arrayContaining(Object.values(TYPING_KEYS)));
        expect(keys).toHaveLength(Object.keys(TYPING_KEYS).length);
    });

    it('keine Belegung mit Strg+Alt (AltGr) und Strg+B bleibt frei', () => {
        for (const key of Object.values(TYPING_KEYS)) {
            expect(key).not.toMatch(/Mod-Alt|Ctrl-Alt|Alt-Mod/);
            expect(key).not.toBe('Mod-b');
        }
    });

    it('die Erweiterung liefert einen Eingabehandler und die Tasten', () => {
        const state = EditorState.create({ doc: '', extensions: typingExtension({ path: '/p/a.tex' }) });
        expect(state.facet(EditorView.inputHandler)).toHaveLength(1);
    });

    it('Standard: Tabulator, Klammern an; über das Facet überschreibbar', () => {
        const plain = EditorState.create({ doc: '' });
        expect(plain.facet(typingSettings)).toEqual(DEFAULT_TEXT_EDITING_SETTINGS);
        const custom = EditorState.create({ doc: '', extensions: withSettings(TWO_SPACES) });
        expect(custom.facet(typingSettings).indentUnit).toBe('  ');
    });
});

// MARK: Fenster gegen ganzen Text

type Logic = (text: string, selection: Selection, settings: TextEditingSettings) => TextEdit | null;

const LOGIC_BY_COMMAND: ReadonlyArray<readonly [string, TypingCommand, Logic]> = [
    ['deleteBackward', typingCommands.deleteBackward, (t, s, st) => deleteBackward(t, s, st)],
    ['newline', typingCommands.newline, (t, s, st) => newline(t, s, st)],
    ['insertTab', typingCommands.insertTab, (t, s, st) => insertTab(t, s, st)],
    ['outdent', typingCommands.outdent, (t, s, st) => outdent(t, s, st)],
    ['toggleComment', typingCommands.toggleComment, (t, s) => toggleComment(t, s)],
    ['moveUp', typingCommands.moveLinesUp, (t, s) => moveLines(true, t, s)],
    ['moveDown', typingCommands.moveLinesDown, (t, s) => moveLines(false, t, s)],
    ['duplicateDown', typingCommands.duplicateLinesDown, (t, s) => duplicateLines(t, s)],
    ['duplicateUp', typingCommands.duplicateLinesUp, (t, s) => ({ ...duplicateLines(t, s), selection: s })],
    ['deleteLines', typingCommands.deleteLines, (t, s) => deleteLines(t, s)],
    ['bold', typingCommands.bold, (t, s) => wrap('textbf', t, s)],
];
const LINE_POOL = [
    '', 'a', '  eingerückt', '\tTab', '% Kommentar', '\\begin{itemize}', '\\item x', '\\end{itemize}', '{}', 'ä😀b',
    '\\textbf{', 'zeile',
];

function seededRandom(seed: number): () => number {
    let value = seed;
    return () => {
        value = (value * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS;
        return value / LCG_MODULUS;
    };
}

describe('Textfenster liefert dasselbe wie der ganze Text', () => {
    it(`${RANDOM_CASE_COUNT} Zufallsfälle über alle Befehle (Text und Auswahl)`, () => {
        const random = seededRandom(7);
        const pick = (count: number): number => Math.floor(random() * count);
        for (let index = 0; index < RANDOM_CASE_COUNT; index++) {
            const lines = Array.from({ length: 1 + pick(14) }, () => LINE_POOL[pick(LINE_POOL.length)] ?? '');
            const text = lines.join('\n') + (random() < 0.3 ? '\n' : '');
            const first = pick(text.length + 1);
            const second = random() < 0.5 ? first : pick(text.length + 1);
            const selection = { from: Math.min(first, second), to: Math.max(first, second) };
            for (const [name, command, logic] of LOGIC_BY_COMMAND) {
                expectSameAsFullText(name, command, logic, text, selection);
            }
        }
    });
});

function expectSameAsFullText(name: string, command: TypingCommand, logic: Logic, text: string, selection: Selection): void {
    const description = `${name}: ${JSON.stringify(text)} ${selection.from}-${selection.to}`;
    const expected = logic(text, selection, DEFAULT_TEXT_EDITING_SETTINGS);
    const editor = new TestEditor('|');
    editor.state = EditorState.create({
        doc: text, selection: EditorSelection.single(selection.from, selection.to), extensions: [history()],
    });
    const intervened = editor.run(command);
    expect(intervened, description).toBe(expected !== null);
    if (expected === null) return;
    const result = applyEdit(text, expected);
    expect(editor.text, description).toBe(result.text);
    const clamped = { from: Math.min(result.selection.from, result.text.length), to: Math.min(result.selection.to, result.text.length) };
    expect({ from: editor.state.selection.main.from, to: editor.state.selection.main.to }, description).toEqual(clamped);
}

describe('Eingetippte Zeichen: Fenster gegen ganzen Text', () => {
    it('typed liefert in langen Dokumenten dasselbe', () => {
        const text = `${'zeile\n'.repeat(50)}a $x\\{ ${'\n\\item'.repeat(5)}`;
        for (const character of ['{', '(', '$', '}', ']']) {
            for (const offset of [0, 5, 6, 8, 303, 306, text.length]) {
                const state = EditorState.create({ doc: text, selection: EditorSelection.single(offset) });
                const expected = typed(character, text, { from: offset, to: offset });
                const actual = typedCharacterEdit(state, offset, offset, character);
                expect(actual === null, `${character}@${offset}`).toBe(expected === null);
                if (expected === null || actual === null) continue;
                expect(applyEdit(text, actual), `${character}@${offset}`).toEqual(applyEdit(text, expected));
            }
        }
    });
});
