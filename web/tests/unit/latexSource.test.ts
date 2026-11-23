import { describe, expect, it } from 'vitest';
import { findCommentStart, isInComment, maskComments } from '../../src/shared/core/latex/comments';
import { isCodeEnvironment, isInsideCode, isMathEnvironment, skipsContent } from '../../src/shared/core/latex/environments';
import { maskCodeEnvironments, maskVerb, scanReferences, scannable } from '../../src/shared/core/latex/masking';
import { loadSpec, type SpecCase } from '../support/specVectors';

interface SourceInput {
    readonly op: string;
    readonly line?: string;
    readonly text?: string;
    readonly lineStart?: number;
    readonly location?: number;
    readonly at?: string;
}

interface MaskingExpect {
    readonly sameUtf16Length: boolean;
    readonly contains: readonly string[];
    readonly notContains: readonly string[];
    readonly hasSuffix: string;
}

function run(testCase: SpecCase): void {
    const input = testCase.input as SourceInput;
    const expected = testCase.expect as Record<string, unknown>;
    switch (input.op) {
        case 'commentStart':
            expect(findCommentStart(input.line ?? '')).toBe(expected.offset);
            return;
        case 'masking':
            return checkMasking(input.text ?? '', testCase.expect as MaskingExpect);
        case 'isInComment':
            expect(isInComment(input.line ?? '', input.lineStart ?? 0, input.location ?? 0)).toBe(expected.isInComment);
            return;
        case 'referenceKeys':
            expect(scanReferences(input.text ?? '').map((occurrence) => occurrence.key)).toEqual(expected.keys);
            return;
        case 'isInsideCode':
            expect(input.at).toBe('end');
            expect(isInsideCode(input.text ?? '', (input.text ?? '').length)).toBe(expected.isInsideCode);
            return;
        default:
            throw new Error(`unbekannte Operation: ${input.op}`);
    }
}

function checkMasking(text: string, expected: MaskingExpect): void {
    const masked = scannable(text);
    if (expected.sameUtf16Length) expect(masked.length).toBe(text.length);
    for (const part of expected.contains) expect(masked).toContain(part);
    for (const part of expected.notContains) expect(masked).not.toContain(part);
    expect(masked.endsWith(expected.hasSuffix)).toBe(true);
}

describe('latex-source Vektoren', () => {
    for (const testCase of loadSpec('latex-source').cases) {
        it(`${testCase.id}: ${testCase.name}`, () => run(testCase));
    }
});

describe('Kommentare', () => {
    it('leere Zeile und leerer Text', () => {
        expect(findCommentStart('')).toBeNull();
        expect(maskComments('')).toBe('');
    });

    it('Offsets zählen UTF-16 (Emoji = 2 Einheiten)', () => {
        expect(findCommentStart('😀 a % b')).toBe(5);
        expect(findCommentStart('Größe 100\\% % x')).toBe(12);
    });

    it('gerade Zahl Backslashes vor % ist ein Kommentar', () => {
        expect(findCommentStart('\\\\%')).toBe(2);
        expect(findCommentStart('\\%')).toBeNull();
    });

    it('isInComment: Position auf dem % selbst gehört noch nicht dazu', () => {
        expect(isInComment('ab % c', 0, 3)).toBe(false);
        expect(isInComment('ab % c', 0, 4)).toBe(true);
    });

    it('isInComment mit Zeilenanfang mitten im Text', () => {
        expect(isInComment('x % y\nz \\% w', 6, 12)).toBe(false);
    });

    it('maskComments: \\r, \\n und \\r\\n beenden den Kommentar, Länge bleibt', () => {
        const text = 'a % x\rb % y\r\nc \\% d\ne %';
        const masked = maskComments(text);
        expect(masked).toBe('a    \rb    \r\nc \\% d\ne  ');
        expect(masked.length).toBe(text.length);
    });

    it('maskComments ohne Prozentzeichen gibt den Text unverändert zurück', () => {
        expect(maskComments('nichts\nhier')).toBe('nichts\nhier');
    });
});

describe('Maskierung', () => {
    it('\\verb mit % versteckt den Rest nicht, der Inhalt ist maskiert', () => {
        const masked = scannable('a \\verb|%| b \\ref{x}');
        expect(masked).toContain('\\ref{x}');
        expect(masked).not.toContain('%');
    });

    it('\\verb* und Länge', () => {
        const text = '\\verb*+a b+ x';
        expect(maskVerb(text)).toBe(' '.repeat(text.length - 2) + ' x');
    });

    it('\\verb ohne schließendes Trennzeichen bleibt stehen', () => {
        expect(maskVerb('\\verb|offen')).toBe('\\verb|offen');
    });

    it('Code-Umgebung wird maskiert, begin/end bleiben', () => {
        const text = 'a\n\\begin{lstlisting}\n\\ref{x} % y\n\\end{lstlisting}\n\\ref{z}';
        const masked = scannable(text);
        expect(masked.length).toBe(text.length);
        expect(masked).not.toContain('\\ref{x}');
        expect(masked).toContain('\\begin{lstlisting}');
        expect(masked).toContain('\\end{lstlisting}\n\\ref{z}');
    });

    it('nicht geschlossene Code-Umgebung reicht bis zum Textende', () => {
        expect(maskCodeEnvironments('\\begin{PythonCode}\nabc')).toBe('\\begin{PythonCode}' + ' '.repeat(4));
    });

    it('\\begin{code} im Kommentar zählt nicht', () => {
        expect(scannable('% \\begin{verbatim}\n\\ref{a}')).toContain('\\ref{a}');
    });

    it('verschachteltes \\begin in Code wird übersprungen, Text danach bleibt', () => {
        const masked = maskCodeEnvironments('\\begin{verbatim}\\begin{minted}x\\end{verbatim} ok');
        expect(masked.endsWith('\\end{verbatim} ok')).toBe(true);
    });

    it('Emoji in Code: gleiche UTF-16-Länge', () => {
        const text = '\\begin{verbatim}😀\\end{verbatim}';
        expect(maskCodeEnvironments(text).length).toBe(text.length);
    });
});

describe('Umgebungen', () => {
    it('Klassifikation', () => {
        expect(isCodeEnvironment('verbatim')).toBe(true);
        expect(isCodeEnvironment('JavaCode')).toBe(true);
        expect(isCodeEnvironment('Code')).toBe(false);
        expect(isCodeEnvironment('itemize')).toBe(false);
        expect(isMathEnvironment('align*')).toBe(true);
        expect(skipsContent('tikzpicture')).toBe(true);
        expect(skipsContent('itemize')).toBe(false);
    });

    it('isInsideCode: leerer Text, Position mitten im Text, verschachtelt', () => {
        expect(isInsideCode('', 0)).toBe(false);
        const text = '\\begin{verbatim}x\\end{verbatim} y \\begin{lstlisting}\nz';
        expect(isInsideCode(text, 10)).toBe(false);
        expect(isInsideCode(text, 17)).toBe(true);
        expect(isInsideCode(text, 34)).toBe(false);
        expect(isInsideCode(text, text.length)).toBe(true);
    });

    it('isInsideCode: Position vor dem Ende von \\begin{…} ist nicht drin', () => {
        expect(isInsideCode('\\begin{verbatim}', 8)).toBe(false);
    });
});

describe('Referenzen', () => {
    it('Zitatlisten, Optionen, Offsets in UTF-16', () => {
        const text = '😀 \\cite[S. 3]{a, b} \\nocite{*}';
        const found = scanReferences(text);
        expect(found.map((occurrence) => occurrence.key)).toEqual(['a', 'b']);
        expect(found.map((occurrence) => text.slice(occurrence.start, occurrence.end))).toEqual(['a', 'b']);
    });

    it('label, ref und hyperref', () => {
        const kinds = scanReferences('\\label{l} \\ref{l} \\hyperref[l]{t}').map((occurrence) => occurrence.kind);
        expect(kinds).toEqual(['labelDefinition', 'labelUse', 'labelUse']);
    });

    it('leerer Text', () => {
        expect(scanReferences('')).toEqual([]);
    });
});
