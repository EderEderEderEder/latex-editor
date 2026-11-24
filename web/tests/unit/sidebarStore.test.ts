import { describe, expect, it, vi } from 'vitest';
import {
    SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, clampSidebarWidth, createSidebarStore,
} from '../../src/renderer/stores/sidebar';

function setup() {
    const store = createSidebarStore();
    const listener = vi.fn();
    store.subscribe(listener);
    return { store, listener };
}

describe('Seitenleisten-Store', () => {
    it('klemmt die Breite auf 180 bis 480 Pixel', () => {
        expect(SIDEBAR_MIN_WIDTH).toBe(180);
        expect(SIDEBAR_MAX_WIDTH).toBe(480);
        expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN_WIDTH);
        expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX_WIDTH);
        expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH);
        const { store } = setup();
        store.getState().setWidth(100);
        expect(store.getState().width).toBe(SIDEBAR_MIN_WIDTH);
    });

    it('setzt nur bei echter Änderung', () => {
        const { store, listener } = setup();
        const state = store.getState();
        state.setTab('files');
        state.setWidth(SIDEBAR_DEFAULT_WIDTH);
        state.setFileFilter('');
        state.select(null);
        state.setShowsBuildFiles(false);
        state.setFolderExpanded('/p/a', false);
        state.setExtensionHidden('png', false);
        state.expandFolders([]);
        state.showAllExtensions();
        state.resetForProject();
        expect(listener).not.toHaveBeenCalled();
        state.setTab('outline');
        state.setWidth(300);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('klappt Ordner auf und zu und behält die Menge bei Wiederholung', () => {
        const { store, listener } = setup();
        store.getState().setFolderExpanded('/p/a', true);
        const first = store.getState().expandedFolders;
        store.getState().setFolderExpanded('/p/a', true);
        expect(store.getState().expandedFolders).toBe(first);
        store.getState().toggleFolder('/p/b');
        expect([...store.getState().expandedFolders]).toEqual(['/p/a', '/p/b']);
        store.getState().toggleFolder('/p/a');
        expect([...store.getState().expandedFolders]).toEqual(['/p/b']);
        store.getState().expandFolders(['/p/b', '/p/c']);
        expect([...store.getState().expandedFolders]).toEqual(['/p/b', '/p/c']);
        expect(listener).toHaveBeenCalledTimes(4);
    });

    it('merkt ausgeblendete Dateitypen und zeigt alle wieder', () => {
        const { store } = setup();
        store.getState().setExtensionHidden('png', true);
        store.getState().setExtensionHidden('', true);
        expect([...store.getState().hiddenExtensions]).toEqual(['png', '']);
        store.getState().showAllExtensions();
        expect(store.getState().hiddenExtensions.size).toBe(0);
    });

    it('setzt beim Projektwechsel Ordner, Auswahl und Filter zurück, nicht Typen und Breite', () => {
        const { store } = setup();
        const state = store.getState();
        state.setFolderExpanded('/p/a', true);
        state.select('/p/a/x.tex');
        state.setFileFilter('x');
        state.setExtensionHidden('png', true);
        state.setWidth(300);
        state.resetForProject();
        expect(store.getState()).toMatchObject({ selectedPath: null, fileFilter: '', width: 300 });
        expect(store.getState().expandedFolders.size).toBe(0);
        expect([...store.getState().hiddenExtensions]).toEqual(['png']);
    });
});
