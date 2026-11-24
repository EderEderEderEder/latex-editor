import { describe, expect, it } from 'vitest';
import { pathBarSegments, relativeToProject } from '../../src/renderer/app/pathBarData';

const ROOT = '/p/arbeit';

describe('Pfadzeile', () => {
    it('zeigt die Include-Kette mit Pfaden relativ zum Projekt', () => {
        const chain = [`${ROOT}/main.tex`, `${ROOT}/kapitel/eins.tex`];
        const segments = pathBarSegments(chain, { path: chain[1]!, title: 'eins.tex' }, ROOT);
        expect(segments).toEqual([
            { path: chain[0], label: 'main.tex' },
            { path: chain[1], label: 'kapitel/eins.tex' },
        ]);
    });

    it('zeigt eine nicht eingebundene Datei allein', () => {
        const active = { path: `${ROOT}/extra.tex`, title: 'extra.tex' };
        expect(pathBarSegments([], active, ROOT)).toEqual([{ path: active.path, label: 'extra.tex' }]);
    });

    it('zeigt eine Datei außerhalb des Projekts (Kennung) mit ihrem Anzeigenamen', () => {
        expect(pathBarSegments(['grant-7'], { path: 'grant-7', title: 'notiz.tex' }, ROOT)).toEqual([
            { path: 'grant-7', label: 'notiz.tex' },
        ]);
        expect(pathBarSegments([], { path: 'grant-7', title: 'notiz.tex' }, null)).toEqual([{ path: 'grant-7', label: 'notiz.tex' }]);
    });

    it('bleibt ohne aktive Datei leer', () => {
        expect(pathBarSegments([], null, ROOT)).toEqual([]);
    });

    it('rechnet Windows-Pfade ohne Beachtung der Groß-/Kleinschreibung um', () => {
        expect(relativeToProject('C:\\Arbeit', 'c:\\arbeit\\kapitel\\eins.tex')).toBe('kapitel/eins.tex');
        expect(relativeToProject('C:\\Arbeit', 'C:\\Arbeit2\\x.tex')).toBeNull();
        expect(relativeToProject(null, '/x')).toBeNull();
    });
});
