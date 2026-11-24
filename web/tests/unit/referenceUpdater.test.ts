import { describe, expect, it } from 'vitest';
import {
    applyReferenceEdits,
    computeReferenceEdits,
    graphicsDirectoriesIn,
    relativePath,
    type ReferenceChange,
} from '../../src/shared/core/referenceUpdater';
import { loadSpec } from '../support/specVectors';

type Texts = Record<string, string>;

interface VectorInput {
    readonly op: string;
    readonly moving?: string;
    readonly to?: string;
    readonly mainFile?: string;
    readonly graphicsDirectories?: string[];
    readonly texts?: Texts;
    readonly path?: string;
    readonly from?: string;
}

interface VectorExpect {
    readonly texts?: Texts;
    readonly lines?: number[];
    readonly oldTexts?: string[];
    readonly applied?: string;
    readonly result?: string;
}

const VECTOR_OPERATIONS = ['updateReferences', 'referenceEdits', 'relativePath'];
const EXPECTED_VECTOR_COUNT = 12;

function change(moving: string, to: string, texts: Texts, graphics: string[] = ['images/'], mainFile = 'main.tex'): ReferenceChange {
    return { moving, to, mainFile, graphicsDirectories: graphics, texts };
}

/** Alle Änderungen angewendet: neuer Text je Datei */
function updated(input: ReferenceChange): Texts {
    const edits = computeReferenceEdits(input);
    return Object.fromEntries(
        Object.entries(input.texts).map(([file, text]) => [
            file,
            applyReferenceEdits(text, edits.find((entry) => entry.file === file)?.edits ?? []),
        ]),
    );
}

function checkVector(input: VectorInput, expected: VectorExpect): void {
    if (input.op === 'relativePath') {
        expect(relativePath(input.path ?? '', input.from ?? '')).toBe(expected.result);
        return;
    }
    const request = change(input.moving ?? '', input.to ?? '', input.texts ?? {}, input.graphicsDirectories ?? [], input.mainFile);
    if (input.op === 'updateReferences') {
        expect(updated(request)).toEqual(expected.texts);
        return;
    }
    const files = computeReferenceEdits(request);
    expect(files).toHaveLength(1);
    const [only] = files;
    expect(only?.edits.map((edit) => edit.line)).toEqual(expected.lines);
    expect(only?.edits.map((edit) => edit.oldText)).toEqual(expected.oldTexts);
    expect(updated(request)[only?.file ?? '']).toBe(expected.applied);
}

describe('Verweise anpassen: Vektoren aus misc.json', () => {
    const cases = loadSpec('misc').cases.filter((specCase) => VECTOR_OPERATIONS.includes((specCase.input as VectorInput).op));

    it('enthält alle erwarteten Fälle', () => {
        expect(cases.length).toBe(EXPECTED_VECTOR_COUNT);
    });

    for (const specCase of cases) {
        it(`${specCase.id}: ${specCase.name}`, () => {
            try {
                checkVector(specCase.input as VectorInput, specCase.expect as VectorExpect);
            } catch (error) {
                throw new Error(`Vektor ${specCase.id} (${specCase.name}): ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }
});

describe('relativePath', () => {
    it('gleiche Stelle, Geschwister und tiefer', () => {
        expect(relativePath('a/b.tex', 'a')).toBe('b.tex');
        expect(relativePath('a/x/b.tex', 'a/y')).toBe('../x/b.tex');
        expect(relativePath('a/b', 'a/b')).toBe('');
    });

    it('normalisiert Windows-Trenner und ./', () => {
        expect(relativePath('a\\b\\c.tex', '.\\a')).toBe('b/c.tex');
    });
});

describe('Offsets und Zusammenfassung', () => {
    it('liefert UTF-16-Bereiche des Arguments und eine Zeile je Änderung', () => {
        const text = '😀 \\input{alt}\n';
        const [file] = computeReferenceEdits(change('alt.tex', 'neu.tex', { 'main.tex': text }));
        const edit = file?.edits[0];
        expect(text.slice(edit?.from, edit?.to)).toBe('alt');
        expect(edit).toMatchObject({ insert: 'neu', line: 1 });
        expect(file?.summary).toEqual(['Zeile 1: \\input{alt} → \\input{neu}']);
    });

    it('gibt nur Dateien mit Änderungen zurück, nach Pfad sortiert', () => {
        const files = computeReferenceEdits(
            change('a.tex', 'b.tex', { 'z.tex': '\\input{a}', 'm.tex': 'nichts', 'c/x.tex': '\\input{a}' }),
        );
        expect(files.map((entry) => entry.file)).toEqual(['c/x.tex', 'z.tex']);
    });

    it('Unicode und Emoji vor dem Verweis verschieben die Offsets nicht falsch', () => {
        const texts = { 'main.tex': 'Ä 😀 😀 \\input{Größe Maß} 😀 \\input{Größe Maß.tex}\n' };
        expect(updated(change('Größe Maß.tex', 'Neu 😀.tex', texts))['main.tex']).toBe(
            'Ä 😀 😀 \\input{Neu 😀} 😀 \\input{Neu 😀.tex}\n',
        );
    });
});

describe('Kommentare, Verbatim und Befehlsgrenzen', () => {
    it('Kommentare und Verbatim bleiben, \\verb auch', () => {
        const text = '% \\input{a}\n\\verb|\\input{a}|\n\\begin{verbatim}\n\\input{a}\n\\end{verbatim}\n\\input{a} % \\input{a}\n';
        expect(updated(change('a.tex', 'b.tex', { 'main.tex': text }))['main.tex']).toBe(
            '% \\input{a}\n\\verb|\\input{a}|\n\\begin{verbatim}\n\\input{a}\n\\end{verbatim}\n\\input{b} % \\input{a}\n',
        );
    });

    it('\\\\input (Zeilenumbruch und Text) und ähnliche Befehle sind keine Verweise', () => {
        const text = 'x\\\\input{a} \\inputx{a} \\includeonly{a}\n';
        expect(updated(change('a.tex', 'b.tex', { 'main.tex': text }))['main.tex']).toBe(text);
    });

    it('Stern und optionales Argument', () => {
        const text = '\\includegraphics*[width=3cm]{images/x.png}\n\\input {a}\n';
        const result = updated(change('images/x.png', 'images/y.png', { 'main.tex': text }));
        expect(result['main.tex']).toBe('\\includegraphics*[width=3cm]{images/y.png}\n\\input {a}\n');
    });
});

describe('Ordner und andere Ordner', () => {
    it('Ordner-Umbenennung zieht Tiefen, Bilder und Literatur nach', () => {
        const texts = { 'main.tex': '\\input{kap/a/b}\n\\includegraphics{kap/bild}\n\\bibliography{kap/refs}\n\\input{kapitel/x}\n' };
        const result = updated(change('kap', 'inhalt', texts, ['images/']));
        expect(result['main.tex']).toBe('\\input{inhalt/a/b}\n\\includegraphics{inhalt/bild}\n\\bibliography{inhalt/refs}\n\\input{kapitel/x}\n');
    });

    it('Datei in einen anderen Ordner verschieben; verweisende Datei liegt woanders', () => {
        const texts = { 'sub/deep/c.tex': '\\input{kapitel/eins}\n\\include{kapitel/eins.tex}\n' };
        const result = updated(change('kapitel/eins.tex', 'archiv/alt/eins.tex', texts));
        expect(result['sub/deep/c.tex']).toBe('\\input{archiv/alt/eins}\n\\include{archiv/alt/eins.tex}\n');
    });

    it('Hauptdatei im Unterordner: Pfade gelten relativ zu ihr', () => {
        const texts = { 'arbeit/main.tex': '\\input{teil/a}\n' };
        const result = updated(change('arbeit/teil/a.tex', 'arbeit/a.tex', texts, [], 'arbeit/main.tex'));
        expect(result['arbeit/main.tex']).toBe('\\input{a}\n');
    });

    it('Datei aus dem Ordner der Hauptdatei hinaus bekommt ../', () => {
        const texts = { 'arbeit/main.tex': '\\input{a}\n' };
        const result = updated(change('arbeit/a.tex', 'gemeinsam/a.tex', texts, [], 'arbeit/main.tex'));
        expect(result['arbeit/main.tex']).toBe('\\input{../gemeinsam/a}\n');
    });

    it('Windows-Trenner im Projekt werden normalisiert', () => {
        const texts = { 'chapters\\a.tex': '\\input{chapters\\alt}\n' };
        const result = updated(change('chapters\\alt.tex', 'kapitel\\neu.tex', texts));
        expect(result['chapters\\a.tex']).toBe('\\input{kapitel/neu}\n');
    });

    it('./ vor dem Pfad bleibt erhalten', () => {
        const texts = { 'main.tex': '\\input{./a}\n\\input{./a.tex}\n' };
        expect(updated(change('a.tex', 'k/b.tex', texts))['main.tex']).toBe('\\input{./k/b}\n\\input{./k/b.tex}\n');
        expect(updated(change('k/a.tex', 'b.tex', { 'main.tex': '\\input{./k/a}\n' }))['main.tex']).toBe('\\input{./b}\n');
    });
});

describe('Bilder und \\graphicspath', () => {
    it('findet Bilder über jeden graphicspath-Ordner, mit und ohne Endung', () => {
        const texts = { 'main.tex': '\\includegraphics{a/x}\n\\includegraphics{x.jpg}\n\\includegraphics{images/a/x.pdf}\n' };
        const result = updated(change('bilder/a/x.pdf', 'bilder/b/x.pdf', texts, ['images/', 'bilder/']));
        expect(result['main.tex']).toBe('\\includegraphics{b/x}\n\\includegraphics{x.jpg}\n\\includegraphics{images/a/x.pdf}\n');
    });

    it('Ordner-Umbenennung eines graphicspath-Ordners', () => {
        const texts = { 'main.tex': '\\includegraphics{logo}\n' };
        const result = updated(change('images', 'bilder', texts, ['images/']));
        expect(result['main.tex']).toBe('\\includegraphics{../bilder/logo}\n');
    });

    it('graphicsDirectoriesIn liest mehrere Ordner, ergänzt / und ignoriert Kommentare', () => {
        expect(graphicsDirectoriesIn('\\graphicspath{{images/}{bilder}}')).toEqual(['images/', 'bilder/']);
        expect(graphicsDirectoriesIn('% \\graphicspath{{alt/}}\n\\graphicspath{ {neu/} }')).toEqual(['neu/']);
        expect(graphicsDirectoriesIn('kein Pfad')).toEqual([]);
    });
});
