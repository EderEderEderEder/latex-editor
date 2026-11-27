import { describe, expect, it } from 'vitest';
import { layoutDiffRows, type DiffRow } from '../../src/shared/core/diff/diffLayout';
import { applyEditScript, reconstructFromDiff } from '../../src/shared/core/diff/diffProperties';
import { editScript } from '../../src/shared/core/diff/editScript';
import {
    computeLineDiff,
    diffLineText,
    MAXIMUM_LINE_EDITS,
    type DiffLine,
} from '../../src/shared/core/diff/lineDiff';
import { splitLines } from '../../src/shared/core/diff/splitLines';
import { codePointLength, tokenize } from '../../src/shared/core/diff/tokenize';
import { loadSpec, type SpecCase } from '../support/specVectors';

// Gemeinsame Vektoren `shared/spec/line-diff.json` (Format: `notes` der Datei, `shared/spec/README.md`).
const EXPECTED_CASE_COUNT = 20;
const RANDOM_CASE_COUNT = 600;
const RANDOM_SEED = 20_261_127;
const MAX_RANDOM_LINES = 30;
const MAX_RANDOM_MUTATIONS = 8;
const MUTATION_KINDS = 3;
const PRNG_RANGE = 0x1_0000_0000;
const PRNG_INCREMENT = 0x6d2b79f5;
const PRNG_SHIFT_A = 15;
const PRNG_SHIFT_B = 7;
const PRNG_SHIFT_C = 14;
const PRNG_MIX = 61;
const PERFORMANCE_LINE_COUNT = 5000;
const PERFORMANCE_CHANGE_STEP = 500;
const PERFORMANCE_BUDGET_MS = 100;
const PERFORMANCE_RUNS = 3;
const HUGE_LINE_COUNT = 20_000;
const LONG_LINE_WORDS = 20_000;

type Input = Record<string, unknown> & { readonly op: string };
type Expect = Record<string, unknown>;

const spec = loadSpec('line-diff');

// ---------- Hilfen ----------

const KIND_SIGN: Record<DiffLine['kind'], string> = { context: ' ', removed: '-', added: '+' };

function rendered(lines: readonly DiffLine[]): string[] {
    return lines.map((line) => KIND_SIGN[line.kind] + diffLineText(line));
}

function countKind(lines: readonly DiffLine[], kind: DiffLine['kind']): number {
    return lines.filter((line) => line.kind === kind).length;
}

function trimBlanks(text: string): string {
    return text.replace(/^[ \t]+|[ \t]+$/g, '');
}

/** Einfache LCS-Länge mit dynamischer Programmierung (Referenz) */
function lcsLength(a: readonly string[], b: readonly string[]): number {
    let previous = new Array<number>(b.length + 1).fill(0);
    for (const x of a) {
        const current = new Array<number>(b.length + 1).fill(0);
        b.forEach((y, j) => {
            current[j + 1] = x === y ? (previous[j] as number) + 1 : Math.max(previous[j + 1] as number, current[j] as number);
        });
        previous = current;
    }
    return previous[b.length] as number;
}

/** Kleiner Zufallsgenerator (mulberry32), Ergebnis in [0, 1) */
function makeRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + PRNG_INCREMENT) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> PRNG_SHIFT_A), t | 1);
        t ^= t + Math.imul(t ^ (t >>> PRNG_SHIFT_B), t | PRNG_MIX);
        return ((t ^ (t >>> PRNG_SHIFT_C)) >>> 0) / PRNG_RANGE;
    };
}

function mirroredSegments(line: DiffLine): void {
    expect(line.segments.length).toBeGreaterThan(0);
    line.segments.forEach((segment, index) => {
        if (line.segments.length > 1) expect(segment.text.length).toBeGreaterThan(0);
        if (index > 0) expect(segment.isChanged).not.toBe(line.segments[index - 1]?.isChanged);
    });
}

// ---------- Vektoren ----------

function checkCompute(input: Input, expected: Expect): void {
    const lines = computeLineDiff(String(input.old), String(input.new));
    if (expected.rendered !== undefined) expect(rendered(lines)).toEqual(expected.rendered);
    if (expected.oldNumbers !== undefined) expect(lines.map((line) => line.oldNumber)).toEqual(expected.oldNumbers);
    if (expected.newNumbers !== undefined) expect(lines.map((line) => line.newNumber)).toEqual(expected.newNumbers);
    if (expected.removedCount !== undefined) expect(countKind(lines, 'removed')).toBe(expected.removedCount);
    if (expected.addedCount !== undefined) expect(countKind(lines, 'added')).toBe(expected.addedCount);
    if (expected.contextCount !== undefined) expect(countKind(lines, 'context')).toBe(expected.contextCount);
    if (expected.texts !== undefined) expect(lines.map(diffLineText)).toEqual(expected.texts);
    checkChangedTexts(lines, expected);
    if (expected.everyLineSingleUnchangedSegment === true) {
        for (const line of lines) expect(line.segments).toEqual([{ text: diffLineText(line), isChanged: false }]);
    }
}

function changedTexts(line: DiffLine | undefined): string[] {
    return (line?.segments ?? []).filter((segment) => segment.isChanged).map((segment) => segment.text);
}

function checkChangedTexts(lines: readonly DiffLine[], expected: Expect): void {
    for (const [key, texts] of Object.entries((expected.changedTexts ?? {}) as Record<string, string[]>)) {
        expect(changedTexts(lines[Number(key)])).toEqual(texts);
    }
    for (const [key, texts] of Object.entries((expected.changedTextsTrimmed ?? {}) as Record<string, string[]>)) {
        expect(changedTexts(lines[Number(key)]).map(trimBlanks)).toEqual(texts);
    }
}

function checkSplitLines(input: Input, expected: Expect): void {
    expect(splitLines(String(input.text))).toEqual(expected.lines);
}

function checkTokenize(input: Input, expected: Expect): void {
    const tokens = tokenize(String(input.text));
    expect(tokens).toEqual(expected.tokens);
    expect(tokens.join('')).toBe(input.text);
}

function checkEditScript(input: Input, expected: Expect): void {
    const old = input.old as string[];
    const next = input.new as string[];
    const script = editScript(old, next, Number(input.maxEdits));
    expect(script.removed).toHaveLength(Number(expected.removedLength));
    expect(script.inserted).toHaveLength(Number(expected.insertedLength));
    if (expected.keptSubsequencesEqual === true) {
        expect(old.filter((_, index) => !script.removed[index])).toEqual(next.filter((_, index) => !script.inserted[index]));
    }
}

function checkDiffProperties(input: Input, expected: Expect): void {
    const oldLines = splitLines(String(input.old));
    const newLines = splitLines(String(input.new));
    const lines = computeLineDiff(String(input.old), String(input.new));
    const rebuilt = reconstructFromDiff(lines);
    if (expected.reconstructsOld === true) expect(rebuilt.old).toEqual(oldLines);
    if (expected.reconstructsNew === true) expect(rebuilt.new).toEqual(newLines);
    if (expected.contextCountEqualsLcs === true) expect(countKind(lines, 'context')).toBe(lcsLength(oldLines, newLines));
}

/** Vektorschreibweise einer Zeile: `{line}` oder `{collapsed: {start, count}}` */
function vectorRow(row: DiffRow): unknown {
    return row.kind === 'line' ? { line: row.index } : { collapsed: { start: row.start, count: row.count } };
}

function checkLayoutRows(input: Input, expected: Expect): void {
    const lines = [...String(input.kinds)].map((sign) => ({ kind: sign === '+' ? 'added' : sign === '-' ? 'removed' : 'context' }) as const);
    const rows = layoutDiffRows(lines, 3, new Set((input.expanded ?? []) as number[])).map(vectorRow);
    if (expected.first !== undefined) expect(rows[0]).toEqual(expected.first);
    if (expected.rowCount !== undefined) expect(rows).toHaveLength(Number(expected.rowCount));
    for (const row of (expected.contains ?? []) as unknown[]) expect(rows).toContainEqual(row);
    const suffix = (expected.suffix ?? []) as unknown[];
    if (suffix.length > 0) expect(rows.slice(-suffix.length)).toEqual(suffix);
}

const CHECKS: Record<string, (input: Input, expected: Expect) => void> = {
    compute: checkCompute,
    splitLines: checkSplitLines,
    tokenize: checkTokenize,
    editScript: checkEditScript,
    layoutRows: checkLayoutRows,
    diffProperties: checkDiffProperties,
};

function runCase(testCase: SpecCase): void {
    const input = testCase.input as Input;
    const check = CHECKS[input.op];
    if (check === undefined) throw new Error(`Unbekannte Operation ${input.op}`);
    check(input, testCase.expect as Expect);
}

describe('Vektoren line-diff.json', () => {
    it('enthält alle Fälle', () => {
        expect(spec.cases).toHaveLength(EXPECTED_CASE_COUNT);
    });

    it.each(spec.cases)('$id: $name', (testCase) => runCase(testCase));
});

// ---------- Zufallsfälle gegen LCS-Referenz ----------

const ALPHABET = ['a', 'b', 'c', '\\item x', '', 'Satz eins.', 'Satz zwei.', 'Größe 😀'];

function randomInt(random: () => number, upperExclusive: number): number {
    return Math.floor(random() * upperExclusive);
}

function randomLine(random: () => number): string {
    return ALPHABET[randomInt(random, ALPHABET.length)] as string;
}

function mutate(lines: string[], random: () => number): void {
    const position = randomInt(random, lines.length + 1);
    const kind = randomInt(random, MUTATION_KINDS);
    if (kind === 0) lines.splice(position, 0, randomLine(random));
    else if (kind === 1) lines.splice(position, 1);
    else if (position < lines.length) lines[position] = randomLine(random);
}

/** Jede Zeile mit eigenem Umbruch (LF oder CRLF gemischt); `splitLines` muss die Zeilen zurückliefern */
function joinWithMixedBreaks(lines: readonly string[], random: () => number): string {
    return lines.map((line) => line + (random() < 0.5 ? '\n' : '\r\n')).join('');
}

function randomPair(random: () => number): { old: string[]; next: string[] } {
    const old = Array.from({ length: randomInt(random, MAX_RANDOM_LINES + 1) }, () => randomLine(random));
    const next = [...old];
    for (let count = randomInt(random, MAX_RANDOM_MUTATIONS + 1); count > 0; count -= 1) mutate(next, random);
    return { old, next };
}

function checkRandomCase(random: () => number): void {
    const { old, next } = randomPair(random);
    const oldText = joinWithMixedBreaks(old, random);
    const newText = joinWithMixedBreaks(next, random);
    expect(splitLines(oldText)).toEqual(old);
    expect(splitLines(newText)).toEqual(next);

    const lines = computeLineDiff(oldText, newText);
    const rebuilt = reconstructFromDiff(lines);
    expect(rebuilt.old).toEqual(old);
    expect(rebuilt.new).toEqual(next);
    expect(countKind(lines, 'context')).toBe(lcsLength(old, next));
    lines.forEach(mirroredSegments);

    const script = editScript(old, next, MAXIMUM_LINE_EDITS);
    expect(applyEditScript(old, next, script)).toEqual(next);
    expect(script.removed.filter((flag) => !flag).length).toBe(lcsLength(old, next));
}

describe('Zufallsfälle gegen LCS-Referenz', () => {
    it(`${RANDOM_CASE_COUNT} Fälle: Skript führt alt in neu über, gemeinsame Zeilen = LCS`, () => {
        const random = makeRandom(RANDOM_SEED);
        for (let count = 0; count < RANDOM_CASE_COUNT; count += 1) checkRandomCase(random);
    });
});

// ---------- Randfälle ----------

describe('Randfälle', () => {
    it('leere und identische Eingaben', () => {
        expect(computeLineDiff('', '')).toEqual([]);
        expect(computeLineDiff('a\nb\n', 'a\nb\n').every((line) => line.kind === 'context')).toBe(true);
        expect(rendered(computeLineDiff('x', 'x'))).toEqual([' x']);
        expect(rendered(computeLineDiff('\n', ''))).toEqual(['-']);
        expect(editScript([], [], MAXIMUM_LINE_EDITS)).toEqual({ removed: [], inserted: [] });
    });

    it('nur Anfügen und nur Löschen', () => {
        expect(rendered(computeLineDiff('a\nb\n', 'a\nb\nc\nd\n'))).toEqual([' a', ' b', '+c', '+d']);
        expect(rendered(computeLineDiff('a\nb\nc\nd\n', 'a\nb\n'))).toEqual([' a', ' b', '-c', '-d']);
        expect(rendered(computeLineDiff('b\n', 'a\nb\n'))).toEqual(['+a', ' b']);
        expect(rendered(computeLineDiff('a\nb\n', 'b\n'))).toEqual(['-a', ' b']);
    });

    it('CRLF und LF gemischt gelten als gleiche Zeilen, ein einzelnes CR mitten in der Zeile bleibt', () => {
        expect(rendered(computeLineDiff('a\r\nb\nc\r\n', 'a\nb\r\nc\n'))).toEqual([' a', ' b', ' c']);
        expect(splitLines('a\rb\r\n')).toEqual(['a\rb']);
        expect(splitLines('\r')).toEqual(['']);
        expect(splitLines('\n')).toEqual(['']);
        expect(splitLines('a\r\n\r\n')).toEqual(['a', '']);
    });

    it('Tokenizer: Zeichen außerhalb der BMP, kombinierende Zeichen, Leerraum', () => {
        expect(tokenize('𝒜x 😀😀')).toEqual(['𝒜x', ' ', '😀', '😀']);
        expect(tokenize('éa')).toEqual(['éa']);
        expect(tokenize('\\größe\\é1')).toEqual(['\\größe', '\\é', '1']);
        expect(tokenize(' \t x')).toEqual([' \t ', 'x']);
        expect(tokenize('')).toEqual([]);
        expect(codePointLength('a😀𝒜ö')).toBe(4);
    });

    it('Wort-Hervorhebung mit Zeichen außerhalb der BMP', () => {
        const lines = computeLineDiff('Hallo 😀 Welt\n', 'Hallo 😀 Erde\n');
        expect(lines.map((line) => changedTexts(line))).toEqual([['Welt'], ['Erde']]);
    });

    it('sehr lange Zeilen: Hervorhebung bleibt korrekt und schnell', () => {
        const words = Array.from({ length: LONG_LINE_WORDS }, (_, index) => `w${index}`);
        const changed = [...words];
        changed[LONG_LINE_WORDS / 2] = 'GEÄNDERT';
        const lines = computeLineDiff(words.join(' '), changed.join(' '));
        expect(lines.map(changedTexts)).toEqual([[`w${LONG_LINE_WORDS / 2}`], ['GEÄNDERT']]);
        expect(reconstructFromDiff(lines).new).toEqual([changed.join(' ')]);
    });

    it('sehr lange Zeile mit vielen Änderungen: über der Wortgrenze gilt der Bereich als ersetzt, Text bleibt erhalten', () => {
        const oldLine = Array.from({ length: LONG_LINE_WORDS }, (_, index) => `a${index}`).join(' ');
        const newLine = Array.from({ length: LONG_LINE_WORDS }, (_, index) => `b${index}`).join(' ');
        const lines = computeLineDiff(oldLine, newLine);
        expect(lines.map(diffLineText)).toEqual([oldLine, newLine]);
    });

    it('Myers-Grenze: genau D Schritte noch minimal, einer weniger erlaubt ersetzt den Bereich', () => {
        const old = ['a', 'b'];
        const next = ['b', 'a'];
        const atLimit = editScript(old, next, 2);
        expect(atLimit.removed.filter(Boolean)).toHaveLength(1);
        const belowLimit = editScript(old, next, 1);
        expect(belowLimit.removed).toEqual([true, true]);
        expect(belowLimit.inserted).toEqual([true, true]);
        expect(applyEditScript(old, next, atLimit)).toEqual(next);
        expect(applyEditScript(old, next, belowLimit)).toEqual(next);
        expect(editScript(old, next, 0).removed).toEqual([true, true]);
    });

    it('Prefix, Suffix und Zeilen ohne Gegenstück werden auch über der Grenze nicht ersetzt', () => {
        const old = ['p', 'x', 'b', 'a', 'q'];
        const next = ['p', 'y', 'a', 'b', 'q'];
        const script = editScript(old, next, 0);
        expect(script.removed).toEqual([false, true, true, true, false]);
        expect(script.inserted).toEqual([false, true, true, true, false]);
    });
});

// ---------- Leistung ----------

function numberedLines(count: number, label: string): string[] {
    return Array.from({ length: count }, (_, index) => `${label} ${index}`);
}

function elapsedMs(work: () => void): number {
    const start = performance.now();
    work();
    return performance.now() - start;
}

describe('Leistung', () => {
    it(`${PERFORMANCE_LINE_COUNT} Zeilen mit wenigen Änderungen in unter ${PERFORMANCE_BUDGET_MS} ms`, () => {
        const old = numberedLines(PERFORMANCE_LINE_COUNT, 'Zeile');
        const next = [...old];
        for (let index = 0; index < PERFORMANCE_LINE_COUNT; index += PERFORMANCE_CHANGE_STEP) next[index] = `geändert ${index}`;
        const oldText = old.join('\n');
        const newText = next.join('\n');
        let lines: DiffLine[] = [];
        const times = Array.from({ length: PERFORMANCE_RUNS }, () => elapsedMs(() => { lines = computeLineDiff(oldText, newText); }));
        expect(Math.min(...times)).toBeLessThan(PERFORMANCE_BUDGET_MS);
        expect(countKind(lines, 'removed')).toBe(PERFORMANCE_LINE_COUNT / PERFORMANCE_CHANGE_STEP);
        expect(reconstructFromDiff(lines).new).toEqual(next);
    });

    it(`vollständig unterschiedlicher Text mit ${HUGE_LINE_COUNT} Zeilen`, () => {
        const old = numberedLines(HUGE_LINE_COUNT, 'alt');
        const next = numberedLines(HUGE_LINE_COUNT, 'neu');
        const lines = computeLineDiff(old.join('\n'), next.join('\n'));
        expect(countKind(lines, 'context')).toBe(0);
        expect(lines).toHaveLength(2 * HUGE_LINE_COUNT);
    });

    it(`${HUGE_LINE_COUNT} gleiche Zeilen in umgekehrter Reihenfolge brechen über der Grenze ab`, () => {
        const old = numberedLines(HUGE_LINE_COUNT, 'Zeile');
        const next = [...old].reverse();
        let lines: DiffLine[] = [];
        const duration = elapsedMs(() => { lines = computeLineDiff(old.join('\n'), next.join('\n'), { highlightingWords: false }); });
        expect(duration).toBeLessThan(5000);
        expect(countKind(lines, 'context')).toBe(0);
        const rebuilt = reconstructFromDiff(lines);
        expect(rebuilt.old).toEqual(old);
        expect(rebuilt.new).toEqual(next);
    });
});
