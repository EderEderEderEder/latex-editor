// Messung (1): Tastendruck-Latenz im Editor, während pdf.js fortlaufend Seiten rendert. Die Tasten kommen als echte
// Tastaturereignisse über Playwright (CDP); gemessen wird je `keydown` ab `event.timeStamp` (Eingang im Renderer):
//   inputDelay – Warten, bis der Hauptthread das Ereignis annimmt (hier wirkt Hauptthread-Rendern),
//   latency    – bis nach dem Paint des Rahmens, der den neuen Text zeigt.
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { fontSpacesGeometry } from '../../src/geometry.mjs';
import { openDocument, isWorkerRenderingActive, type RenderMode } from './pdfSetup';
import { afterNextPaint, longTaskRecorder, summarize, type Summary } from './stats';

export type LoadMode = 'none' | RenderMode;

/** Breite der Seite in CSS-Pixeln (halbes Fenster, wie „Geteilt“) */
const PAGE_CSS_WIDTH = 650;

interface KeySample {
    inputDelay: number;
    latency: number;
}

export interface TypingResult {
    mode: LoadMode;
    devicePixelRatio: number;
    workerRenderingActive: boolean;
    inputDelay: Summary;
    latency: Summary;
    pageRender: Summary;
    geometry: Summary;
    pagesRendered: number;
    longTasks: Summary;
    fontFaces: number;
}

interface RenderLoad {
    stop: () => Promise<void>;
    renderTimes: number[];
    geometryTimes: number[];
    task: PDFDocumentLoadingTask | null;
    pixelRatio: number;
}

let samples: KeySample[] = [];
let recording = false;

function recordKey(event: KeyboardEvent): void {
    if (!recording) return;
    const handlerStart = performance.now();
    void afterNextPaint().then((painted) => {
        samples.push({ inputDelay: handlerStart - event.timeStamp, latency: painted - event.timeStamp });
    });
}

window.addEventListener('keydown', recordKey, true);

async function renderOnePage(document_: PDFDocumentProxy, number: number, load: RenderLoad, measure: CanvasRenderingContext2D): Promise<void> {
    const page = await document_.getPage(number);
    const viewport = page.getViewport({ scale: (PAGE_CSS_WIDTH / page.view[2]!) * load.pixelRatio });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${PAGE_CSS_WIDTH}px`;
    document.getElementById('renderPane')?.replaceChildren(canvas);
    const started = performance.now();
    await page.render({ canvas, viewport }).promise;
    const rendered = performance.now();
    fontSpacesGeometry(await page.getTextContent(), page.view, measure);
    load.renderTimes.push(rendered - started);
    load.geometryTimes.push(performance.now() - rendered);
    page.cleanup();
}

function startRenderLoad(bytes: Uint8Array | null, mode: LoadMode, pixelRatio: number): RenderLoad {
    const load: RenderLoad = { stop: async () => undefined, renderTimes: [], geometryTimes: [], task: null, pixelRatio };
    if (bytes === null || mode === 'none') return load;
    const measure = document.createElement('canvas').getContext('2d');
    if (measure === null) throw new Error('Kein Canvas-Kontext');
    let running = true;
    const task = openDocument(bytes, mode);
    load.task = task;
    const loop = (async () => {
        const document_ = await task.promise;
        for (let number = 1; running; number = (number % document_.numPages) + 1) {
            await renderOnePage(document_, number, load, measure);
        }
    })();
    load.stop = async () => {
        running = false;
        await loop;
    };
    return load;
}

let activeLoad: RenderLoad | null = null;
let activeMode: LoadMode = 'none';
let longTasks: { stop: () => number[] } | null = null;

/** Startet die Last; danach tippt Playwright, dann `finishTyping`. `pixelRatio` ersetzt devicePixelRatio beim Rendern */
export async function beginTyping(bytes: Uint8Array | null, mode: LoadMode, warmupMs: number, pixelRatio: number | null): Promise<void> {
    samples = [];
    activeMode = mode;
    activeLoad = startRenderLoad(bytes, mode, pixelRatio ?? window.devicePixelRatio);
    await activeLoad.task?.promise;
    await new Promise((resolve) => setTimeout(resolve, warmupMs));
    longTasks = longTaskRecorder();
    recording = true;
}

export async function finishTyping(): Promise<TypingResult> {
    recording = false;
    await afterNextPaint();
    const long = longTasks?.stop() ?? [];
    const load = activeLoad;
    await load?.stop();
    const result: TypingResult = {
        mode: activeMode,
        devicePixelRatio: load?.pixelRatio ?? window.devicePixelRatio,
        workerRenderingActive: load?.task !== null && load?.task !== undefined && isWorkerRenderingActive(load.task),
        inputDelay: summarize(samples.map((sample) => sample.inputDelay)),
        latency: summarize(samples.map((sample) => sample.latency)),
        pageRender: summarize(load?.renderTimes ?? []),
        geometry: summarize(load?.geometryTimes ?? []),
        pagesRendered: load?.renderTimes.length ?? 0,
        longTasks: summarize(long),
        fontFaces: document.fonts.size,
    };
    await load?.task?.destroy();
    document.getElementById('renderPane')?.replaceChildren();
    return result;
}
