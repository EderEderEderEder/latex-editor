import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventListener, RendererApi } from '../../src/shared/contract';
import { connectFsEvents, connectProjectToOutline } from '../../src/renderer/app/projectSync';
import { TREE_REFRESH_DELAY_MS, createProjectStore } from '../../src/renderer/stores/project';
import { createPreloadStub } from '../support/preloadStub';

afterEach(() => vi.useRealTimers());

const GRANT = 'stub-project-grant';

async function setup() {
    const stub = createPreloadStub();
    const control = (stub.api as unknown as { __stub: { installSampleProject(extra?: number): void; addProjectFile(path: string, text: string): void } }).__stub;
    control.installSampleProject();
    const store = createProjectStore({ api: () => stub.api as RendererApi });
    const opened = await stub.api.project.open(GRANT);
    if (!opened.ok) throw new Error('Stub-Projekt fehlt');
    store.getState().setProject(opened.value, GRANT);
    const outline = { setMainFile: vi.fn(), requestRefresh: vi.fn() };
    return { stub, control, store, outline };
}

describe('Projekt und Gliederung', () => {
    it('gibt die Hauptdatei beim Verbinden und bei Wechseln weiter', async () => {
        const { store, outline } = await setup();
        connectProjectToOutline(store, () => outline);
        expect(outline.setMainFile).toHaveBeenLastCalledWith('/stub/projekt/main.tex');
        store.getState().clearProject();
        expect(outline.setMainFile).toHaveBeenLastCalledWith(null);
    });

    it('lässt die Gliederung nachziehen, wenn nur der Baum desselben Projekts neu kommt', async () => {
        const { store, outline, control } = await setup();
        connectProjectToOutline(store, () => outline);
        outline.requestRefresh.mockClear();
        control.addProjectFile('neu.tex', '');
        await store.getState().refreshTree();
        expect(outline.requestRefresh).toHaveBeenCalledTimes(1);
    });
});

describe('fs:changed', () => {
    function connect(project: Awaited<ReturnType<typeof setup>>) {
        let listener: EventListener<'fs:changed'> | null = null;
        const stop = vi.fn();
        connectFsEvents((next) => {
            listener = next;
            return stop;
        }, project.store, () => project.outline);
        return (event: Partial<Parameters<EventListener<'fs:changed'>>[0]>) =>
            listener?.({ paths: [], kinds: [], treeChanged: false, gitChanged: false, ...event });
    }

    it('holt den Baum nur bei treeChanged und entprellt', async () => {
        vi.useFakeTimers();
        const project = await setup();
        const send = connect(project);
        const opens = (): number => project.stub.calls.filter((call) => call.channel === 'project:open').length;
        const before = opens();
        send({ treeChanged: false, paths: ['/stub/projekt/main.aux'] });
        send({ treeChanged: true });
        send({ treeChanged: true });
        await vi.advanceTimersByTimeAsync(TREE_REFRESH_DELAY_MS);
        expect(opens()).toBe(before + 1);
    });

    it('aktualisiert die Gliederung nur für geänderte .tex-Dateien', async () => {
        const project = await setup();
        const send = connect(project);
        send({ paths: ['/stub/projekt/main.aux'] });
        expect(project.outline.requestRefresh).not.toHaveBeenCalled();
        send({ paths: ['/stub/projekt/kapitel/eins.TEX'] });
        expect(project.outline.requestRefresh).toHaveBeenCalledTimes(1);
    });

    it('tut ohne Projekt nichts', async () => {
        const project = await setup();
        const send = connect(project);
        project.store.getState().clearProject();
        send({ treeChanged: true, paths: ['/x/a.tex'] });
        expect(project.outline.requestRefresh).not.toHaveBeenCalled();
    });
});
