import { describe, expect, it } from 'vitest';
import {
    FoldState,
    LineIndex,
    hiddenRange,
    scanFoldRegions,
    type FoldKind,
    type FoldRegion,
    type TextRange,
} from '../../src/shared/core/latex/foldRegions';
import { loadSpec, type SpecCase } from '../support/specVectors';

interface FoldVectorInput {
    readonly op: string;
    readonly text: string;
    readonly region?: FoldRegion;
}

interface FoldVectorExpect {
    readonly regions?: readonly FoldRegion[];
    readonly hiddenRange?: TextRange;
    readonly hiddenText?: string;
}

const EXPECTED_VECTOR_COUNT = 14;

function runVector(testCase: SpecCase): void {
    const input = testCase.input as FoldVectorInput;
    const expected = testCase.expect as FoldVectorExpect;
    switch (input.op) {
        case 'regions':
            expect(scanFoldRegions(input.text)).toEqual(expected.regions);
            return;
        case 'hiddenRange': {
            const range = hiddenRange(input.region as FoldRegion, new LineIndex(input.text));
            expect(range).toEqual(expected.hiddenRange);
            expect(input.text.slice(range.location, range.location + range.length)).toBe(expected.hiddenText);
            return;
        }
        default:
            throw new Error(`unbekannte Operation: ${input.op}`);
    }
}

describe('foldRegions: gemeinsame Testvektoren (fold-regions.json)', () => {
    const spec = loadSpec('fold-regions');

    it(`enthält ${EXPECTED_VECTOR_COUNT} übernehmbare Fälle`, () => {
        expect(spec.cases).toHaveLength(EXPECTED_VECTOR_COUNT);
    });

    for (const testCase of spec.cases) {
        it(`${testCase.id}: ${testCase.name}`, () => runVector(testCase));
    }
});

function summary(text: string): string[] {
    return scanFoldRegions(text).map((region) => `${kindName(region.kind)} ${region.startLine}-${region.endLine}`);
}

function kindName(kind: FoldKind): string {
    return typeof kind === 'string' ? kind : kind.environment;
}

describe('foldRegions: Scanner, Randfälle', () => {
    it('Unicode und Emoji: Zeilen zählen nur \\n, Offsets sind UTF-16', () => {
        const text = '\\section{😀 Größe}\nä\n\\section{B}\nb\n';
        expect(summary(text)).toEqual(['section 0-1', 'section 2-3']);
        const range = hiddenRange(scanFoldRegions(text)[0] as FoldRegion, new LineIndex(text));
        expect(range).toEqual({ location: 18, length: 2 });
        expect(text.slice(range.location, range.location + range.length)).toBe('\nä');
    });

    it('Emoji in Kommentarblock und in Code-Umgebung', () => {
        expect(summary('% 😀\n% 🎉\nx\n')).toEqual(['comments 0-1']);
        expect(summary('\\begin{lstlisting}\n😀 \\section{X}\n\\end{lstlisting}\n')).toEqual(['lstlisting 0-2']);
    });

    it('verschachtelte Umgebungen: alle Ebenen, nach Startzeile sortiert', () => {
        const text = '\\begin{enumerate}\n\\begin{itemize}\n\\item a\n\\end{itemize}\n\\end{enumerate}\n';
        expect(summary(text)).toEqual(['enumerate 0-4', 'itemize 1-3']);
    });

    it('\\end ohne \\begin wird ignoriert, ein fremdes \\end schließt nichts', () => {
        expect(summary('\\end{a}\nx\ny\n')).toEqual([]);
        expect(summary('\\begin{a}\nx\n\\end{b}\ny\n\\end{a}\n')).toEqual(['a 0-4']);
    });

    it('Kommentarblock am Dateiende, mit und ohne Zeilenumbruch', () => {
        expect(summary('text\n% a\n% b')).toEqual(['comments 1-2']);
        expect(summary('text\n% a\n% b\n')).toEqual(['comments 1-2']);
        expect(summary('text\n% a')).toEqual([]);
    });

    it('nicht geschlossene Code-Umgebung: nichts dahinter zählt', () => {
        expect(summary('\\begin{verbatim}\n\\section{X}\ny\n')).toEqual([]);
    });

    it('Sternvariante und Präfixe: \\section* ist eine Überschrift, \\sectionx nicht', () => {
        expect(summary('\\section*{A}\nx\n')).toEqual(['section 0-1']);
        expect(summary('\\sectionx{A}\nx\n')).toEqual([]);
        expect(summary('\\subsection{A}\nx\n\\subsubsection{B}\ny\n')).toEqual(['section 0-3', 'section 2-3']);
    });

    it('leerer Text und Text ohne Bereiche', () => {
        expect(summary('')).toEqual([]);
        expect(summary('nur\neine\nDatei\n')).toEqual([]);
    });

    it('hiddenRange klemmt Zeilen hinter dem Textende', () => {
        const lines = new LineIndex('ab\ncd');
        const range = hiddenRange({ kind: 'section', startLine: 0, endLine: 9 }, lines);
        expect(range).toEqual({ location: 2, length: 3 });
    });

    it('10.000 Zeilen mit sehr vielen Regionen: schnellster von 5 Läufen unter 20 ms', () => {
        const block = ['\\section{S}', '\\begin{itemize}', '\\item x', '\\end{itemize}', '% a', '% b', 'Text'].join('\n');
        const text = Array.from({ length: 1430 }, () => block).join('\n');
        expect(text.split('\n').length).toBeGreaterThanOrEqual(10_000);
        const regionCount = scanFoldRegions(text).length;
        expect(regionCount).toBeGreaterThan(4000);
        const durations = Array.from({ length: 5 }, () => {
            const start = performance.now();
            scanFoldRegions(text);
            return performance.now() - start;
        });
        expect(Math.min(...durations)).toBeLessThan(20);
    });
});

describe('foldRegions: LineIndex', () => {
    const TEXT = 'ab\ncd\n\nef';

    it('Zeilenanfänge, Inhaltsbereiche und Zeile zu Offset', () => {
        const lines = new LineIndex(TEXT);
        expect(lines.lineCount).toBe(4);
        expect(lines.contentRange(1)).toEqual({ location: 3, length: 2 });
        expect(lines.contentRange(3)).toEqual({ location: 7, length: 2 });
        expect(lines.lineContaining(2)).toBe(0);
        expect(lines.lineContaining(3)).toBe(1);
        expect(lines.lineContaining(TEXT.length)).toBe(3);
    });

    it('applyEdit liefert denselben Index wie ein Neuaufbau', () => {
        const edits: Array<[number, number, string]> = [[0, 0, 'neu\n'], [3, 3, ''], [2, 0, '\n\n'], [0, TEXT.length, 'x\ny\nz'], [5, 1, '😀']];
        for (const [location, length, replacement] of edits) {
            const lines = new LineIndex(TEXT);
            const edited = TEXT.slice(0, location) + replacement + TEXT.slice(location + length);
            lines.applyEdit(edited, { location, length: replacement.length }, replacement.length - length);
            const fresh = new LineIndex(edited);
            expect(lines.lineCount).toBe(fresh.lineCount);
            expect(lines.length).toBe(fresh.length);
            for (let line = 0; line < fresh.lineCount; line++) expect(lines.start(line)).toBe(fresh.start(line));
        }
    });
});

/** Nachbildung der FoldState-Tests aus `FoldingTests.swift` (Suite „Zugeklappte Stellen verwalten“) */
describe('foldRegions: FoldState (Swift-Tests nachgebildet)', () => {
    const TEXT = '\\section{A}\nx\ny\n\\section{B}\nz\n';
    const NESTED_TEXT = '\\section{A}\n\\begin{x}\nb\n\\end{x}\nc\n';
    const SELECTION_TEXT_LENGTH = 30;

    function stateFor(text: string = TEXT): { folds: FoldState; lines: LineIndex } {
        const folds = new FoldState();
        const lines = new LineIndex(text);
        folds.adopt(scanFoldRegions(text), lines);
        return { folds, lines };
    }

    function regionAt(folds: FoldState, line: number): FoldRegion {
        const region = folds.region(line);
        if (region === undefined) throw new Error(`kein Bereich in Zeile ${line}`);
        return region;
    }

    /** Ersetzt `range` im Text, führt Zeilenindex und Zustand nach (wie `edit` in den Swift-Tests) */
    function edit(folds: FoldState, text: string, range: TextRange, replacement: string): LineIndex {
        const lines = new LineIndex(text);
        const edited = text.slice(0, range.location) + replacement + text.slice(range.location + range.length);
        const editedRange = { location: range.location, length: replacement.length };
        const delta = replacement.length - range.length;
        const splice = lines.applyEdit(edited, editedRange, delta);
        folds.applyEdit(editedRange, delta, splice, lines);
        return lines;
    }

    it('Zuklappen blendet vom Ende der Kopfzeile bis vor den letzten Zeilenumbruch aus', () => {
        const { folds, lines } = stateFor();
        const changes: TextRange[] = [];
        folds.onHiddenChange = (range) => changes.push(range);
        const region = regionAt(folds, 0);
        folds.toggle(region, lines);
        expect(folds.hiddenRanges).toEqual([{ location: 11, length: 4 }]);
        expect(folds.isFolded(region, lines)).toBe(true);
        folds.toggle(region, lines);
        expect(folds.hiddenRanges).toEqual([]);
        expect(changes).toEqual([{ location: 11, length: 4 }, { location: 11, length: 4 }]);
    });

    it('Verschachtelte Bereiche ergeben ein Ausgeblendetes; Aufklappen des äußeren lässt den inneren zu', () => {
        const { folds, lines } = stateFor(NESTED_TEXT);
        const outer = regionAt(folds, 0);
        const inner = regionAt(folds, 1);
        folds.fold(inner, lines);
        folds.fold(outer, lines);
        expect(folds.hiddenRanges).toHaveLength(1);
        folds.unfold(outer, lines);
        expect(folds.hiddenRanges).toEqual([hiddenRange(inner, lines)]);
    });

    it('Alles zuklappen lässt \\begin{document} offen; Alles aufklappen räumt auf', () => {
        const text = '\\begin{document}\n\\section{A}\nx\n\\section{B}\ny\n\\end{document}\n';
        const { folds, lines } = stateFor(text);
        folds.foldAll(lines);
        expect(folds.folded).toHaveLength(2);
        expect(folds.isFolded(regionAt(folds, 0), lines)).toBe(false);
        folds.unfoldAll();
        expect(folds.hasFolds).toBe(false);
    });

    it('Der innerste offene Bereich unter dem Cursor; ein zugeklappter wird übersprungen', () => {
        const { folds, lines } = stateFor(NESTED_TEXT);
        expect(folds.innermostOpenRegion(2, lines)?.startLine).toBe(1);
        folds.fold(regionAt(folds, 1), lines);
        expect(folds.innermostOpenRegion(1, lines)?.startLine).toBe(0);
    });

    it('Eine Änderung davor verschiebt die zugeklappte Stelle, eine dahinter lässt sie', () => {
        const { folds, lines } = stateFor();
        folds.fold(regionAt(folds, 0), lines);
        const before = folds.hiddenRanges;
        edit(folds, TEXT, { location: 11, length: 0 }, '!!');
        expect(folds.hiddenRanges).toEqual([{ location: (before[0]?.location ?? 0) + 2, length: before[0]?.length }]);

        const other = stateFor();
        other.folds.fold(regionAt(other.folds, 0), other.lines);
        edit(other.folds, TEXT, { location: 20, length: 0 }, '!!');
        expect(other.folds.hiddenRanges).toEqual(before);
    });

    it('Eine Änderung im Ausgeblendeten klappt auf und meldet den betroffenen Bereich', () => {
        const { folds, lines } = stateFor();
        folds.fold(regionAt(folds, 0), lines);
        let changed: TextRange | undefined;
        folds.onHiddenChange = (range) => {
            changed = range;
        };
        edit(folds, TEXT, { location: 12, length: 1 }, 'q');
        expect(folds.hasFolds).toBe(false);
        expect(changed).toBeDefined();
        const hidden = { location: 11, length: 4 };
        const overlap = Math.min(hidden.location + hidden.length, (changed?.location ?? 0) + (changed?.length ?? 0))
            - Math.max(hidden.location, changed?.location ?? 0);
        expect(overlap).toBeGreaterThan(0);
    });

    it('Neue Zeilen verschieben die Bereiche, bis die nächste Prüfung sie bestätigt', () => {
        const { folds } = stateFor();
        edit(folds, TEXT, { location: 0, length: 0 }, 'neu\n');
        expect(folds.regions.map((region) => region.startLine)).toEqual([1, 4]);
    });

    it('Eine neue Zeile hinter der Kopfzeile lässt die Kopfzeile stehen', () => {
        const { folds } = stateFor();
        edit(folds, TEXT, { location: 11, length: 0 }, '\n');
        expect(folds.regions.map((region) => region.startLine)).toEqual([0, 4]);
    });

    it('Nach einer Prüfung klappt auf, wozu es keinen Bereich mehr gibt', () => {
        const { folds, lines } = stateFor();
        folds.fold(regionAt(folds, 0), lines);
        const changedText = '\\section{A}\nx\ny\nz\n\\section{B}\n';
        folds.adopt(scanFoldRegions(changedText), new LineIndex(changedText));
        expect(folds.hasFolds).toBe(false);
    });

    it('Cursor am Ende des Ausgeblendeten rückt an das Ende der Kopfzeile', () => {
        const { folds, lines } = stateFor();
        folds.fold(regionAt(folds, 0), lines);
        const hidden = folds.hiddenRanges[0] as TextRange;
        const selection = { location: hidden.location + hidden.length, length: 0 };
        const adjusted = folds.adjustedSelection({ selection, previousLocation: 30, textLength: SELECTION_TEXT_LENGTH });
        expect(adjusted).toEqual({ location: hidden.location, length: 0 });
        expect(folds.hasFolds).toBe(true);
    });

    it('Ein Schritt nach rechts vom Ende der Kopfzeile springt hinter den Bereich', () => {
        const { folds, lines } = stateFor();
        folds.fold(regionAt(folds, 0), lines);
        const hidden = folds.hiddenRanges[0] as TextRange;
        const adjusted = folds.adjustedSelection({
            selection: { location: hidden.location + 1, length: 0 },
            previousLocation: hidden.location,
            textLength: SELECTION_TEXT_LENGTH,
        });
        expect(adjusted).toEqual({ location: hidden.location + hidden.length + 1, length: 0 });
        expect(folds.hasFolds).toBe(true);
    });

    it('Mitten ins Ausgeblendete (Suche, Gehe zu Zeile) klappt auf', () => {
        const { folds, lines } = stateFor();
        folds.fold(regionAt(folds, 0), lines);
        const hidden = folds.hiddenRanges[0] as TextRange;
        const selection = { location: hidden.location + 2, length: 0 };
        expect(folds.adjustedSelection({ selection, previousLocation: 0, textLength: SELECTION_TEXT_LENGTH })).toBeNull();
        expect(folds.hasFolds).toBe(false);
    });

    it('Eine Auswahl über den ganzen Bereich lässt ihn zu, ein Rand mittendrin klappt auf', () => {
        const { folds, lines } = stateFor();
        folds.fold(regionAt(folds, 0), lines);
        const whole = { selection: { location: 0, length: 30 }, previousLocation: 0, textLength: SELECTION_TEXT_LENGTH };
        folds.adjustedSelection(whole);
        expect(folds.hasFolds).toBe(true);
        folds.adjustedSelection({ ...whole, selection: { location: 12, length: 5 } });
        expect(folds.hasFolds).toBe(false);
    });
});

describe('foldRegions: FoldState, Randfälle', () => {
    it('Emoji vor der zugeklappten Stelle verschieben sie um zwei UTF-16-Einheiten', () => {
        const text = '😀\n\\section{A}\nx\ny\n';
        const folds = new FoldState();
        const lines = new LineIndex(text);
        folds.adopt(scanFoldRegions(text), lines);
        folds.fold(folds.region(1) as FoldRegion, lines);
        const before = folds.hiddenRanges[0] as TextRange;
        const edited = '😀😀\n\\section{A}\nx\ny\n';
        const editedRange = { location: 2, length: 2 };
        const splice = lines.applyEdit(edited, editedRange, 2);
        folds.applyEdit(editedRange, 2, splice, lines);
        expect(folds.hiddenRanges).toEqual([{ location: before.location + 2, length: before.length }]);
        expect(edited.slice(before.location + 2, before.location + 2 + before.length)).toBe('\nx\ny');
    });

    it('generation zählt jede Bearbeitung; unfoldHeaderLine und unfoldStartingAt klappen auf', () => {
        const text = '\\section{A}\nx\ny\n\\section{B}\nz\n';
        const folds = new FoldState();
        const lines = new LineIndex(text);
        folds.adopt(scanFoldRegions(text), lines);
        folds.fold(folds.region(0) as FoldRegion, lines);
        folds.unfoldHeaderLine(0, lines);
        expect(folds.hasFolds).toBe(false);
        folds.fold(folds.region(0) as FoldRegion, lines);
        folds.unfoldStartingAt(11);
        expect(folds.hasFolds).toBe(false);
        const generation = folds.generation;
        const splice = lines.applyEdit(`${text}!`, { location: text.length, length: 1 }, 1);
        folds.applyEdit({ location: text.length, length: 1 }, 1, splice, lines);
        expect(folds.generation).toBe(generation + 1);
    });

    it('Ersetzen des ganzen Texts: adopt lässt keinen verwaisten Bereich zurück', () => {
        const text = '\\section{A}\nx\ny\n';
        const folds = new FoldState();
        const lines = new LineIndex(text);
        folds.adopt(scanFoldRegions(text), lines);
        folds.fold(folds.region(0) as FoldRegion, lines);
        const replaced = 'neu\nganz\nanders\n';
        folds.adopt(scanFoldRegions(replaced), new LineIndex(replaced));
        expect(folds.hasFolds).toBe(false);
        expect(folds.regions).toEqual([]);
    });

    it('Alles zuklappen bei sehr vielen Bereichen bleibt schnell und ist umkehrbar', () => {
        const block = ['\\section{S}', '\\begin{itemize}', '\\item x', '\\end{itemize}', 'Text'].join('\n');
        const text = Array.from({ length: 1000 }, () => block).join('\n');
        const folds = new FoldState();
        const lines = new LineIndex(text);
        folds.adopt(scanFoldRegions(text), lines);
        const start = performance.now();
        folds.foldAll(lines);
        expect(performance.now() - start).toBeLessThan(200);
        expect(folds.hiddenRanges).toHaveLength(1000);
        folds.unfoldAll();
        expect(folds.hasFolds).toBe(false);
    });
});
