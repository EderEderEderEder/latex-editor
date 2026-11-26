import { describe, expect, it } from 'vitest';
import {
    acronymDefinitions,
    CompletionIndexBuilder,
    handleCompletionIndexRequest,
    relativeWithin,
    sourceKindOf,
    type CompletionIndexUpdate,
    type ProjectFiles,
    type SourceFile,
} from '../../src/renderer/app/completionIndexLogic';

const ROOT = '/p';
const PROJECT: ProjectFiles = {
    root: ROOT,
    mainFile: `${ROOT}/main.tex`,
    files: [
        `${ROOT}/main.tex`, `${ROOT}/kapitel/a.tex`, `${ROOT}/kapitel/b.tex`, `${ROOT}/lit.bib`,
        `${ROOT}/bilder/logo.png`, `${ROOT}/bilder/plan.pdf`, `${ROOT}/notizen.txt`, `${ROOT}/hgbthesis.cls`,
    ],
};
const BIB = '@book{knuth1984,\n  author = {Donald E. Knuth},\n  title = {The {\\TeX}book},\n  year = 1984\n}\n';
const CLS = '\\DeclareOption{draft}{}\n\\newcommand{\\hgbIntern}{x}\n\\define@key{x}{y}{}\n';

function file(relative: string, text: string): SourceFile {
    return { path: `${ROOT}/${relative}`, name: relative.split('/').at(-1) ?? relative, text };
}

function update(version: number, changes: Partial<CompletionIndexUpdate> = {}): CompletionIndexUpdate {
    return { kind: 'update', version, reset: false, changed: [], removed: [], ...changes };
}

function projectBuilder() {
    const builder = new CompletionIndexBuilder();
    const index = builder.apply(update(1, {
        reset: true,
        project: PROJECT,
        changed: [
            file('main.tex', '\\graphicspath{{bilder/}}\n\\label{sec:start}\n\\newacronym{api}{API}{Programmierschnittstelle}\n'),
            file('kapitel/a.tex', '\\label{fig:ablauf}\n% \\label{kommentar}\n\\newcommand{\\meinBefehl}{x}\n\\begin{meineUmgebung}\n'),
            file('lit.bib', BIB),
            file('hgbthesis.cls', CLS),
        ],
    }));
    return { builder, index };
}

describe('Vervollständigungs-Index (Worker-Logik)', () => {
    it('sammelt Labels (ohne Kommentare, sortiert, mit Datei:Zeile), Zitate, Abkürzungen, Befehle und Umgebungen', () => {
        const { index } = projectBuilder();
        expect(index?.labels).toEqual([
            { label: 'fig:ablauf', file: 'a.tex', line: 1 },
            { label: 'sec:start', file: 'main.tex', line: 2 },
        ]);
        expect(index?.citations).toEqual([
            { key: 'knuth1984', summary: 'Knuth 1984 · The \\TeXbook', searchText: 'Donald E. Knuth The \\TeXbook 1984' },
        ]);
        expect(index?.acronyms).toEqual([{ key: 'api', summary: 'API – Programmierschnittstelle' }]);
        expect(index?.commands).toEqual(['hgbIntern', 'meinBefehl']);
        expect(index?.environments).toContain('meineUmgebung');
    });

    it('liefert Eingabepfade relativ zur Hauptdatei ohne `.tex` und Bildpfade ohne `\\graphicspath`-Ordner', () => {
        const { index } = projectBuilder();
        expect(index?.inputPaths).toEqual(['kapitel/a', 'kapitel/b']);
        expect(index?.graphicsPaths).toEqual(['logo.png', 'plan.pdf']);
    });

    it('liest Paketoptionen aus `.cls`/`.sty`', () => {
        const { index } = projectBuilder();
        const options = new Map(index?.packageOptions ?? []);
        expect(options.get('hgbthesis')?.flags).toContain('draft');
    });

    it('meldet null, wenn sich nichts geändert hat (gleicher Text oder Text ohne neue Einträge)', () => {
        const { builder } = projectBuilder();
        expect(builder.apply(update(2, { changed: [file('lit.bib', BIB)] }))).toBeNull();
        expect(builder.apply(update(3, { changed: [file('kapitel/b.tex', 'Nur Fließtext.\n')] }))).toBeNull();
        expect(builder.apply(update(4, { project: PROJECT }))).toBeNull();
        const changed = builder.apply(update(5, { changed: [file('kapitel/b.tex', 'Text\n\\label{tab:neu}\n')] }));
        expect(changed?.labels.map((entry) => entry.label)).toEqual(['fig:ablauf', 'sec:start', 'tab:neu']);
    });

    it('entfernt Dateien und vergisst bei `reset` alles', () => {
        const { builder } = projectBuilder();
        const removed = builder.apply(update(2, { removed: [`${ROOT}/lit.bib`] }));
        expect(removed?.citations).toEqual([]);
        expect(builder.apply(update(3, { removed: [`${ROOT}/lit.bib`] }))).toBeNull();
        const reset = builder.apply(update(4, { reset: true }));
        expect(reset?.labels).toEqual([]);
        expect(reset?.inputPaths).toEqual([]);
    });

    it('beantwortet Anfragen mit Version und meldet Fehler als Antwort', () => {
        const builder = new CompletionIndexBuilder();
        const response = handleCompletionIndexRequest(builder, update(7, { reset: true }));
        expect(response).toMatchObject({ kind: 'index', version: 7 });
        const broken = { ...update(8), changed: null } as unknown as CompletionIndexUpdate;
        expect(handleCompletionIndexRequest(builder, broken)).toMatchObject({ kind: 'error', version: 8 });
    });
});

describe('Hilfen des Index', () => {
    it('erkennt Quelldateien an der Endung', () => {
        expect(['a.tex', 'b.BIB', 'c.cls', 'd.sty', 'e.png', 'tex', '.tex'].map(sourceKindOf))
            .toEqual(['tex', 'bib', 'style', 'style', null, null, null]);
    });

    it('rechnet Pfade relativ, auch mit Backslashes', () => {
        expect(relativeWithin('C:\\p\\', 'C:\\p\\kapitel\\a.tex')).toBe('kapitel/a.tex');
        expect(relativeWithin('/p', '/q/a.tex')).toBeNull();
    });

    it('liest Kurz- und Langform aus `\\newacronym`, `\\DeclareAcronym` und `\\newglossaryentry`', () => {
        const text = [
            '\\newacronym[plural=x]{gui}{GUI}{Graphical User Interface}',
            '\\DeclareAcronym{cpu}{short = CPU, long = {Central Processing Unit}}',
            '\\newglossaryentry{latex}{name={LaTeX}, description={Textsatz}}',
            '% \\newacronym{weg}{WEG}{im Kommentar}',
        ].join('\n');
        expect(acronymDefinitions(text)).toEqual([
            { key: 'gui', summary: 'GUI – Graphical User Interface' },
            { key: 'cpu', summary: 'CPU – Central Processing Unit' },
            { key: 'latex', summary: 'LaTeX – Textsatz' },
        ]);
    });
});
