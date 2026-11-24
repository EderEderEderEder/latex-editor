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
            { path: '/p/a.tex', title: 'a.tex', isActive: false, isPreview: false, isDirty: false },
            { path: '/p/b.tex', title: 'b.tex', isActive: true, isPreview: false, isDirty: true },
            { path: '/p/c.bib', title: 'c.bib', isActive: false, isPreview: true, isDirty: false },
        ]);
    });

    it('nimmt den Titel aus dem Pfad, wenn die Dateiangaben fehlen', () => {
        const tabs = { items: ['/p/x.tex'], preview: null, active: '/p/x.tex' };
        expect(buildTabBarItems(tabs, {})[0]).toMatchObject({ title: 'x.tex', isDirty: false });
    });

    it('fragt beim Schließen mit dem Dateinamen', () => {
        expect(closeConfirmationText('a.tex')).toContain('„a.tex“');
    });
});
