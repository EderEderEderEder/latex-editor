import { describe, expect, it } from 'vitest';
import { EMPTY_TABS } from '../../src/shared/core/tabs';
import { buildTabBarItems, closeConfirmationText } from '../../src/renderer/app/tabBarData';
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
            { path: '/p/a.tex', title: 'a.tex', hint: '/p/a.tex', isActive: false, isPreview: false, isDirty: false },
            { path: '/p/b.tex', title: 'b.tex', hint: '/p/b.tex', isActive: true, isPreview: false, isDirty: true },
            { path: '/p/c.bib', title: 'c.bib', hint: '/p/c.bib', isActive: false, isPreview: true, isDirty: false },
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

    it('fragt beim Schließen mit dem Dateinamen', () => {
        expect(closeConfirmationText('a.tex')).toContain('„a.tex“');
    });
});
