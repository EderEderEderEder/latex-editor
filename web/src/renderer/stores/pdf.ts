// PDF-Store (W3-3): welches PDF angezeigt wird, Seite, Zoom, Seitenzahl, Lade- und Fehlerstatus. Die Bytes stehen nie
// im Store: `open` holt sie per `pdf:open` und reicht sie direkt an den Viewer (`PdfViewerPort`, umgesetzt mit pdf.js
// in `pdf/viewer.ts`). Neuladen desselben Pfads (nach einem Build) behält Seite, Zoom und Scrollposition; schlägt das
// Lesen oder Laden fehl, bleibt die alte Ansicht stehen und die Statusleiste meldet es. Ohne DOM-Typen (Vitest).
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import type { AbsolutePath, IpcError, RendererApi } from '../../shared/contract';
import { statusStore } from './status';
import type { StatusMessage } from './status';

/** Fester Faktor (1 = 100 %) oder an die Breite bzw. ganz in den Bereich eingepasst */
export type PdfZoom = number | 'pageWidth' | 'pageFit';
export type ZoomDirection = 'in' | 'out';
/** `project`: PDF neben der Hauptdatei beim Öffnen (fehlt es, ist das kein Fehler); `build`: nach einem Build */
export type PdfOpenReason = 'project' | 'build';
/** `pending`: noch kein Viewer angemeldet, das PDF wird beim Anmelden geladen; `superseded`: neueres Laden oder Leeren */
export type PdfOpenOutcome = 'shown' | 'missing' | 'failed' | 'pending' | 'superseded';

export interface PdfViewReport {
    readonly pageNumber: number;
    /** Wirksamer Faktor (auch bei „Breite“/„Seite“) */
    readonly scale: number;
}

/** Schnittstelle zum Viewer; `show` wirft bei einem kaputten PDF und lässt dann die alte Ansicht stehen */
export interface PdfViewerPort {
    /** Zeigt das Dokument und liefert die Seitenzahl; `keepPosition`: Seite, Zoom und Scrollposition behalten */
    show(bytes: Uint8Array, keepPosition: boolean): Promise<number>;
    close(): void;
    setZoom(zoom: PdfZoom): void;
    goToPage(pageNumber: number): void;
}

export const DEFAULT_PDF_ZOOM: PdfZoom = 'pageWidth';
/** Stufen für Plus/Minus (wie gängige PDF-Programme) */
export const PDF_ZOOM_STEPS: readonly number[] = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
const ZOOM_STEP_TOLERANCE = 0.005;
const FIRST_PAGE = 1;
const PDF_EXTENSION = '.pdf';
const TEX_EXTENSION = /\.tex$/i;

export const PDF_TEXTS = {
    reloadFailed: (detail: string) => `PDF nicht neu geladen, die alte Ansicht bleibt: ${detail}`,
    openFailed: (detail: string) => `PDF lässt sich nicht öffnen: ${detail}`,
} as const;

export interface PdfState {
    /** Pfad des angezeigten PDFs (`null`: keins) */
    readonly path: AbsolutePath | null;
    readonly pageNumber: number;
    readonly pageCount: number;
    readonly zoom: PdfZoom;
    readonly scale: number;
    readonly isLoading: boolean;
    /** Letzter Fehler beim Laden (die alte Ansicht bleibt dabei stehen) */
    readonly error: string | null;
    /** Der Viewer meldet sich an (`null` beim Abbau); ein schon gewünschtes PDF wird dann geladen */
    attachViewer(viewer: PdfViewerPort | null): void;
    open(path: AbsolutePath, reason: PdfOpenReason): Promise<PdfOpenOutcome>;
    /** Projektwechsel: Ansicht leeren, laufendes Laden verwerfen */
    clear(): void;
    setZoom(zoom: PdfZoom): void;
    zoomStep(direction: ZoomDirection): void;
    goToPage(pageNumber: number): void;
    /** Meldung des Viewers (Scrollen, Zoom); gesetzt wird nur bei echter Änderung */
    noteView(report: PdfViewReport): void;
}

export type PdfStore = StoreApi<PdfState>;
export type PdfApi = Pick<RendererApi, 'pdf'>;

export interface PdfStoreDeps {
    readonly api: () => PdfApi;
    readonly report: (message: StatusMessage) => void;
}

type SetState = PdfStore['setState'];
type GetState = PdfStore['getState'];

/** `<Hauptdatei>.pdf` neben der Hauptdatei (latexmk mit `-cd`, ohne Ausgabeordner) */
export function pdfPathForMainFile(mainFile: AbsolutePath): AbsolutePath {
    return TEX_EXTENSION.test(mainFile) ? mainFile.replace(TEX_EXTENSION, PDF_EXTENSION) : mainFile + PDF_EXTENSION;
}

/** Nächste Stufe über bzw. unter dem wirksamen Faktor; an den Enden bleibt es bei der äußersten Stufe */
export function nextZoomStep(scale: number, direction: ZoomDirection): number {
    const first = PDF_ZOOM_STEPS[0] ?? scale;
    const last = PDF_ZOOM_STEPS.at(-1) ?? scale;
    if (direction === 'in') return PDF_ZOOM_STEPS.find((step) => step > scale + ZOOM_STEP_TOLERANCE) ?? last;
    return [...PDF_ZOOM_STEPS].reverse().find((step) => step < scale - ZOOM_STEP_TOLERANCE) ?? first;
}

export function clampPage(pageNumber: number, pageCount: number): number {
    if (pageCount < FIRST_PAGE) return FIRST_PAGE;
    return Math.min(Math.max(Math.round(pageNumber), FIRST_PAGE), pageCount);
}

const INITIAL_STATE = {
    path: null,
    pageNumber: FIRST_PAGE,
    pageCount: 0,
    zoom: DEFAULT_PDF_ZOOM,
    scale: 1,
    isLoading: false,
    error: null,
} as const satisfies Partial<PdfState>;

/** Gemeinsamer Ablauf: Generation gegen veraltete Antworten, Warteschlange für den Viewer (nie zwei `show` zugleich) */
class PdfLoader {
    generation = 0;
    viewer: PdfViewerPort | null = null;
    requestedPath: AbsolutePath | null = null;
    private queue: Promise<unknown> = Promise.resolve();

    constructor(readonly deps: PdfStoreDeps, readonly set: SetState, readonly get: GetState) {}

    enqueue<T>(task: () => Promise<T>): Promise<T> {
        const run = this.queue.then(task);
        this.queue = run.catch(() => undefined);
        return run;
    }
}

function setLoading(loader: PdfLoader, isLoading: boolean): void {
    if (loader.get().isLoading !== isLoading) loader.set({ isLoading });
}

function reportFailure(loader: PdfLoader, error: IpcError | string): PdfOpenOutcome {
    const detail = typeof error === 'string' ? error : error.message;
    const text = loader.get().pageCount > 0 ? PDF_TEXTS.reloadFailed(detail) : PDF_TEXTS.openFailed(detail);
    loader.set({ isLoading: false, error: detail });
    loader.deps.report({ text, kind: 'error' });
    return 'failed';
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function showBytes(loader: PdfLoader, path: AbsolutePath, bytes: Uint8Array, ticket: number): Promise<PdfOpenOutcome> {
    const viewer = loader.viewer;
    if (ticket !== loader.generation || viewer === null) return 'superseded';
    const before = loader.get();
    const keepPosition = before.path === path && before.pageCount > 0;
    let pageCount: number;
    try {
        pageCount = await viewer.show(bytes, keepPosition);
    } catch (error) {
        return ticket === loader.generation ? reportFailure(loader, errorText(error)) : 'superseded';
    }
    if (ticket !== loader.generation) return 'superseded';
    const pageNumber = keepPosition ? clampPage(loader.get().pageNumber, pageCount) : FIRST_PAGE;
    loader.set({ path, pageCount, pageNumber, isLoading: false, error: null });
    return 'shown';
}

async function openPdf(loader: PdfLoader, path: AbsolutePath, reason: PdfOpenReason): Promise<PdfOpenOutcome> {
    const ticket = ++loader.generation;
    loader.requestedPath = path;
    if (loader.viewer === null) return 'pending';
    setLoading(loader, true);
    const result = await loader.deps.api().pdf.open(path);
    if (ticket !== loader.generation) return 'superseded';
    if (!result.ok) {
        if (reason === 'project' && result.error.kind === 'notFound') {
            setLoading(loader, false);
            return 'missing';
        }
        return reportFailure(loader, result.error);
    }
    return loader.enqueue(() => showBytes(loader, path, result.value.bytes, ticket));
}

function clearPdf(loader: PdfLoader): void {
    loader.generation++;
    loader.requestedPath = null;
    const viewer = loader.viewer;
    void loader.enqueue(async () => viewer?.close());
    const { zoom, scale } = loader.get();
    loader.set({ ...INITIAL_STATE, zoom, scale });
}

function attachViewer(loader: PdfLoader, viewer: PdfViewerPort | null): void {
    loader.viewer = viewer;
    if (viewer === null) return;
    viewer.setZoom(loader.get().zoom);
    if (loader.requestedPath !== null) void openPdf(loader, loader.requestedPath, 'project');
}

function viewActions(loader: PdfLoader): Pick<PdfState, 'setZoom' | 'zoomStep' | 'goToPage' | 'noteView'> {
    const { set, get } = loader;
    const setZoom = (zoom: PdfZoom): void => {
        loader.viewer?.setZoom(zoom);
        const scale = typeof zoom === 'number' ? zoom : get().scale;
        if (get().zoom !== zoom || get().scale !== scale) set({ zoom, scale });
    };
    return {
        setZoom,
        zoomStep: (direction) => setZoom(nextZoomStep(get().scale, direction)),
        goToPage: (pageNumber) => {
            if (get().pageCount === 0) return;
            const target = clampPage(pageNumber, get().pageCount);
            loader.viewer?.goToPage(target);
            if (get().pageNumber !== target) set({ pageNumber: target });
        },
        noteView: ({ pageNumber, scale }) => {
            if (get().pageNumber !== pageNumber || get().scale !== scale) set({ pageNumber, scale });
        },
    };
}

export function createPdfStore(deps: PdfStoreDeps): PdfStore {
    return createStore<PdfState>()((set, get) => {
        const loader = new PdfLoader(deps, set, get);
        return {
            ...INITIAL_STATE,
            ...viewActions(loader),
            attachViewer: (viewer) => attachViewer(loader, viewer),
            open: (path, reason) => openPdf(loader, path, reason),
            clear: () => clearPdf(loader),
        };
    });
}

/** `window.api` ohne DOM-Typen (der Node-tsconfig der Tests kennt `window` nicht) */
function defaultPdfApi(): PdfApi {
    return (globalThis as unknown as { api: RendererApi }).api;
}

export const pdfStore = createPdfStore({ api: defaultPdfApi, report: (message) => statusStore.getState().show(message) });

export function usePdfStore<T>(selector: (state: PdfState) => T): T {
    return useStore(pdfStore, selector);
}
