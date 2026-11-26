import { describe, expect, it } from 'vitest';
import { ENVIRONMENTS } from '../../src/shared/core/completion/catalog';
import {
    adjustBlock,
    bibEntriesInText,
    CODE_LANGUAGES,
    type CodeSettings,
    createCodeSettings,
    createEquationSettings,
    createImageSettings,
    createListSettings,
    createTableSettings,
    cursorLineNumber,
    DEFAULT_CODE_ENVIRONMENT,
    escapeLatex,
    fillTableFromTabSeparated,
    generateCitation,
    generateCode,
    generateEquation,
    generateImage,
    generateList,
    generateReference,
    generateTable,
    graphicsDirectories,
    graphicsReference,
    type CitationSettings,
    type InsertionContext,
    insertionLines,
    labelsInText,
    makeInsertionContext,
    resizeList,
    resizeTable,
    type ReferenceSettings,
    sanitizedName,
    slugOf,
    type TableSettings,
    uniqueLabel,
    widthText,
} from '../../src/shared/core/insertion';
import { loadSpec } from '../support/specVectors';

// Gemeinsame Vektoren `shared/spec/insertion.json` (Format: `notes` der Datei, `shared/spec/README.md`).
const EXPECTED_CASE_COUNT = 69;
const EXPECTED_LANGUAGE_COUNT = 27;
const MAXIMUM_SLUG_LENGTH = 40;
const LONG_NAME_LENGTH = 5000;

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Handler = (input: Obj) => Obj;

const spec = loadSpec('insertion');

function tableOf(input: Obj): TableSettings {
    return createTableSettings(input.settings as Partial<TableSettings>);
}

function tableShape(table: TableSettings): Obj {
    return {
        rows: table.rows,
        columns: table.columns,
        cells: table.cells,
        alignments: table.alignments,
        cellRowCount: table.cells.length,
        cellColumnCount: table.cells[0]?.length,
    };
}

function contextOf(input: Obj): InsertionContext {
    return makeInsertionContext(input.text, input.selection, input.fileName);
}

function linesOf(input: Obj): Obj {
    const lines = insertionLines(contextOf(input), input.code, input.isBlock, input.replacesSelection);
    const firstNew = lines.find((line) => line.isNew);
    return {
        lines,
        firstNewLineText: firstNew?.text,
        linesContainText: lines.map((line) => line.text),
        isNewByText: (names: string[]) => Object.fromEntries(names.map((name) => [name, lines.find((line) => line.text === name)?.isNew])),
    };
}

function languagesOf(): Obj {
    const environments = CODE_LANGUAGES.map((language) => language.environment);
    return {
        languages: CODE_LANGUAGES,
        environments,
        defaultEnvironment: DEFAULT_CODE_ENVIRONMENT,
        allEndWithCode: environments.every((name) => name.endsWith('Code')),
        unique: new Set(environments).size === environments.length,
    };
}

const handlers: Record<string, Handler> = {
    escape: (input) => ({ text: escapeLatex(input.text) }),
    slug: (input) => ({ slug: slugOf(input.text), slugLength: slugOf(input.text).length }),
    label: (input) => ({ label: uniqueLabel(input.prefix, input.caption, input.fallback, new Set(input.existing)) }),
    blockPlacement: (input) => ({ result: adjustBlock(input.block, input.text, input.range) }),
    table: (input) => ({ output: generateTable(tableOf(input), input.label) }),
    tableResize: (input) => tableShape(resizeTable(tableOf(input), input.rows, input.columns)),
    fillTabSeparated: (input) => tableShape(fillTableFromTabSeparated(tableOf(input), input.text)),
    widthText: (input) => ({ text: widthText(input.percent) }),
    image: (input) => ({ output: generateImage(createImageSettings(input.settings), input.reference, input.label) }),
    code: (input) => ({ output: generateCode(createCodeSettings(input.settings as Partial<CodeSettings>), input.label) }),
    codeLanguages: () => languagesOf(),
    equation: (input) => ({ output: generateEquation(createEquationSettings(input.settings), input.label) }),
    list: (input) => ({ output: generateList(createListSettings(input.settings)) }),
    listResize: (input) => {
        const resized = resizeList(createListSettings({ items: input.items }), input.count);
        return { itemCount: resized.items.length, itemsPrefix: resized.items.slice(0, input.items.length + 1) };
    },
    reference: (input) => ({ text: generateReference(input as unknown as ReferenceSettings) }),
    citation: (input) => ({ text: generateCitation(input as unknown as CitationSettings) }),
    labels: (input) => ({ entries: labelsInText(input.text).map(({ label, line }) => ({ label, line })) }),
    bibEntries: (input) => ({ entries: bibEntriesInText(input.text).map(({ key, title }) => ({ key, title })) }),
    graphicsDirectories: (input) => ({ directories: graphicsDirectories(input.text) }),
    graphicsReference: (input) => ({ path: graphicsReference(input.file, input.projectRoot, input.graphicsDirectories) }),
    sanitizedName: (input) => ({ name: sanitizedName(input.filename) }),
    insertionContext: (input) => {
        const context = contextOf(input);
        return { ...context, cursorLineNumber: cursorLineNumber(context) };
    },
    insertionLines: (input) => linesOf(input),
};

function occurrences(text: string, part: string): number {
    return text.split(part).length - 1;
}

/** Prüft alle Schlüssel von `expected` gegen `actual` (fehlende Schlüssel in `expected` werden nicht geprüft) */
function assertExpectation(actual: Obj, expected: Obj): void {
    for (const [key, value] of Object.entries(expected)) {
        if (key === 'startsWith') expect(actual.output.startsWith(value)).toBe(true);
        else if (key === 'contains') for (const part of value) expect(actual.output).toContain(part);
        else if (key === 'notContains') for (const part of value) expect(actual.output).not.toContain(part);
        else if (key === 'occurrences') for (const [part, count] of Object.entries(value)) expect(occurrences(actual.output, part)).toBe(count);
        else if (key === 'linesContainText') for (const text of value) expect(actual.linesContainText).toContain(text);
        else if (key === 'isNewByText') expect(actual.isNewByText(Object.keys(value))).toEqual(value);
        else if (key === 'excerpt' || key === 'selection') expect(actual[key]).toEqual(value);
        else expect(actual[key]).toEqual(value);
    }
}

describe('Vektoren shared/spec/insertion.json', () => {
    it('enthält die erwartete Zahl Fälle', () => {
        expect(spec.cases.length).toBe(EXPECTED_CASE_COUNT);
    });

    it.each(spec.cases.map((testCase) => [testCase.id, testCase] as const))('%s', (_id, testCase) => {
        const input = testCase.input as Obj;
        const handler = handlers[input.op];
        expect(handler, `Operation ${input.op}`).toBeDefined();
        assertExpectation(handler!(input), testCase.expect as Obj);
    });

    it('jede Operation der Vektoren hat einen Handler', () => {
        const operations = new Set(spec.cases.map((testCase) => (testCase.input as Obj).op as string));
        for (const operation of operations) expect(handlers[operation]).toBeDefined();
    });

    it('die 27 Sprachumgebungen gibt es im Vervollständigungskatalog', () => {
        expect(CODE_LANGUAGES).toHaveLength(EXPECTED_LANGUAGE_COUNT);
        for (const language of CODE_LANGUAGES) expect(ENVIRONMENTS).toContain(language.environment);
    });
});

describe('Randfälle Escaping', () => {
    it('maskiert alle Sonderzeichen in einer Zeichenkette', () => {
        expect(escapeLatex('% & _ # $ ^ ~ \\ { }')).toBe(
            '\\% \\& \\_ \\# \\$ \\textasciicircum{} \\textasciitilde{} \\textbackslash{} \\{ \\}',
        );
    });

    it('lässt Umlaute und leere Eingaben unverändert', () => {
        expect(escapeLatex('äöüß€')).toBe('äöüß€');
        expect(escapeLatex('')).toBe('');
    });

    it('macht jeden Zeilenumbruch zu einem Leerzeichen, CRLF als eines', () => {
        expect(escapeLatex('a\r\nb\rc\nd\u2028e\u0085f')).toBe('a b c d e f');
        expect(escapeLatex('\n\n')).toBe('  ');
    });

    it('ersetzt Backslash nur einmal (keine doppelte Maskierung)', () => {
        expect(escapeLatex('\\&')).toBe('\\textbackslash{}\\&');
    });

    it('verarbeitet sehr lange Texte', () => {
        expect(escapeLatex('%'.repeat(LONG_NAME_LENGTH))).toHaveLength(LONG_NAME_LENGTH * 2);
    });
});

describe('Randfälle Slug und Label', () => {
    it('schreibt Umlaute aus und trennt bei Akzent-Buchstaben', () => {
        expect(slugOf('Äpfel Öl Übung Straße')).toBe('aepfel-oel-uebung-strasse');
        expect(slugOf('café')).toBe('caf');
    });

    it('behandelt zerlegte Umlaute (NFD) wie zusammengesetzte', () => {
        expect(slugOf('Gro\u0308ße')).toBe('groesse');
    });

    it('liefert für leere Eingaben und nur Sonderzeichen einen leeren Slug', () => {
        expect(slugOf('')).toBe('');
        expect(slugOf('% & _ # $ ^ ~ \\ { }')).toBe('');
    });

    it('kürzt sehr lange Wörter auf 40 Zeichen und entfernt ein Rand-Minus', () => {
        expect(slugOf('a'.repeat(LONG_NAME_LENGTH))).toHaveLength(MAXIMUM_SLUG_LENGTH);
        expect(slugOf(`${'a'.repeat(MAXIMUM_SLUG_LENGTH - 1)} bbb`)).toBe('a'.repeat(MAXIMUM_SLUG_LENGTH - 1));
    });

    it('nutzt bei leerer Beschriftung die Ersatzbezeichnung und vergibt die nächste freie Nummer', () => {
        expect(uniqueLabel('fig', '', 'bild', new Set(['fig:bild', 'fig:bild-3']))).toBe('fig:bild-2');
    });
});

describe('Randfälle Blockplatzierung', () => {
    it('klemmt negative und ungültige Bereiche auf den Textanfang', () => {
        expect(adjustBlock('x\n', 'abc', { location: -5, length: 2 })).toBe('x\n');
        expect(adjustBlock('x\n', 'abc', { location: Number.NaN, length: 0 })).toBe('x\n');
    });

    it('lässt einen Block ohne Schluss-Zeilenumbruch unberührt', () => {
        expect(adjustBlock('x', 'a\n\nb', { location: 2, length: 0 })).toBe('x');
    });

    it('entfernt bei CRLF-Block-Ende kein Zeichen (wie Swift)', () => {
        expect(adjustBlock('x\r\n', 'a\n\nb', { location: 2, length: 0 })).toBe('x\r\n');
    });
});

describe('Randfälle Tabelle', () => {
    const base = (cells: string[][], overrides: Partial<TableSettings> = {}): TableSettings =>
        createTableSettings({ rows: cells.length, columns: cells[0]!.length, alignments: cells[0]!.map(() => 'left'), cells, ...overrides });

    it('maskiert Sonderzeichen und Zeilenumbrüche in Zellen und Beschriftung', () => {
        const output = generateTable(base([['a%b', 'c\r\nd'], ['_', '#']], { caption: ' 50 % \n' }), 'tab:x');
        expect(output).toContain('a\\%b');
        expect(output).toContain('c d');
        expect(output).toContain('\\caption{50 \\%}');
    });

    it('richtet Spalten nach Umlauten (Zeichenzahl, nicht Bytes) aus', () => {
        const output = generateTable(base([['Größe', 'x'], ['ä', 'y']]), '');
        expect(output).toContain('\t\tGröße & x \\\\');
        expect(output).toContain('\t\tä     & y \\\\');
    });

    it('lässt Zeilen mit fehlenden Zellen leere Zellen bekommen', () => {
        const output = generateTable(base([['a', 'b'], ['c']]), '');
        expect(output).toContain('\t\tc & \\\\');
    });

    it('lässt die Mittellinie bei einer einzigen Zeile weg und verwendet Leerzeichen als Einrückung', () => {
        const output = generateTable(base([['a']], { indent: '  ' }), '');
        expect(output).not.toContain('\\midrule');
        expect(output).toContain('  \\centering');
    });

    it('ändert die Größe auf eine Zelle und behält Ausrichtungen', () => {
        const resized = resizeTable(base([['a', 'b']], { alignments: ['right', 'center'] }), 1, 3);
        expect(resized.alignments).toEqual(['right', 'center', 'left']);
        expect(resized.cells).toEqual([['a', 'b', '']]);
    });
});

describe('Randfälle Tab-getrennt', () => {
    const empty = base3();

    function base3(): TableSettings {
        return createTableSettings();
    }

    it('liest CRLF wie LF', () => {
        const filled = fillTableFromTabSeparated(empty, 'a\tb\r\nc\td\r\n');
        expect(filled.cells).toEqual([['a', 'b'], ['c', 'd']]);
    });

    it('behandelt "" in Anführungszellen als Anführungszeichen und mittiges " als Text', () => {
        const filled = fillTableFromTabSeparated(empty, '"sagt ""hi"""\ta"b\n');
        expect(filled.cells).toEqual([['sagt "hi"', 'a"b']]);
    });

    it('übernimmt eine unterbrochene Anführungszelle bis zum Textende', () => {
        expect(fillTableFromTabSeparated(empty, '"offen\tx').cells).toEqual([['offen\tx']]);
    });

    it('entfernt nur am Ende stehende leere Zeilen, nicht leere Zeilen in der Mitte', () => {
        expect(fillTableFromTabSeparated(empty, 'a\n\nb\n\t\n').cells).toEqual([['a'], [''], ['b']]);
    });

    it('verändert die Tabelle bei nur leeren Zeilen nicht', () => {
        expect(fillTableFromTabSeparated(empty, '\n\n\t\n')).toBe(empty);
    });

    it('klemmt auf 40 Zeilen und 12 Spalten', () => {
        const wide = Array.from({ length: 20 }, (_, index) => `c${index}`).join('\t');
        const tall = Array.from({ length: 50 }, () => 'x').join('\n');
        expect(fillTableFromTabSeparated(empty, wide).columns).toBe(12);
        expect(fillTableFromTabSeparated(empty, tall).rows).toBe(40);
    });

    it('behält Umlaute und Sonderzeichen unverändert', () => {
        expect(fillTableFromTabSeparated(empty, 'Größe\t50 %').cells).toEqual([['Größe', '50 %']]);
    });
});

describe('Randfälle Bausteine', () => {
    it('Gleichung: CRLF im Inhalt bleibt eine Zeile, leere Teile bleiben erhalten', () => {
        const output = generateEquation(createEquationSettings({ content: 'a\n\nb' }), '');
        expect(output).toBe('\\begin{equation}\n\ta\n\t\n\tb\n\\end{equation}\n');
        expect(generateEquation(createEquationSettings({ content: 'a\r\nb' }), '')).toBe('\\begin{equation}\n\ta\r\nb\n\\end{equation}\n');
    });

    it('Gleichung: Label nur bei nummerierter Umgebung, auch bei align', () => {
        expect(generateEquation(createEquationSettings({ kind: 'align', content: 'x' }), 'eq:x')).toContain('\\label{eq:x}');
        expect(generateEquation(createEquationSettings({ kind: 'equationStar', content: 'x' }), 'eq:x')).not.toContain('\\label');
    });

    it('Code: Inhalt mit Sonderzeichen bleibt unmaskiert, umgebende Leerzeilen entfallen', () => {
        const output = generateCode(createCodeSettings({ content: '\r\n\n  a % b & c_d\n\n', asFloat: false }), '');
        expect(output).toBe('\\begin{PythonCode}\n  a % b & c_d\n\\end{PythonCode}\n');
    });

    it('Code: Beschriftung wird maskiert, ohne Beschriftung entfällt das Label', () => {
        const withCaption = generateCode(createCodeSettings({ caption: '100 %', content: 'x' }), 'prog:x');
        expect(withCaption).toContain('\\caption{100 \\%}');
        expect(generateCode(createCodeSettings({ content: 'x' }), 'prog:x')).not.toContain('\\label');
    });

    it('Bild: Beschriftung maskiert Sonderzeichen, Platzierung steht hinter \\begin', () => {
        const output = generateImage(createImageSettings({ caption: 'A_B', placement: 'forceHere', widthPercent: 50 }), 'a b.png', 'fig:a');
        expect(output).toContain('\\begin{figure}[H]');
        expect(output).toContain('width=.5\\textwidth]{a b.png}');
        expect(output).toContain('\\caption{A\\_B}');
    });

    it('Liste: Einträge mit Sonderzeichen bleiben unverändert, leere ergeben nur \\item', () => {
        const output = generateList(createListSettings({ items: ['  50 % ', ' '] }));
        expect(output).toBe('\\begin{itemize}\n\t\\item 50 %\n\t\\item\n\\end{itemize}\n');
        expect(resizeList(createListSettings(), 0).items).toHaveLength(1);
    });

    it('Verweis und Zitat: leere Eingaben, Doppelpunkt am Anfang, ohne Schlüssel', () => {
        expect(generateReference({ label: '', withPrefix: true })).toBe('\\ref{}');
        expect(generateReference({ label: ':fig:x', withPrefix: true })).toBe('Abbildung~\\ref{:fig:x}');
        expect(generateReference({ label: 'constructor:x', withPrefix: true })).toBe('\\ref{constructor:x}');
        expect(generateCitation({ keys: [], note: '  ' })).toBe('\\cite{}');
    });
});

describe('Randfälle Katalog, Pfade, Namen', () => {
    it('Labels: Zeilen mit CRLF, leeres Label und Umlaute', () => {
        const entries = labelsInText('\\label{a}\r\n\\label{ }\\label{größe}\n');
        expect(entries.map((entry) => entry.label)).toEqual(['a', 'größe']);
        expect(labelsInText('')).toEqual([]);
    });

    it('Grafikpfade: Leerzeichen, verschachtelte Klammern und fehlende Schließklammer', () => {
        expect(graphicsDirectories('\\graphicspath{{a b/}{{x}c/}}')).toEqual(['a b/', 'c/']);
        expect(graphicsDirectories('\\graphicspath')).toEqual([]);
        expect(graphicsDirectories('\\graphicspath{{img')).toEqual([]);
    });

    it('Grafikreferenz: löst .. und . auf, Projektwurzel mit Schrägstrich am Ende', () => {
        expect(graphicsReference('/p/x/../images/./a.png', '/p/', ['images/'])).toBe('a.png');
        expect(graphicsReference('/p2/a.png', '/p', [])).toBe('a.png');
    });

    it('Dateinamen: nur Punkt am Anfang, doppelte Erweiterung, lange und leere Namen', () => {
        expect(sanitizedName('.png')).toBe('png');
        expect(sanitizedName('a.tar.GZ')).toBe('a-tar.gz');
        expect(sanitizedName('')).toBe('bild');
        expect(sanitizedName('/ordner/Ä Ö Ü ß.PNG')).toBe('Ae-Oe-Ue-ss.png');
        expect(sanitizedName(`${'a'.repeat(LONG_NAME_LENGTH)}.png`)).toHaveLength(LONG_NAME_LENGTH + '.png'.length);
    });

    it('Dateinamen: zerlegte Umlaute werden zusammengesetzt', () => {
        expect(sanitizedName('Gro\u0308ße.png')).toBe('Groesse.png');
    });
});

describe('Randfälle Einfügekontext', () => {
    it('Leerer Text ergibt eine leere Zeile 1', () => {
        const context = makeInsertionContext('', { location: 0, length: 0 }, 'a.tex');
        expect(context).toMatchObject({ excerpt: '', firstLineNumber: 1 });
        expect(cursorLineNumber(context)).toBe(1);
    });

    it('klemmt Auswahlen außerhalb des Textes', () => {
        const context = makeInsertionContext('ab\ncd', { location: 99, length: 5 }, 'a.tex');
        expect(context.selection).toEqual({ location: 5, length: 0 });
        expect(cursorLineNumber(context)).toBe(2);
    });

    it('Auswahl über mehrere Zeilen erweitert den Ausschnitt nach unten', () => {
        const text = Array.from({ length: 20 }, (_, index) => `z${index}`).join('\n');
        const context = makeInsertionContext(text, { location: text.indexOf('z8'), length: text.indexOf('z10') - text.indexOf('z8') }, 'a.tex');
        expect(context.firstLineNumber).toBe(6);
        expect(context.excerpt.split('\n').pop()).toBe('z13');
    });

    it('Zeilen mit CRLF: \\r\\n bleibt im Zeilentext, nur \\n trennt', () => {
        const lines = insertionLines(makeInsertionContext('a\r\nb', { location: 0, length: 0 }, 'a.tex'), 'X\n', true, false);
        expect(lines.map((line) => line.text)).toEqual(['X', 'a\r', 'b']);
    });

    it('Einfügen am Textende ohne Schluss-Zeilenumbruch beginnt in neuer Zeile', () => {
        const lines = insertionLines(makeInsertionContext('abc', { location: 3, length: 0 }, 'a.tex'), 'X\n', true, false);
        expect(lines.map((line) => [line.text, line.isNew])).toEqual([['abc', true], ['X', true], ['', false]]);
    });
});
