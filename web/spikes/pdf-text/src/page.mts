// Messseite des Spikes S2 (Renderer): lädt die PDFs mit pdf.js, baut je Variante die Zeichenrechtecke aller Seiten,
// ordnet die Testmarkierungen zu und misst die Zeiten. Aufruf von außen: `window.spikeRun(request)`.
import { getDocument, GlobalWorkerOptions, version } from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { fontMetricsGeometry, fontSpacesGeometry, textLayerGeometry, uniformGeometry } from "./geometry.mjs";
import type { FontMetricsStats } from "./geometry.mjs";
import { resolveMark } from "./matcher.mjs";
import type { PageGeometry, PageTiming, SpikeRequest, SpikeResponse, VariantName, VariantRun } from "./types.mjs";

const VARIANTS: VariantName[] = ["textLayer", "uniform", "fontMetrics", "fontSpaces"];
const RENDER_SCALE = 1;

GlobalWorkerOptions.workerSrc = new URL("../../node_modules/pdfjs-dist/build/pdf.worker.mjs", document.baseURI).href;

interface LoadedPage {
    pdf: string;
    number: number;
    proxy: PDFPageProxy;
}

function bytesOf(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

async function loadPages(pdfs: Record<string, string>): Promise<LoadedPage[]> {
    const pages: LoadedPage[] = [];
    for (const [pdf, base64] of Object.entries(pdfs)) {
        const document: PDFDocumentProxy = await getDocument({ data: bytesOf(base64), disableWorkerRendering: true }).promise;
        for (let number = 1; number <= document.numPages; number += 1) {
            pages.push({ pdf, number, proxy: await document.getPage(number) });
        }
    }
    return pages;
}

/** Rendert jede Seite einmal ins Canvas, damit die eingebetteten Schriften als FontFace im Dokument liegen */
async function renderAll(pages: LoadedPage[]): Promise<number> {
    const started = performance.now();
    for (const page of pages) {
        const viewport = page.proxy.getViewport({ scale: RENDER_SCALE });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.proxy.render({ canvas, viewport }).promise;
    }
    return performance.now() - started;
}

interface VariantContext {
    host: HTMLElement;
    scale: number;
    measureContext: CanvasRenderingContext2D;
    stats: FontMetricsStats;
}

async function buildGeometry(variant: VariantName, page: LoadedPage, context: VariantContext): Promise<{ geometry: PageGeometry; timing: PageTiming }> {
    const started = performance.now();
    const content = await page.proxy.getTextContent();
    const contentReady = performance.now();
    const view = page.proxy.view;
    let geometry: PageGeometry;
    if (variant === "textLayer") {
        geometry = await textLayerGeometry(page.proxy, content, context.host, context.scale);
    } else if (variant === "uniform") {
        geometry = uniformGeometry(content, view);
    } else if (variant === "fontSpaces") {
        geometry = fontSpacesGeometry(content, view, context.measureContext);
    } else {
        geometry = fontMetricsGeometry(content, view, context.measureContext, context.stats);
    }
    const timing = { pdf: page.pdf, page: page.number, textContentMs: contentReady - started, geometryMs: performance.now() - contentReady };
    return { geometry, timing };
}

async function runVariant(variant: VariantName, pages: LoadedPage[], request: SpikeRequest, context: VariantContext): Promise<VariantRun> {
    const run: VariantRun = { variant, outputs: [], timings: [], resolveMs: [], notes: [] };
    for (let repetition = 0; repetition < request.repetitions; repetition += 1) {
        const geometries = new Map<string, PageGeometry>();
        const timings: PageTiming[] = [];
        for (const page of pages) {
            const built = await buildGeometry(variant, page, context);
            geometries.set(`${page.pdf}#${page.number}`, built.geometry);
            timings.push(built.timing);
        }
        const started = performance.now();
        run.outputs = request.marks.map((mark) => resolveMark(mark, (pdf, number) => geometries.get(`${pdf}#${number}`)));
        run.resolveMs.push(performance.now() - started);
        run.timings.push(timings);
    }
    return run;
}

function describeStats(stats: FontMetricsStats): string {
    const sorted = [...stats.ratios].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const off = sorted.filter((ratio) => Math.abs(ratio - 1) > 0.02).length;
    return `fontMetrics: ${stats.measuredItems} Stücke gemessen, ${stats.fallbackItems} ohne Schrift; Breitenverhältnis Median ${median.toFixed(3)}, ${off} Stücke > 2 % daneben`;
}

async function spikeRun(request: SpikeRequest): Promise<SpikeResponse> {
    const pages = await loadPages(request.pdfs);
    const renderMs = await renderAll(pages);
    const host = document.getElementById("host") ?? document.body;
    const measureContext = document.createElement("canvas").getContext("2d");
    if (!measureContext) throw new Error("Kein Canvas-Kontext");
    const context: VariantContext = { host, scale: request.scale, measureContext, stats: { measuredItems: 0, fallbackItems: 0, ratios: [] } };
    const runs: VariantRun[] = [];
    for (const variant of VARIANTS) runs.push(await runVariant(variant, pages, request, context));
    runs.find((run) => run.variant === "fontMetrics")?.notes.push(describeStats(context.stats));
    const environment = {
        userAgent: navigator.userAgent,
        devicePixelRatio: String(window.devicePixelRatio),
        pdfjs: version,
        pages: String(pages.length),
        renderAllMs: renderMs.toFixed(1),
    };
    return { runs, environment };
}

window.spikeRun = spikeRun;
