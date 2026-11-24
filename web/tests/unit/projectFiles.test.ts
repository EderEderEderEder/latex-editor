import { describe, expect, it, vi } from 'vitest';
import type { RendererApi } from '../../src/shared/contract';
import { IpcFailure } from '../../src/shared/ipcResult';
import { PROJECT_FILE_TEXTS, openProjectFile } from '../../src/renderer/app/projectFiles';
import type { ProjectFileDeps } from '../../src/renderer/app/projectFiles';
import { createEditorStore } from '../../src/renderer/stores/editor';
import { createPreloadStub } from '../support/preloadStub';

const ROOT = '/stub/projekt';

function setup() {
    const stub = createPreloadStub();
    const control = (stub.api as unknown as { __stub: { installSampleProject(extra?: number): void } }).__stub;
    control.installSampleProject();
    const store = createEditorStore();
    const report = vi.fn();
    const deps: ProjectFileDeps = { api: stub.api as RendererApi, store, report };
    const reads = () => stub.calls.filter((call) => call.channel === 'fs:readText').length;
    return { stub, store, report, deps, reads };
}

describe('Projektdatei öffnen', () => {
    it('öffnet Einzelklick als Vorschau-Tab mit dem Text vom absoluten Pfad', async () => {
        const { store, deps, stub } = setup();
        expect(await openProjectFile(deps, `${ROOT}/main.tex`, true)).toBe(true);
        const state = store.getState();
        expect(state.tabs).toMatchObject({ active: `${ROOT}/main.tex`, preview: `${ROOT}/main.tex` });
        expect(state.session(`${ROOT}/main.tex`)?.state.doc.toString()).toContain('\\chapter{Einleitung}');
        expect(stub.calls.find((call) => call.channel === 'fs:readText')?.args).toEqual([`${ROOT}/main.tex`]);
    });

    it('macht die Datei bei Doppelklick fest, ohne sie ein zweites Mal zu lesen', async () => {
        const { store, deps, reads } = setup();
        await openProjectFile(deps, `${ROOT}/main.tex`, true);
        await openProjectFile(deps, `${ROOT}/main.tex`, false);
        expect(store.getState().tabs.preview).toBeNull();
        expect(reads()).toBe(1);
    });

    it('liest bei Klick und gleichzeitigem Doppelklick nur einmal und endet fest', async () => {
        const { store, deps, reads } = setup();
        await Promise.all([
            openProjectFile(deps, `${ROOT}/main.tex`, true),
            openProjectFile(deps, `${ROOT}/main.tex`, true),
            openProjectFile(deps, `${ROOT}/main.tex`, false),
        ]);
        expect(reads()).toBe(1);
        expect(store.getState().tabs.items).toEqual([`${ROOT}/main.tex`]);
        expect(store.getState().tabs.preview).toBeNull();
    });

    it('ersetzt die Vorschau durch die nächste Einzelklick-Datei', async () => {
        const { store, deps } = setup();
        await openProjectFile(deps, `${ROOT}/main.tex`, true);
        await openProjectFile(deps, `${ROOT}/kapitel/fazit.tex`, true);
        expect(store.getState().tabs.items).toEqual([`${ROOT}/kapitel/fazit.tex`]);
    });

    it('öffnet eine veraltete Vorschau nicht mehr, wenn schon eine neuere angeklickt wurde', async () => {
        const { store, deps } = setup();
        await Promise.all([
            openProjectFile(deps, `${ROOT}/main.tex`, true),
            openProjectFile(deps, `${ROOT}/literatur.bib`, true),
        ]);
        expect(store.getState().tabs.items).toEqual([`${ROOT}/literatur.bib`]);
    });

    it('meldet Lesefehler in der Statusleiste und öffnet nichts', async () => {
        const { stub, store, deps, report } = setup();
        stub.respond('fs:readText', () => {
            throw new IpcFailure({ kind: 'forbiddenPath', message: 'kein Zugriff' });
        });
        expect(await openProjectFile(deps, `${ROOT}/main.tex`, true)).toBe(false);
        expect(store.getState().tabs.items).toEqual([]);
        expect(report).toHaveBeenCalledWith({ text: PROJECT_FILE_TEXTS.openFailed('main.tex', 'kein Zugriff'), kind: 'error' });
    });

    it('öffnet Bilder nicht im Editor und sagt warum', async () => {
        const { store, deps, report, reads } = setup();
        expect(await openProjectFile(deps, `${ROOT}/bilder/logo.png`, false)).toBe(false);
        expect(reads()).toBe(0);
        expect(store.getState().tabs.items).toEqual([]);
        expect(report).toHaveBeenCalledWith({ text: PROJECT_FILE_TEXTS.notEditable('logo.png'), kind: 'info' });
    });
});
