import { describe, expect, it } from 'vitest';
import { EMPTY_TABS } from '../../src/shared/core/tabs';
import { buildTabBarItems, isTabNavigationKey, scrollLeftToReveal, tabAfterKey } from '../../src/renderer/app/tabBarData';
import type { TabInfo } from '../../src/renderer/stores/editor';

function info(path: string, isDirty: boolean): TabInfo {
    return { path, title: path.split('/').at(-1)!, isDirty, encoding: 'utf8', eol: 'lf', hash: 'h', mtime: 0 };
}

describe('Tab-Leiste: Daten', () => {
    it('ist ohne Tabs leer', () => {
        expect(buildTabBarItems(EMPTY_TABS, {})).toEqual([]);
    });

    it('markiert aktiven Tab, Vorschau und ungespeichert in der Reihenfolge der Tabs', () => {
        const tabs = { items: ['/p/a.tex', '/p/b.tex', '/p/c.bib'], preview: '/p/c.bib', active: '/p/b.tex' };
        const files = { '/p/a.tex': info('/p/a.tex', false), '/p/b.tex': info('/p/b.tex', true), '/p/c.bib': info('/p/c.bib', false) };
        expect(buildTabBarItems(tabs, files)).toEqual([
            { path: '/p/a.tex', title: 'a.tex', hint: '/p/a.tex', isActive: false, isPreview: false, isDirty: false, closeLabel: '„a.tex“ schließen' },
            { path: '/p/b.tex', title: 'b.tex', hint: '/p/b.tex', isActive: true, isPreview: false, isDirty: true, closeLabel: '„b.tex“ schließen' },
            { path: '/p/c.bib', title: 'c.bib', hint: '/p/c.bib', isActive: false, isPreview: true, isDirty: false, closeLabel: '„c.bib“ schließen' },
        ]);
    });

    it('Dialog-Datei (Schlüssel ist eine GrantId): Titel und Tooltip zeigen den Namen, nie die Kennung', () => {
        const grantId = '5f0c2d3e-1111-4222-8333-944445555666';
        const tabs = { items: [grantId], preview: null, active: grantId };
        const files = { [grantId]: { ...info(grantId, false), title: 'quellen.bib' } };
        expect(buildTabBarItems(tabs, files)[0]).toMatchObject({ path: grantId, title: 'quellen.bib', hint: 'quellen.bib' });
    });

    it('nimmt den Titel aus dem Pfad, wenn die Dateiangaben fehlen', () => {
        const tabs = { items: ['/p/x.tex'], preview: null, active: '/p/x.tex' };
        expect(buildTabBarItems(tabs, {})[0]).toMatchObject({ title: 'x.tex', isDirty: false });
    });

    it('Schließen-Knopf nennt die Datei', () => {
        const tabs = { items: ['/p/x.tex'], preview: null, active: '/p/x.tex' };
        expect(buildTabBarItems(tabs, {})[0]?.closeLabel).toBe('„x.tex“ schließen');
    });
});

describe('Tab-Leiste: Tastatur', () => {
    const tabs = { items: ['/p/a.tex', '/p/b.tex', '/p/c.tex'], preview: null, active: '/p/b.tex' };
    const items = buildTabBarItems(tabs, {});

    it('Pfeile laufen am Rand herum, Pos1 und Ende springen', () => {
        expect(tabAfterKey(items, '/p/b.tex', 'ArrowRight')).toBe('/p/c.tex');
        expect(tabAfterKey(items, '/p/c.tex', 'ArrowRight')).toBe('/p/a.tex');
        expect(tabAfterKey(items, '/p/a.tex', 'ArrowLeft')).toBe('/p/c.tex');
        expect(tabAfterKey(items, '/p/b.tex', 'Home')).toBe('/p/a.tex');
        expect(tabAfterKey(items, '/p/b.tex', 'End')).toBe('/p/c.tex');
    });

    it('ohne bekannten Tab oder ohne Tabs ohne Ziel', () => {
        expect(tabAfterKey(items, '/p/fremd.tex', 'Home')).toBeNull();
        expect(tabAfterKey([], '/p/a.tex', 'Home')).toBeNull();
    });

    it('erkennt nur die Navigationstasten', () => {
        expect(['ArrowLeft', 'ArrowRight', 'Home', 'End'].every(isTabNavigationKey)).toBe(true);
        expect(isTabNavigationKey('Enter')).toBe(false);
        expect(isTabNavigationKey('ArrowUp')).toBe(false);
    });
});

describe('Tab-Leiste: Überlauf', () => {
    const view = { start: 100, size: 300 };

    it('lässt einen sichtbaren Tab, wo er ist', () => {
        expect(scrollLeftToReveal(view, { start: 150, size: 100 })).toBe(100);
        expect(scrollLeftToReveal(view, { start: 100, size: 300 })).toBe(100);
    });

    it('rollt nach links, bis der linke Rand des Tabs sichtbar ist', () => {
        expect(scrollLeftToReveal(view, { start: 40, size: 100 })).toBe(40);
        expect(scrollLeftToReveal(view, { start: -5, size: 100 })).toBe(0);
    });

    it('rollt nach rechts, bis der rechte Rand des Tabs sichtbar ist', () => {
        expect(scrollLeftToReveal(view, { start: 350, size: 100 })).toBe(150);
    });

    it('ein Tab, der breiter ist als die Leiste, zeigt seinen Anfang', () => {
        expect(scrollLeftToReveal(view, { start: 250, size: 500 })).toBe(250);
    });
});
