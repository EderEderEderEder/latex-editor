import { describe, expect, it } from 'vitest';
import {
    INITIAL_BIB_STATE,
    bibStatesEqual,
    languageFromPath,
    tokenizeBibLine,
    type BibLexState,
    type BibToken,
} from '../../src/shared/core/bib/tokenizer';
import { loadSpec, type SpecCase } from '../support/specVectors';

interface TextToken {
    readonly kind: string;
    readonly text: string;
}

interface Highlighted {
    readonly tokens: BibToken[];
    readonly texts: TextToken[];
    readonly endStates: BibLexState[];
}

interface SpecExpectation {
    readonly tokens?: TextToken[];
    readonly tokensPrefix?: TextToken[];
    readonly tokensSuffix?: TextToken[];
    readonly tokensContain?: TextToken[];
    readonly tokensNoneContainText?: string[];
    readonly endStates?: Record<string, unknown>;
    readonly endStatesPartial?: Record<string, { bibtex: Record<string, unknown> }>;
    readonly language?: string;
}

interface SpecInput {
    readonly op: string;
    readonly source?: string;
    readonly visibleOnly?: boolean;
    readonly path?: string;
}

/** Zustandsform wie in `shared/spec/README.md` (Abschnitt „Zustände“) */
function toSpecState(state: BibLexState): unknown {
    const { phase, kind, depth, inQuotes, closesWithParenthesis } = state;
    return { bibtex: { phase, kind, depth, inQuotes, closesWithParenthesis } };
}

/** Wie `SyntaxHighlighter.highlightAll`: Zeilen an `\n` trennen, Zustand von Zeile zu Zeile weiterreichen */
function highlightAll(source: string, visibleOnly = false): Highlighted {
    const tokens: BibToken[] = [];
    const endStates: BibLexState[] = [];
    let state = INITIAL_BIB_STATE;
    let offset = 0;
    for (const line of source.split('\n')) {
        const result = tokenizeBibLine(line, offset, state);
        tokens.push(...result.tokens);
        endStates.push(result.state);
        state = result.state;
        offset += line.length + 1;
    }
    const texts = tokens
        .map((token) => ({ kind: token.kind, text: source.slice(token.from, token.to) }))
        .filter((token) => !visibleOnly || token.text.trim().length > 0);
    return { tokens, texts, endStates };
}

function checkTokenLists(highlighted: Highlighted, expectation: SpecExpectation): void {
    const { texts } = highlighted;
    if (expectation.tokens) expect(texts).toEqual(expectation.tokens);
    if (expectation.tokensPrefix) {
        expect(texts.slice(0, expectation.tokensPrefix.length)).toEqual(expectation.tokensPrefix);
    }
    if (expectation.tokensSuffix) {
        expect(texts.slice(texts.length - expectation.tokensSuffix.length)).toEqual(expectation.tokensSuffix);
    }
    for (const wanted of expectation.tokensContain ?? []) expect(texts).toContainEqual(wanted);
    for (const forbidden of expectation.tokensNoneContainText ?? []) {
        expect(texts.filter((token) => token.text.includes(forbidden))).toEqual([]);
    }
}

function checkStates(highlighted: Highlighted, expectation: SpecExpectation): void {
    for (const [line, state] of Object.entries(expectation.endStates ?? {})) {
        expect(toSpecState(highlighted.endStates[Number(line)] as BibLexState), `Zeile ${line}`).toEqual(state);
    }
    for (const [line, partial] of Object.entries(expectation.endStatesPartial ?? {})) {
        const actual = toSpecState(highlighted.endStates[Number(line)] as BibLexState) as { bibtex: unknown };
        expect(actual.bibtex, `Zeile ${line}`).toMatchObject(partial.bibtex);
    }
}

function runSpecCase(specCase: SpecCase): void {
    const input = specCase.input as SpecInput;
    const expectation = specCase.expect as SpecExpectation;
    if (input.op === 'languageFromPath') {
        expect(languageFromPath(input.path ?? '')).toBe(expectation.language);
        return;
    }
    expect(input.op).toBe('highlightAll');
    const highlighted = highlightAll(input.source ?? '', input.visibleOnly ?? false);
    checkTokenLists(highlighted, expectation);
    checkStates(highlighted, expectation);
}

describe('bib-tokenizer: Vektoren aus shared/spec', () => {
    const spec = loadSpec('bib-tokenizer');

    it('die Vektordatei hat Fälle', () => {
        expect(spec.cases.length).toBeGreaterThan(0);
    });

    it.each(spec.cases.map((specCase) => [specCase.id, specCase.name, specCase] as const))(
        '%s: %s',
        (_id, _name, specCase) => runSpecCase(specCase),
    );
});

function pairs(source: string): string[] {
    return highlightAll(source, true).texts.map((token) => `${token.kind}(${token.text})`);
}

function lastState(source: string): BibLexState {
    return highlightAll(source).endStates.at(-1) as BibLexState;
}

describe('bib-tokenizer: Randfälle', () => {
    it('Unicode: Umlaute im Schlüssel, UTF-16-Offsets mit Emoji in mehreren Zeilen', () => {
        const source = '@misc{müller2020,\n  note = {😀 \\emph{x}},\n}';
        const { tokens } = highlightAll(source);
        const key = tokens.find((token) => token.kind === 'keyArgument');
        expect(key && source.slice(key.from, key.to)).toBe('müller2020');
        const command = tokens.find((token) => token.kind === 'command' && source[token.from] === '\\');
        expect(command?.from).toBe(source.indexOf('\\emph'));
        expect(command?.to).toBe(source.indexOf('\\emph') + '\\emph'.length);
    });

    it('sehr lange Zeile: linear und mit denselben Tokens', () => {
        const longText = 'x'.repeat(200_000);
        const result = tokenizeBibLine(`@misc{k, note = {${longText}}}`, 0, INITIAL_BIB_STATE);
        expect(result.tokens.map((token) => token.kind)).toEqual([
            'command', 'delimiter', 'keyArgument', 'optionalArgument', 'delimiter', 'delimiter', 'delimiter', 'delimiter',
        ]);
        expect(result.state).toEqual(INITIAL_BIB_STATE);
    });

    it('sehr lange Zeile mit Zeichen, die nur Kommentar sind', () => {
        const result = tokenizeBibLine('a'.repeat(100_000), 5, INITIAL_BIB_STATE);
        expect(result.tokens).toEqual([{ kind: 'comment', from: 5, to: 100_005 }]);
    });

    it('unvollständige Einträge behalten ihre Phase über Zeilenenden', () => {
        expect(lastState('@book').phase).toBe('entryOpening');
        expect(lastState('@book{').phase).toBe('key');
        expect(lastState('@book{key').phase).toBe('key');
        expect(lastState('@book{key,').phase).toBe('fieldName');
        expect(lastState('@book{key, title').phase).toBe('equals');
        expect(lastState('@book{key, title =').phase).toBe('value');
        expect(pairs('@book\n{k,}')).toEqual(['command(@book)', 'delimiter({)', 'keyArgument(k)', 'delimiter(})']);
    });

    it('@Typ ohne Klammer verwirft den Eintrag, der Rest ist Kommentar', () => {
        expect(pairs('@book foo')).toEqual(['command(@book)', 'comment(foo)']);
        expect(lastState('@book foo')).toEqual(INITIAL_BIB_STATE);
    });

    it('@ ohne Namen und Text vor dem Eintrag sind Kommentar', () => {
        expect(pairs('a @ b @misc{k}')).toEqual([
            'comment(a )', 'comment(@)', 'comment(b )', 'command(@misc)', 'delimiter({)', 'keyArgument(k)', 'delimiter(})',
        ]);
    });

    it('@comment: Klammern zählen, auch über Zeilen; der Eintrag endet an der passenden Klammer', () => {
        expect(pairs('@Comment{a {b} c}')).toEqual([
            'command(@Comment)', 'delimiter({)', 'comment(a {b} c)', 'delimiter(})',
        ]);
        const lines = highlightAll('@comment{ein {\nzweiter } Teil\n}\n@misc{k}');
        expect(lines.endStates.slice(0, 3).map((state) => [state.phase, state.depth])).toEqual([
            ['comment', 2], ['comment', 1], ['outside', 0],
        ]);
        expect(lines.endStates[0]?.kind).toBe('comment');
    });

    it('@comment mit runden Klammern endet an der ersten runden Schließklammer', () => {
        expect(pairs('@comment(foo (bar) baz)')).toEqual([
            'command(@comment)', 'delimiter(()', 'comment(foo (bar)', 'delimiter())', 'comment(baz))',
        ]);
    });

    it('@string und @preamble haben keinen Schlüssel', () => {
        expect(pairs('@STRING{jan = "Januar"}')).toEqual([
            'command(@STRING)', 'delimiter({)', 'optionalArgument(jan)', 'delimiter(=)',
            'delimiter(")', 'delimiter(")', 'delimiter(})',
        ]);
        expect(pairs('@preamble{"\\foo " # {\\bar}}')).toEqual([
            'command(@preamble)', 'delimiter({)', 'delimiter(")', 'command(\\foo)', 'delimiter(")',
            'delimiter(#)', 'delimiter({)', 'command(\\bar)', 'delimiter(})', 'delimiter(})',
        ]);
    });

    it('Anführungszeichen: geschachtelte Klammern, maskiertes Zeichen, Anführungszeichen in Klammern sind Text', () => {
        expect(pairs('@misc{k, a = "x {y \\" z} w"}')).toEqual([
            'command(@misc)', 'delimiter({)', 'keyArgument(k)', 'optionalArgument(a)', 'delimiter(=)',
            'delimiter(")', 'delimiter({)', 'command(\\")', 'delimiter(})', 'delimiter(")', 'delimiter(})',
        ]);
        expect(pairs('@misc{k, a = {sagt "x" }}')).not.toContain('delimiter(")');
    });

    it('verschachtelte Klammern: Tiefe im Zustand, Wert endet erst auf oberster Ebene', () => {
        const lines = highlightAll('@misc{k, a = {1 {2 {3}\n 4} 5}\n, b = 2}');
        expect(lines.endStates.map((state) => [state.phase, state.depth])).toEqual([
            ['value', 3], ['value', 1], ['outside', 0],
        ]);
    });

    it('ein % im Wert ist Text, sonst Kommentar bis zum Zeilenende', () => {
        expect(pairs('@misc{k, a = {50 %}, % Rest\n}')).toEqual([
            'command(@misc)', 'delimiter({)', 'keyArgument(k)', 'optionalArgument(a)', 'delimiter(=)',
            'delimiter({)', 'delimiter(})', 'comment(% Rest)', 'delimiter(})',
        ]);
    });

    it('Eintrag mit runden Klammern: } auf oberster Ebene des Werts ist kein Ende', () => {
        expect(pairs('@misc(k, a = }, b = 1)')).toEqual([
            'command(@misc)', 'delimiter(()', 'keyArgument(k)', 'optionalArgument(a)', 'delimiter(=)',
            'optionalArgument(b)', 'delimiter(=)', 'delimiter())',
        ]);
    });

    it('Windows-Zeilenende am Zeilenende stört nicht', () => {
        const result = tokenizeBibLine('@book{k,\r', 0, INITIAL_BIB_STATE);
        expect(result.state.phase).toBe('fieldName');
        expect(result.tokens).toHaveLength(3);
    });

    it('unveränderter Zustand kommt als dasselbe Objekt zurück, Anfangszustand ist eingefroren', () => {
        const inValue = tokenizeBibLine('@misc{k, a = {x', 0, INITIAL_BIB_STATE).state;
        const again = tokenizeBibLine('mehr Text', 0, inValue).state;
        expect(again).toBe(inValue);
        expect(tokenizeBibLine('Freitext', 0, INITIAL_BIB_STATE).state).toBe(INITIAL_BIB_STATE);
        expect(Object.isFrozen(INITIAL_BIB_STATE)).toBe(true);
        expect(bibStatesEqual(inValue, { ...inValue })).toBe(true);
    });

    it('Tokens tragen absolute Offsets (lineOffset)', () => {
        expect(tokenizeBibLine('@a{b}', 100, INITIAL_BIB_STATE).tokens[0]).toEqual({ kind: 'command', from: 100, to: 102 });
    });

    it('languageFromPath: Endung ohne Beachtung der Schreibweise, auch Windows-Pfade', () => {
        expect(languageFromPath('C:\\Arbeit\\lit.Bib')).toBe('bibtex');
        expect(languageFromPath('/p/a.b.bib')).toBe('bibtex');
        expect(languageFromPath('/p/bib')).toBe('latex');
        expect(languageFromPath('/p/.bib')).toBe('latex');
        expect(languageFromPath('/p/x.bibx')).toBe('latex');
        expect(languageFromPath('/p.bib/main')).toBe('latex');
    });
});

// ---- Zufallsabgleich: inkrementell = komplett -------------------------------------------------------------

const RANDOM_SEED_A = 11;
const RANDOM_SEED_B = 4711;
const ENTRY_COUNT = 120;
const EDIT_COUNT = 500;
const MAX_EDIT_LENGTH = 30;
const MAX_SHARE_OF_LINES_RETOKENIZED = 0.75;
const SNIPPETS = ['', '{', '}', '"', ',', '=', '@book{', '@comment{', '\n', '#', 'x', '\\emph{', '(', ')', '% ', '😀', '@string('];
const UINT32_RANGE = 4_294_967_296;

/** Kleiner deterministischer Zufallsgenerator (mulberry32), Werte in [0, 1) */
function createRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let mixed = Math.imul(state ^ (state >>> 15), state | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        return ((mixed ^ (mixed >>> 14)) >>> 0) / UINT32_RANGE;
    };
}

interface Model {
    text: string;
    /** Endzustand je Zeile */
    states: BibLexState[];
    /** Tokens je Zeile mit zeilenrelativen Offsets (`lineOffset` 0), bleiben beim Verschieben gültig */
    tokens: BibToken[][];
}

function tokenizeFully(text: string): Model {
    const model: Model = { text, states: [], tokens: [] };
    let state = INITIAL_BIB_STATE;
    for (const line of text.split('\n')) {
        const result = tokenizeBibLine(line, 0, state);
        state = result.state;
        model.states.push(state);
        model.tokens.push(result.tokens);
    }
    return model;
}

function lineIndexOf(text: string, offset: number): number {
    let line = 0;
    for (let index = text.indexOf('\n'); index !== -1 && index < offset; index = text.indexOf('\n', index + 1)) line += 1;
    return line;
}

/** Wie `SyntaxHighlighter.update`: ab der ersten geänderten Zeile bis zur Konvergenz des Endzustands neu tokenisieren */
function applyEditIncrementally(model: Model, location: number, length: number, snippet: string): number {
    const oldText = model.text;
    const newText = oldText.slice(0, location) + snippet + oldText.slice(location + length);
    const firstLine = lineIndexOf(oldText, location);
    const removed = lineIndexOf(oldText, location + length) - firstLine + 1;
    const inserted = lineIndexOf(newText, location + snippet.length) - firstLine + 1;
    model.text = newText;
    model.states.splice(firstLine, removed, ...Array.from({ length: inserted }, () => INITIAL_BIB_STATE));
    model.tokens.splice(firstLine, removed, ...Array.from({ length: inserted }, () => [] as BibToken[]));
    return retokenizeUntilConverged(model, firstLine, firstLine + inserted);
}

function retokenizeUntilConverged(model: Model, firstLine: number, lastChangedLine: number): number {
    const lines = model.text.split('\n');
    let state = firstLine === 0 ? INITIAL_BIB_STATE : (model.states[firstLine - 1] as BibLexState);
    for (let line = firstLine; ; line += 1) {
        const previous = model.states[line] as BibLexState;
        const result = tokenizeBibLine(lines[line] as string, 0, state);
        model.states[line] = result.state;
        model.tokens[line] = result.tokens;
        state = result.state;
        const hasConverged = line >= lastChangedLine && bibStatesEqual(state, previous);
        if (hasConverged || line + 1 === lines.length) return line - firstLine + 1;
    }
}

function buildRandomSource(): string {
    const entry = (index: number): string =>
        `@book{key${index},\n\tauthor = {Nach, Vor and Zwei, Name},\n\ttitle = {Titel {\\LaTeX} ${index}},\n\tyear = ${2000 + index},\n}\n\n`;
    return Array.from({ length: ENTRY_COUNT }, (_unused, index) => entry(index)).join('');
}

function runRandomEdits(seed: number): { retokenized: number; totalLines: number } {
    const random = createRandom(seed);
    const model = tokenizeFully(buildRandomSource());
    let retokenized = 0;
    for (let editNumber = 0; editNumber < EDIT_COUNT; editNumber += 1) {
        const location = Math.floor(random() * (model.text.length + 1));
        const length = Math.floor(random() * (Math.min(model.text.length - location, MAX_EDIT_LENGTH) + 1));
        const snippet = SNIPPETS[Math.floor(random() * SNIPPETS.length)] as string;
        retokenized += applyEditIncrementally(model, location, length, snippet);
        const fresh = tokenizeFully(model.text);
        if (JSON.stringify(model.states) !== JSON.stringify(fresh.states)
            || JSON.stringify(model.tokens) !== JSON.stringify(fresh.tokens)) {
            expect(model, `Bearbeitung ${editNumber} (${location}, ${length}, ${JSON.stringify(snippet)})`).toEqual(fresh);
        }
    }
    return { retokenized, totalLines: model.states.length * EDIT_COUNT };
}

describe('bib-tokenizer: inkrementell gleich komplett neu berechnet (fester Seed)', () => {
    it.each([RANDOM_SEED_A, RANDOM_SEED_B])('Seed %i: Zustände und Tokens stimmen nach allen Bearbeitungen', (seed) => {
        const { retokenized, totalLines } = runRandomEdits(seed);
        // Offene Klammern und Anführungszeichen ändern den Zustand bis zum Dateiende (hier ca. 40 %); nur bei
        // voller Neuberechnung je Bearbeitung (100 %) hätte die Konvergenz nichts bewiesen.
        expect(retokenized / totalLines).toBeLessThan(MAX_SHARE_OF_LINES_RETOKENIZED);
    });
});
