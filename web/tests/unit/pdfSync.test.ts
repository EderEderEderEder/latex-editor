import { describe, expect, it, vi } from 'vitest';
import type { IpcEvents, ProjectInfo } from '../../src/shared/contract';
import { ok } from '../../src/shared/ipcResult';
import { connectPdfSync, shouldReloadAfterBuild } from '../../src/renderer/app/pdfSync';
import { createPdfStore } from '../../src/renderer/stores/pdf';
import type { PdfViewerPort } from '../../src/renderer/stores/pdf';
import { createProjectStore } from '../../src/renderer/stores/project';

type BuildFinished = IpcEvents['build:finished'];

const ROOT = '/projekt';
const MAIN = `${ROOT}/main.tex`;
const MAIN_PDF = `${ROOT}/main.pdf`;
const PROJECT: ProjectInfo = { root: ROOT, mainFile: MAIN, tree: { kind: 'directory', name: 'projekt', path: ROOT, children: [] } };
const FINISHED: BuildFinished = { ok: true, cancelled: false, report: [], pdfPath: MAIN_PDF, durationMs: 1 };

function setup() {
    const open = vi.fn((_path: string) => Promise.resolve(ok({ kind: 'bytes' as const, bytes: new Uint8Array([1]) })));
    const pdf = createPdfStore({ api: () => ({ pdf: { open } }), report: () => undefined });
    const viewer: PdfViewerPort = { show: () => Promise.resolve(2), close: vi.fn(), setZoom: () => undefined, goToPage: () => undefined };
    pdf.getState().attachViewer(viewer);
    const project = createProjectStore({ api: () => ({ project: { open: vi.fn(), recent: vi.fn() } }) as never });
    let buildListener: ((result: BuildFinished) => void) | null = null;
    const stop = connectPdfSync({
        pdf,
        project,
        onBuildFinished: (listener) => {
            buildListener = listener;
            return () => {
                buildListener = null;
            };
        },
    });
    const finishBuild = (result: BuildFinished): void => buildListener?.(result);
    return { pdf, project, open, stop, finishBuild, viewer };
}

describe('PDF folgt Projekt und Build', () => {
    it('beim Öffnen eines Projekts wird `<Hauptdatei>.pdf` angezeigt', async () => {
        const { project, open, pdf } = setup();
        project.getState().setProject(PROJECT, 'kennung');
        expect(open).toHaveBeenCalledWith(MAIN_PDF);
        await vi.waitFor(() => expect(pdf.getState().pageCount).toBe(2));
    });

    it('nach einem erfolgreichen Build wird neu geladen, nach Fehler oder Abbruch nicht', () => {
        const { open, finishBuild } = setup();
        finishBuild({ ...FINISHED, ok: false });
        finishBuild({ ...FINISHED, cancelled: true });
        finishBuild({ ...FINISHED, pdfPath: null });
        expect(open).not.toHaveBeenCalled();
        finishBuild(FINISHED);
        finishBuild(FINISHED);
        expect(open).toHaveBeenCalledTimes(2);
    });

    it('Projektwechsel leert die Ansicht', async () => {
        const { project, pdf, viewer } = setup();
        project.getState().setProject(PROJECT, 'kennung');
        await vi.waitFor(() => expect(pdf.getState().path).toBe(MAIN_PDF));
        project.getState().clearProject();
        await vi.waitFor(() => expect(viewer.close).toHaveBeenCalled());
        expect(pdf.getState().path).toBeNull();
    });

    it('Abmelden beendet beide Abonnements', () => {
        const { stop, open, finishBuild, project } = setup();
        stop();
        finishBuild(FINISHED);
        project.getState().setProject(PROJECT, 'kennung');
        expect(open).not.toHaveBeenCalled();
    });

    it('shouldReloadAfterBuild', () => {
        expect(shouldReloadAfterBuild(FINISHED)).toBe(true);
        expect(shouldReloadAfterBuild({ ...FINISHED, ok: false })).toBe(false);
    });
});
