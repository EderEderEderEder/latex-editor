import { describe, expect, it } from 'vitest';
import {
    OutlineParser, buildOutlineTree, currentEntry, flattenOutlineTree, includeChain, normalizePath, outlineOf,
    parseOutlineItems, sectionChain,
} from '../../src/shared/core/latex/outline';
import type { OutlineEntry, ReadFile } from '../../src/shared/core/latex/outline';
import { loadSpec } from '../support/specVectors';

type Files = Record<string, string>;

const fromFiles = (files: Files): ReadFile => (path) => files[path] ?? null;

interface VectorInput {
    readonly op: string;
    readonly main: string;
    readonly files: Files;
    readonly rewrite?: Files;
    readonly target?: string;
}

interface VectorExpect {
    readonly titles?: string[];
    readonly levels?: string[];
    readonly lines?: number[];
    readonly files?: string[];
    readonly includingFileIsEmpty?: boolean;
    readonly titlesBefore?: string[];
    readonly titlesAfter?: string[];
    readonly chain?: string[];
}

async function checkVector(input: VectorInput, expected: VectorExpect): Promise<void> {
    const readFile = fromFiles(input.files);
    if (input.op === 'outlineRefresh') {
        const parser = new OutlineParser();
        const before = await parser.outline(input.main, readFile);
        const after = await parser.outline(input.main, fromFiles({ ...input.files, ...input.rewrite }));
        expect(before.entries.map((entry) => entry.title)).toEqual(expected.titlesBefore);
        expect(after.entries.map((entry) => entry.title)).toEqual(expected.titlesAfter);
        return;
    }
    const result = await outlineOf(input.main, readFile);
    if (input.op === 'includeChain') {
        expect(includeChain(input.target ?? '', input.main, result.includingFile)).toEqual(expected.chain);
        return;
    }
    if (expected.titles) expect(result.entries.map((entry) => entry.title)).toEqual(expected.titles);
    if (expected.levels) expect(result.entries.map((entry) => entry.level)).toEqual(expected.levels);
    if (expected.lines) expect(result.entries.map((entry) => entry.line)).toEqual(expected.lines);
    if (expected.files) expect(result.entries.map((entry) => entry.file)).toEqual(expected.files);
    if (expected.includingFileIsEmpty) expect(Object.keys(result.includingFile)).toEqual([]);
}

describe('Gliederung: Vektoren aus misc.json', () => {
    const cases = loadSpec('misc').cases.filter((specCase) => {
        const op = (specCase.input as { op?: string }).op;
        return op === 'outline' || op === 'outlineRefresh' || op === 'includeChain';
    });

    it('enthält alle erwarteten Fälle', () => {
        expect(cases.length).toBe(10);
    });

    for (const specCase of cases) {
        it(`${specCase.id}: ${specCase.name}`, async () => {
            try {
                await checkVector(specCase.input as VectorInput, specCase.expect as VectorExpect);
            } catch (error) {
                throw new Error(`Vektor ${specCase.id} (${specCase.name}): ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }
});

describe('Überschriften', () => {
    it('erkennt alle Ebenen, Stern, Offset und Zeile', () => {
        const text = '\\part{P}\n\\chapter*{K}\n  \\subsubsection{U}';
        const items = parseOutlineItems(text);
        expect(items.map((item) => item.kind === 'heading' && [item.level, item.isStarred, item.line, item.offset])).toEqual([
            ['part', false, 1, 0], ['chapter', true, 2, 9], ['subsubsection', false, 3, text.indexOf('\\subsubsection')],
        ]);
    });

    it('verträgt Unicode vor dem Befehl (UTF-16-Offsets)', () => {
        const text = '😀 Größe\n😀\\section{Überblick ✓}';
        const [item] = parseOutlineItems(text);
        expect(item).toMatchObject({ title: 'Überblick ✓', line: 2, offset: text.indexOf('\\section') });
    });

    it('ignoriert \\\\section, Namensverlängerungen, Verbatim und \\verb', () => {
        const text = 'a\\\\section{X}\n\\sectionmark{Y}\n\\begin{verbatim}\n\\section{V}\n\\end{verbatim}\n\\verb|\\section{W}|\n\\section{Z}';
        expect(parseOutlineItems(text).map((item) => item.kind === 'heading' && item.title)).toEqual(['Z']);
    });

    it('liest Titel über Zeilenumbruch; eine nie geschlossene Klammer verwirft nur ihren Befehl', () => {
        const items = parseOutlineItems('\\section{Ein\nTitel}\n\\section{offen\n\\subsection{Danach}');
        expect(items.map((item) => item.kind === 'heading' && item.title)).toEqual(['Ein Titel', 'Danach']);
    });

    it('Stern-Varianten und optionales Argument', () => {
        const items = parseOutlineItems('\\section*[Kurz]{Lang}\n\\section*{Leer}\n\\section[x');
        expect(items.map((item) => item.kind === 'heading' && [item.title, item.isStarred])).toEqual([['Lang', true], ['Leer', true]]);
    });

    it('Includes: input, include, subfile; nicht inputminted', () => {
        const items = parseOutlineItems('\\input{a}\\include{b}\\subfile{c}\\inputminted{d}{e}\\includeonly{f}');
        expect(items.map((item) => item.kind === 'include' && [item.command, item.path])).toEqual([
            ['input', 'a'], ['include', 'b'], ['subfile', 'c'],
        ]);
    });
});

describe('Gliederung über Dateien', () => {
    it('löst Pfade relativ zur Hauptdatei auf, auch mit .. und ohne Endung', async () => {
        const files: Files = {
            'p/main.tex': '\\input{a/b}\\input{../p/c.tex}',
            'p/a/b.tex': '\\section{B}\\input{a/d}',
            'p/a/d.tex': '\\section{D}',
            'p/c.tex': '\\section{C}',
        };
        const result = await outlineOf('p/main.tex', fromFiles(files));
        expect(result.entries.map((entry) => entry.file)).toEqual(['p/a/b.tex', 'p/a/d.tex', 'p/c.tex']);
        expect(result.includingFile).toEqual({ 'p/a/b.tex': 'p/main.tex', 'p/a/d.tex': 'p/a/b.tex', 'p/c.tex': 'p/main.tex' });
    });

    it('Zirkel: Hauptdatei wird nicht Kind, nichts endlos', async () => {
        const files: Files = { 'main.tex': '\\input{a}', 'a.tex': '\\input{main}\\input{a}\\section{A}' };
        const result = await outlineOf('main.tex', fromFiles(files));
        expect(result.entries.map((entry) => entry.title)).toEqual(['A']);
        expect(result.includingFile).toEqual({ 'a.tex': 'main.tex' });
        expect(includeChain('main.tex', 'main.tex', result.includingFile)).toEqual(['main.tex']);
    });

    it('fehlende Hauptdatei und fehlende Includes ergeben leere Gliederung', async () => {
        expect((await outlineOf('x.tex', fromFiles({}))).entries).toEqual([]);
        const result = await outlineOf('main.tex', fromFiles({ 'main.tex': '\\input{weg}' }));
        expect(result).toEqual({ entries: [], includingFile: {} });
    });

    it('Windows-Pfade behalten den Trenner', async () => {
        const files: Files = { 'C:\\p\\main.tex': '\\input{k/a}', 'C:\\p\\k\\a.tex': '\\section{A}' };
        const result = await outlineOf('C:\\p\\main.tex', fromFiles(files));
        expect(result.entries[0]?.file).toBe('C:\\p\\k\\a.tex');
        expect(normalizePath('C:\\p\\..\\q\\.\\x')).toBe('C:\\q\\x');
        expect(normalizePath('/a/../../b')).toBe('/b');
    });

    it('Cache erkennt geänderte Dateien und liest asynchron', async () => {
        const parser = new OutlineParser();
        const files: Files = { 'main.tex': '\\section{Alt}' };
        const read: ReadFile = async (path) => files[path] ?? null;
        expect((await parser.outline('main.tex', read)).entries[0]?.title).toBe('Alt');
        files['main.tex'] = '\\section{Neu}';
        expect((await parser.outline('main.tex', read)).entries[0]?.title).toBe('Neu');
    });
});

describe('Aktueller Abschnitt, Kette, Baum', () => {
    const files: Files = {
        'main.tex': '\\chapter{A}\n\\section{A1}\n\\input{b}\n\\chapter{C}\n\\subsection{C1}',
        'b.tex': 'Text\n\\section{B1}\n\\subsection{B2}\nEnde',
    };
    const entries = async (): Promise<readonly OutlineEntry[]> => (await outlineOf('main.tex', fromFiles(files))).entries;

    it('aktueller Abschnitt je Zeile und Datei', async () => {
        const all = await entries();
        expect(currentEntry(all, 'main.tex', 2)?.title).toBe('A1');
        expect(currentEntry(all, 'main.tex', 1)?.title).toBe('A');
        expect(currentEntry(all, 'b.tex', 1)?.title).toBe('A1');
        expect(currentEntry(all, 'b.tex', 4)?.title).toBe('B2');
        expect(currentEntry(all, 'main.tex', 5)?.title).toBe('C1');
        expect(currentEntry(all, 'fremd.tex', 1)).toBeNull();
        expect(currentEntry([], 'main.tex', 1)).toBeNull();
    });

    it('Abschnittskette von außen nach innen', async () => {
        const all = await entries();
        expect(sectionChain(all, 'main.tex', 5).map((entry) => entry.title)).toEqual(['C', 'C1']);
        expect(sectionChain(all, 'b.tex', 3).map((entry) => entry.title)).toEqual(['A', 'B1', 'B2']);
    });

    it('Baum: hierarchisch, Dateigrenzen, fehlende Ebene hängt am nächsthöheren', async () => {
        const tree = buildOutlineTree(await entries());
        expect(tree.map((node) => node.entry.title)).toEqual(['A', 'C']);
        const first = tree[0];
        expect(first?.children.map((node) => node.entry.title)).toEqual(['A1', 'B1']);
        expect(first?.children[1]?.startsFile).toBe(true);
        expect(first?.children[1]?.children[0]?.startsFile).toBe(false);
        expect(tree[1]?.startsFile).toBe(true);
        expect(first?.startsFile).toBe(true);
    });

    it('flache Liste respektiert zugeklappte Knoten', async () => {
        const tree = buildOutlineTree(await entries());
        const all = flattenOutlineTree(tree, new Set());
        expect(all.map((row) => [row.node.entry.title, row.depth])).toEqual([
            ['A', 0], ['A1', 1], ['B1', 1], ['B2', 2], ['C', 0], ['C1', 1],
        ]);
        const closed = flattenOutlineTree(tree, new Set([tree[0]?.entry.id ?? '']));
        expect(closed.map((row) => row.node.entry.title)).toEqual(['A', 'C', 'C1']);
        expect(closed[0]).toMatchObject({ isExpanded: false, position: 1, siblingCount: 2, parentId: null });
    });

    it('Include-Kette: nicht eingebundene Datei steht allein, Kette ohne Hauptdatei', () => {
        const including = { 'k.tex': 'main.tex', 'a.tex': 'k.tex' };
        expect(includeChain('a.tex', 'main.tex', including)).toEqual(['main.tex', 'k.tex', 'a.tex']);
        expect(includeChain('lose.tex', 'main.tex', including)).toEqual(['lose.tex']);
        expect(includeChain('a.tex', null, including)).toEqual(['main.tex', 'k.tex', 'a.tex']);
        expect(includeChain('a.tex', 'main.tex', { 'a.tex': 'b.tex', 'b.tex': 'a.tex' })).toEqual(['a.tex']);
    });
});
