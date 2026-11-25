// pdf.js-Anbindung (W3-3) nach den Messungen aus W3-3a (`docs/ARCHITEKTUR.md`, S2): Seiten im Hauptthread rendern
// (`disableWorkerRendering`), `PDFViewer` mit seiner Standard-Warteschlange (sichtbare Seiten zuerst, Puffer 10 Seiten,
// nicht erhöhen), `maxCanvasPixels` 2^24, Hilfsdaten offline aus `out/renderer/pdfjs/`, eigenes l10n (sonst lädt
// `GenericL10n` Sprachdateien nach), Textebene und Annotationen (Links) an. Neuladen ersetzt das Dokument im selben
// Viewer, stellt Seite, Zoom und Scrollposition wieder her und gibt das alte Dokument erst nach dem ersten Paint frei.
import './pdfjsGlobal';
import { AnnotationMode, getDocument, GlobalWorkerOptions, PDFWorker } from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import type { PdfViewerPort, PdfViewReport, PdfZoom } from '../stores/pdf';
import { PDFJS_ASSET_DIRECTORY, PDFJS_WORKER_FILE } from './pdfjsAssets';

const MAX_CANVAS_PIXELS = 2 ** 24;
const TEXT_LAYER_ENABLED = 1;
/** Fällt das erste Rendern des neuen Dokuments aus, wird das alte trotzdem freigegeben */
const RELEASE_TIMEOUT_MS = 5_000;
const PAGES_INIT_TIMEOUT_MS = 15_000;
const PRESET_ZOOM_VALUES: Readonly<Record<Exclude<PdfZoom, number>, string>> = { pageWidth: 'page-width', pageFit: 'page-fit' };
const XYZ_DESTINATION = { name: 'XYZ' } as const;
const L10N_LANGUAGE = 'de';
const L10N_DIRECTION = 'ltr';

export const PDF_VIEWER_MESSAGES = {
    pagesInitTimeout: 'Seiten des PDFs wurden nicht rechtzeitig aufgebaut',
    destroyed: 'PDF-Ansicht ist geschlossen',
} as const;

type ViewerOptions = ConstructorParameters<typeof PDFViewer>[0];

/** Stummes l10n: die App braucht keine Texte von pdf.js, und es lädt so keine Sprachdateien nach */
const silentL10n = {
    getLanguage: () => L10N_LANGUAGE,
    getDirection: () => L10N_DIRECTION,
    get: async () => '',
    translate: async () => undefined,
    translateOnce: async () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    destroy: async () => undefined,
} as unknown as NonNullable<ViewerOptions['l10n']>;

interface LoadedDocument {
    readonly task: PDFDocumentLoadingTask;
    readonly document: PDFDocumentProxy;
}

interface SavedLocation {
    readonly pageNumber: number;
    readonly left: number;
    readonly top: number;
}

export interface PdfViewerElements {
    /** Muss absolut positioniert sein und scrollt (Vorgabe von pdf.js) */
    readonly container: HTMLDivElement;
    /** Kind des Containers mit der Klasse `pdfViewer` */
    readonly viewer: HTMLDivElement;
}

export interface PdfJsViewer extends PdfViewerPort {
    destroy(): void;
}

function assetUrl(relative: string): string {
    return new URL(`${PDFJS_ASSET_DIRECTORY}/${relative}`, document.baseURI).href;
}

function zoomValueOf(zoom: PdfZoom): string {
    return typeof zoom === 'number' ? String(zoom) : PRESET_ZOOM_VALUES[zoom];
}

function loadDocument(bytes: Uint8Array, worker: PDFWorker): PDFDocumentLoadingTask {
    return getDocument({
        data: bytes,
        worker,
        disableWorkerRendering: true,
        cMapUrl: assetUrl('cmaps/'),
        cMapPacked: true,
        standardFontDataUrl: assetUrl('standard_fonts/'),
        wasmUrl: assetUrl('wasm/'),
        iccUrl: assetUrl('iccs/'),
    });
}

function afterTimeout(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Wartet auf ein Ereignis des Viewers; `false` nach Ablauf der Frist */
function waitForEvent(eventBus: EventBus, name: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => finish(false), timeoutMs);
        const listener = (): void => finish(true);
        function finish(seen: boolean): void {
            clearTimeout(timer);
            eventBus.off(name, listener);
            resolve(seen);
        }
        eventBus.on(name, listener);
    });
}

class PdfJsViewerImpl implements PdfJsViewer {
    private readonly eventBus = new EventBus();
    private readonly linkService = new PDFLinkService({ eventBus: this.eventBus });
    private readonly viewer: PDFViewer;
    private worker: PDFWorker | null = null;
    private current: LoadedDocument | null = null;
    private location: SavedLocation | null = null;
    private zoomValue = zoomValueOf('pageWidth');
    private isDestroyed = false;

    constructor(elements: PdfViewerElements, private readonly onView: (report: PdfViewReport) => void) {
        this.viewer = new PDFViewer({
            container: elements.container,
            viewer: elements.viewer,
            eventBus: this.eventBus,
            linkService: this.linkService,
            l10n: silentL10n,
            textLayerMode: TEXT_LAYER_ENABLED,
            annotationMode: AnnotationMode.ENABLE,
            maxCanvasPixels: MAX_CANVAS_PIXELS,
        });
        this.linkService.setViewer(this.viewer);
        this.listen();
    }

    private listen(): void {
        this.eventBus.on('updateviewarea', ({ location }: { location?: SavedLocation }) => {
            if (location !== undefined) this.location = { pageNumber: location.pageNumber, left: location.left, top: location.top };
            this.report();
        });
        this.eventBus.on('pagechanging', () => this.report());
        this.eventBus.on('scalechanging', () => this.report());
    }

    private report(): void {
        if (this.viewer.pdfDocument === null || this.viewer.pdfDocument === undefined) return;
        this.onView({ pageNumber: this.viewer.currentPageNumber, scale: this.viewer.currentScale });
    }

    async show(bytes: Uint8Array, keepPosition: boolean): Promise<number> {
        const loaded = await this.load(bytes);
        const saved = keepPosition ? this.location : null;
        const previous = this.current;
        this.current = loaded;
        const pagesReady = waitForEvent(this.eventBus, 'pagesinit', PAGES_INIT_TIMEOUT_MS);
        this.linkService.setDocument(loaded.document);
        this.viewer.setDocument(loaded.document);
        const isReady = await pagesReady;
        if (this.current !== loaded) return loaded.document.numPages;
        if (!isReady) throw new Error(PDF_VIEWER_MESSAGES.pagesInitTimeout);
        this.restore(saved, loaded.document.numPages);
        void this.releaseAfterPaint(previous);
        return loaded.document.numPages;
    }

    /** Lädt das neue Dokument, ohne den Viewer anzufassen: Scheitert es, bleibt die alte Ansicht unverändert */
    private async load(bytes: Uint8Array): Promise<LoadedDocument> {
        if (this.isDestroyed) throw new Error(PDF_VIEWER_MESSAGES.destroyed);
        const task = loadDocument(bytes, this.sharedWorker());
        try {
            const loadedDocument = await task.promise;
            if (this.isDestroyed) throw new Error(PDF_VIEWER_MESSAGES.destroyed);
            return { task, document: loadedDocument };
        } catch (error) {
            void task.destroy();
            throw error;
        }
    }

    /** Ein Parse-Worker für alle Dokumente: Neuladen spart den Start (S9: 70–90 ms) */
    private sharedWorker(): PDFWorker {
        GlobalWorkerOptions.workerSrc = assetUrl(PDFJS_WORKER_FILE);
        this.worker ??= new PDFWorker();
        return this.worker;
    }

    private restore(saved: SavedLocation | null, pageCount: number): void {
        this.viewer.currentScaleValue = this.zoomValue;
        if (saved === null) return;
        const pageNumber = Math.min(saved.pageNumber, pageCount);
        // XYZ ohne Zoom (`null`): Scrollposition in PDF-Punkten der Seite, der Zoom bleibt wie gesetzt.
        const destArray = [null, XYZ_DESTINATION, saved.left, saved.top, null];
        this.viewer.scrollPageIntoView(pageNumber === saved.pageNumber ? { pageNumber, destArray } : { pageNumber });
    }

    private async releaseAfterPaint(previous: LoadedDocument | null): Promise<void> {
        if (previous === null) return;
        await Promise.race([this.viewer.onePageRendered, afterTimeout(RELEASE_TIMEOUT_MS)]);
        await previous.task.destroy();
    }

    close(): void {
        const previous = this.current;
        this.current = null;
        this.location = null;
        this.linkService.setDocument(null);
        this.viewer.setDocument(null);
        void previous?.task.destroy();
    }

    setZoom(zoom: PdfZoom): void {
        this.zoomValue = zoomValueOf(zoom);
        if (this.current !== null) this.viewer.currentScaleValue = this.zoomValue;
    }

    goToPage(pageNumber: number): void {
        if (this.current === null) return;
        this.viewer.scrollPageIntoView({ pageNumber });
    }

    destroy(): void {
        this.isDestroyed = true;
        this.close();
        this.worker?.destroy();
        this.worker = null;
    }
}

export function createPdfViewer(elements: PdfViewerElements, onView: (report: PdfViewReport) => void): PdfJsViewer {
    return new PdfJsViewerImpl(elements, onView);
}
