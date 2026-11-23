import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scannable } from '../../src/shared/core/latex/masking';
import { MAXIMUM_MARK_COUNT, checkSyntax, syntaxMarks, type TextMark } from '../../src/shared/core/latex/syntaxChecker';
import { loadSpec, specDirectory, type SpecCase } from '../support/specVectors';

interface SyntaxInput {
    readonly text: string;
}

interface SyntaxExpect {
    readonly count?: number;
    readonly allSeverity?: string;
    readonly firstLocation?: number;
    readonly foundTexts?: readonly string[];
    readonly firstMessageContains?: string;
}

function checkCase(testCase: SpecCase): void {
    const { text } = testCase.input as SyntaxInput;
    const expected = testCase.expect as SyntaxExpect;
    const marks = syntaxMarks(scannable(text));
    const message = `${testCase.id}: ${testCase.name}`;
    if (expected.count !== undefined) expect(marks.length, message).toBe(expected.count);
    if (expected.allSeverity !== undefined) {
        expect(marks.every((mark) => mark.severity === expected.allSeverity), message).toBe(true);
    }
    if (expected.firstLocation !== undefined) expect(marks[0]?.start, message).toBe(expected.firstLocation);
    for (const needle of expected.foundTexts ?? []) {
        const found = marks.some((mark) => text.slice(mark.start, mark.end) === needle);
        expect(found, `${message}: keine Markierung über „${needle}“`).toBe(true);
    }
    if (expected.firstMessageContains !== undefined) {
        expect(marks[0]?.message, message).toContain(expected.firstMessageContains);
    }
}

describe('Syntaxprüfer: Vektoren (shared/spec/syntax-checker.json)', () => {
    const spec = loadSpec('syntax-checker');

    it('lädt alle 13 Fälle', () => {
        expect(spec.cases).toHaveLength(13);
    });

    for (const testCase of spec.cases) {
        it(`${testCase.id}: ${testCase.name}`, () => checkCase(testCase));
    }
});

describe('Syntaxprüfer: weitere Eigenschaften', () => {
    it('Obergrenze ist 200', () => {
        expect(MAXIMUM_MARK_COUNT).toBe(200);
        expect(checkSyntax('}'.repeat(500))).toHaveLength(MAXIMUM_MARK_COUNT);
    });

    it('Markierungen sind nach Position sortiert', () => {
        const marks = checkSyntax('\\textbf{a}}\n\\emph{b\n');
        expect(marks.map((mark) => mark.start)).toEqual([10, 17]);
    });

    it('checkSyntax maskiert selbst: Kommentare und Code zählen nicht', () => {
        expect(checkSyntax('% { offen\n\\begin{lstlisting}\n{ }}\n\\end{lstlisting}\n\\verb|}|\n')).toEqual([]);
    });

    it('Falsch verschachtelte Umgebung nennt Zeile des \\end', () => {
        const [mark] = checkSyntax('\\begin{a}\n\\begin{b}\n\\end{a}');
        expect(mark?.message).toContain('Zeile 3');
    });
});

const DEMO_SOURCE = join(specDirectory(), '..', 'Testdaten', 'HgbDemo');
const CHECKED_EXTENSIONS: readonly string[] = ['.tex', '.cls', '.sty'];

function collectFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return collectFiles(path);
        return CHECKED_EXTENSIONS.some((extension) => entry.name.endsWith(extension)) ? [path] : [];
    });
}

describe.skipIf(!existsSync(DEMO_SOURCE))('Syntaxprüfer: Demo-Projekt (Kopie)', () => {
    const copyRoot = existsSync(DEMO_SOURCE) ? mkdtempSync(join(tmpdir(), 'syntax-demo-')) : '';
    afterAll(() => {
        if (copyRoot !== '') rmSync(copyRoot, { recursive: true, force: true });
    });

    it('0 Fehlalarme in allen .tex/.cls/.sty-Dateien', () => {
        const copy = join(copyRoot, 'HgbDemo');
        cpSync(DEMO_SOURCE, copy, { recursive: true });
        const files = collectFiles(copy);
        expect(files.length).toBeGreaterThan(0);
        const problems: string[] = [];
        for (const file of files) {
            const text = readFileSync(file, 'utf8');
            const describeMark = (mark: TextMark): string => `${file.slice(copy.length)}:${mark.start} ${text.slice(mark.start, mark.end)} – ${mark.message}`;
            problems.push(...checkSyntax(text).map(describeMark));
        }
        expect(problems).toEqual([]);
    });
});
