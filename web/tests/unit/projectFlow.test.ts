import { describe, expect, it, vi } from 'vitest';
import type { RendererApi, TextFile } from '../../src/shared/contract';
import { chooseAndOpenProject, openProjectByGrant, projectTabPaths } from '../../src/renderer/app/projectFlow';
import type { ProjectFlowDeps } from '../../src/renderer/app/projectFlow';
import { createEditorStore } from '../../src/renderer/stores/editor';
import { createProjectStore } from '../../src/renderer/stores/project';
import { createSidebarStore } from '../../src/renderer/stores/sidebar';
import { createPreloadStub } from '../support/preloadStub';

const GRANT = 'stub-project-grant';
const ROOT = '/stub/projekt';

function file(path: string, text = 'x'): TextFile {
    return { path, name: path.split('/').at(-1) ?? path, text, encoding: 'utf8', eol: 'lf', hash: 'h', mtime: 0 };
}

function setup(ask: ProjectFlowDeps['ask'] = () => Promise.resolve('discard')) {
    const stub = createPreloadStub();
    const control = (stub.api as unknown as { __stub: { installSampleProject(extra?: number): void } }).__stub;
    control.installSampleProject();
    const stubApi = stub.api as RendererApi;
    const log: string[] = [];
    const api = {
        ...stubApi,
        project: {
            ...stubApi.project,
            open: (grantId: string) => {
                log.push('open');
                return stubApi.project.open(grantId);
            },
        },
    } as RendererApi;
    const project = createProjectStore({ api: () => api });
    const editor = createEditorStore();
    const sidebar = createSidebarStore();
    const memory = {
        start: vi.fn((root: string) => {
            log.push(`start ${root}`);
            return Promise.resolve({ opened: 0, skipped: 0 });
        }),
        stop: vi.fn(() => {
            log.push('stop');
            return Promise.resolve();
        }),
    };
    const report = vi.fn();
    const deps: ProjectFlowDeps = { api, project, editor, sidebar, memory, ask, report };
    return { stub, deps, project, editor, sidebar, memory, report, log };
}

describe('Projekt öffnen', () => {
    it('stoppt das Gedächtnis vor project:open und startet es danach für das neue Projekt', async () => {
        const { deps, project, log } = setup();
        expect(await openProjectByGrant(deps, GRANT)).toBe(true);
        expect(project.getState().current?.root).toBe(ROOT);
        expect(log).toEqual(['stop', 'open', `start ${ROOT}`]);
    });

    it('ruft über den Dialog dieselbe Folge auf; Abbrechen im Dialog ändert nichts', async () => {
        const { stub, deps, project, memory } = setup();
        stub.respond('dialog:openProject', () => null);
        expect(await chooseAndOpenProject(deps)).toBe(false);
        expect(memory.stop).not.toHaveBeenCalled();
        stub.respond('dialog:openProject', () => ({ grantId: GRANT, name: 'projekt' }));
        expect(await chooseAndOpenProject(deps)).toBe(true);
        expect(project.getState().current?.name).toBe('projekt');
    });

    it('meldet einen Fehler, lässt das alte Projekt und nimmt dessen Gedächtnis wieder auf', async () => {
        const { stub, deps, project, memory, report } = setup();
        await openProjectByGrant(deps, GRANT);
        memory.start.mockClear();
        stub.respond('project:open', () => {
            throw new Error('Der Projektordner existiert nicht mehr');
        });
        expect(await openProjectByGrant(deps, GRANT)).toBe(false);
        expect(project.getState().current?.root).toBe(ROOT);
        expect(memory.start).toHaveBeenCalledWith(ROOT);
        expect(report).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
    });

    it('schließt beim Wechsel nur Tabs des alten Projekts und setzt die Seitenleiste zurück', async () => {
        const { stub, deps, editor, sidebar, project } = setup();
        await openProjectByGrant(deps, GRANT);
        editor.getState().open(file(`${ROOT}/main.tex`), { asPreview: false });
        editor.getState().open(file('dialog-grant-1'), { asPreview: false });
        sidebar.getState().setFolderExpanded(`${ROOT}/kapitel`, true);
        expect(projectTabPaths(deps)).toEqual([`${ROOT}/main.tex`]);
        const info = await stub.api.project.open(GRANT);
        if (!info.ok) throw new Error('Stub-Projekt fehlt');
        const other = { ...info.value, root: '/stub/anderes', tree: { ...info.value.tree, name: 'anderes', path: '/stub/anderes' } };
        stub.respond('project:open', () => other);
        expect(await openProjectByGrant(deps, GRANT)).toBe(true);
        expect(editor.getState().tabs.items).toEqual(['dialog-grant-1']);
        expect(sidebar.getState().expandedFolders.size).toBe(0);
        expect(project.getState().current?.name).toBe('anderes');
    });

    it('fragt bei ungespeicherten Tabs; Abbrechen ändert nichts', async () => {
        const ask = vi.fn(() => Promise.resolve<'cancel'>('cancel'));
        const { deps, editor, memory, project } = setup(ask);
        await openProjectByGrant(deps, GRANT);
        editor.getState().open(file(`${ROOT}/main.tex`, 'a'), { asPreview: false });
        editor.getState().session(`${ROOT}/main.tex`)?.dispatch({ changes: { from: 0, insert: 'neu' } });
        memory.stop.mockClear();
        expect(await openProjectByGrant(deps, GRANT)).toBe(false);
        expect(ask).toHaveBeenCalledWith('main.tex');
        expect(memory.stop).not.toHaveBeenCalled();
        expect(editor.getState().tabs.items).toEqual([`${ROOT}/main.tex`]);
        expect(project.getState().current?.root).toBe(ROOT);
    });

    it('verwirft bei „Nicht speichern“ die Änderungen und wechselt', async () => {
        const { deps, editor } = setup(() => Promise.resolve('discard'));
        await openProjectByGrant(deps, GRANT);
        editor.getState().open(file(`${ROOT}/main.tex`, 'a'), { asPreview: false });
        editor.getState().session(`${ROOT}/main.tex`)?.dispatch({ changes: { from: 0, insert: 'neu' } });
        expect(await openProjectByGrant(deps, GRANT)).toBe(true);
        expect(editor.getState().tabs.items).toEqual([]);
    });

    it('meldet nicht wiederhergestellte Tabs', async () => {
        const { deps, memory, report } = setup();
        memory.start.mockResolvedValueOnce({ opened: 1, skipped: 2 });
        await openProjectByGrant(deps, GRANT);
        expect(report).toHaveBeenCalledWith({ text: '2 gemerkte Tabs konnten nicht geöffnet werden.', kind: 'info' });
    });
});
