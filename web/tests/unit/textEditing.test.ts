import { describe, expect, it } from 'vitest';
import {
    applyEdit,
    DEFAULT_TEXT_EDITING_SETTINGS,
    deleteBackward,
    deleteLines,
    duplicateLines,
    FORMAT_COMMANDS,
    indent,
    insertTab,
    isAutoPair,
    isClosed,
    lineBlock,
    moveLines,
    newline,
    openedEnvironment,
    outdent,
    toggleComment,
    typed,
    wrap,
    type Selection,
    type TextEdit,
    type TextEditingSettings,
} from '../../src/shared/core/textEditing';
import { loadSpec, type SpecCase } from '../support/specVectors';

const EXPECTED_VECTOR_COUNT = 50;
const TWO_SPACES: TextEditingSettings = { ...DEFAULT_TEXT_EDITING_SETTINGS, indentUnit: '  ' };
const AUTO_PAIR_OFF: TextEditingSettings = { ...DEFAULT_TEXT_EDITING_SETTINGS, autoPairBrackets: false };

// MARK: Markierungsnotation: `|` Cursor, `«…»` Auswahl

interface Marked {
    readonly text: string;
    readonly selection: Selection;
}

function parseMarked(marked: string): Marked {
    const start = marked.indexOf('«');
    if (start !== -1) {
        const end = marked.indexOf('»');
        return { text: marked.replace('«', '').replace('»', ''), selection: { from: start, to: end - 1 } };
    }
    const cursor = marked.indexOf('|');
    if (cursor === -1) throw new Error(`keine Markierung in „${marked}“`);
    return { text: marked.replace('|', ''), selection: { from: cursor, to: cursor } };
}

function renderMarked(text: string, selection: Selection): string {
    if (selection.from === selection.to) return `${text.slice(0, selection.from)}|${text.slice(selection.from)}`;
    return `${text.slice(0, selection.from)}«${text.slice(selection.from, selection.to)}»${text.slice(selection.to)}`;
}

/** Wendet die Bearbeitung an und schreibt die neue Auswahl wieder als Markierung in den Text */
function run(operation: (text: string, selection: Selection) => TextEdit | null, marked: string): string | null {
    const { text, selection } = parseMarked(marked);
    const edit = operation(text, selection);
    if (edit === null) return null;
    const result = applyEdit(text, edit);
    return renderMarked(result.text, result.selection);
}

// MARK: Vektoren (shared/spec/text-editing.json)

interface EditingInput {
    readonly op: string;
    readonly marked: string;
    readonly character?: string;
    readonly command?: string;
    readonly up?: boolean;
}

function runVectorOperation(input: EditingInput, text: string, selection: Selection): TextEdit | null {
    switch (input.op) {
        case 'typed': return typed(input.character ?? '', text, selection);
        case 'deleteBackward': return deleteBackward(text, selection);
        case 'newline': return newline(text, selection);
        case 'toggleComment': return toggleComment(text, selection);
        case 'indent': return indent(text, selection);
        case 'outdent': return outdent(text, selection);
        case 'moveLines': return moveLines(input.up ?? false, text, selection);
        case 'duplicateLines': return duplicateLines(text, selection);
        case 'deleteLines': return deleteLines(text, selection);
        case 'wrap': return wrap(input.command ?? '', text, selection);
        default: throw new Error(`unbekannte Operation: ${input.op}`);
    }
}

function checkVector(testCase: SpecCase): void {
    const input = testCase.input as EditingInput;
    const actual = run((text, selection) => runVectorOperation(input, text, selection), input.marked);
    expect(actual, `${testCase.id}: ${testCase.name}`).toBe(testCase.expect);
}

describe('text-editing Vektoren', () => {
    const spec = loadSpec('text-editing');

    it('enthält alle 50 übernehmbaren Fälle', () => {
        expect(spec.cases).toHaveLength(EXPECTED_VECTOR_COUNT);
    });

    for (const testCase of spec.cases) {
        it(`${testCase.id}: ${testCase.name}`, () => checkVector(testCase));
    }
});

// MARK: Nachgebildete Tipp-Fälle (TypingTests.swift, nur die reine Textlogik)

/** Tastatur ohne Editor: jede Taste ist ein Aufruf der Logik, sonst normales Tippen oder Löschen */
class TypingSession {
    text: string;
    selection: Selection;
    /** Anzahl der Bearbeitungen aus der Logik; jede ist ein Undo-Schritt (eine Ersetzung) */
    commandCount = 0;

    constructor(initial = '', private readonly settings: TextEditingSettings = DEFAULT_TEXT_EDITING_SETTINGS) {
        this.text = initial;
        this.selection = { from: initial.length, to: initial.length };
    }

    type(characters: string): void {
        for (const character of characters) this.typeCharacter(character);
    }

    returnKey(): void { this.command(newline(this.text, this.selection, this.settings)); }
    tab(): void { this.command(insertTab(this.text, this.selection, this.settings)); }
    backtab(): void { this.command(outdent(this.text, this.selection, this.settings)); }

    backspace(): void {
        const edit = deleteBackward(this.text, this.selection, this.settings);
        if (edit) return this.command(edit);
        const from = this.selection.from === this.selection.to ? Math.max(0, this.selection.from - 1) : this.selection.from;
        this.replace(from, this.selection.to, '');
    }

    selectAll(): void { this.selection = { from: 0, to: this.text.length }; }

    select(from: number, length: number): void { this.selection = { from, to: from + length }; }

    menu(edit: TextEdit | null): void { this.command(edit); }

    private typeCharacter(character: string): void {
        const edit = typed(character, this.text, this.selection, this.settings);
        if (edit) return this.command(edit);
        this.replace(this.selection.from, this.selection.to, character);
    }

    private command(edit: TextEdit | null): void {
        if (edit === null) return;
        expect(edit.changes).toHaveLength(1);
        this.commandCount++;
        ({ text: this.text, selection: this.selection } = applyEdit(this.text, edit));
    }

    private replace(from: number, to: number, insert: string): void {
        this.text = this.text.slice(0, from) + insert + this.text.slice(to);
        this.selection = { from: from + insert.length, to: from + insert.length };
    }
}

describe('Tippen wie im Editor (TypingTests.swift)', () => {
    it('Klammern schließen, überspringen und paarweise löschen', () => {
        const session = new TypingSession();
        session.type('\\emph{');
        expect(session.text).toBe('\\emph{}');
        expect(session.selection.from).toBe(6);
        session.type('x}');
        expect(session.text, 'Die schließende Klammer wird übersprungen, nicht verdoppelt').toBe('\\emph{x}');
        session.type(' \\ref{');
        expect(session.text).toBe('\\emph{x} \\ref{}');
        session.backspace();
        expect(session.text).toBe('\\emph{x} \\ref');
    });

    it('Enter rückt ein und ergänzt \\end; Tab mit Auswahl rückt ein, ⇧Tab aus', () => {
        const session = new TypingSession('\t\\begin{itemize}');
        session.returnKey();
        expect(session.text).toBe('\t\\begin{itemize}\n\t\t\\item \n\t\\end{itemize}');
        session.type('Eins');
        session.returnKey();
        expect(session.text).toBe('\t\\begin{itemize}\n\t\t\\item Eins\n\t\t\\item \n\t\\end{itemize}');

        session.selectAll();
        session.backtab();
        expect(session.text).toBe('\\begin{itemize}\n\t\\item Eins\n\t\\item \n\\end{itemize}');
        session.tab();
        expect(session.text.startsWith('\t\\begin{itemize}\n\t\t\\item Eins')).toBe(true);
    });

    it('Menübefehle: Kommentar, Zeilen verschieben, Fett; jeder Befehl ein Undo-Schritt', () => {
        const session = new TypingSession('erste\nzweite');
        session.menu(toggleComment(session.text, session.selection));
        expect(session.text).toBe('erste\n% zweite');
        session.menu(moveLines(true, session.text, session.selection));
        expect(session.text).toBe('% zweite\nerste');
        session.select(9, 5);
        session.menu(wrap(FORMAT_COMMANDS.bold, session.text, session.selection));
        expect(session.text).toBe('% zweite\n\\textbf{erste}');
        expect(session.commandCount).toBe(3);
    });

    it('Abschaltbar: ohne „Klammern automatisch schließen“ wird normal getippt', () => {
        const session = new TypingSession('', AUTO_PAIR_OFF);
        session.type('{');
        expect(session.text).toBe('{');
        expect(deleteBackward('{}', { from: 1, to: 1 }, AUTO_PAIR_OFF)).toBeNull();
    });

    it('Mit „2 Leerzeichen“: Tab-Taste, Enter nach \\begin, Einrücken und Ausrücken nutzen Leerzeichen', () => {
        const session = new TypingSession('', TWO_SPACES);
        session.tab();
        expect(session.text, 'Tab-Taste fügt die Leerzeichen ein').toBe('  ');
        session.backspace();
        session.backspace();
        session.type('\\begin{center}');
        session.returnKey();
        session.type('x');
        expect(session.text).toBe('\\begin{center}\n  x\n\\end{center}');

        session.selectAll();
        session.menu(indent(session.text, session.selection, TWO_SPACES));
        expect(session.text).toBe('  \\begin{center}\n    x\n  \\end{center}');
        session.menu(outdent(session.text, session.selection, TWO_SPACES));
        expect(session.text).toBe('\\begin{center}\n  x\n\\end{center}');
    });

    it('Standard: Tabulator wie in der HgbThesis', () => {
        expect(DEFAULT_TEXT_EDITING_SETTINGS.indentUnit).toBe('\t');
        const session = new TypingSession();
        session.tab();
        expect(session.text).toBe('\t');
    });

    it('Ausrücken nimmt eine Einrückung der gewählten Art weg (EditorSettingsTests.swift)', () => {
        const text = '    vier\n\tTab\n x';
        const whole = { from: 0, to: text.length };
        expect(applyEdit(text, outdent(text, whole, TWO_SPACES)).text).toBe('  vier\nTab\nx');
        expect(applyEdit(text, outdent(text, whole)).text).toBe('vier\nTab\nx');
        const blank = 'a\n\nb';
        expect(applyEdit(blank, indent(blank, { from: 0, to: 4 }, TWO_SPACES)).text).toBe('  a\n\n  b');
    });
});

// MARK: Randfälle

describe('Randfälle: Unicode (UTF-16)', () => {
    const type = (character: string, marked: string) => run((text, selection) => typed(character, text, selection), marked);

    it('Emoji vor dem Cursor zählt zwei Einheiten, das Paar steht dahinter', () => {
        expect(type('{', '😀|')).toBe('😀{|}');
        const edit = typed('{', '😀', { from: 2, to: 2 });
        expect(edit?.changes).toEqual([{ from: 2, to: 2, insert: '{}' }]);
        expect(edit?.selection).toEqual({ from: 3, to: 3 });
    });

    it('Emoji direkt hinter dem Cursor verhindert das Paar', () => {
        expect(type('{', '|😀')).toBeNull();
    });

    it('Auswahl mit Emoji wird umschlossen und bleibt ausgewählt', () => {
        expect(type('[', '«😀»')).toBe('[«😀»]');
        expect(type('(', 'ä «ö😀ü» ß')).toBe('ä («ö😀ü») ß');
    });

    it('Rückschritt im Paar nach einem Emoji', () => {
        expect(run((text, selection) => deleteBackward(text, selection), '😀{|}')).toBe('😀|');
    });

    it('Enter, Kommentar und Verschieben mit Emoji und Umlauten', () => {
        expect(run(newline, '😀|x')).toBe('😀\n|x');
        expect(run(toggleComment, '|😀')).toBe('% |😀');
        expect(run(toggleComment, 'äö|😀')).toBe('% äö|😀');
        expect(run((text, selection) => moveLines(true, text, selection), '😀\nb|')).toBe('b|\n😀');
        expect(run(duplicateLines, '😀|\nz')).toBe('😀\n😀|\nz');
    });

    it('Fett um Emoji und wieder heraus', () => {
        const bold = (marked: string) => run((text, selection) => wrap('textbf', text, selection), marked);
        expect(bold('a «😀» b')).toBe('a \\textbf{«😀»} b');
        expect(bold('a \\textbf{«😀»} b')).toBe('a «😀» b');
    });
});

describe('Randfälle: Klammern', () => {
    const type = (character: string, marked: string) => run((text, selection) => typed(character, text, selection), marked);

    it('Zwei Backslashes davor maskieren nicht', () => {
        expect(type('{', '\\\\|')).toBe('\\\\{|}');
        expect(type('}', '\\|}')).toBeNull();
    });

    it('Schließende Klammer ohne Gegenstück im Text: normal tippen', () => {
        expect(type(')', 'a|')).toBeNull();
        expect(type('}', '|')).toBeNull();
    });

    it('Leerer Text: Paar einfügen', () => {
        expect(type('{', '|')).toBe('{|}');
        expect(type('$', '|')).toBe('$|$');
    });

    it('Zweites $ in derselben Zeile schließt, in der nächsten Zeile öffnet es wieder', () => {
        expect(type('$', '$a$ und |')).toBe('$a$ und $|$');
        expect(type('$', '$a\nb |')).toBe('$a\nb $|$');
    });

    it('Auswahl über mehrere Zeilen wird umschlossen', () => {
        expect(type('{', '«a\nb»')).toBe('{«a\nb»}');
    });

    it('Nicht-Klammer mit Auswahl und Auswahl ohne Paar: normal', () => {
        expect(type('}', '«x»')).toBeNull();
    });

    it('Rückschritt: Dateianfang, Dateiende, Auswahl, leerer Text', () => {
        const back = (marked: string) => run((text, selection) => deleteBackward(text, selection), marked);
        expect(back('|{}')).toBeNull();
        expect(back('{}|')).toBeNull();
        expect(back('«{}»')).toBeNull();
        expect(back('|')).toBeNull();
        expect(back('{|}')).toBe('|');
        expect(back('$|$')).toBe('|');
    });

    it('isAutoPair erkennt nur die vier Paare', () => {
        expect(['{}', '[]', '()', '$$'].every(isAutoPair)).toBe(true);
        expect(['{)', '{', '{}}', ''].some(isAutoPair)).toBe(false);
    });
});

describe('Randfälle: Zeilenumbruch', () => {
    it('Auswahl wird durch den Umbruch ersetzt, Einrückung der Anfangszeile bleibt', () => {
        expect(run(newline, '\tx«yz»w')).toBe('\tx\n\t|w');
    });

    it('Leerer Text und Dateiende mit Zeilenumbruch', () => {
        expect(run(newline, '|')).toBe('\n|');
        expect(run(newline, 'a\n|')).toBe('a\n\n|');
    });

    it('Einrückung aus Leerzeichen und Einheit aus den Einstellungen', () => {
        const spaced = (marked: string) => run((text, selection) => newline(text, selection, TWO_SPACES), marked);
        expect(spaced('  a|')).toBe('  a\n  |');
        expect(spaced('\\begin{itemize}|')).toBe('\\begin{itemize}\n  \\item |\n\\end{itemize}');
    });

    it('Umgebung mit Stern und mit mehreren Argumenten', () => {
        expect(run(newline, '\\begin{align*}|')).toBe('\\begin{align*}\n\t|\n\\end{align*}');
        expect(run(newline, '\\begin{tabular}[t]{lr}|')).toBe('\\begin{tabular}[t]{lr}\n\t|\n\\end{tabular}');
    });

    it('Gleiche Umgebung nur innen geschlossen: \\end wird trotzdem ergänzt', () => {
        const marked = '\\begin{x}|\n\\begin{x}\n\\end{x}';
        expect(run(newline, marked)).toBe('\\begin{x}\n\t|\n\\end{x}\n\\begin{x}\n\\end{x}');
    });

    it('Nach \\begin mit Text dahinter und \\item mit Auswahl: nur Umbruch', () => {
        expect(run(newline, '\\begin{x}| text')).toBe('\\begin{x}\n| text');
        expect(run(newline, '\\item «a»')).toBe('\\item \n|');
    });

    it('\\item[…] setzt die Liste fort', () => {
        expect(run(newline, '\\item[a] Text|')).toBe('\\item[a] Text\n\\item |');
    });

    it('openedEnvironment und isClosed', () => {
        expect(openedEnvironment('\\begin{figure}[H]')).toBe('figure');
        expect(openedEnvironment('\\begin{x} text')).toBeNull();
        expect(openedEnvironment('text')).toBeNull();
        expect(isClosed('x', '\n\\end{x}', 0)).toBe(true);
        expect(isClosed('x', '\n\\end{y}', 0)).toBe(false);
        expect(isClosed('a*', '\\end{a*}', 0)).toBe(true);
    });

    it('isClosed sucht nur im Fenster von 50 000 Einheiten', () => {
        const farAway = `${'\n'.repeat(50_001)}\\end{x}`;
        expect(isClosed('x', farAway, 0)).toBe(false);
        expect(isClosed('x', farAway, 10)).toBe(true);
    });
});

describe('Randfälle: Zeilenbefehle', () => {
    const move = (up: boolean, marked: string) => run((text, selection) => moveLines(up, text, selection), marked);

    it('Kommentar: mehrere Zeilen, Auswahl bis Zeilenanfang, leere und leerer Text', () => {
        expect(run(toggleComment, '«a\nb\nc»')).toBe('«% a\n% b\n% c»');
        expect(run(toggleComment, '«a\nb\n»')).toBe('«% a\n% b»\n');
        expect(run(toggleComment, '  |')).toBe('  |');
        expect(run(toggleComment, '|')).toBe('|');
    });

    it('Kommentar ein und wieder aus ergibt den Ausgangstext', () => {
        const original = '«\tx\n  y\n\n\tz»';
        const { text, selection } = parseMarked(original);
        const once = applyEdit(text, toggleComment(text, selection));
        const twice = applyEdit(once.text, toggleComment(once.text, once.selection));
        expect(renderMarked(twice.text, twice.selection)).toBe(original);
    });

    it('Einrücken und Ausrücken: Dateianfang, leerer Text, nur Leerzeichen-Zeile', () => {
        expect(run(indent, '|')).toBe('|');
        expect(run(outdent, '|')).toBe('|');
        expect(run(indent, '«a\nb»')).toBe('«\ta\n\tb»');
        expect(run(outdent, '«  a\n\tb»')).toBe('«a\nb»');
        expect(run(indent, '  |')).toBe('  |');
    });

    it('Tab-Taste: einfügen, Auswahl ersetzen, mehrzeilig einrücken', () => {
        expect(run(insertTab, '|')).toBe('\t|');
        expect(run(insertTab, 'a«b»c')).toBe('a\t|c');
        expect(run(insertTab, '«a\nb»')).toBe('«\ta\n\tb»');
    });

    it('lineBlock: Auswahl endet nach Zeilenumbruch, am Dateiende, leerer Text', () => {
        expect(lineBlock('a\nb\nc', { from: 1, to: 4 })).toEqual({ from: 0, to: 4 });
        expect(lineBlock('a\nb\nc', { from: 4, to: 5 })).toEqual({ from: 4, to: 5 });
        expect(lineBlock('', { from: 0, to: 0 })).toEqual({ from: 0, to: 0 });
        expect(lineBlock('a\n', { from: 2, to: 2 })).toEqual({ from: 2, to: 2 });
    });

    it('Verschieben: mehrzeilige Auswahl, leerer Text, leere letzte Zeile', () => {
        expect(move(true, 'a\n«b\nc»\nd')).toBe('«b\nc»\na\nd');
        expect(move(false, '«a\nb»\nc')).toBe('c\n«a\nb»');
        expect(move(true, '|')).toBeNull();
        expect(move(false, '|')).toBeNull();
        expect(move(true, 'a\n|')).toBe('|\na');
    });

    it('Verdoppeln und Löschen: mehrere Zeilen, Dateianfang, leerer Text', () => {
        expect(run(duplicateLines, '«a\nb»\nc')).toBe('a\nb\n«a\nb»\nc');
        expect(run(duplicateLines, '|')).toBe('\n|');
        expect(run(deleteLines, '|a\nb')).toBe('|b');
        expect(run(deleteLines, '«a\nb»\nc')).toBe('|c');
        expect(run(deleteLines, '|')).toBe('|');
        expect(run(deleteLines, 'a\nb\n|')).toBe('a\nb|');
    });

    it('Formatierung: leerer Text, Auswahl am Textende, mehrere Zeilen, Monospace', () => {
        const format = (command: string, marked: string) => run((text, selection) => wrap(command, text, selection), marked);
        expect(format('textbf', '|')).toBe('\\textbf{|}');
        expect(format('emph', 'a «b»')).toBe('a \\emph{«b»}');
        expect(format(FORMAT_COMMANDS.monospace, '«a\nb»')).toBe('\\texttt{«a\nb»}');
        expect(format('textbf', '\\textbf{«a»')).toBe('\\textbf{\\textbf{«a»}');
    });
});

describe('applyEdit', () => {
    it('wendet mehrere Ersetzungen in Offsets des Ausgangstexts an', () => {
        const edit: TextEdit = {
            changes: [{ from: 0, to: 1, insert: 'xx' }, { from: 2, to: 3, insert: '' }],
            selection: { from: 0, to: 0 },
        };
        expect(applyEdit('abc', edit).text).toBe('xxb');
    });
});
