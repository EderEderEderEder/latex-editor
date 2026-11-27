import { EditorState } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { referenceMarksExtension, referenceMarksOf, ReferenceMarksDriver } from '../../src/renderer/editor/referenceMarks';
import type { ReferenceMarkSource } from '../../src/renderer/editor/referenceMarks';
import { referenceProblems, type ReferenceProblem } from '../../src/shared/core/latex/referenceCheck';

// W4-12: rote Unterstreichung undefinierter Verweise (Dekorationen im Zustand der Sitzung, ohne View testbar)
const PATH = '/p/kapitel.tex';
const TEXT = 'Siehe \\ref{fig:fehlt} und \\cite{da} sowie \\ref{ok}.\n';

class FakeSource implements ReferenceMarkSource {
    problems: readonly ReferenceProblem[] = [];
    readonly listeners = new Set<() => void>();
    requestedPaths: string[] = [];

    problemsFor(path: string): readonly ReferenceProblem[] {
        this.requestedPaths.push(path);
        return this.problems;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    publish(problems: readonly ReferenceProblem[]): void {
        this.problems = problems;
        for (const listener of this.listeners) listener();
    }
}

function setup(text = TEXT, name = 'kapitel.tex') {
    const source = new FakeSource();
    const host = {
        state: EditorState.create({ doc: text, extensions: referenceMarksExtension({ path: PATH, name }, { source }) }),
        dispatch(spec: TransactionSpec): void {
            this.state = this.state.update(spec).state;
        },
    };
    const driver = new ReferenceMarksDriver(host, PATH, source);
    return { source, host, driver };
}

const known = { labels: new Set(['ok']), citations: null };

describe('Markierungen undefinierter Verweise', () => {
    it('setzt Unterstreichungen auf genau den Schlüssel, Meldung als Tooltip-Text', () => {
        const { source, host } = setup();
        source.publish(referenceProblems(TEXT, known));
        const marks = referenceMarksOf(host.state);
        expect(marks).toHaveLength(1);
        expect(TEXT.slice(marks[0]?.start, marks[0]?.end)).toBe('fig:fehlt');
        expect(marks[0]?.kind).toBe('unknownLabel');
        expect(marks[0]?.message).toContain('fig:fehlt');
        expect(source.requestedPaths).toEqual([PATH]);
    });

    it('beim Start wird das vorhandene Ergebnis eingesetzt (refresh), ein leeres entfernt alles', () => {
        const { source, host, driver } = setup();
        source.problems = referenceProblems(TEXT, known);
        driver.refresh();
        expect(referenceMarksOf(host.state)).toHaveLength(1);
        source.publish([]);
        expect(referenceMarksOf(host.state)).toEqual([]);
    });

    it('die Markierung wandert mit Änderungen davor mit', () => {
        const { source, host } = setup();
        source.publish(referenceProblems(TEXT, known));
        host.dispatch({ changes: { from: 0, insert: 'Vorne ' } });
        const [mark] = referenceMarksOf(host.state);
        expect(host.state.doc.sliceString(mark?.start ?? 0, mark?.end ?? 0)).toBe('fig:fehlt');
    });

    it('verwirft Meldungen, deren Schlüssel nicht mehr an der Stelle steht (veraltete Positionen)', () => {
        const { source, host } = setup('Viel mehr Platz \\ref{fig:fehlt}\n');
        source.publish(referenceProblems(TEXT, known));
        expect(referenceMarksOf(host.state)).toEqual([]);
    });

    it('verwirft Meldungen außerhalb des Textes', () => {
        const { source, host } = setup('kurz');
        source.publish(referenceProblems(TEXT, known));
        expect(referenceMarksOf(host.state)).toEqual([]);
    });

    it('nach `destroy` setzt es nichts mehr ein', () => {
        const { source, host, driver } = setup();
        driver.destroy();
        source.publish(referenceProblems(TEXT, known));
        expect(referenceMarksOf(host.state)).toEqual([]);
        expect(source.listeners.size).toBe(0);
    });

    it('BibTeX-Dateien bekommen keine Erweiterung', () => {
        const state = EditorState.create({
            doc: '@book{a,}', extensions: referenceMarksExtension({ path: '/p/lit.bib', name: 'lit.bib' }, { source: new FakeSource() }),
        });
        expect(referenceMarksOf(state)).toEqual([]);
    });
});
