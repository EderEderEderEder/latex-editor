import { describe, expect, it } from 'vitest';
import {
    EMPTY_TABS, activateNextTab, activatePreviousTab, activateTab, closeAllTabs, closeOtherTabs, closeTab, moveTab,
    openTab, promoteTab, relocateTabs, tabsUnder,
} from '../../src/shared/core/tabs';
import type { TabsState } from '../../src/shared/core/tabs';

// Fälle aus swift/Tests/LatexEditorTests/EditorTabsTests.swift (Datei-Tabs; Diff-Tabs und TabMemory folgen später).

const path = (name: string): string => `/p/${name}.tex`;

function tabs(names: string[], options: { active?: string; preview?: string } = {}): TabsState {
    let state = EMPTY_TABS;
    for (const name of names) state = openTab(state, path(name), false).tabs;
    if (options.preview) state = openTab(state, path(options.preview), true).tabs;
    if (options.active) state = activateTab(state, path(options.active));
    return state;
}

function names(state: TabsState): string[] {
    return state.items.map((item) => item.slice('/p/'.length, -'.tex'.length));
}

describe('Tabs: Öffnen und Vorschau-Tab', () => {
    it('ein neuer Tab steht rechts vom aktiven und wird aktiv', () => {
        const { tabs: state } = openTab(tabs(['a', 'b', 'c'], { active: 'a' }), path('d'), false);
        expect(names(state)).toEqual(['a', 'd', 'b', 'c']);
        expect(state.active).toBe(path('d'));
    });

    it('Vorschau-Tab wird beim Öffnen einer anderen Datei ersetzt, an derselben Stelle', () => {
        const result = openTab(tabs(['a', 'b'], { preview: 'p' }), path('q'), true);
        expect(result.replaced).toBe(path('p'));
        expect(names(result.tabs)).toEqual(['a', 'b', 'q']);
        expect(result.tabs.preview).toBe(path('q'));
        expect(result.tabs.active).toBe(path('q'));
    });

    it('festgehaltener Tab wird nicht ersetzt, ein neuer Vorschau-Tab entsteht', () => {
        const promoted = promoteTab(tabs(['a'], { preview: 'p' }), path('p'));
        const result = openTab(promoted, path('q'), true);
        expect(result.replaced).toBeNull();
        expect(names(result.tabs)).toEqual(['a', 'p', 'q']);
        expect(result.tabs.preview).toBe(path('q'));
    });

    it('vorhandenen Tab öffnen aktiviert nur; festes Öffnen hält die Vorschau fest', () => {
        const start = tabs(['a', 'b'], { active: 'a', preview: 'p' });
        const reopened = openTab(start, path('b'), true);
        expect(reopened.replaced).toBeNull();
        expect(reopened.tabs.active).toBe(path('b'));
        expect(reopened.tabs.preview).toBe(path('p'));
        const pinned = openTab(reopened.tabs, path('p'), false).tabs;
        expect(pinned.preview).toBeNull();
        expect(names(pinned)).toEqual(['a', 'b', 'p']);
    });

    it('es gibt höchstens einen Vorschau-Tab', () => {
        let state = EMPTY_TABS;
        for (const name of ['a', 'b', 'c', 'd']) state = openTab(state, path(name), true).tabs;
        expect(names(state)).toEqual(['d']);
    });

    it('unbekannten Tab aktivieren oder festhalten ändert nichts', () => {
        const start = tabs(['a', 'b'], { active: 'a' });
        expect(promoteTab(activateTab(start, path('x')), path('x'))).toBe(start);
    });
});

describe('Tabs: Schließen, Wechseln, Reihenfolge', () => {
    it('aktiven Tab schließen aktiviert den rechten Nachbarn, am Ende den linken', () => {
        let state = tabs(['a', 'b', 'c'], { active: 'b' });
        state = closeTab(state, path('b'));
        expect(state.active).toBe(path('c'));
        state = closeTab(state, path('c'));
        expect(state.active).toBe(path('a'));
        state = closeTab(state, path('a'));
        expect(state.active).toBeNull();
        expect(state.items).toEqual([]);
    });

    it('inaktiven Tab schließen lässt den aktiven', () => {
        const state = closeTab(tabs(['a', 'b', 'c'], { active: 'c' }), path('a'));
        expect(state.active).toBe(path('c'));
        expect(names(state)).toEqual(['b', 'c']);
    });

    it('Schließen entfernt auch den Vorschau-Status; unbekannte Datei ändert nichts', () => {
        const state = closeTab(tabs(['a'], { preview: 'p' }), path('p'));
        expect(state.preview).toBeNull();
        expect(closeTab(state, path('zzz'))).toBe(state);
    });

    it('andere schließen und alle schließen', () => {
        const others = closeOtherTabs(tabs(['a', 'b', 'c'], { active: 'a', preview: 'p' }), path('b'));
        expect(names(others)).toEqual(['b']);
        expect(others.active).toBe(path('b'));
        expect(others.preview).toBeNull();
        const none = closeAllTabs(others);
        expect(none.items).toEqual([]);
        expect(none.active).toBeNull();
    });

    it('Wechsel zum nächsten und vorherigen Tab springt am Rand herum', () => {
        let state = activateNextTab(tabs(['a', 'b', 'c'], { active: 'c' }));
        expect(state.active).toBe(path('a'));
        state = activatePreviousTab(state);
        expect(state.active).toBe(path('c'));
        const single = tabs(['a']);
        expect(activateNextTab(single)).toBe(single);
    });

    it('Verschieben ändert die Reihenfolge, nicht den aktiven Tab', () => {
        let state = moveTab(tabs(['a', 'b', 'c', 'd'], { active: 'b' }), path('d'), path('a'));
        expect(names(state)).toEqual(['d', 'a', 'b', 'c']);
        state = moveTab(state, path('a'), path('c'));
        expect(names(state)).toEqual(['d', 'b', 'c', 'a']);
        expect(state.active).toBe(path('b'));
        expect(moveTab(state, path('x'), path('a'))).toBe(state);
    });
});

describe('Tabs: Pfade ändern', () => {
    it('Umbenennen behält Position, Vorschau und aktiven Tab', () => {
        const start = tabs(['a', 'b'], { active: 'a', preview: 'p' });
        const { tabs: state, mapping } = relocateTabs(start, path('p'), path('q'));
        expect(names(state)).toEqual(['a', 'b', 'q']);
        expect(state.preview).toBe(path('q'));
        expect(state.active).toBe(path('a'));
        expect([...mapping]).toEqual([[path('p'), path('q')]]);
    });

    it('verschobener Ordner nimmt alle Tabs darunter mit, auch mit Windows-Trennern', () => {
        let state = EMPTY_TABS;
        for (const item of ['/p/kap/a.tex', '/p/kapitel.tex', 'C:\\p\\kap\\b.tex']) state = openTab(state, item, false).tabs;
        expect(relocateTabs(state, '/p/kap', '/p/neu').tabs.items).toEqual(['/p/neu/a.tex', '/p/kapitel.tex', 'C:\\p\\kap\\b.tex']);
        expect(relocateTabs(state, 'C:\\p\\kap', 'C:\\p\\x').tabs.items[2]).toBe('C:\\p\\x\\b.tex');
        expect(tabsUnder(state, '/p/kap')).toEqual(['/p/kap/a.tex']);
    });
});
