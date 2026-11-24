import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RendererApi } from '../../src/shared/contract';
import { TREE_REFRESH_DELAY_MS, createProjectStore, mergeProjectView, projectViewOf } from '../../src/renderer/stores/project';
import { createPreloadStub } from '../support/preloadStub';

afterEach(() => vi.useRealTimers());

const GRANT = 'stub-project-grant';

function setup() {
    const stub = createPreloadStub();
    const control = (stub.api as unknown as { __stub: { installSampleProject(extra?: number): void; addProjectFile(path: string, text: string): void } }).__stub;
    control.installSampleProject();
    const store = createProjectStore({ api: () => stub.api as RendererApi });
    const listener = vi.fn();
    return { stub, control, store, listener };
}

async function openSample(store: ReturnType<typeof setup>['store'], stub: ReturnType<typeof setup>['stub']): Promise<void> {
    const opened = await stub.api.project.open(GRANT);
    if (!opened.ok) throw new Error('Stub-Projekt fehlt');
    store.getState().setProject(opened.value, GRANT);
}

describe('Projekt-Store', () => {
    it('hält Name, Wurzel, Baum und Hauptdatei des geöffneten Projekts', async () => {
        const { store, stub } = setup();
        await openSample(store, stub);
        const current = store.getState().current;
        expect(current).toMatchObject({ root: '/stub/projekt', name: 'projekt', mainFile: '/stub/projekt/main.tex', truncated: false });
        expect(current?.tree.children.map((child) => child.name)).toEqual(['bilder', 'kapitel', 'literatur.bib', 'main.aux', 'main.tex']);
        expect(store.getState().grantId).toBe(GRANT);
    });

    it('setzt beim Neuholen mit gleichem Ergebnis nichts', async () => {
        const { store, stub, listener } = setup();
        await openSample(store, stub);
        const before = store.getState().current;
        store.subscribe(listener);
        expect(await store.getState().refreshTree()).toBe(true);
        expect(store.getState().current).toBe(before);
        expect(listener).not.toHaveBeenCalled();
    });

    it('übernimmt einen geänderten Baum und behält unveränderte Teile', async () => {
        const { store, stub, control, listener } = setup();
        await openSample(store, stub);
        const before = store.getState().current;
        store.subscribe(listener);
        control.addProjectFile('neu.tex', '');
        await store.getState().refreshTree();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(store.getState().current?.tree.children.map((child) => child.name)).toContain('neu.tex');
        expect(store.getState().current?.root).toBe(before?.root);
    });

    it('entprellt requestRefresh mit gefälschtem Zeitgeber', async () => {
        vi.useFakeTimers();
        const { store, stub, control } = setup();
        await openSample(store, stub);
        control.addProjectFile('neu.tex', '');
        const opens = (): number => stub.calls.filter((call) => call.channel === 'project:open').length;
        const before = opens();
        store.getState().requestRefresh();
        await vi.advanceTimersByTimeAsync(TREE_REFRESH_DELAY_MS - 1);
        store.getState().requestRefresh();
        await vi.advanceTimersByTimeAsync(TREE_REFRESH_DELAY_MS - 1);
        expect(opens()).toBe(before);
        await vi.advanceTimersByTimeAsync(1);
        expect(opens()).toBe(before + 1);
        expect(store.getState().current?.tree.children.some((child) => child.name === 'neu.tex')).toBe(true);
    });

    it('behält bei einem Fehler den alten Baum und verwirft veraltete Ergebnisse', async () => {
        const { store, stub } = setup();
        await openSample(store, stub);
        const before = store.getState().current;
        stub.respond('project:open', () => {
            throw new Error('weg');
        });
        expect(await store.getState().refreshTree()).toBe(false);
        expect(store.getState().current).toBe(before);
        stub.respond('project:open', () => before!.tree && { root: '/anderes', mainFile: null, tree: { ...before!.tree, path: '/anderes' } });
        const pending = store.getState().refreshTree();
        store.getState().clearProject();
        expect(await pending).toBe(false);
        expect(store.getState().current).toBeNull();
    });

    it('lädt „Zuletzt geöffnet“ nur bei Änderung', async () => {
        const { store, listener } = setup();
        await store.getState().loadRecent();
        expect(store.getState().recent).toEqual([{ grantId: GRANT, name: 'projekt', openedAt: 0 }]);
        store.subscribe(listener);
        await store.getState().loadRecent();
        expect(listener).not.toHaveBeenCalled();
    });

    it('mergeProjectView behält das Objekt, wenn sich nichts ändert, und wechselt bei anderer Wurzel', async () => {
        const { stub } = setup();
        const opened = await stub.api.project.open(GRANT);
        if (!opened.ok) throw new Error('Stub-Projekt fehlt');
        const view = projectViewOf(opened.value);
        const copy = projectViewOf(JSON.parse(JSON.stringify(opened.value)) as typeof opened.value);
        expect(mergeProjectView(view, copy)).toBe(view);
        expect(mergeProjectView(view, { ...copy, mainFile: null }).tree).toBe(view.tree);
        expect(mergeProjectView(view, { ...copy, root: '/x' })).toEqual({ ...copy, root: '/x' });
        expect(mergeProjectView(null, copy)).toBe(copy);
    });
});
