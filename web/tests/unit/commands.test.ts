import { describe, expect, it, vi } from 'vitest';
import type { TextFile } from '../../src/shared/contract';
import { COMPLETION_TEXTS, createCommandRegistry, runCommand, saveAllDirtyTabs } from '../../src/renderer/app/commands';
import type { CommandDeps } from '../../src/renderer/app/commands';
import { gotoLine } from '../../src/renderer/app/gotoLine';
import { quickOpenFilesOf } from '../../src/renderer/app/quickOpenFiles';
import { createEditorStore } from '../../src/renderer/stores/editor';
import { createOverlayStore } from '../../src/renderer/stores/overlays';
import { createSidebarStore } from '../../src/renderer/stores/sidebar';
import type { StatusMessage } from '../../src/renderer/stores/status';
import { createPreloadStub } from '../support/preloadStub';

function textFile(path: string, name: string, text = 'Text'): TextFile {
    return { path, name, text, encoding: 'utf8', eol: 'lf', hash: 'h', mtime: 0 };
}

function setup() {
    const stub = createPreloadStub();
    const store = createEditorStore();
    const overlays = createOverlayStore();
    const sidebar = createSidebarStore();
    const messages: StatusMessage[] = [];
    const compile = vi.fn(() => Promise.resolve('started'));
    const ask = vi.fn(() => Promise.resolve('cancel' as const));
    const fileActions = () => ({ api: stub.api, store, report: (message: StatusMessage) => messages.push(message) });
    const deps = {
        fileActions, tabClose: () => ({ ...fileActions(), ask }), projectFlow: vi.fn(), editor: store,
        build: { getState: () => ({ compile, cancel: vi.fn(), clean: vi.fn(() => Promise.resolve(true)), navigate: vi.fn(() => null) }) },
        overlays, sidebar, settings: { getState: vi.fn() }, activeView: () => null, focusEditor: vi.fn(), reveal: vi.fn(),
        report: (message: StatusMessage) => messages.push(message), confirmClean: () => false,
    } as unknown as CommandDeps;
    const open = (path: string, name: string, dirty: boolean): void => {
        store.getState().open(textFile(path, name), { asPreview: false });
        if (dirty) store.getState().session(path)!.dispatch({ changes: { from: 0, insert: 'x' } });
    };
    return { stub, store, overlays, sidebar, messages, compile, ask, deps, open };
}

describe('Befehlsregister', () => {
    it('Strg+P und Strg+G öffnen ihre Dialoge; Gehe zu Zeile nur mit offenem Tab', async () => {
        const { deps, overlays, open } = setup();
        const registry = createCommandRegistry(deps);
        await runCommand(registry, 'edit.gotoLine', deps.report);
        expect(overlays.getState().active).toBeNull();
        open('/p/a.tex', 'a.tex', false);
        await runCommand(registry, 'edit.gotoLine', deps.report);
        expect(overlays.getState().active).toBe('gotoLine');
        await runCommand(registry, 'edit.quickOpen', deps.report);
        expect(overlays.getState().active).toBe('quickOpen');
    });

    it('Tab schließen fragt bei Änderungen nach und lässt den Tab bei Abbrechen offen', async () => {
        const { deps, open, ask, store } = setup();
        open('/p/a.tex', 'a.tex', true);
        await runCommand(createCommandRegistry(deps), 'file.closeTab', deps.report);
        expect(ask).toHaveBeenCalledOnce();
        expect(store.getState().tabs.items).toEqual(['/p/a.tex']);
    });

    it('Tab schließen ohne Änderungen schließt sofort', async () => {
        const { deps, open, ask, store } = setup();
        open('/p/a.tex', 'a.tex', false);
        await runCommand(createCommandRegistry(deps), 'file.closeTab', deps.report);
        expect(ask).not.toHaveBeenCalled();
        expect(store.getState().tabs.items).toEqual([]);
    });

    it('Alle speichern schreibt genau die geänderten Tabs', async () => {
        const { deps, open, stub, store } = setup();
        open('/p/a.tex', 'a.tex', true);
        open('/p/b.tex', 'b.tex', false);
        open('/p/c.tex', 'c.tex', true);
        await saveAllDirtyTabs(deps.fileActions());
        const writes = stub.calls.filter((call) => call.channel === 'fs:writeText').map((call) => call.args[0]);
        expect(writes).toEqual(['/p/a.tex', '/p/c.tex']);
        expect(store.getState().files['/p/a.tex']?.isDirty).toBe(false);
    });

    it('Kompilieren und Seitenleisten-Tabs', async () => {
        const { deps, compile, sidebar } = setup();
        const registry = createCommandRegistry(deps);
        await runCommand(registry, 'project.compile', deps.report);
        expect(compile).toHaveBeenCalledOnce();
        await runCommand(registry, 'project.showIssues', deps.report);
        expect(sidebar.getState().tab).toBe('issues');
    });

    it('Hilfsdateien löschen nur nach Bestätigung', async () => {
        const { deps } = setup();
        const clean = vi.fn(() => Promise.resolve(true));
        const build = { getState: () => ({ clean }) } as unknown as CommandDeps['build'];
        await runCommand(createCommandRegistry({ ...deps, build, confirmClean: () => false }), 'project.clean', deps.report);
        expect(clean).not.toHaveBeenCalled();
        await runCommand(createCommandRegistry({ ...deps, build, confirmClean: () => true }), 'project.clean', deps.report);
        expect(clean).toHaveBeenCalledOnce();
    });

    it('„PDF folgt Cursor“ schaltet die Einstellung um und nennt den neuen Zustand (W3-5)', async () => {
        const { deps, messages } = setup();
        const values = { compilesOnSave: true, pdfFollowsCursor: false };
        const set = vi.fn((key: 'compilesOnSave' | 'pdfFollowsCursor', value: boolean) => {
            values[key] = value;
            return Promise.resolve();
        });
        const settings = { getState: () => ({ values, set }) } as unknown as CommandDeps['settings'];
        const registry = createCommandRegistry({ ...deps, settings });
        await runCommand(registry, 'view.toggleFollowCursor', deps.report);
        expect(set).toHaveBeenCalledWith('pdfFollowsCursor', true);
        await runCommand(registry, 'view.toggleFollowCursor', deps.report);
        expect(values.pdfFollowsCursor).toBe(false);
        expect(messages.map((message) => message.text)).toEqual(['PDF folgt dem Cursor.', 'PDF folgt dem Cursor nicht mehr.']);
    });

    it('„Automatische Vervollständigung“ schaltet `autoComplete` um und nennt den Zustand (W4-6)', async () => {
        const { deps, messages } = setup();
        const values = { compilesOnSave: true, pdfFollowsCursor: false, autoComplete: true };
        const set = vi.fn((key: 'autoComplete', value: boolean) => {
            values[key] = value;
            return Promise.resolve();
        });
        const settings = { getState: () => ({ values, set }) } as unknown as CommandDeps['settings'];
        const registry = createCommandRegistry({ ...deps, settings });
        await runCommand(registry, 'edit.toggleAutoComplete', deps.report);
        expect(set).toHaveBeenCalledWith('autoComplete', false);
        await runCommand(registry, 'edit.toggleAutoComplete', deps.report);
        expect(values.autoComplete).toBe(true);
        expect(messages.map((message) => message.text)).toEqual([COMPLETION_TEXTS.automaticOff, COMPLETION_TEXTS.automaticOn]);
        await runCommand(registry, 'edit.triggerCompletion', deps.report);
        expect(messages).toHaveLength(2);
    });

    it('unbekannte IDs werden ignoriert, Fehler als Meldung gezeigt', async () => {
        const { deps, messages } = setup();
        await runCommand(new Map(), 'gibt.es.nicht', deps.report);
        expect(messages).toEqual([]);
        await runCommand(new Map([['x', () => { throw new Error('kaputt'); }]]), 'x', deps.report);
        expect(messages[0]).toMatchObject({ kind: 'error' });
    });
});

describe('Schnell öffnen und Gehe zu Zeile', () => {
    it('Dateiliste: relative Pfade, offene markiert, Build- und Binärdateien ohne', () => {
        const project = {
            root: '/p', name: 'p', mainFile: null, truncated: false,
            tree: {
                kind: 'directory', name: 'p', path: '/p', children: [
                    { kind: 'file', name: 'main.tex', path: '/p/main.tex' },
                    { kind: 'file', name: 'main.aux', path: '/p/main.aux', isBuildFile: true },
                    { kind: 'directory', name: 'kap', path: '/p/kap', children: [{ kind: 'file', name: 'a.tex', path: '/p/kap/a.tex' }] },
                ],
            },
        } as const;
        const list = quickOpenFilesOf(project as never, ['/p/kap/a.tex']);
        expect(list.files).toEqual([{ path: 'main.tex', isOpen: false }, { path: 'kap/a.tex', isOpen: true }]);
        expect(list.absolutePaths.get('kap/a.tex')).toBe('/p/kap/a.tex');
        expect(quickOpenFilesOf(null, []).files).toEqual([]);
    });

    it('Gehe zu Zeile setzt den Cursor, Spalte wird gekürzt', () => {
        const { store, open } = setup();
        open('/p/a.tex', 'a.tex', false);
        const session = store.getState().session('/p/a.tex')!;
        session.dispatch({ changes: { from: 0, to: 4, insert: 'eins\nzwei\ndrei' } });
        gotoLine(session, 2, 3);
        expect(session.selection.head).toBe(5 + 2);
        gotoLine(session, 3, 99);
        expect(session.selection.head).toBe(session.state.doc.length);
    });
});
