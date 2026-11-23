import { describe, expect, it } from 'vitest';
import { ChangeSet, Text } from '@codemirror/state';
import type { ChangeSpec } from '@codemirror/state';
import type { BibLexState } from '../../src/shared/core/bib/tokenizer';
import { languageFromPath } from '../../src/shared/core/language';
import type { LexState, TokenKind } from '../../src/shared/core/latex/tokenizer';
import {
    LineStateCache,
    bibSyntax,
    latexSyntax,
    spliceFromChanges,
    syntaxFor,
    textLineSource,
} from '../../src/renderer/editor/lineStateCache';
import type {
    HighlightToken, HighlightUpdate, LineSource, LineSplice, LineSyntax,
} from '../../src/renderer/editor/lineStateCache';
import { loadSpec, type SpecCase } from '../support/specVectors';

const HIGHLIGHTER_PREFIX = 'highlighter-';
const RANDOM_EDIT_COUNT = 500;
const RANDOM_BASE_LINES = 150;
const SEED = 7;
const BIB_SEED = 4711;
const MAX_DELETE_LENGTH = 20;
const SMALL_SYNC_LIMIT = 5;
const ADVANCE_CHUNK = 7;

interface EditSpec {
    readonly locationOfSubstring: string;
    readonly offset: number;
    readonly length: number;
    readonly replacement: string;
}

interface HighlighterInput {
    readonly op: 'highlightAll' | 'highlightEdit';
    readonly text: string;
    readonly edit?: EditSpec;
}

interface HighlighterExpect {
    readonly endStates?: readonly LexState[];
    readonly tokenizedLineCount?: number;
    readonly allTokenKinds?: TokenKind;
    readonly endStatesAfterEdit?: Readonly<Record<string, LexState>>;
}

/** Dokument mit CodeMirror-`Text`, wie im Editor */
class Document<State> {
    doc: Text;
    readonly cache: LineStateCache<State>;

    constructor(text: string, syntax: LineSyntax<State>) {
        this.doc = Text.of(text.split('\n'));
        this.cache = new LineStateCache(syntax);
        this.cache.highlightAll(this.source());
    }

    source(): LineSource {
        return textLineSource(this.doc);
    }

    /** Wendet die Änderung an und liefert die Zeilenänderung (`null`: nichts geändert); Cache noch nicht nachgeführt */
    change(spec: ChangeSpec): LineSplice | null {
        const changes = ChangeSet.of(spec, this.doc.length);
        const oldDoc = this.doc;
        this.doc = changes.apply(oldDoc);
        return spliceFromChanges(changes, oldDoc, this.doc);
    }

    /** Änderung anwenden und den Cache nachführen */
    edit(spec: ChangeSpec, syncLimitLine = Infinity): HighlightUpdate {
        const splice = this.change(spec);
        if (splice === null) throw new Error('keine Änderung');
        return this.cache.highlightEdit(this.source(), splice, syncLimitLine);
    }
}

function fullEndStates<State>(syntax: LineSyntax<State>, source: LineSource): State[] {
    const states: State[] = [];
    let state = syntax.initialState;
    for (let line = 0; line < source.lineCount; line++) {
        state = syntax.tokenizeLine(source.lineText(line), state).state;
        states.push(state);
    }
    return states;
}

function fullTokens<State>(syntax: LineSyntax<State>, source: LineSource): (readonly HighlightToken[])[] {
    const tokens: (readonly HighlightToken[])[] = [];
    let state = syntax.initialState;
    for (let line = 0; line < source.lineCount; line++) {
        const result = syntax.tokenizeLine(source.lineText(line), state);
        tokens.push(result.tokens);
        state = result.state;
    }
    return tokens;
}

function cachedTokens<State>(cache: LineStateCache<State>, source: LineSource): (readonly HighlightToken[])[] {
    const tokens: (readonly HighlightToken[])[] = [];
    for (let line = 0; line < source.lineCount; line++) tokens.push(cache.tokensOfLine(source, line));
    return tokens;
}

/** Erwartete Zahl neu tokenisierter Zeilen nach Swift (`SyntaxHighlighter.update`), aus alten und neuen Zuständen */
function swiftTokenizedLineCount<State>(
    syntax: LineSyntax<State>, oldStates: readonly State[], newStates: readonly State[], splice: LineSplice,
): number {
    const lastChangedLine = splice.firstLine + splice.insertedLineCount;
    const delta = splice.insertedLineCount - splice.removedLineCount;
    for (let line = splice.firstLine; line < newStates.length; line++) {
        if (line < lastChangedLine) continue;
        const previous = oldStates[line - delta];
        if (previous !== undefined && syntax.statesEqual(newStates[line] as State, previous)) {
            return line - splice.firstLine + 1;
        }
    }
    return newStates.length - splice.firstLine;
}

// MARK: Vektoren

function runHighlightAll(input: HighlighterInput, expectation: HighlighterExpect): void {
    const document = new Document(input.text, latexSyntax);
    expect(document.cache.validEndStates()).toEqual(expectation.endStates);
}

function runHighlightEdit(input: HighlighterInput, expectation: HighlighterExpect): void {
    const edit = input.edit as EditSpec;
    const document = new Document(input.text, latexSyntax);
    const from = input.text.indexOf(edit.locationOfSubstring) + edit.offset;
    const update = document.edit({ from, to: from + edit.length, insert: edit.replacement });
    if (expectation.tokenizedLineCount !== undefined) {
        expect(update.tokenizedLineCount).toBe(expectation.tokenizedLineCount);
    }
    const lastLine = update.firstLine + update.tokenizedLineCount;
    for (let line = update.firstLine; line < lastLine; line++) {
        for (const token of document.cache.tokensOfLine(document.source(), line)) {
            expect(token.kind, `Zeile ${line}`).toBe(expectation.allTokenKinds ?? token.kind);
        }
    }
    const states = document.cache.validEndStates();
    for (const [line, state] of Object.entries(expectation.endStatesAfterEdit ?? {})) {
        expect(states[Number(line)], `Zeile ${line}`).toEqual(state);
    }
}

function runVector(specCase: SpecCase): void {
    const input = specCase.input as HighlighterInput;
    const expectation = specCase.expect as HighlighterExpect;
    if (input.op === 'highlightAll') {
        runHighlightAll(input, expectation);
        return;
    }
    expect(input.op).toBe('highlightEdit');
    runHighlightEdit(input, expectation);
}

describe('lineStateCache: Vektoren highlighter-* aus latex-tokenizer.json', () => {
    const cases = loadSpec('latex-tokenizer').cases.filter((specCase) => specCase.id.startsWith(HIGHLIGHTER_PREFIX));

    it('die zurückgestellten Fälle sind vorhanden', () => {
        expect(cases.map((specCase) => specCase.id)).toEqual(
            ['highlighter-fullHighlightStates', 'highlighter-openDollarStopsAtParagraph'],
        );
    });

    it.each(cases.map((specCase) => [specCase.id, specCase.name, specCase] as const))(
        '%s: %s',
        (_id, _name, specCase) => runVector(specCase),
    );
});

// MARK: Wie SyntaxHighlighterTests.swift

const PARAGRAPHS = [
    'Erster Absatz mit Text.', 'Noch eine Zeile.', '', 'Zweiter Absatz.', 'Mit zwei Zeilen.', '',
    'Dritter Absatz am Ende.',
].join('\n');

describe('lineStateCache: Verhalten wie in Swift', () => {
    it('normales Tippen färbt genau eine Zeile neu', () => {
        const document = new Document(PARAGRAPHS, latexSyntax);
        const from = PARAGRAPHS.indexOf('Zweiter') + 3;
        const update = document.edit({ from, insert: 'x' });
        expect(update).toEqual({ firstLine: 3, tokenizedLineCount: 1, converged: true });
    });

    it('offene Verbatim-Umgebung wirkt bis zum Ende und wird beim Schließen zurückgenommen', () => {
        const document = new Document(PARAGRAPHS, latexSyntax);
        const opening = document.edit({ from: 0, insert: '\\begin{verbatim}\n' });
        expect(opening.tokenizedLineCount).toBe(document.doc.lines);
        expect(document.cache.validEndStates().at(-1)).toEqual({ verbatimEnvironment: 'verbatim' });

        const from = document.doc.toString().indexOf('Noch');
        const closing = document.edit({ from, insert: '\\end{verbatim}\n' });
        expect(document.cache.validEndStates().at(-1)).toBe('normal');
        expect(closing.tokenizedLineCount).toBeLessThan(document.doc.lines);
    });

    it('Zeilen einfügen und löschen verschiebt die Zustände ohne Neuberechnung des Dokuments', () => {
        const text = ['\\begin{equation}', 'x', '\\end{equation}', ...Array<string>(50).fill('Text')].join('\n');
        const document = new Document(text, latexSyntax);
        const inserted = document.edit({ from: 0, insert: 'a\nb\nc\n' });
        expect(inserted.tokenizedLineCount).toBe(4);
        const lineStart = document.doc.line(2).from;
        const removed = document.edit({ from: lineStart, to: lineStart + 4 });
        expect(removed.tokenizedLineCount).toBe(1);
        expect(document.cache.validEndStates()).toEqual(fullEndStates(latexSyntax, document.source()));
    });
});

// MARK: Synchrone Grenze und Leerlauf

describe('lineStateCache: synchrone Grenze, Leerlauf, Konvergenz über Hinweise', () => {
    const longText = Array<string>(1000).fill('Text ohne Besonderheiten').join('\n');

    it('ein offenes Verbatim rechnet synchron nur bis zur Grenze, der Leerlauf vollendet', () => {
        const document = new Document(longText, latexSyntax);
        const limit = 200;
        const update = document.edit({ from: 0, insert: '\\begin{verbatim}' }, limit);
        expect(update.tokenizedLineCount).toBe(limit + 1);
        expect(update.converged).toBe(false);
        expect(document.cache.validLineCount).toBe(limit + 1);
        while (document.cache.advance(document.source(), ADVANCE_CHUNK) > 0) { /* Leerlauf nachstellen */ }
        expect(document.cache.validEndStates()).toEqual(fullEndStates(latexSyntax, document.source()));
    });

    it('nach abgebrochener Neuberechnung konvergiert der Leerlauf am Absatzende und springt zum Ende', () => {
        const text = ['Anfang', ...Array<string>(20).fill('Zeile'), '', ...Array<string>(500).fill('Rest')].join('\n');
        const document = new Document(text, latexSyntax);
        const update = document.edit({ from: 0, insert: '$' }, 3);
        expect(update.tokenizedLineCount).toBe(4);
        const tokenized = document.cache.advance(document.source(), 1000);
        // Zeilen 4 bis 21 (Leerzeile): 18 Zeilen, dann gilt der Rest aus den alten Zuständen
        expect(tokenized).toBe(18);
        expect(document.cache.isComplete).toBe(true);
        expect(document.cache.validEndStates()).toEqual(fullEndStates(latexSyntax, document.source()));
    });

    it('Bearbeitung hinter dem gültigen Bereich tokenisiert nichts', () => {
        const document = new Document(longText, latexSyntax);
        document.edit({ from: 0, insert: '\\begin{verbatim}' }, 10);
        const from = document.doc.line(900).from;
        const update = document.edit({ from, insert: 'x\n' }, 10);
        expect(update.tokenizedLineCount).toBe(0);
        document.cache.ensureValid(document.source(), document.doc.lines);
        expect(document.cache.validEndStates()).toEqual(fullEndStates(latexSyntax, document.source()));
    });

    it('mehrere Änderungsstellen in einer Transaktion werden zu einem Bereich', () => {
        const document = new Document(PARAGRAPHS, latexSyntax);
        const splice = document.change([{ from: 1, insert: 'x\ny' }, { from: PARAGRAPHS.indexOf('Dritter'), insert: '$' }]);
        expect(splice).toEqual({ firstLine: 0, removedLineCount: 6, insertedLineCount: 7 });
        document.cache.highlightEdit(document.source(), splice as LineSplice);
        expect(document.cache.validEndStates()).toEqual(fullEndStates(latexSyntax, document.source()));
    });
});

// MARK: Zufallsabgleich inkrementell = komplett

/** Fester Zufallsgenerator (mulberry32), damit Fehlschläge reproduzierbar sind */
function seededRandom(seed: number): () => number {
    let value = seed >>> 0;
    return () => {
        value = (value + 0x6d2b79f5) >>> 0;
        let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

function pick<T>(random: () => number, items: readonly T[]): T {
    return items[Math.floor(random() * items.length)] as T;
}

const LATEX_LINES = [
    'Fließtext mit $x^2$ und \\cite{key}.', '', '\\section{Titel}', '\\begin{equation}', 'a = b', '\\end{equation}',
    '\\begin{verbatim}', 'code % kein Kommentar $', '\\end{verbatim}', '% Kommentar', '\\[ x \\]', 'Text mit $offen',
    '\\begin{comment}', '\\end{comment}', '\\begin{lstlisting}', '\\end{lstlisting}', '$$', '\\(', '\\)', '\\label{a}',
];
const LATEX_SNIPPETS = [
    '$', '\n', '\n\n', '\\begin{verbatim}', '\\end{verbatim}', '\\begin{equation}\n', '\\end{equation}', '%', '\\[',
    '\\]', 'x', '{', '}', '\\begin{lstlisting}\n', '\\end{lstlisting}\n', 'Text\n\nText', '\\begin{align*}', '\\)',
];
const BIB_LINES = [
    '@article{key2020,', '  author = {Müller, A. and B},', '  title = "Ein {Titel}",', '  year = 2020', '}', '',
    '% Kommentar', '@string{jn = "Journal"}', '@comment{alles {hier}', '}', '@book(key,', '  note = {a', '  b}', ')',
];
const BIB_SNIPPETS = ['@article{k,\n', '}', '{', '"', 'title = {', '%', '\n', '@comment{', '@string{x = "a"}\n', ')', '('];

function randomDocument(random: () => number, lines: readonly string[]): string {
    return Array.from({ length: RANDOM_BASE_LINES }, () => pick(random, lines)).join('\n');
}

function randomChange(random: () => number, doc: Text, snippets: readonly string[]): ChangeSpec {
    const position = Math.floor(random() * (doc.length + 1));
    const choice = random();
    if (choice < 0.45 || doc.length === 0) return { from: position, insert: pick(random, snippets) };
    const deleteEnd = Math.min(doc.length, position + Math.floor(random() * MAX_DELETE_LENGTH));
    if (choice < 0.65) return { from: position, to: deleteEnd };
    if (choice < 0.75) return { from: position, insert: '\n' };
    const lineBreak = doc.toString().indexOf('\n', position);
    if (choice < 0.9 && lineBreak >= 0) return { from: lineBreak, to: lineBreak + 1 };
    const second = Math.floor(random() * (doc.length + 1));
    return [
        { from: Math.min(position, second), insert: pick(random, snippets) },
        { from: Math.max(position, second), insert: '\n' },
    ];
}

/** Unbegrenzt synchron: nach jeder Bearbeitung Zustände wie komplett, Zeilenzahl wie Swift */
function runUnlimited<State>(
    syntax: LineSyntax<State>, seed: number, lines: readonly string[], snippets: readonly string[],
): void {
    const random = seededRandom(seed);
    const document = new Document(randomDocument(random, lines), syntax);
    for (let step = 0; step < RANDOM_EDIT_COUNT; step++) {
        const oldStates = document.cache.validEndStates();
        const splice = document.change(randomChange(random, document.doc, snippets));
        if (splice === null) continue;
        const update = document.cache.highlightEdit(document.source(), splice);
        const expected = fullEndStates(syntax, document.source());
        expect(document.cache.validEndStates(), `Schritt ${step}`).toEqual(expected);
        const expectedCount = swiftTokenizedLineCount(syntax, oldStates, expected, splice);
        expect(update.tokenizedLineCount, `Schritt ${step}`).toBe(expectedCount);
    }
    expect(cachedTokens(document.cache, document.source())).toEqual(fullTokens(syntax, document.source()));
}

/** Kleine synchrone Grenze und zufällige Leerlauf-Schritte: gültiger Teil stimmt immer, am Ende alles */
function runLimited<State>(
    syntax: LineSyntax<State>, seed: number, lines: readonly string[], snippets: readonly string[],
): void {
    const random = seededRandom(seed);
    const document = new Document(randomDocument(random, lines), syntax);
    for (let step = 0; step < RANDOM_EDIT_COUNT; step++) {
        const splice = document.change(randomChange(random, document.doc, snippets));
        if (splice !== null) document.cache.highlightEdit(document.source(), splice, splice.firstLine + SMALL_SYNC_LIMIT);
        if (random() < 0.3) document.cache.advance(document.source(), ADVANCE_CHUNK);
        if (random() < 0.1) document.cache.ensureValid(document.source(), Math.floor(random() * document.doc.lines));
        const expected = fullEndStates(syntax, document.source());
        const valid = document.cache.validEndStates();
        expect(valid, `Schritt ${step}`).toEqual(expected.slice(0, valid.length));
    }
    while (document.cache.advance(document.source(), ADVANCE_CHUNK) > 0) { /* Leerlauf nachstellen */ }
    expect(document.cache.validEndStates()).toEqual(fullEndStates(syntax, document.source()));
    const tokens = cachedTokens(document.cache, document.source());
    expect(tokens).toEqual(fullTokens(syntax, document.source()));
    expect(tokens.flat().length).toBeGreaterThan(0);
}

describe('lineStateCache: Zufallsabgleich inkrementell = komplett (fester Seed)', () => {
    it(`LaTeX, unbegrenzt: ${RANDOM_EDIT_COUNT} Bearbeitungen, Zeilenzahl bis zur Konvergenz wie Swift`, () => {
        runUnlimited(latexSyntax, SEED, LATEX_LINES, LATEX_SNIPPETS);
    });

    it(`LaTeX, synchrone Grenze ${SMALL_SYNC_LIMIT} Zeilen mit Leerlauf`, () => {
        runLimited(latexSyntax, SEED + 1, LATEX_LINES, LATEX_SNIPPETS);
    });

    it(`Bib-Kette, unbegrenzt: ${RANDOM_EDIT_COUNT} Bearbeitungen`, () => {
        runUnlimited(bibSyntax, BIB_SEED, BIB_LINES, BIB_SNIPPETS);
    });

    it(`Bib-Kette, synchrone Grenze ${SMALL_SYNC_LIMIT} Zeilen mit Leerlauf`, () => {
        runLimited(bibSyntax, BIB_SEED + 1, BIB_LINES, BIB_SNIPPETS);
    });
});

// MARK: Bib im selben Mechanismus

describe('lineStateCache: Bib und Sprache nach Endung', () => {
    it('Sprache nach Endung wählt den Tokenizer', () => {
        expect(syntaxFor(languageFromPath('/p/literatur.BIB'))).toBe(bibSyntax);
        expect(syntaxFor(languageFromPath('C:\\p\\main.tex'))).toBe(latexSyntax);
    });

    it.each(loadSpec('bib-tokenizer').cases
        .filter((specCase) => (specCase.input as { op: string }).op === 'highlightAll')
        .map((specCase) => [specCase.id, specCase] as const))(
        'bib-Vektor %s: Cache gleich komplette Kette',
        (_id, specCase) => {
            const document = new Document((specCase.input as { source: string }).source, bibSyntax);
            expect(document.cache.validEndStates()).toEqual(fullEndStates(bibSyntax, document.source()));
            expect(cachedTokens(document.cache, document.source())).toEqual(fullTokens(bibSyntax, document.source()));
        },
    );

    it('mehrzeiliger Wert: Endzustände wie im Vektor multilineValue', () => {
        const specCase = loadSpec('bib-tokenizer').cases.find((candidate) => candidate.id === 'multilineValue');
        const document = new Document((specCase?.input as { source: string }).source, bibSyntax);
        const expected = (specCase?.expect as { endStates: Record<string, { bibtex: BibLexState }> }).endStates;
        const states = document.cache.validEndStates();
        for (const [line, state] of Object.entries(expected)) {
            expect(states[Number(line)], `Zeile ${line}`).toEqual(state.bibtex);
        }
    });
});
