import { describe, expect, it, vi } from 'vitest';
import type { IpcResult, PdfSource } from '../../src/shared/contract';
import { fail, ok } from '../../src/shared/ipcResult';
import {
    clampPage, createPdfStore, nextZoomStep, PDF_TEXTS, PDF_ZOOM_STEPS, pdfPathForMainFile,
} from '../../src/renderer/stores/pdf';
import type { PdfStore, PdfViewerPort, PdfZoom } from '../../src/renderer/stores/pdf';
import type { StatusMessage } from '../../src/renderer/stores/status';

const PDF_PATH = '/projekt/main.pdf';
const PAGE_COUNT = 5;
const SHORTER_PAGE_COUNT = 3;

interface FakeViewer extends PdfViewerPort {
    readonly shows: { bytes: Uint8Array; keepPosition: boolean }[];
    readonly zooms: PdfZoom[];
    readonly pages: number[];
    closed: number;
    pageCount: number;
    failNext: string | null;
}

function fakeViewer(): FakeViewer {
    const viewer: FakeViewer = {
        shows: [], zooms: [], pages: [], closed: 0, pageCount: PAGE_COUNT, failNext: null,
        show: async (bytes, keepPosition) => {
            if (viewer.failNext !== null) {
                const message = viewer.failNext;
                viewer.failNext = null;
                throw new Error(message);
            }
            viewer.shows.push({ bytes, keepPosition });
            return viewer.pageCount;
        },
        close: () => {
            viewer.closed++;
        },
        setZoom: (zoom) => {
            viewer.zooms.push(zoom);
        },
        goToPage: (pageNumber) => {
            viewer.pages.push(pageNumber);
        },
    };
    return viewer;
}

const bytesResult = (value: number): IpcResult<PdfSource> => ok({ kind: 'bytes', bytes: new Uint8Array([value]) });

function setup(responses: IpcResult<PdfSource>[] = []) {
    const queue = [...responses];
    const open = vi.fn((_path: string) => Promise.resolve(queue.shift() ?? bytesResult(0)));
    const reports: StatusMessage[] = [];
    const store: PdfStore = createPdfStore({
        api: () => ({ pdf: { open } }),
        report: (message) => reports.push(message),
    });
    const viewer = fakeViewer();
    store.getState().attachViewer(viewer);
    return { store, viewer, open, reports };
}

describe('Hilfsfunktionen', () => {
    it('PDF neben der Hauptdatei', () => {
        expect(pdfPathForMainFile('/a/b/main.tex')).toBe('/a/b/main.pdf');
        expect(pdfPathForMainFile('C:\\Arbeit\\Thesis.TEX')).toBe('C:\\Arbeit\\Thesis.pdf');
        expect(pdfPathForMainFile('/a/ohne')).toBe('/a/ohne.pdf');
    });

    it('Zoomstufen nach oben und unten, an den Enden bleibt es', () => {
        expect(nextZoomStep(1, 'in')).toBe(1.1);
        expect(nextZoomStep(1, 'out')).toBe(0.9);
        expect(nextZoomStep(1.03, 'in')).toBe(1.1);
        expect(nextZoomStep(1.03, 'out')).toBe(1);
        expect(nextZoomStep(PDF_ZOOM_STEPS.at(-1)!, 'in')).toBe(PDF_ZOOM_STEPS.at(-1));
        expect(nextZoomStep(PDF_ZOOM_STEPS[0]!, 'out')).toBe(PDF_ZOOM_STEPS[0]);
    });

    it('Seiten klemmen', () => {
        expect(clampPage(0, 4)).toBe(1);
        expect(clampPage(9, 4)).toBe(4);
        expect(clampPage(2.4, 4)).toBe(2);
        expect(clampPage(3, 0)).toBe(1);
    });
});

describe('Laden und Neuladen', () => {
    it('zeigt ein PDF; die Bytes gehen an den Viewer, nicht in den Store', async () => {
        const { store, viewer, open } = setup([bytesResult(7)]);
        expect(await store.getState().open(PDF_PATH, 'build')).toBe('shown');
        expect(open).toHaveBeenCalledWith(PDF_PATH);
        expect(viewer.shows).toEqual([{ bytes: new Uint8Array([7]), keepPosition: false }]);
        const state = store.getState();
        expect(state).toMatchObject({ path: PDF_PATH, pageCount: PAGE_COUNT, pageNumber: 1, isLoading: false, error: null });
        expect(Object.values(state).some((value) => value instanceof Uint8Array)).toBe(false);
    });

    it('Neuladen desselben PDFs behält Seite und Zoom (der Viewer stellt die Position wieder her)', async () => {
        const { store, viewer } = setup();
        await store.getState().open(PDF_PATH, 'project');
        store.getState().setZoom(1.5);
        store.getState().goToPage(4);
        store.getState().noteView({ pageNumber: 4, scale: 1.5 });
        expect(await store.getState().open(PDF_PATH, 'build')).toBe('shown');
        expect(viewer.shows.at(-1)?.keepPosition).toBe(true);
        expect(store.getState()).toMatchObject({ pageNumber: 4, zoom: 1.5, scale: 1.5 });
        expect(viewer.zooms.at(-1)).toBe(1.5);
    });

    it('hat das neue PDF weniger Seiten, steht die Ansicht auf der letzten', async () => {
        const { store, viewer } = setup();
        await store.getState().open(PDF_PATH, 'build');
        store.getState().goToPage(PAGE_COUNT);
        viewer.pageCount = SHORTER_PAGE_COUNT;
        await store.getState().open(PDF_PATH, 'build');
        expect(store.getState()).toMatchObject({ pageNumber: SHORTER_PAGE_COUNT, pageCount: SHORTER_PAGE_COUNT });
    });

    it('ein anderes PDF beginnt oben auf Seite 1', async () => {
        const { store, viewer } = setup();
        await store.getState().open(PDF_PATH, 'build');
        store.getState().goToPage(3);
        await store.getState().open('/projekt/anderes.pdf', 'build');
        expect(viewer.shows.at(-1)?.keepPosition).toBe(false);
        expect(store.getState().pageNumber).toBe(1);
    });
});

describe('Fehler: die alte Ansicht bleibt', () => {
    it('Lesefehler (z. B. unvollständiges PDF) ändert nichts an der Ansicht und meldet es in der Statusleiste', async () => {
        const { store, viewer, reports } = setup([bytesResult(1), fail({ kind: 'io', message: 'PDF ist unvollständig' })]);
        await store.getState().open(PDF_PATH, 'build');
        store.getState().goToPage(2);
        expect(await store.getState().open(PDF_PATH, 'build')).toBe('failed');
        expect(viewer.shows).toHaveLength(1);
        expect(store.getState()).toMatchObject({ path: PDF_PATH, pageCount: PAGE_COUNT, pageNumber: 2, isLoading: false });
        expect(store.getState().error).toBe('PDF ist unvollständig');
        expect(reports).toEqual([{ text: PDF_TEXTS.reloadFailed('PDF ist unvollständig'), kind: 'error' }]);
    });

    it('kaputtes PDF im Viewer: Zustand bleibt, Meldung erscheint; der nächste Erfolg löscht den Fehler', async () => {
        const { store, viewer, reports } = setup();
        await store.getState().open(PDF_PATH, 'build');
        viewer.failNext = 'Invalid PDF structure';
        expect(await store.getState().open(PDF_PATH, 'build')).toBe('failed');
        expect(store.getState()).toMatchObject({ path: PDF_PATH, pageCount: PAGE_COUNT, error: 'Invalid PDF structure' });
        expect(reports.at(-1)?.kind).toBe('error');
        expect(await store.getState().open(PDF_PATH, 'build')).toBe('shown');
        expect(store.getState().error).toBeNull();
    });

    it('ohne vorhandene Ansicht lautet die Meldung „lässt sich nicht öffnen“', async () => {
        const { store, reports } = setup([fail({ kind: 'forbiddenPath', message: 'Pfad liegt nicht im Projekt' })]);
        expect(await store.getState().open(PDF_PATH, 'build')).toBe('failed');
        expect(reports).toEqual([{ text: PDF_TEXTS.openFailed('Pfad liegt nicht im Projekt'), kind: 'error' }]);
    });

    it('fehlt das PDF beim Öffnen des Projekts, ist das kein Fehler', async () => {
        const { store, reports } = setup([fail({ kind: 'notFound', message: 'PDF nicht gefunden' })]);
        expect(await store.getState().open(PDF_PATH, 'project')).toBe('missing');
        expect(reports).toEqual([]);
        expect(store.getState()).toMatchObject({ path: null, pageCount: 0, isLoading: false, error: null });
    });
});

describe('Reihenfolge, Leeren, Viewer', () => {
    it('ein späteres Laden überholt ein früheres; die veraltete Antwort wird verworfen', async () => {
        const { store, viewer } = setup([bytesResult(1), bytesResult(2)]);
        const first = store.getState().open('/projekt/alt.pdf', 'build');
        const second = store.getState().open(PDF_PATH, 'build');
        expect(await first).toBe('superseded');
        expect(await second).toBe('shown');
        expect(viewer.shows.map((show) => show.bytes[0])).toEqual([2]);
        expect(store.getState().path).toBe(PDF_PATH);
    });

    it('Leeren (Projektwechsel) schließt den Viewer und verwirft ein laufendes Laden', async () => {
        const { store, viewer } = setup();
        await store.getState().open(PDF_PATH, 'build');
        const pending = store.getState().open(PDF_PATH, 'build');
        store.getState().clear();
        expect(await pending).toBe('superseded');
        await Promise.resolve();
        expect(viewer.closed).toBe(1);
        expect(store.getState()).toMatchObject({ path: null, pageCount: 0, pageNumber: 1 });
    });

    it('ohne Viewer wird das PDF vorgemerkt und beim Anmelden geladen', async () => {
        const open = vi.fn(() => Promise.resolve(bytesResult(3)));
        const store = createPdfStore({ api: () => ({ pdf: { open } }), report: () => undefined });
        expect(await store.getState().open(PDF_PATH, 'project')).toBe('pending');
        expect(open).not.toHaveBeenCalled();
        const viewer = fakeViewer();
        store.getState().attachViewer(viewer);
        await vi.waitFor(() => expect(store.getState().path).toBe(PDF_PATH));
        expect(viewer.shows).toHaveLength(1);
        expect(viewer.zooms).toEqual(['pageWidth']);
    });

    it('Zoom und Seitenwechsel gehen an den Viewer; Meldungen des Viewers setzen nur bei Änderung', async () => {
        const { store, viewer } = setup();
        await store.getState().open(PDF_PATH, 'build');
        store.getState().noteView({ pageNumber: 1, scale: 1 });
        store.getState().zoomStep('in');
        expect(viewer.zooms.at(-1)).toBe(1.1);
        store.getState().setZoom('pageFit');
        expect(store.getState().zoom).toBe('pageFit');
        store.getState().goToPage(99);
        expect(viewer.pages.at(-1)).toBe(PAGE_COUNT);
        const listener = vi.fn();
        const stop = store.subscribe(listener);
        store.getState().noteView({ pageNumber: PAGE_COUNT, scale: store.getState().scale });
        expect(listener).not.toHaveBeenCalled();
        stop();
    });
});
