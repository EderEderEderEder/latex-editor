import { describe, expect, it } from 'vitest';
import {
    type LexState,
    type LineTokens,
    NORMAL_STATE,
    type SyntaxToken,
    type TokenKind,
    endsAtBlankLine,
    statesEqual,
    tokenizeChain,
    tokenizeLine,
    tokenizeLineWithOffset,
} from '../../src/shared/core/latex/tokenizer';
import { loadSpec, type SpecCase } from '../support/specVectors';

interface Pair {
    readonly kind: TokenKind;
    readonly text: string;
}

interface StepExpect {
    readonly tokens?: readonly Pair[];
    readonly state?: LexState;
    readonly lastToken?: Pair;
}

interface TokenizerInput {
    readonly op: string;
    readonly line?: string;
    readonly lines?: readonly string[];
    readonly lineOffset?: number;
    readonly state?: LexState;
}

interface TokenizerExpect extends StepExpect {
    readonly steps?: readonly StepExpect[];
    readonly tokensByRange?: readonly SyntaxToken[];
}

/** Operationen, die erst mit dem Zeilenzustands-Cache kommen (W1-4) */
const DEFERRED_OPERATIONS: ReadonlySet<string> = new Set(['highlightAll', 'highlightEdit', 'languageFromPath']);
const DEFERRED_CASE_IDS = ['highlighter-fullHighlightStates', 'highlighter-openDollarStopsAtParagraph'];

function pairs(line: string, tokens: readonly SyntaxToken[], lineOffset = 0): Pair[] {
    return tokens.map((token) => ({
        kind: token.kind,
        text: line.slice(token.location - lineOffset, token.location - lineOffset + token.length),
    }));
}

function scan(line: string, state: LexState = NORMAL_STATE): { tokens: Pair[]; state: LexState } {
    const result = tokenizeLine(line, state);
    return { tokens: pairs(line, result.tokens), state: result.state };
}

function checkStep(line: string, result: LineTokens, expected: StepExpect, label: string): void {
    const actual = pairs(line, result.tokens);
    if (expected.tokens !== undefined) expect(actual, `${label}: tokens`).toEqual(expected.tokens);
    if (expected.state !== undefined) expect(result.state, `${label}: state`).toEqual(expected.state);
    if (expected.lastToken !== undefined) expect(actual.at(-1), `${label}: lastToken`).toEqual(expected.lastToken);
}

function runVector(testCase: SpecCase): void {
    const input = testCase.input as TokenizerInput;
    const expected = testCase.expect as TokenizerExpect;
    const label = `${testCase.id} (${testCase.name})`;
    const state = input.state ?? NORMAL_STATE;
    switch (input.op) {
        case 'tokenizeLine':
            return checkStep(input.line ?? '', tokenizeLine(input.line ?? '', state), expected, label);
        case 'tokenizeLineWithOffset': {
            const result = tokenizeLineWithOffset(input.line ?? '', input.lineOffset ?? 0, state);
            expect(result.tokens, `${label}: tokensByRange`).toEqual(expected.tokensByRange);
            return;
        }
        case 'tokenizeChain':
            return checkChain(input.lines ?? [], state, expected.steps ?? [], label);
        default:
            throw new Error(`${label}: unbekannte Operation ${input.op}`);
    }
}

function checkChain(lines: readonly string[], state: LexState, steps: readonly StepExpect[], label: string): void {
    const results = tokenizeChain(lines, state);
    expect(steps.length, `${label}: Anzahl Schritte`).toBe(lines.length);
    steps.forEach((step, index) => {
        const result = results[index];
        if (result === undefined) throw new Error(`${label}: Zeile ${index} fehlt`);
        checkStep(lines[index] ?? '', result, step, `${label}, Zeile ${index}`);
    });
}

describe('latex-tokenizer Vektoren', () => {
    const cases = loadSpec('latex-tokenizer').cases;
    for (const testCase of cases) {
        const op = (testCase.input as TokenizerInput).op;
        if (DEFERRED_OPERATIONS.has(op)) {
            it.skip(`${testCase.id}: ${testCase.name} – später (W1-4, ${op})`, () => undefined);
            continue;
        }
        it(`${testCase.id}: ${testCase.name}`, () => runVector(testCase));
    }

    it('zurückgestellt sind genau die highlight*-Fälle (W1-4)', () => {
        const deferred = cases.filter((entry) => DEFERRED_OPERATIONS.has((entry.input as TokenizerInput).op));
        expect(deferred.map((entry) => entry.id)).toEqual(DEFERRED_CASE_IDS);
    });
});

const OPEN: Pair = { kind: 'delimiter', text: '{' };
const CLOSE: Pair = { kind: 'delimiter', text: '}' };

function command(text: string): Pair {
    return { kind: 'command', text };
}

function key(text: string): Pair {
    return { kind: 'keyArgument', text };
}

function math(text: string): Pair {
    return { kind: 'math', text };
}

describe('LaTeX-Tokenizer: Unicode und Grenzfälle', () => {
    it('Umlaute und Emoji: Positionen in UTF-16', () => {
        const line = '\\section{Größe} \\ref{a😀} $ä$';
        expect(scan(line).tokens).toEqual([command('\\section'), OPEN, CLOSE, command('\\ref'), OPEN, key('a😀'), CLOSE, math('$ä$')]);
        expect(tokenizeLineWithOffset(line, 50).tokens.at(-1)).toEqual({ kind: 'math', location: 76, length: 3 });
        expect(tokenizeLine('$😀$').tokens).toEqual([{ kind: 'math', location: 0, length: 4 }]);
    });

    it('Backslash vor Nicht-ASCII ist ein Ein-Zeichen-Befehl (UTF-16-Einheit wie in Swift)', () => {
        expect(scan('\\ö').tokens).toEqual([command('\\ö')]);
        expect(tokenizeLine('\\😀x').tokens).toEqual([{ kind: 'command', location: 0, length: 2 }]);
    });

    it('leere Zeile', () => {
        expect(tokenizeLine('')).toEqual({ tokens: [], state: 'normal' });
        expect(tokenizeLine('', { math: 'doubleDollar' }).state).toBe('normal');
        expect(tokenizeLine('\r', { mathEnvironment: 'align' }).state).toBe('normal');
        expect(tokenizeLine('', { verbatimEnvironment: 'lstlisting' })).toEqual({ tokens: [], state: { verbatimEnvironment: 'lstlisting' } });
    });

    it('\\\\ als Zeilenumbruch, auch mit Abstand, vor Kommentar und in Mathe', () => {
        expect(scan('a \\\\ b').tokens).toEqual([command('\\\\')]);
        expect(scan('\\\\%c').tokens).toEqual([command('\\\\'), { kind: 'comment', text: '%c' }]);
        expect(scan('\\\\ [3pt]').tokens).toEqual([
            command('\\\\'), { kind: 'delimiter', text: '[' }, { kind: 'optionalArgument', text: '3pt' }, { kind: 'delimiter', text: ']' },
        ]);
        expect(scan('\\\\\\\\').tokens).toEqual([command('\\\\'), command('\\\\')]);
        expect(scan('$a \\\\ b$')).toEqual({ tokens: [math('$a \\\\ b$')], state: 'normal' });
    });

    it('\\% ist kein Kommentar, auch nach \\\\ und in Mathe', () => {
        expect(scan('100\\% sicher')).toEqual({ tokens: [command('\\%')], state: 'normal' });
        expect(scan('$5\\%$').tokens).toEqual([math('$5\\%$')]);
        expect(scan('\\\\\\%').tokens).toEqual([command('\\\\'), command('\\%')]);
    });

    it('verschachtelte Klammern in Schlüssel-, Prosa- und optionalen Argumenten', () => {
        expect(scan('\\label{a{b{c}}d}').tokens).toEqual([command('\\label'), OPEN, key('a{b{c}}d'), CLOSE]);
        expect(scan('\\textbf{a{b}c}').tokens).toEqual([command('\\textbf'), OPEN, OPEN, CLOSE, CLOSE]);
        expect(scan('\\cite{a\\}b}').tokens).toEqual([command('\\cite'), OPEN, key('a\\}b'), CLOSE]);
        expect(scan('\\includegraphics[a={b]c}]{x}').tokens).toEqual([
            command('\\includegraphics'), { kind: 'delimiter', text: '[' }, { kind: 'optionalArgument', text: 'a={b]c}' },
            { kind: 'delimiter', text: ']' }, OPEN, key('x'), CLOSE,
        ]);
        expect(scan('\\label{a{b}')).toEqual({ tokens: [command('\\label'), OPEN, key('a{b}')], state: 'normal' });
    });
});

describe('LaTeX-Tokenizer: Umgebungen über mehrere Zeilen', () => {
    it('\\begin{verbatim} schützt Mathe, Kommentar und fremdes \\end, auch über Leerzeilen', () => {
        const lines = ['\\begin{verbatim}', '$x$ % \\end{itemize}', '', '\\end{verbatim} $y$'];
        const results = tokenizeChain(lines);
        const verbatimState: LexState = { verbatimEnvironment: 'verbatim' };
        expect(results.map((result) => result.state)).toEqual([verbatimState, verbatimState, verbatimState, 'normal']);
        expect(pairs(lines[0] ?? '', results[0]?.tokens ?? [])).toEqual([command('\\begin'), OPEN, key('verbatim'), CLOSE]);
        expect(pairs(lines[1] ?? '', results[1]?.tokens ?? [])).toEqual([{ kind: 'verbatim', text: '$x$ % \\end{itemize}' }]);
        expect(results[2]?.tokens).toEqual([]);
        expect(pairs(lines[3] ?? '', results[3]?.tokens ?? [])).toEqual([command('\\end'), OPEN, key('verbatim'), CLOSE, math('$y$')]);
    });

    it('Verbatim in einer Zeile, comment-Umgebung als Kommentar, Optionen vor Code', () => {
        expect(scan('\\begin{verbatim}a % $\\end{verbatim}b')).toEqual({
            tokens: [command('\\begin'), OPEN, key('verbatim'), CLOSE, { kind: 'verbatim', text: 'a % $' }, command('\\end'), OPEN, key('verbatim'), CLOSE],
            state: 'normal',
        });
        const comment = tokenizeChain(['\\begin{comment}', 'text $x$', '\\end{comment}']);
        expect(pairs('text $x$', comment[1]?.tokens ?? [])).toEqual([{ kind: 'comment', text: 'text $x$' }]);
        expect(comment[2]?.state).toBe('normal');
        expect(scan('\\begin{lstlisting}[a] code').tokens).toEqual([
            command('\\begin'), OPEN, key('lstlisting'), CLOSE, { kind: 'delimiter', text: '[' }, { kind: 'optionalArgument', text: 'a' },
            { kind: 'delimiter', text: ']' }, { kind: 'verbatim', text: ' code' },
        ]);
        expect(scan('\\end{lstlisting}', { verbatimEnvironment: 'verbatim' }).state).toEqual({ verbatimEnvironment: 'verbatim' });
    });

    it('Inline-Mathe über Zeilen endet am Absatz', () => {
        const lines = ['Text $a', 'b + c', '  ', 'Neu $x$'];
        const results = tokenizeChain(lines);
        expect(results.map((result) => result.state)).toEqual([{ math: 'dollar' }, { math: 'dollar' }, 'normal', 'normal']);
        expect(results.map((result, index) => pairs(lines[index] ?? '', result.tokens))).toEqual([
            [math('$a')], [math('b + c')], [], [math('$x$')],
        ]);
    });

    it('Mathe-Umgebung mit Kommentar endet an der Leerzeile', () => {
        const lines = ['\\begin{equation}', 'a = b % Kommentar', '', 'c = d'];
        const results = tokenizeChain(lines);
        const equation: LexState = { mathEnvironment: 'equation' };
        expect(results.map((result) => result.state)).toEqual([equation, equation, 'normal', 'normal']);
        expect(pairs(lines[1] ?? '', results[1]?.tokens ?? [])).toEqual([math('a = b '), { kind: 'comment', text: '% Kommentar' }]);
        expect(results[3]?.tokens).toEqual([]);
    });

    it('\\[ … \\], $$ … $$ und \\( … \\) über Zeilen und gemischt', () => {
        expect(tokenizeChain(['\\[ x', 'y \\] z']).map((result) => result.state)).toEqual([{ math: 'bracket' }, 'normal']);
        expect(scan('y \\] z', { math: 'bracket' }).tokens).toEqual([math('y \\]')]);
        expect(scan('$$ a').state).toEqual({ math: 'doubleDollar' });
        expect(scan('b $$ c', { math: 'doubleDollar' })).toEqual({ tokens: [math('b $$')], state: 'normal' });
        expect(scan('\\( a $ b \\)')).toEqual({ tokens: [math('\\( a $ b \\)')], state: 'normal' });
        expect(scan('$$a$b$$').tokens).toEqual([math('$$a$b$$')]);
    });

    it('Mathe-Umgebung in einer Zeile, auch leer', () => {
        const endTokens = [command('\\end'), OPEN, key('equation'), CLOSE];
        expect(scan('\\begin{equation}x = 1\\end{equation} y')).toEqual({
            tokens: [command('\\begin'), OPEN, key('equation'), CLOSE, math('x = 1'), ...endTokens],
            state: 'normal',
        });
        expect(scan('\\begin{equation}\\end{equation}').tokens).toEqual([command('\\begin'), OPEN, key('equation'), CLOSE, ...endTokens]);
    });
});

describe('LaTeX-Tokenizer: Zustände', () => {
    it('statesEqual vergleicht per Wert', () => {
        expect(statesEqual('normal', 'normal')).toBe(true);
        expect(statesEqual({ math: 'dollar' }, { math: 'dollar' })).toBe(true);
        expect(statesEqual({ math: 'dollar' }, { math: 'doubleDollar' })).toBe(false);
        expect(statesEqual({ mathEnvironment: 'x' }, { verbatimEnvironment: 'x' })).toBe(false);
        expect(statesEqual({ mathEnvironment: 'align' }, { mathEnvironment: 'align*' })).toBe(false);
        expect(statesEqual('normal', { math: 'dollar' })).toBe(false);
    });

    it('gleiche Zustände sind dasselbe Objekt (Vergleich endet meist an der Identität)', () => {
        expect(tokenizeLine('$a').state).toBe(tokenizeLine('$c').state);
        expect(tokenizeLine('\\begin{align}').state).toBe(tokenizeLine('x', { mathEnvironment: 'align' }).state);
    });

    it('endsAtBlankLine nur für Mathe', () => {
        expect([NORMAL_STATE, { math: 'bracket' }, { mathEnvironment: 'gather' }, { verbatimEnvironment: 'minted' }].map(
            (state) => endsAtBlankLine(state as LexState),
        )).toEqual([false, true, true, false]);
    });
});

// MARK: Zufallsabgleich und Leistung

const RANDOM_SEED = 20261123;
const DOCUMENT_LINE_COUNT = 300;
const RANDOM_EDIT_COUNT = 500;
const MAXIMUM_DELETE_LENGTH = 24;
const MAXIMUM_SNIPPET_PARTS = 6;

const DOCUMENT_LINES = [
    'Text mit Wörtern und $x^2$ Mathe.', '\\section{Titel}', '\\label{sec:a}', '\\begin{equation}', 'a = b + c', '\\end{equation}', '',
    '\\begin{verbatim}', 'code $ % x', '\\end{verbatim}', '% Kommentar', '\\cite[S.~5]{key}', 'Ende\\\\[2mm]', '\\[ x \\]',
    '\\begin{align*}', 'a &= b \\\\', '\\end{align*}', '\\begin{comment}', '\\end{comment}', '\\verb|$|', 'Größe 😀 $a', '50\\% {a{b}}',
];
const SNIPPETS = [
    '\\', '$', '%', '{', '}', '[', ']', '&', '~', '^', '_', 'a', 'x', ' ', 'ä', '😀', '\n', '$$', '\\[', '\\]', '\\(', '\\)',
    '\\begin{equation}', '\\end{equation}', '\\begin{verbatim}', '\\end{verbatim}', '\\begin{comment}', '\\end{comment}',
    '\\begin{align*}', '\\end{align*}', '\\begin{PythonCode}', '\\end{PythonCode}', '\\label{', '\\verb|', '\\\\', '\\%',
];

/** mulberry32: kleiner Zufallsgenerator mit festem Samen, damit Fehlschläge reproduzierbar sind */
function seededRandom(seed: number): () => number {
    let value = seed >>> 0;
    return () => {
        value = (value + 0x6d2b79f5) >>> 0;
        let mixed = value;
        mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

function pick<T>(random: () => number, items: readonly T[]): T {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) throw new Error('leere Auswahl');
    return item;
}

function generateDocument(random: () => number, lineCount: number): string[] {
    return Array.from({ length: lineCount }, () => pick(random, DOCUMENT_LINES));
}

interface TextEdit {
    readonly from: number;
    readonly to: number;
    readonly insert: string;
}

function randomSnippet(random: () => number): string {
    const parts = 1 + Math.floor(random() * MAXIMUM_SNIPPET_PARTS);
    return Array.from({ length: parts }, () => pick(random, SNIPPETS)).join('');
}

/** Einfügen, Löschen, Zeile teilen oder mit der nächsten verbinden */
function randomEdit(random: () => number, text: string): TextEdit {
    const position = Math.floor(random() * (text.length + 1));
    const choice = random();
    if (choice < 0.4) return { from: position, to: position, insert: randomSnippet(random) };
    if (choice < 0.7) return { from: position, to: Math.min(text.length, position + Math.floor(random() * MAXIMUM_DELETE_LENGTH)), insert: '' };
    if (choice < 0.85) return { from: position, to: position, insert: '\n' };
    const newline = text.indexOf('\n', position);
    return newline === -1 ? { from: position, to: position, insert: '' } : { from: newline, to: newline + 1, insert: '' };
}

function countNewlines(text: string): number {
    let count = 0;
    for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) count++;
    return count;
}

/** Wie ein Zeilenzustands-Cache: ab der geänderten Zeile neu, bis der Endzustand mit dem alten übereinstimmt */
function updateIncrementally(
    cached: readonly LineTokens[],
    lines: readonly string[],
    change: { readonly firstLine: number; readonly oldLastLine: number; readonly newLastLine: number },
): { results: LineTokens[]; tokenizedLineCount: number } {
    const { firstLine, oldLastLine, newLastLine } = change;
    const shift = newLastLine - oldLastLine;
    const results = cached.slice(0, firstLine);
    let state = cached[firstLine - 1]?.state ?? NORMAL_STATE;
    let line = firstLine;
    while (line < lines.length) {
        const result = tokenizeLine(lines[line] ?? '', state);
        results.push(result);
        state = result.state;
        const old = line >= newLastLine ? cached[line - shift] : undefined;
        line++;
        if (old !== undefined && statesEqual(old.state, state)) break;
    }
    const tokenizedLineCount = line - firstLine;
    for (; line < lines.length; line++) results.push(cached[line - shift] as LineTokens);
    return { results, tokenizedLineCount };
}

function applyEdit(text: string, edit: TextEdit): { text: string; firstLine: number; oldLastLine: number; newLastLine: number } {
    const firstLine = countNewlines(text.slice(0, edit.from));
    const oldLastLine = firstLine + countNewlines(text.slice(edit.from, edit.to));
    const newLastLine = firstLine + countNewlines(edit.insert);
    return { text: text.slice(0, edit.from) + edit.insert + text.slice(edit.to), firstLine, oldLastLine, newLastLine };
}

function firstDifference(actual: readonly LineTokens[], expected: readonly LineTokens[]): number {
    if (actual.length !== expected.length) return Math.min(actual.length, expected.length);
    return actual.findIndex((result, index) => {
        const other = expected[index];
        return other === undefined || !statesEqual(result.state, other.state) || JSON.stringify(result.tokens) !== JSON.stringify(other.tokens);
    });
}

function fastestDuration(runs: number, work: () => void): number {
    let fastest = Number.POSITIVE_INFINITY;
    for (let run = 0; run < runs; run++) {
        const start = performance.now();
        work();
        fastest = Math.min(fastest, performance.now() - start);
    }
    return fastest;
}

describe('LaTeX-Tokenizer: inkrementell = komplett', () => {
    it(`${RANDOM_EDIT_COUNT} zufällige Bearbeitungen auf ${DOCUMENT_LINE_COUNT} Zeilen (Samen ${RANDOM_SEED})`, () => {
        const random = seededRandom(RANDOM_SEED);
        let text = generateDocument(random, DOCUMENT_LINE_COUNT).join('\n');
        let cached = tokenizeChain(text.split('\n'));
        let earlyStops = 0;
        for (let editNumber = 0; editNumber < RANDOM_EDIT_COUNT; editNumber++) {
            const edit = randomEdit(random, text);
            const applied = applyEdit(text, edit);
            text = applied.text;
            const lines = text.split('\n');
            const update = updateIncrementally(cached, lines, applied);
            const full = tokenizeChain(lines);
            const difference = firstDifference(update.results, full);
            expect(difference, `Bearbeitung ${editNumber} (${JSON.stringify(edit)}): erste abweichende Zeile`).toBe(-1);
            if (applied.firstLine + update.tokenizedLineCount < lines.length) earlyStops++;
            cached = update.results;
        }
        // Der Abgleich ist nur aussagekräftig, wenn die Konvergenz tatsächlich früh abbricht
        expect(earlyStops).toBeGreaterThan(RANDOM_EDIT_COUNT / 2);
    });
});

const LONG_LINE_LENGTH = 100_000;
const LONG_LINE_BUDGET_MS = 50;
const LARGE_DOCUMENT_LINE_COUNT = 10_000;
const LARGE_DOCUMENT_BUDGET_MS = 100;
const MEASUREMENT_RUNS = 5;

function repeatToLength(chunk: string, length: number): string {
    return chunk.repeat(Math.ceil(length / chunk.length)).slice(0, length);
}

describe('LaTeX-Tokenizer: Leistung', () => {
    const longLines: Record<string, string> = {
        gemischt: repeatToLength('Text \\textbf{fett} $x^2$ \\cite{a} 50\\% {a{b}} \\\\[1mm] ', LONG_LINE_LENGTH),
        offeneKlammer: `\\label${'{'.repeat(LONG_LINE_LENGTH)}`,
        offeneOption: `\\foo${'[{'.repeat(LONG_LINE_LENGTH / 2)}`,
        backslashes: '\\'.repeat(LONG_LINE_LENGTH),
        dollars: '$'.repeat(LONG_LINE_LENGTH),
        befehle: repeatToLength('\\ref{a}\\begin{x}', LONG_LINE_LENGTH),
        mathe: repeatToLength('\\alpha\\e x_1^2 ', LONG_LINE_LENGTH),
    };
    for (const [name, line] of Object.entries(longLines)) {
        it(`Zeile mit ${LONG_LINE_LENGTH} Zeichen (${name}) unter ${LONG_LINE_BUDGET_MS} ms`, () => {
            const state: LexState = name === 'mathe' ? { mathEnvironment: 'equation' } : NORMAL_STATE;
            expect(fastestDuration(MEASUREMENT_RUNS, () => tokenizeLine(line, state))).toBeLessThan(LONG_LINE_BUDGET_MS);
        });
    }

    it(`${LARGE_DOCUMENT_LINE_COUNT} Zeilen komplett unter ${LARGE_DOCUMENT_BUDGET_MS} ms`, () => {
        const lines = generateDocument(seededRandom(RANDOM_SEED), LARGE_DOCUMENT_LINE_COUNT);
        const duration = fastestDuration(MEASUREMENT_RUNS, () => tokenizeChain(lines));
        console.info(`latexTokenizer: ${LARGE_DOCUMENT_LINE_COUNT} Zeilen in ${duration.toFixed(2)} ms (schnellster von ${MEASUREMENT_RUNS})`);
        expect(duration).toBeLessThan(LARGE_DOCUMENT_BUDGET_MS);
    });
});
