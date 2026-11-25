// Messung (2): `PDFViewer` von pdf.js (wie W3-3 ihn nutzen wird, mit Textebene) mit dem 300-Seiten-PDF:
// Zeit bis zur ersten sichtbaren Seite, Rahmen beim gleichmäßigen Durchscrollen, Sprünge auf ferne Seiten.
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';
import { EventBus, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { isWorkerRenderingActive, openDocument, type RenderMode } from './pdfSetup';
import { afterNextPaint, longTaskRecorder, sleep, summarize, type Summary } from './stats';

const FRAME_BUDGET_MS = 16;
const DROPPED_FRAME_MS = 33;
const SETTLE_MS = 1_500;
const SCALE_VALUE = 'page-width';
/** Schutz gegen Hänger, falls eine Seite nie `pagerendered` meldet (z. B. schon fertig im Zwischenspeicher) */
const PAGE_TIMEOUT_MS = 15_000;

/** Leerer Übersetzer: der Viewer bräuchte sonst Sprachdateien (fetch), die Messung braucht keine Texte */
const silentL10n = {
    getLanguage: () => 'de',
    getDirection: () => 'ltr',
    get: async () => '',
    translate: async () => undefined,
    translateOnce: async () => undefined,
    pause: () => undefined,
    resume: () => undefined,
    destroy: async () => undefined,
};

interface RenderedEvent {
    pageNumber: number;
    isDetailView?: boolean;
    error?: unknown;
}

interface ViewerSession {
    viewer: PDFViewer;
    eventBus: EventBus;
    task: PDFDocumentLoadingTask;
    started: number;
    rendered: number;
    renderErrors: number;
    /** Seite → Zeitpunkt der letzten fertigen Darstellung */
    renderedAt: Map<number, number>;
}

let current: ViewerSession | null = null;

function containerElement(): HTMLDivElement {
    const container = document.getElementById('viewerContainer');
    if (!(container instanceof HTMLDivElement)) throw new Error('viewerContainer fehlt');
    return container;
}

/** `true`, wenn die Seite gemeldet wurde; `false` nach Ablauf der Schutzfrist */
function waitForPage(eventBus: EventBus, pageNumber: number): Promise<boolean> {
    return new Promise((resolve) => {
        const onRendered = (event: RenderedEvent): void => {
            if (event.pageNumber !== pageNumber || event.isDetailView === true) return;
            finish(true);
        };
        const timer = setTimeout(() => finish(false), PAGE_TIMEOUT_MS);
        const finish = (seen: boolean): void => {
            clearTimeout(timer);
            eventBus.off('pagerendered', onRendered);
            resolve(seen);
        };
        eventBus.on('pagerendered', onRendered);
    });
}

function createViewer(): { viewer: PDFViewer; eventBus: EventBus } {
    const container = containerElement();
    container.hidden = false;
    const eventBus = new EventBus();
    const viewerElement = document.getElementById('viewer') as HTMLDivElement;
    const viewer = new PDFViewer({ container, viewer: viewerElement, eventBus, l10n: silentL10n as never, textLayerMode: 1 });
    eventBus.on('pagesinit', () => {
        viewer.currentScaleValue = SCALE_VALUE;
    });
    return { viewer, eventBus };
}

export interface OpenResult {
    mode: RenderMode;
    pages: number;
    documentMs: number;
    firstVisibleMs: number;
    workerRenderingActive: boolean;
    devicePixelRatio: number;
}

export async function openViewer(bytes: Uint8Array, mode: RenderMode): Promise<OpenResult> {
    const started = performance.now();
    const { viewer, eventBus } = createViewer();
    const task = openDocument(bytes, mode);
    const session: ViewerSession = { viewer, eventBus, task, started, rendered: 0, renderErrors: 0, renderedAt: new Map() };
    eventBus.on('pagerendered', (event: RenderedEvent) => {
        session.rendered += 1;
        session.renderedAt.set(event.pageNumber, performance.now());
        if (event.error !== null && event.error !== undefined) session.renderErrors += 1;
    });
    const firstPage = waitForPage(eventBus, 1);
    const document_ = await task.promise;
    const documentMs = performance.now() - started;
    viewer.setDocument(document_);
    await firstPage;
    const firstVisibleMs = (await afterNextPaint()) - started;
    current = session;
    await sleep(SETTLE_MS);
    const workerRenderingActive = isWorkerRenderingActive(task);
    return { mode, pages: document_.numPages, documentMs, firstVisibleMs, workerRenderingActive, devicePixelRatio: window.devicePixelRatio };
}

export interface ScrollResult {
    distancePx: number;
    durationMs: number;
    frames: number;
    framesOverBudget: number;
    framesDropped: number;
    frameGap: Summary;
    frameWork: Summary;
    longTasks: Summary;
    pagesRendered: number;
    renderErrors: number;
    lastPageVisibleMs: number;
    jsHeapMb: number;
}

interface FrameLog {
    gaps: number[];
    work: number[];
}

function runScrollFrames(container: HTMLElement, speedPxPerSecond: number): Promise<FrameLog> {
    const log: FrameLog = { gaps: [], work: [] };
    const distance = container.scrollHeight - container.clientHeight;
    return new Promise((resolve) => {
        let start = -1;
        let previous = -1;
        const step = (frameStart: number): void => {
            if (start < 0) start = frameStart;
            if (previous >= 0) log.gaps.push(frameStart - previous);
            previous = frameStart;
            container.scrollTop = Math.min(distance, ((frameStart - start) * speedPxPerSecond) / 1000);
            const channel = new MessageChannel();
            channel.port1.onmessage = () => log.work.push(performance.now() - frameStart);
            channel.port2.postMessage(null);
            if (container.scrollTop >= distance - 1) resolve(log);
            else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    });
}

function jsHeapMb(): number {
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return memory === undefined ? 0 : memory.usedJSHeapSize / (1024 * 1024);
}

/** Ende des Scrollens bis die letzte Seite zu sehen ist (0, wenn sie schon während des Scrollens fertig war) */
async function lastPageDelay(session: ViewerSession, started: number, scrolled: number): Promise<number> {
    const lastPage = session.viewer.pagesCount;
    const renderedAt = session.renderedAt.get(lastPage);
    if (renderedAt !== undefined && renderedAt >= started) return Math.max(0, renderedAt - scrolled);
    const seen = await waitForPage(session.eventBus, lastPage);
    return seen ? (await afterNextPaint()) - scrolled : Number.NaN;
}

export async function scrollThrough(speedPxPerSecond: number): Promise<ScrollResult> {
    if (current === null) throw new Error('Viewer nicht offen');
    const session = current;
    const container = containerElement();
    const renderedBefore = session.rendered;
    const errorsBefore = session.renderErrors;
    const longTasks = longTaskRecorder();
    const started = performance.now();
    const log = await runScrollFrames(container, speedPxPerSecond);
    const scrolled = performance.now();
    const lastPageVisibleMs = await lastPageDelay(session, started, scrolled);
    return {
        distancePx: container.scrollTop,
        durationMs: scrolled - started,
        frames: log.gaps.length,
        framesOverBudget: log.gaps.filter((gap) => gap > FRAME_BUDGET_MS).length,
        framesDropped: log.gaps.filter((gap) => gap > DROPPED_FRAME_MS).length,
        frameGap: summarize(log.gaps),
        frameWork: summarize(log.work),
        longTasks: summarize(longTasks.stop()),
        pagesRendered: session.rendered - renderedBefore,
        renderErrors: session.renderErrors - errorsBefore,
        lastPageVisibleMs,
        jsHeapMb: jsHeapMb(),
    };
}

/** Sprung wie bei SyncTeX vorwärts: Seite setzen bis nach dem Paint der gerenderten Seite */
export async function jumpTo(pageNumbers: readonly number[]): Promise<number[]> {
    if (current === null) throw new Error('Viewer nicht offen');
    const session = current;
    const times: number[] = [];
    for (const pageNumber of pageNumbers) {
        const started = performance.now();
        const rendered = waitForPage(session.eventBus, pageNumber);
        session.viewer.currentPageNumber = pageNumber;
        const seen = await rendered;
        times.push(seen ? (await afterNextPaint()) - started : Number.NaN);
    }
    return times;
}

export async function closeViewer(): Promise<void> {
    if (current === null) return;
    current.viewer.setDocument(null as never);
    await current.task.destroy();
    current = null;
    containerElement().hidden = true;
}
