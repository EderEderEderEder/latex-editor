import { describe, expect, it } from 'vitest';
import { acronymDefinitions, acronymProblems } from '../../src/shared/core/latex/acronyms';
import { correctionForWordEndingAt } from '../../src/shared/core/latex/capitalization';
import { type WritingHint, writingHints } from '../../src/shared/core/latex/writingHints';
import { countWords } from '../../src/shared/core/latex/wordCounter';
import technicalWords from '../../src/shared/core/spelling/technicalWords.json';
import { getStandardVocabulary, TechnicalVocabulary } from '../../src/shared/core/spelling/technicalVocabulary';
import { loadSpec, type SpecCase } from '../support/specVectors';

// Gemeinsame Vektoren `shared/spec/writing.json` (Format: `notes` der Datei, `shared/spec/README.md`).
const EXPECTED_CASE_COUNT = 163;

type Input = Record<string, unknown> & { readonly op: string };
type Expect = Record<string, unknown>;

const spec = loadSpec('writing');

function capitalizationCorrection(text: string): string | null {
    return correctionForWordEndingAt(text, text.length)?.replacement ?? null;
}

function checkCapitalization(input: Input, expected: Expect): void {
    expect(capitalizationCorrection(String(input.text))).toBe(expected.replacement);
}

function filteredHints(input: Input): { hints: WritingHint[]; marked: string[] } {
    const text = String(input.text);
    const dropKinds = (input.dropKinds as string[] | undefined) ?? [];
    const dropMarked = input.dropMarkedContaining as string | undefined;
    const hints = writingHints(text).filter((hint) => {
        if (dropKinds.includes(hint.kind)) return false;
        return dropMarked === undefined || !text.slice(hint.start, hint.end).includes(dropMarked);
    });
    return { hints, marked: hints.map((hint) => text.slice(hint.start, hint.end)) };
}

function checkHints(input: Input, expected: Expect): void {
    const { hints, marked } = filteredHints(input);
    const kinds = hints.map((hint) => hint.kind);
    if (expected.kinds !== undefined) expect(kinds).toEqual(expected.kinds);
    if (expected.markedTexts !== undefined) expect(marked).toEqual(expected.markedTexts);
    for (const kind of (expected.kindsContain as string[] | undefined) ?? []) expect(kinds).toContain(kind);
    for (const kind of (expected.kindsNotContain as string[] | undefined) ?? []) expect(kinds).not.toContain(kind);
    for (const [index, part] of Object.entries((expected.messageContains as Record<string, string> | undefined) ?? {})) {
        expect(hints[Number(index)]?.message).toContain(part);
    }
    if (expected.sortedByLocation === true) {
        expect(hints.map((hint) => hint.start)).toEqual(hints.map((hint) => hint.start).sort((a, b) => a - b));
    }
}

function checkWordCount(input: Input, expected: Expect): void {
    const text = String(input.text).repeat(Number(input.repeat ?? 1));
    expect(countWords(text)).toBe(expected.count);
}

function checkAcronymDefinitions(input: Input, expected: Expect): void {
    const entries = acronymDefinitions(String(input.text));
    expect(entries.map((entry) => entry.key)).toEqual(expected.keys);
    const partial = (expected.entriesPartial ?? {}) as Record<string, Record<string, unknown>>;
    for (const [index, fields] of Object.entries(partial)) {
        expect(entries[Number(index)]).toMatchObject(fields);
    }
}

function checkAcronymProblems(input: Input, expected: Expect): void {
    const known = input.known === null || input.known === undefined ? null : new Set(input.known as string[]);
    const problems = acronymProblems(String(input.text), known);
    expect(problems.map((problem) => problem.key)).toEqual(expected.keys);
    if (expected.firstKind !== undefined) expect(problems[0]?.kind).toBe(expected.firstKind);
    if (expected.firstMessageContains !== undefined) expect(problems[0]?.message).toContain(String(expected.firstMessageContains));
}

function checkVocabularyAccepts(input: Input, expected: Expect): void {
    const known = new Set((input.known as string[] | undefined) ?? []);
    expect(getStandardVocabulary().accepts(String(input.word), (word) => known.has(word))).toBe(expected.accepted);
}

function checkVocabularySize(_input: Input, expected: Expect): void {
    expect(getStandardVocabulary().wordCount).toBeGreaterThan(Number(expected.wordCountGreaterThan));
}

const CHECKS: Record<string, (input: Input, expected: Expect) => void> = {
    capitalizationCorrection: checkCapitalization,
    writingHints: checkHints,
    wordCount: checkWordCount,
    acronymDefinitions: checkAcronymDefinitions,
    acronymProblems: checkAcronymProblems,
    vocabularyAccepts: checkVocabularyAccepts,
    vocabularySize: checkVocabularySize,
};

function runCase(testCase: SpecCase): void {
    const input = testCase.input as Input;
    const check = CHECKS[input.op];
    if (check === undefined) throw new Error(`Unbekannte Operation ${input.op}`);
    check(input, testCase.expect as Expect);
}

describe('Vektoren writing.json', () => {
    it('enthält alle Fälle', () => {
        expect(spec.cases).toHaveLength(EXPECTED_CASE_COUNT);
    });

    it.each(spec.cases)('$id: $name', (testCase) => runCase(testCase));
});

// Randfälle: Umlaute, ß, Zeichen außerhalb der BMP, CRLF, Befehle/Formeln/Kommentare. Die erwarteten Werte hat die
// Swift-Umsetzung für dieselben Texte geliefert (Gegenprobe außerhalb der Suite), Positionen sind UTF-16.
const CAPITALIZATION_EDGE_CASES: ReadonlyArray<readonly [string, string | null]> = [
    ['Das ist gut. über', 'Über'],
    ['Fertig! ärger', 'Ärger'],
    ['Satz. straße', 'Straße'],
    ['Satz. ßa', 'SSa'],
    ['Satz? ǆa', 'Ǆa'],
    ['Satz. u\u0308ber', 'U\u0308ber'],
    ['Satz. ÜBer', 'Über'],
    ['Satz. ÀBer', 'Àber'],
    ['Nur 𝒳. wort', null],
    ['𝒳 wort', null],
    ['Satz. 😀wort', null],
    ['Satz.\r\nwort', 'Wort'],
    ['Absatz.\r\n\r\nwort', 'Wort'],
    ['Absatz\r\n\r\nwort', 'Wort'],
    ['Text\n\nÄrger', null],
    ['Text\n\närger', 'Ärger'],
    ['\\begin{equation}a\\end{equation}\n\nwort', null],
    ['\\[ y. \\]\n\nwort', 'Wort'],
    ['Er sagte (siehe oben). wort', 'Wort'],
    ['Dr. wort', null],
    ['(wort', null],
    ['wort', null],
];

type HintExpectation = readonly [kind: string, start: number, end: number];
const HINT_EDGE_CASES: ReadonlyArray<readonly [string, readonly HintExpectation[]]> = [
    ['Das ist ist schön', [['repeatedWord', 8, 11]]],
    ['Über Über uns', [['repeatedWord', 5, 9]]],
    ['Straße Straße', [['repeatedWord', 7, 13]]],
    ['😀 ist ist 𝒳 gut', [['repeatedWord', 7, 10]]],
    ['ab 😀ist ist', [['repeatedWord', 9, 12]]],
    ['Wir gehen  nach Hause .', [['multipleSpaces', 9, 11], ['spaceBeforePunctuation', 21, 22]]],
    ['Äpfel,Birnen', [['missingSpace', 5, 6]]],
    ['ÜBer uns', [['twoInitialCapitals', 0, 4]]],
    ['Satz. ärger und mehr', [['lowercaseSentenceStart', 6, 11]]],
    ['Zeile\u2028wort ,x', [['spaceBeforePunctuation', 10, 11]]],
    ['a 😀 , b', []],
    ['Test\u00a0 ,x', []],
    // CRLF: `\r` ist kein Leerraum der Regeln (wie in Swift), Anführungszeichen vor `\r` zählen
    ['Das ist\r\nist gut', []],
    ['Satz.\r\nwort', []],
    ['Satz.\nwort', [['lowercaseSentenceStart', 6, 10]]],
    ['Er sagte "Hallo"\r\nDann', [['straightQuote', 9, 10], ['straightQuote', 15, 16]]],
    // Kommentare, Befehle, Schlüssel, Optionen, Mathe, Code, \verb
    ['% ist ist\nGut', []],
    ['Text % ist ist', []],
    ['\\ref{a  ,b} \\cite[S. 3 ,4]{x} $a  ,b$ \\usepackage{a,b}', []],
    ['\\textbf{ist ist} und \\label{ist ist}', [['repeatedWord', 12, 15]]],
    ['\\begin{equation}\na  ,b\n\\end{equation}\nDas ist ist', [['repeatedWord', 46, 49]]],
    ['\\begin{lstlisting}\nist ist ,x\n\\end{lstlisting}\nOK ok', [['repeatedWord', 50, 52]]],
    ['Wort... mehr \\verb|a  ,b| ... x', [['ellipsis', 4, 7], ['ellipsis', 26, 29]]],
    ['Das ist z.B. gut und d.h. nicht J.R. egal', [['abbreviationSpacing', 8, 12], ['abbreviationSpacing', 21, 25]]],
    // Präambel wird nie geprüft; `^` trifft auch direkt hinter \begin{document}
    ['\\documentclass{article}\nDer der der\n\\begin{document}\nOK ok', [['repeatedWord', 56, 58]]],
    ['\\begin{document}"Zitat" ok', [['straightQuote', 16, 17], ['straightQuote', 22, 23]]],
];

const WORD_COUNT_EDGE_CASES: ReadonlyArray<readonly [string, number]> = [
    ['Größe ändern', 2],
    ['Straße', 1],
    ['Über-Größe', 1],
    ['naïve Café', 2],
    ['𝒳 ist gut', 3],
    ['😀 Hallo', 1],
    ['日本語 テスト', 2],
    ['١٢٣ Zahl', 2],
    ['½ Liter und ² x', 5],
    ['a\u200bb', 2],
    ['x–y', 2],
    ["l'été d’été", 2],
    // Zerlegte Umlaute: U+0308 ist kein Wortzeichen und trennt, wie in Swift
    ['Mu\u0308ller', 2],
    ['Eins\r\nZwei\r\n\r\nDrei', 3],
    ['Text $a\r\n\r\nb$ Text', 2],
    ['Text $ offen bis Ende', 1],
    ['\\textbf{fett} \\emph{kursiv}', 2],
    ['Text $a+b$ mehr', 2],
    ['Text % Kommentar hier\nmehr', 2],
    ['\\"{o}l', 1],
    ['Stra\\ss{}e', 1],
    ['\\begin{equation}x\\end{equation} Nach', 1],
    ['\\section{Ein}\\label{x}Text', 2],
    ['\\begin{tabular}{cc} a & b \\\\ c & d \\end{tabular}', 4],
];

describe('Randfälle der Schreibhilfen', () => {
    it.each(CAPITALIZATION_EDGE_CASES)('Großschreibung %j → %j', (text, expected) => {
        expect(capitalizationCorrection(text)).toBe(expected);
    });

    it.each(HINT_EDGE_CASES)('Schreibhinweise %j', (text, expected) => {
        const found = writingHints(text).map((hint) => [hint.kind, hint.start, hint.end]);
        expect(found).toEqual(expected);
    });

    it('Schreibhinweise sind auf 1.000 begrenzt und nach Position sortiert', () => {
        const hints = writingHints('ab , '.repeat(1_500));
        expect(hints).toHaveLength(1_000);
        expect(hints.map((hint) => hint.start)).toEqual(hints.map((hint) => hint.start).sort((a, b) => a - b));
    });

    it.each(WORD_COUNT_EDGE_CASES)('Wortzähler %j → %j', (text, expected) => {
        expect(countWords(text)).toBe(expected);
    });

    it('Abkürzungen: CRLF, Zeichen außerhalb der BMP, Kommentare, fehlende Gruppen, Kürzung auf 200 Einheiten', () => {
        const [crlf] = acronymDefinitions('\\newacronym{api}{API}{Application\r\nProgramming}');
        expect(crlf).toMatchObject({ key: 'api', long: 'Application Programming', line: 1 });
        const [astral] = acronymDefinitions('😀\n\\newacronym{k}{K}{Löwe 𝒳}');
        expect(astral).toMatchObject({ line: 2, long: 'Löwe 𝒳', summary: 'K – Löwe 𝒳' });
        expect(acronymDefinitions('% \\newacronym{x}{X}{Y}\n\\newacronym{k}{K}{L}').map((entry) => [entry.key, entry.line])).toEqual([['k', 2]]);
        expect(acronymDefinitions('\\newacronym{k}{K}')[0]).toMatchObject({ short: 'K', long: '', summary: 'K' });
        expect(acronymDefinitions('\\newacronym{k}')[0]).toMatchObject({ short: '', long: '', summary: '' });
        expect(acronymDefinitions('\\newacronym{ü}{Ü}{Überfall}')[0]).toMatchObject({ key: 'ü', summary: 'Ü – Überfall' });
        expect(acronymDefinitions(`\\newacronym{a}{A}{${'ab'.repeat(150)}}`)[0]?.long).toHaveLength(200);
        const [glossary] = acronymDefinitions('\\newglossaryentry{g}{\r\n name=Gnu,\r\n description={Ein\r\n Tier}}');
        expect(glossary).toMatchObject({ short: 'Gnu', long: 'Ein Tier' });
        const [keyValue] = acronymDefinitions('\\DeclareAcronym{k}{ short = {K}, long = {Lang \\{ text} }');
        expect(keyValue).toMatchObject({ short: 'K', long: 'Lang \\{ text' });
    });
});

describe('Fachvokabular', () => {
    it('hat dieselben Wortlisten wie Swift (Rohzählung und Größe nach Kleinschreibung ohne Duplikate)', () => {
        expect([technicalWords.nouns.length, technicalWords.adjectives.length, technicalWords.verbs.length, technicalWords.names.length])
            .toEqual([4541, 209, 102, 260]);
        expect(getStandardVocabulary().wordCount).toBe(4177 + 206 + 102 + 246);
    });

    it('arbeitet mit eigenen Listen: Beugung, Mindestlängen, Duplikate, Systemwörter', () => {
        const vocabulary = new TechnicalVocabulary({ nouns: ['Qubit', 'qubit', 'Gatter'], adjectives: [], verbs: ['optimier'], names: [] });
        expect(vocabulary.wordCount).toBe(3);
        expect(vocabulary.accepts('Qubits')).toBe(true);
        expect(vocabulary.accepts('optimiert')).toBe(true);
        expect(vocabulary.accepts('Qubi')).toBe(false);
        expect(vocabulary.accepts('Qubitgatter')).toBe(true);
        expect(vocabulary.accepts('Qubithaus')).toBe(false);
        expect(vocabulary.accepts('Qubithaus', (word) => word === 'Haus')).toBe(true);
        expect(vocabulary.accepts('Qubit😀')).toBe(false);
    });
});
