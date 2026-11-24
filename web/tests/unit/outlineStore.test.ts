import { afterEach, describe, expect, it, vi } from 'vitest';
import { OUTLINE_REFRESH_DELAY_MS, createOutlineStore } from '../../src/renderer/stores/outline';

afterEach(() => vi.useRealTimers());

function setup(initial: Record<string, string>) {
    const files = { ...initial };
    const reads: string[] = [];
    const readFile = (path: string): string | null => {
        reads.push(path);
        return files[path] ?? null;
    };
    const store = createOutlineStore({ readFile });
    const listener = vi.fn();
    return { files, reads, store, listener };
}

describe('Gliederungs-Store', () => {
    it('setzt Gliederung, Baum und Zuordnung beim Setzen der Hauptdatei', async () => {
        const { store } = setup({ 'main.tex': '\\chapter{A}\\input{b}', 'b.tex': '\\section{B}' });
        store.getState().setMainFile('main.tex');
        await store.getState().refreshNow();
        const state = store.getState();
        expect(state.entries.map((entry) => entry.title)).toEqual(['A', 'B']);
        expect(state.tree).toHaveLength(1);
        expect(state.includingFile).toEqual({ 'b.tex': 'main.tex' });
        expect(state.includeChainTo('b.tex')).toEqual(['main.tex', 'b.tex']);
    });

    it('meldet bei unverändertem Ergebnis nichts', async () => {
        const { store, listener } = setup({ 'main.tex': '\\chapter{A}' });
        store.getState().setMainFile('main.tex');
        await store.getState().refreshNow();
        store.subscribe(listener);
        await store.getState().refreshNow();
        store.getState().setMainFile('main.tex');
        expect(listener).not.toHaveBeenCalled();
    });

    it('entprellt requestRefresh mit gefälschtem Zeitgeber', async () => {
        vi.useFakeTimers();
        const { store, files, listener } = setup({ 'main.tex': '\\chapter{Alt}' });
        store.getState().setMainFile('main.tex');
        await vi.advanceTimersByTimeAsync(0);
        store.subscribe(listener);
        files['main.tex'] = '\\chapter{Neu}';
        store.getState().requestRefresh();
        await vi.advanceTimersByTimeAsync(OUTLINE_REFRESH_DELAY_MS - 1);
        store.getState().requestRefresh();
        await vi.advanceTimersByTimeAsync(OUTLINE_REFRESH_DELAY_MS - 1);
        expect(store.getState().entries[0]?.title).toBe('Alt');
        await vi.advanceTimersByTimeAsync(1);
        expect(store.getState().entries[0]?.title).toBe('Neu');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('currentEntryId wird nur bei Änderung gesetzt und folgt neuen Einträgen', async () => {
        const { store, files, listener } = setup({ 'main.tex': '\\chapter{A}\n\\section{B}\ntext' });
        store.getState().setMainFile('main.tex');
        await store.getState().refreshNow();
        store.subscribe(listener);
        store.getState().updateCursor('main.tex', 1);
        store.getState().updateCursor('main.tex', 1);
        expect(listener).toHaveBeenCalledTimes(1);
        store.getState().updateCursor('main.tex', 3);
        expect(store.getState().currentEntryId).toBe('main.tex:12');
        files['main.tex'] = '\\chapter{A}\n\\section{B}\n\\section{C}\ntext';
        await store.getState().refreshNow();
        store.getState().updateCursor('main.tex', 4);
        expect(store.getState().currentEntryId).toBe('main.tex:24');
    });

    it('verwirft veraltete Ergebnisse und leert ohne Hauptdatei', async () => {
        const { store } = setup({ 'main.tex': '\\chapter{A}' });
        store.getState().setMainFile('main.tex');
        await store.getState().refreshNow();
        store.getState().setMainFile(null);
        await store.getState().refreshNow();
        expect(store.getState()).toMatchObject({ entries: [], tree: [], includingFile: {}, currentEntryId: null });
    });

    it('hält keinen Text im Zustand', async () => {
        const { store } = setup({ 'main.tex': 'GEHEIMER TEXT \\chapter{A}' });
        store.getState().setMainFile('main.tex');
        await store.getState().refreshNow();
        const { setMainFile, requestRefresh, refreshNow, updateCursor, includeChainTo, ...data } = store.getState();
        void [setMainFile, requestRefresh, refreshNow, updateCursor, includeChainTo];
        expect(JSON.stringify(data)).not.toContain('GEHEIMER');
    });
});
