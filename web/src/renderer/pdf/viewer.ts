// pdf.js-Anbindung (W3-3) nach den Messungen aus W3-3a (`docs/ARCHITEKTUR.md`, S2): Seiten im Hauptthread rendern
// (`disableWorkerRendering`), `PDFViewer` mit seiner Standard-Warteschlange (sichtbare Seiten zuerst, Puffer 10 Seiten,
// nicht erhöhen), `maxCanvasPixels` 2^24, Hilfsdaten offline aus `out/renderer/pdfjs/`, eigenes l10n (sonst lädt
// `GenericL10n` Sprachdateien nach), Textebene und Annotationen (Links) an. Neuladen ersetzt das Dokument im selben
// Viewer, stellt Seite, Zoom und Scrollposition wieder her und gibt das alte Dokument erst nach dem ersten Paint frei.
// SyncTeX (W3-5): Stelle etwa mittig sichtbar machen (ohne Markierung), Sichtbarkeitsprüfung für „PDF folgt Cursor“
// und ⌘-Klick (macOS) bzw. Strg-Klick → Seite + SyncTeX-Punkt; normale Klicks, Auswahl und Links bleiben unberührt.
import './pdfjsGlobal';
import { AnnotationMode, getDocument, GlobalWorkerOptions, PDFWorker } from 'pdfjs-dist';
import type { PageViewport, PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import type { PdfRect } from '../../shared/contract';
import {
    containsRect, mediaBoxFromViewBox, pdfRectFromSyncTeX, syncTeXPointFromPdf,
} from '../../shared/core/synctexCoordinates';
import type { PdfPoint } from '../../shared/core/synctexCoordinates';
import { isSyncTeXClick } from '../app/synctexFlow';
import type { SyncTeXTarget, SyncTeXViewerPort, ViewerRevealResult } from '../app/synctexFlow';
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
/** Abstand links neben der Stelle beim Hinscrollen (Swift `horizontalMargin`), PDF-Punkte */
const REVEAL_HORIZONTAL_MARGIN = 20;
const REVEAL_CENTER = 'vertical';
const HALF = 2;
const FIRST_PAGE = 1;
const IS_MAC = /Mac/i.test(navigator.platform);

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

export interface PdfJsViewer extends PdfViewerPort, SyncTeXViewerPort {
    destroy(): void;
}

/** ⌘-Klick bzw. Strg-Klick ins PDF: Seite (1-basiert) und Punkt in SyncTeX-Koordinaten */
export type SyncTeXClickHandler = (page: number, point: PdfPoint) => void;

/** Was SyncTeX von `PDFPageView` braucht (pdf.js typisiert `getPageView` nur als `any`) */
interface PageViewLike {
    readonly id: number;
    readonly div: HTMLDivElement;
    readonly viewport: PageViewport;
}

/** Linke obere Ecke des Seiteninhalts (ohne Rahmen) im Fenster */
function pageOrigin(div: HTMLDivElement): PdfPoint {
    const box = div.getBoundingClientRect();
    return { x: box.left + div.clientLeft, y: box.top + div.clientTop };
}

function viewportPoint(viewport: PageViewport, x: number, y: number): PdfPoint {
    const [viewX, viewY] = viewport.convertToViewportPoint(x, y);
    return { x: Number(viewX), y: Number(viewY) };
}

/** Rechteck im PDF-Benutzerraum → Fensterkoordinaten (CSS-Pixel) */
function clientRectOf(pageView: PageViewLike, rect: PdfRect): PdfRect {
    const origin = pageOrigin(pageView.div);
    const first = viewportPoint(pageView.viewport, rect.x, rect.y);
    const second = viewportPoint(pageView.viewport, rect.x + rect.width, rect.y + rect.height);
    return {
        x: origin.x + Math.min(first.x, second.x),
        y: origin.y + Math.min(first.y, second.y),
        width: Math.abs(second.x - first.x),
        height: Math.abs(second.y - first.y),
    };
}

function distanceToBox(box: DOMRect, x: number, y: number): number {
    const dx = Math.max(box.left - x, 0, x - box.right);
    const dy = Math.max(box.top - y, 0, y - box.bottom);
    return Math.hypot(dx, dy);
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
    private readonly container: HTMLDivElement;
    private readonly domListeners = new AbortController();

    constructor(
        elements: PdfViewerElements,
        private readonly onView: (report: PdfViewReport) => void,
        private readonly onSyncTeXClick: SyncTeXClickHandler | null,
    ) {
        this.container = elements.container;
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
        this.listenForSyncTeXClicks();
    }

    // In der Einfangphase, damit Textebene und Links die Geste nicht zuerst sehen: `mousedown` verhindert das Starten
    // einer Auswahl, `click` das Folgen eines Links (Strg-Klick öffnete sonst ein neues Fenster).
    private listenForSyncTeXClicks(): void {
        if (this.onSyncTeXClick === null) return;
        const options = { capture: true, signal: this.domListeners.signal };
        this.container.addEventListener('mousedown', (event) => this.handleSyncTeXMouseDown(event), options);
        this.container.addEventListener('click', (event) => {
            if (!isSyncTeXClick(event, IS_MAC)) return;
            event.preventDefault();
            event.stopPropagation();
        }, options);
    }

    private handleSyncTeXMouseDown(event: MouseEvent): void {
        if (this.onSyncTeXClick === null || !isSyncTeXClick(event, IS_MAC)) return;
        event.preventDefault();
        event.stopPropagation();
        const hit = this.syncTeXPointAt(event.clientX, event.clientY);
        if (hit !== null) this.onSyncTeXClick(hit.page, hit.point);
    }

    /** Wie Swift `page(for:nearest: true)`: ein Klick neben die Seiten zählt zur nächsten Seite */
    private pageViewAt(clientX: number, clientY: number): PageViewLike | null {
        let nearest: PageViewLike | null = null;
        let nearestDistance = Number.POSITIVE_INFINITY;
        for (let index = 0; index < this.viewer.pagesCount; index++) {
            const pageView = this.viewer.getPageView(index) as PageViewLike | undefined;
            if (pageView === undefined) continue;
            const distance = distanceToBox(pageView.div.getBoundingClientRect(), clientX, clientY);
            if (distance === 0) return pageView;
            if (distance < nearestDistance) {
                nearest = pageView;
                nearestDistance = distance;
            }
        }
        return nearest;
    }

    private syncTeXPointAt(clientX: number, clientY: number): { page: number; point: PdfPoint } | null {
        if (this.current === null) return null;
        const pageView = this.pageViewAt(clientX, clientY);
        const mediaBox = pageView === null ? null : mediaBoxFromViewBox(pageView.viewport.viewBox);
        if (pageView === null || mediaBox === null) return null;
        const origin = pageOrigin(pageView.div);
        const [pdfX, pdfY] = pageView.viewport.convertToPdfPoint(clientX - origin.x, clientY - origin.y);
        return { page: pageView.id, point: syncTeXPointFromPdf({ x: Number(pdfX), y: Number(pdfY) }, mediaBox) };
    }

    private pageViewFor(pageNumber: number): PageViewLike | null {
        const pageCount = this.viewer.pagesCount;
        if (this.current === null || pageCount < FIRST_PAGE) return null;
        const clamped = Math.min(Math.max(Math.round(pageNumber), FIRST_PAGE), pageCount);
        return (this.viewer.getPageView(clamped - FIRST_PAGE) as PageViewLike | undefined) ?? null;
    }

    /** Ganz im sichtbaren Bereich des Scrollcontainers? (Swift: `pdfView.bounds.contains(rect)`) */
    private isVisible(pageView: PageViewLike, rect: PdfRect): boolean {
        const box = this.container.getBoundingClientRect();
        const visible = { x: box.left, y: box.top, width: this.container.clientWidth, height: this.container.clientHeight };
        return containsRect(visible, clientRectOf(pageView, rect));
    }

    // Ohne Markierung und ohne Aufblitzen (Nutzerwunsch, wie Swift): nur hinscrollen, Stelle senkrecht mittig.
    reveal(target: SyncTeXTarget, onlyIfHidden: boolean): ViewerRevealResult {
        const pageView = this.pageViewFor(target.page);
        const mediaBox = pageView === null ? null : mediaBoxFromViewBox(pageView.viewport.viewBox);
        if (pageView === null || mediaBox === null) return 'unavailable';
        const rect = pdfRectFromSyncTeX(target.rect, mediaBox);
        if (onlyIfHidden && this.isVisible(pageView, rect)) return 'visible';
        // XYZ ohne Zoom (`null`): Punkt im PDF-Benutzerraum, `center` rückt ihn senkrecht in die Mitte.
        const destArray = [null, XYZ_DESTINATION, rect.x - REVEAL_HORIZONTAL_MARGIN, rect.y + rect.height / HALF, null];
        this.viewer.scrollPageIntoView({ pageNumber: pageView.id, destArray, center: REVEAL_CENTER });
        return 'scrolled';
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
        this.domListeners.abort();
        this.close();
        this.worker?.destroy();
        this.worker = null;
    }
}

export function createPdfViewer(
    elements: PdfViewerElements,
    onView: (report: PdfViewReport) => void,
    onSyncTeXClick: SyncTeXClickHandler | null = null,
): PdfJsViewer {
    return new PdfJsViewerImpl(elements, onView, onSyncTeXClick);
}
