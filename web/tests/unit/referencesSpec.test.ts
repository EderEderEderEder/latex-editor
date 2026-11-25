import { describe, expect, it } from 'vitest';
import { duplicateLabelMarks, findDuplicateLabels, type LabelEntry } from '../../src/shared/core/latex/duplicateLabels';
import { scannable } from '../../src/shared/core/latex/masking';
import {
    checkProject,
    duplicateLabelList,
    referenceProblems,
    storeCheck,
    unusedLabels,
    unusedSources,
} from '../../src/shared/core/latex/referenceCheck';
import {
    bibEntries,
    catalogLabels,
    citesEverything,
    parseBibKeys,
    type ProjectFile,
    scanAcronyms,
    scanReferences,
    usedReferences,
} from '../../src/shared/core/latex/references';
import { findUsages, MAXIMUM_EXCERPT_LENGTH, type UsageKind } from '../../src/shared/core/latex/usageFinder';
import { loadSpec, type SpecCase } from '../support/specVectors';

// Gemeinsame Vektoren `shared/spec/references.json` (Eingabe/Ausgabe je `op`: `notes` der Datei).
const EXPECTED_CASE_COUNT = 46;
const FILE_A = '/tmp/a.tex';

type Input = Record<string, any> & { readonly op: string };
type Expect = Record<string, any>;

const spec = loadSpec('references');

function rangeText(text: string, span: { start: number; end: number }): string {
    return text.slice(span.start, span.end);
}

function setOf(values: readonly string[] | null | undefined): Set<string> | null {
    return values ? new Set(values) : null;
}

function checkScan(input: Input, expected: Expect): void {
    const text = String(input.text);
    const hits = scanReferences(text);
    if (expected.kinds) expect(hits.map((hit) => hit.kind)).toEqual(expected.kinds);
    if (expected.keys) expect(hits.map((hit) => hit.key)).toEqual(expected.keys);
    if (expected.rangeTexts) expect(hits.map((hit) => rangeText(text, hit))).toEqual(expected.rangeTexts);
}

function checkProblems(text: string, problems: ReturnType<typeof referenceProblems>, expected: Expect): void {
    if (expected.keys) expect(problems.map((item) => item.key)).toEqual(expected.keys);
    if (expected.kinds) expect(problems.map((item) => item.kind)).toEqual(expected.kinds);
    if (expected.rangeTexts) expect(problems.map((item) => rangeText(text, item))).toEqual(expected.rangeTexts);
    if (expected.isEmpty !== undefined) expect(problems.length === 0).toBe(expected.isEmpty);
    if (expected.count !== undefined) expect(problems).toHaveLength(expected.count);
    if (expected.firstMessageContains) expect(problems[0]?.message).toContain(expected.firstMessageContains);
}

function checkCheck(input: Input, expected: Expect): void {
    const text = String(input.text);
    const known = { labels: new Set<string>(input.labels), citations: setOf(input.citations) };
    checkProblems(text, referenceProblems(text, known), expected);
}

function checkStoreCheck(input: Input, expected: Expect): void {
    const problems = storeCheck(String(input.fileName), String(input.text), setOf(input.knownLabels), setOf(input.knownCitations));
    expect(problems.map((item) => item.key)).toEqual(expected.problemKeys);
}

function checkBibEntries(input: Input, expected: Expect): void {
    const entries = bibEntries(String(input.text), input.withFile ? 'lit.bib' : undefined);
    if (expected.keys) expect(entries.map((entry) => entry.key)).toEqual(expected.keys);
    if (expected.lines) expect(entries.map((entry) => entry.line)).toEqual(expected.lines);
    if (expected.hasFile !== undefined) expect(entries.every((entry) => entry.file !== undefined)).toBe(expected.hasFile);
    if (expected.hasFile === false) expect(entries.some((entry) => entry.file !== undefined)).toBe(false);
}

function checkUsedSets(input: Input, expected: Expect): void {
    const used = usedReferences(input.files as ProjectFile[]);
    if (expected.usedLabels) expect([...used.usedLabels].sort()).toEqual([...expected.usedLabels].sort());
    if (expected.usedCitations) expect([...used.usedCitations].sort()).toEqual([...expected.usedCitations].sort());
    if (expected.citesEverything !== undefined) expect(used.citesEverything).toBe(expected.citesEverything);
}

function checkUnusedHints(input: Input, expected: Expect): void {
    const used = { usedLabels: new Set<string>(input.usedLabels), usedCitations: new Set<string>(input.usedCitations), citesEverything: Boolean(input.citesEverything) };
    const labels = unusedLabels(input.labels as LabelEntry[], used, Boolean(input.isLoaded));
    const sources = unusedSources(input.bibEntries as { key: string }[], used, Boolean(input.isLoaded));
    if (expected.unusedLabels) expect(labels.map((entry) => entry.label)).toEqual(expected.unusedLabels);
    if (expected.unusedSources) expect(sources.map((entry) => entry.key)).toEqual(expected.unusedSources);
}

function checkProjectCase(input: Input, expected: Expect): void {
    const result = checkProject(input.files as ProjectFile[], String(input.checkFile), input.openTexts ?? {});
    if (expected.problemKeys) expect(result.problems.map((item) => item.key)).toEqual(expected.problemKeys);
    if (expected.unusedLabels) expect(result.unusedLabels.map((entry) => entry.label)).toEqual(expected.unusedLabels);
    if (expected.unusedSources) {
        expect(result.unusedSources.map((entry) => ({ key: entry.key, file: entry.file, line: entry.line }))).toEqual(expected.unusedSources);
    }
}

function placeNumber(message: string): number {
    if (message.includes('Zeile 3')) return 3;
    return message.includes('Zeile 1') ? 1 : 0;
}

function checkDuplicateMarks(input: Input, expected: Expect): void {
    const text = String(input.text);
    const duplicates = findDuplicateLabels(input.labels as LabelEntry[]);
    const marks = duplicateLabelMarks(text, String(input.file), duplicates);
    if (expected.duplicateKeys) expect([...duplicates.keys()]).toEqual(expected.duplicateKeys);
    if (expected.count !== undefined) expect(marks).toHaveLength(expected.count);
    if (expected.severity) expect(marks.every((mark) => mark.severity === expected.severity)).toBe(true);
    if (expected.rangeTexts) expect(marks.map((mark) => rangeText(text, mark))).toEqual(expected.rangeTexts);
    if (expected.messageContains) expect(marks[0]?.message).toContain(expected.messageContains);
    if (expected.messagePlaces) expect(marks.map((mark) => placeNumber(mark.message))).toEqual(expected.messagePlaces);
}

function checkDuplicateList(input: Input, expected: Expect): void {
    const entries = duplicateLabelList(input.labels as LabelEntry[], Boolean(input.isLoaded));
    expect(entries.map((entry) => entry.line)).toEqual(expected.lines);
}

function checkUsageExcerpts(usages: ReturnType<typeof findUsages>, expected: Expect): void {
    for (const [index, text] of Object.entries(expected.excerpts ?? {})) expect(usages[Number(index)]?.excerpt).toBe(text);
    for (const [index, text] of Object.entries(expected.matchTexts ?? {})) {
        const entry = usages[Number(index)];
        expect(entry?.matchInExcerpt).not.toBeNull();
        expect(entry?.excerpt.slice(entry.matchInExcerpt?.start, entry.matchInExcerpt?.end)).toBe(text);
    }
    const first = usages[0];
    if (expected.excerptHasPrefix) expect(first?.excerpt.startsWith(expected.excerptHasPrefix)).toBe(true);
    if (expected.excerptHasSuffix) expect(first?.excerpt.endsWith(expected.excerptHasSuffix)).toBe(true);
    if (expected.excerptLengthAtMost !== undefined) expect(first?.excerpt.length).toBeLessThanOrEqual(expected.excerptLengthAtMost);
    if (expected.firstMatchText !== undefined) {
        expect(first?.matchInExcerpt).not.toBeNull();
        expect(first?.excerpt.slice(first.matchInExcerpt?.start, first.matchInExcerpt?.end)).toBe(expected.firstMatchText);
    }
}

function checkUsages(input: Input, expected: Expect): void {
    const usages = findUsages({ kind: input.kind as UsageKind, name: String(input.name) }, String(input.text), String(input.path));
    if (expected.isEmpty !== undefined) expect(usages.length === 0).toBe(expected.isEmpty);
    if (expected.count !== undefined) expect(usages).toHaveLength(expected.count);
    if (expected.lines) expect(usages.map((entry) => entry.line)).toEqual(expected.lines);
    if (expected.isDefinition) expect(usages.map((entry) => entry.isDefinition)).toEqual(expected.isDefinition);
    for (const [first, second] of (expected.differentIds ?? []) as [number, number][]) {
        expect(usages[first]?.id).not.toBe(usages[second]?.id);
    }
    if (expected.firstIsDefinition !== undefined) expect(usages[0]?.isDefinition).toBe(expected.firstIsDefinition);
    if (expected.restAreNotDefinitions) expect(usages.slice(1).every((entry) => !entry.isDefinition)).toBe(true);
    checkUsageExcerpts(usages, expected);
}

const CHECKS: Record<string, (input: Input, expected: Expect) => void> = {
    scan: checkScan,
    citesEverything: (input, expected) => expect(citesEverything(String(input.text))).toBe(expected.result),
    check: checkCheck,
    storeCheck: checkStoreCheck,
    bibEntries: checkBibEntries,
    usedSets: checkUsedSets,
    unusedHints: checkUnusedHints,
    projectCheck: checkProjectCase,
    duplicateMarks: checkDuplicateMarks,
    duplicateList: checkDuplicateList,
    usages: checkUsages,
};

function runCase(testCase: SpecCase): void {
    const input = testCase.input as Input;
    const check = CHECKS[input.op];
    if (check === undefined) throw new Error(`Unbekannte Operation ${input.op}`);
    check(input, testCase.expect as Expect);
}

describe('Vektoren references.json', () => {
    it('enthält alle Fälle', () => {
        expect(spec.cases).toHaveLength(EXPECTED_CASE_COUNT);
    });

    it.each(spec.cases)('$id: $name', (testCase) => runCase(testCase));
});

function keysOf(text: string): string[] {
    return scanReferences(text).map((hit) => hit.key);
}

describe('Verweise: Randfälle', () => {
    it('ignoriert Labels in Kommentaren, \\verb und Code-Umgebungen', () => {
        const text = [
            '% \\label{kommentar}',
            '\\verb|\\label{verb}| \\label{echt}',
            '\\begin{verbatim}\\label{code}\\end{verbatim}',
            '\\begin{minted}{python}\n\\ref{im-code}\n\\end{minted}',
            '\\begin{lstlisting}\n\\cite{nie}',
        ].join('\n');
        expect(keysOf(text)).toEqual(['echt']);
    });

    it('trennt Schlüssel mehrerer Verweise am Komma und kürzt Leerraum', () => {
        const text = '\\ref{a, b ,,c}';
        const hits = scanReferences(text);
        expect(hits.map((hit) => hit.key)).toEqual(['a', 'b', 'c']);
        expect(hits.map((hit) => text.slice(hit.start, hit.end))).toEqual(['a', 'b', 'c']);
    });

    it('trennt \\label{a,b} nicht und lässt \\hyperref[a,b] als einen Schlüssel', () => {
        expect(keysOf('\\label{a,b} \\hyperref[c,d]{Text}')).toEqual(['a,b', 'c,d']);
    });

    it('liest \\cite mit Optionen und Schlüsselliste', () => {
        const text = '\\cite[S.~3]{a,b} \\textcite[vgl.][S.~5]{c} \\cite*{d}';
        expect(keysOf(text)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('\\nocite{*} liefert keinen Schlüssel, aber citesEverything; in Kommentar und Code nicht', () => {
        expect(keysOf('\\nocite{*} \\nocite{a,*}')).toEqual(['a']);
        expect(citesEverything('x \\nocite{*}')).toBe(true);
        expect(citesEverything('% \\nocite{*}')).toBe(false);
        expect(citesEverything('\\begin{verbatim}\\nocite{*}\\end{verbatim}')).toBe(false);
        expect(citesEverything('\\nocite{ * }')).toBe(false);
    });

    it('Umlaute und Zeichen außerhalb der BMP: Bereiche sind UTF-16-Offsets', () => {
        const text = '😀 \\label{größe} äöü \\ref{größe}, \\cite{müller,😀k}';
        const hits = scanReferences(text);
        expect(hits.map((hit) => text.slice(hit.start, hit.end))).toEqual(['größe', 'größe', 'müller', '😀k']);
    });

    it('Kommentar endet an \\r\\n; \\\\% ist ein Kommentar, \\% nicht', () => {
        expect(keysOf('% \\ref{x}\r\n\\ref{y}')).toEqual(['y']);
        expect(keysOf('\\\\% \\ref{x}\n\\ref{y}')).toEqual(['y']);
        expect(keysOf('\\% \\ref{x}')).toEqual(['x']);
    });
});

describe('Verweisprüfung: Randfälle', () => {
    it('Meldungen und Bereiche mit Umlauten', () => {
        const text = '😀 \\ref{größe} \\cite{müller}';
        const problems = referenceProblems(text, { labels: new Set(), citations: new Set() });
        expect(problems.map((item) => item.message)).toEqual([
            'Das Label „größe“ ist im Projekt nicht definiert.',
            '„müller“ steht in keiner Literaturdatei des Projekts.',
        ]);
        expect(problems.map((item) => rangeText(text, item))).toEqual(['größe', 'müller']);
    });

    it('unbekannte Abkürzungen nur mit bekannter Menge; Definitionen zählen nicht', () => {
        const text = '\\newacronym{api}{API}{x} \\gls{api} \\acrshort{fehlt}';
        const known = { labels: new Set<string>(), citations: null, acronyms: new Set(['api']) };
        expect(referenceProblems(text, known).map((item) => item.key)).toEqual(['fehlt']);
        expect(referenceProblems(text, { labels: new Set(), citations: null })).toEqual([]);
    });

    it('Abkürzungen: Leerraum nach ICU (U+0085 ja, U+FEFF nein)', () => {
        expect(scanAcronyms('\\gls\u0085{api}').map((hit) => hit.key)).toEqual(['api']);
        expect(scanAcronyms('\\gls\uFEFF{api}')).toEqual([]);
        expect(scanAcronyms('\\gls[a]{ api }')).toEqual([expect.objectContaining({ key: 'api', start: 9, end: 12 })]);
    });
});

describe('Katalog: Labels und Literatur', () => {
    it('Labels je Zeile, ohne Kommentar, mehrere pro Zeile, Namen getrimmt', () => {
        const text = '\\label{a} \\label{ b }\n% \\label{c}\n\\% \\label{d}\n\\label{ }\n\\label{e} % \\label{f}';
        expect(catalogLabels(text, 'x.tex')).toEqual([
            { label: 'a', file: 'x.tex', line: 1 },
            { label: 'b', file: 'x.tex', line: 1 },
            { label: 'd', file: 'x.tex', line: 3 },
            { label: 'e', file: 'x.tex', line: 5 },
        ]);
    });

    it('Zeilen bei \\r\\n gezählt', () => {
        expect(catalogLabels('a\r\n\\label{x}\r\n', 'x.tex').map((entry) => entry.line)).toEqual([2]);
    });

    it('Einträge: @string, @comment, @preamble, Klammern und Anführungszeichen', () => {
        const text = [
            '@string{kurz = "K"}',
            '@comment{@book{nein, title={x}}}',
            '% @book{kommentar, title={x}}',
            '@preamble{"\\newcommand{\\x}{y}"}',
            '@book(rund, title = "A {B} @ C" # kurz, year = 2020)',
            '@article{Müller2020,',
            '  title = {Ein {T}itel, mit @ und Komma},',
            '  note = 12',
            '}',
        ].join('\n');
        expect(parseBibKeys(text)).toEqual(['rund', 'Müller2020']);
    });

    it('Zeilen auch bei Leerzeilen davor, CRLF und eingerückten Köpfen; Zeile 1 ohne Datei', () => {
        const text = '\r\n\r\n  @book{a,\r\n title={x}}\r\n\r\n\t@book{b, title={y}}\r\n@book{a, title={z}}';
        expect(bibEntries(text, 'l.bib').map((entry) => [entry.key, entry.line])).toEqual([['a', 3], ['b', 6], ['a', 3]]);
        expect(bibEntries(text).map((entry) => entry.line)).toEqual([1, 1, 1]);
    });

    it('Zeilenzählung: ICU erkennt U+000B und U+0085 als Zeilenende, \\r\\n als eine Einheit', () => {
        expect(bibEntries('q\nx\u0085@book{a,}\n@book{b,}', 'l.bib').map((entry) => entry.line)).toEqual([2, 3]);
        expect(bibEntries('x\n@book{a,}\r@book{b,}\r\n@book{c,}', 'l.bib').map((entry) => entry.line)).toEqual([2, 2, 3]);
    });

    it('Projektprüfung: Zitate nur, wenn es Einträge gibt; ungespeicherte Labels zählen', () => {
        const files: ProjectFile[] = [{ path: 'a.tex', text: '\\ref{x} \\cite{k}' }];
        expect(checkProject(files, 'a.tex').problems.map((item) => item.key)).toEqual(['x']);
        expect(checkProject(files, 'a.tex', { 'a.tex': '\\label{x} \\ref{x} \\cite{k}' }).problems).toEqual([]);
    });
});

describe('Verwendungen: Randfälle', () => {
    it('Befehl: \\def mit Unicode-Wortgrenze, Definition nur in Definitionszeilen', () => {
        const text = '\\def\\x{1}\n\\x \\defä \\x';
        const usages = findUsages({ kind: 'command', name: 'x' }, text, '/p/a.tex');
        expect(usages.map((entry) => entry.isDefinition)).toEqual([true, false, false]);
        expect(findUsages({ kind: 'command', name: 'def' }, text, '/p/a.tex').map((entry) => entry.isDefinition)).toEqual([true, false]);
    });

    it('Befehl: \\\\name ist ein Zeilenumbruch mit Text, \\namefoo ist ein anderer Befehl', () => {
        const usages = findUsages({ kind: 'command', name: 'tool' }, '\\\\tool \\toolbox \\tool{x}', '/p/a.tex');
        expect(usages).toHaveLength(1);
        expect(usages[0]?.matchInExcerpt).toEqual({ start: 17, end: 21 });
    });

    it('Quelle in .bib: Kommentar zählt nicht, Querverweise schon', () => {
        const text = '@book{a, title={x}}\n% @book{a, title={y}}\n@book{b, crossref = {a, c}, xref = "a"}\n';
        const usages = findUsages({ kind: 'citation', name: 'a' }, text, '/p/lit.BIB');
        expect(usages.map((entry) => entry.line)).toEqual([1, 3, 3]);
        expect(usages.map((entry) => entry.index)).toEqual([0, 0, 1]);
        expect(usages.every((entry) => entry.isDefinition)).toBe(true);
    });

    it('Quelle in .bib: @comment-Kopf und .tex-Kinds liefern nichts', () => {
        expect(findUsages({ kind: 'citation', name: 'a' }, '@comment{a, x}', '/p/l.bib')).toEqual([]);
        expect(findUsages({ kind: 'label', name: 'a' }, '@book{a,}', '/p/l.bib')).toEqual([]);
    });

    it('Umgebung: begin, end und newtheorem; Code-Blöcke zählen nicht', () => {
        const text = '\\newtheorem{satz}{Satz}\n\\begin{satz}\\end{satz}\n\\begin{verbatim}\\begin{satz}\\end{verbatim}';
        const usages = findUsages({ kind: 'environment', name: 'satz' }, text, '/p/a.tex');
        expect(usages.map((entry) => entry.line)).toEqual([1, 2, 2]);
    });

    it('Auszug mit Umlauten und Zeichen außerhalb der BMP; Einrückung entfällt', () => {
        const text = '\t  😀 äöü \\ref{ziel} ß';
        const [entry] = findUsages({ kind: 'label', name: 'ziel' }, text, '/p/a.tex');
        expect(entry?.excerpt).toBe('😀 äöü \\ref{ziel} ß');
        expect(entry?.excerpt.slice(entry.matchInExcerpt?.start, entry.matchInExcerpt?.end)).toBe('ziel');
    });

    it('Auszug langer Zeilen: Treffer vorn, mitten und hinten', () => {
        const filler = 'x '.repeat(100);
        const front = findUsages({ kind: 'label', name: 'z' }, `\\ref{z} ${filler}`, '/p/a.tex')[0];
        expect(front?.excerpt.startsWith('\\ref{z}')).toBe(true);
        expect(front?.excerpt.endsWith('…')).toBe(true);
        expect(front?.excerpt.length).toBe(MAXIMUM_EXCERPT_LENGTH + 1);
        const back = findUsages({ kind: 'label', name: 'z' }, `${filler}\\ref{z}`, '/p/a.tex')[0];
        expect(back?.excerpt.startsWith('…')).toBe(true);
        expect(back?.excerpt.endsWith('…')).toBe(false);
        expect(back?.excerpt.slice(back.matchInExcerpt?.start, back.matchInExcerpt?.end)).toBe('z');
    });
});

describe('Maskierung im Zusammenspiel', () => {
    it('benutzte Verweise zählen nur .tex und nur sichtbaren Text', () => {
        const files: ProjectFile[] = [
            { path: 'a.tex', text: '\\ref{a} % \\ref{b}\n\\begin{verbatim}\\ref{c}\\end{verbatim}' },
            { path: 'l.bib', text: '\\ref{d}' },
        ];
        expect([...usedReferences(files).usedLabels]).toEqual(['a']);
        expect(scannable('\\ref{a} % x').length).toBe('\\ref{a} % x'.length);
    });
});
