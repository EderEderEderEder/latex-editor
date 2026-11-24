import { describe, expect, it } from 'vitest';
import { QUICK_OPEN_LIMIT, matchPositions, normalizeQuery, rankQuickOpen } from '../../src/shared/core/quickOpen';
import type { QuickOpenFile } from '../../src/shared/core/quickOpen';
import { loadSpec } from '../support/specVectors';

interface QuickOpenInput {
    readonly op: string;
    readonly files: readonly QuickOpenFile[];
    readonly query: string;
    readonly limit?: number;
}

interface QuickOpenExpect {
    readonly paths?: readonly string[];
    readonly first?: string;
    readonly contains?: string;
    readonly count?: number;
}

const cases = loadSpec('misc').cases.filter((specCase) => (specCase.input as { op?: string }).op === 'quickOpenRank');

describe('quickOpenRank (Testvektoren misc.json)', () => {
    it('findet die Fälle', () => {
        expect(cases.length).toBeGreaterThan(0);
    });

    for (const specCase of cases) {
        it(`${specCase.id}: ${specCase.name}`, () => {
            const input = specCase.input as QuickOpenInput;
            const want = specCase.expect as QuickOpenExpect;
            const label = `${specCase.id} (${specCase.name})`;
            const paths = rankQuickOpen(input.files, input.query, input.limit).map((file) => file.path);
            if (want.paths !== undefined) expect(paths, label).toEqual(want.paths);
            if (want.first !== undefined) expect(paths[0], label).toBe(want.first);
            if (want.contains !== undefined) expect(paths, label).toContain(want.contains);
            if (want.count !== undefined) expect(paths.length, label).toBe(want.count);
        });
    }
});

describe('quickOpen Randfälle', () => {
    const files = (...paths: string[]): QuickOpenFile[] => paths.map((path) => ({ path }));

    it('Unicode: Umlaute und Groß-/Kleinschreibung', () => {
        const list = files('kapitel/Übersicht.tex', 'kapitel/uebersicht.tex', 'a.tex');
        expect(rankQuickOpen(list, 'ÜBER').map((f) => f.path)).toEqual(['kapitel/Übersicht.tex']);
        expect(rankQuickOpen(list, 'übers')).toHaveLength(1);
    });

    it('Emoji im Pfad bricht nichts', () => {
        const list = files('😀/a😀b.tex');
        expect(rankQuickOpen(list, 'ab')).toHaveLength(1);
    });

    it('Leere und Leerzeichen-Eingabe liefern alles, natürlich sortiert', () => {
        const list = files('kap10.tex', 'kap2.tex', 'Kap1.tex');
        expect(rankQuickOpen(list, '').map((f) => f.path)).toEqual(['Kap1.tex', 'kap2.tex', 'kap10.tex']);
        expect(rankQuickOpen(list, ' \t')).toHaveLength(3);
    });

    it('Standardgrenze und limit 0', () => {
        const many = Array.from({ length: QUICK_OPEN_LIMIT + 20 }, (_, index) => ({ path: `f${index}.tex` }));
        expect(rankQuickOpen(many, '')).toHaveLength(QUICK_OPEN_LIMIT);
        expect(rankQuickOpen(many, 'f')).toHaveLength(QUICK_OPEN_LIMIT);
        expect(rankQuickOpen(many, 'f', 0)).toEqual([]);
    });

    it('Gleiche Wertung bleibt in der Eingabereihenfolge (stabil), Eingabe wird nicht verändert', () => {
        const list = files('x/a.tex', 'x/A.tex');
        const copy = [...list];
        expect(rankQuickOpen(list, 'a').map((f) => f.path)).toEqual(['x/a.tex', 'x/A.tex']);
        expect(list).toEqual(copy);
    });

    it('Hervorhebung: Teilstring, Teilfolge, kein Treffer', () => {
        expect(matchPositions('einleitung.tex', 'einl')).toEqual([0, 1, 2, 3]);
        expect(matchPositions('grundlagen.tex', 'grlg')).toEqual([0, 1, 5, 7]);
        expect(matchPositions('main.tex', 'xyz')).toEqual([]);
        expect(matchPositions('main.tex', normalizeQuery(''))).toEqual([]);
    });

    it('10.000 Pfade in unter 50 ms', () => {
        const big: QuickOpenFile[] = Array.from({ length: 10_000 }, (_, index) => ({ path: `kapitel${index % 50}/abschnitt-${index}.tex` }));
        rankQuickOpen(big, 'abs');
        const start = performance.now();
        rankQuickOpen(big, 'k3abs9');
        rankQuickOpen(big, 'abschnitt-12');
        const perCall = (performance.now() - start) / 2;
        expect(perCall).toBeLessThan(50);
        const startEmpty = performance.now();
        rankQuickOpen(big, '');
        expect(performance.now() - startEmpty).toBeLessThan(50);
    });
});
