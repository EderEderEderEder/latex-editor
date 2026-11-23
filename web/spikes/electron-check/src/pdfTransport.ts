// S9: PDF-Laden über eigenes Protokoll (mit/ohne Range) gegen binäre IPC-Antwort, Zeit bis getDocument().promise.
import { getDocument, GlobalWorkerOptions, PDFWorker } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', document.baseURI).href;

export type Variant = 'protocolRange' | 'protocolFull' | 'ipc';
export interface LoadResult { readonly ms: number; readonly pages: number; readonly bytes: number }

let sharedWorker: PDFWorker | null = null;
let nonce = 0;

export async function prepareWorker(): Promise<number> {
    const start = performance.now();
    sharedWorker = new PDFWorker({});
    await sharedWorker.promise;
    return performance.now() - start;
}

export function protocolUrl(path: string): string {
    nonce += 1;
    return `latexeditor://pdf/?p=${encodeURIComponent(path)}&n=${nonce}`;
}

export async function loadOnce(variant: Variant, path: string, renderFirstPage = false): Promise<LoadResult & { rendered: string }> {
    const start = performance.now();
    const common = { worker: sharedWorker ?? undefined, isEvalSupported: false };
    let bytes = 0;
    let task;
    if (variant === 'ipc') {
        const data = await window.spike.readPdf(path);
        bytes = data.byteLength;
        task = getDocument({ ...common, data });
    } else {
        const full = variant === 'protocolFull';
        task = getDocument({ ...common, url: protocolUrl(path), disableRange: full, disableStream: full });
    }
    const document_ = await task.promise;
    const ms = performance.now() - start;
    const rendered = renderFirstPage ? await renderPage1(document_) : '';
    const pages = document_.numPages;
    await task.destroy();
    return { ms, pages, bytes, rendered };
}

async function renderPage1(document_: Awaited<ReturnType<typeof getDocument>['promise']>): Promise<string> {
    const page = await document_.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const canvas = window.document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;
    const text = await page.getTextContent();
    return `Seite 1 gerendert, ${text.items.length} Textelemente`;
}

export async function measure(variant: Variant, path: string, runs: number): Promise<number[]> {
    const times: number[] = [];
    for (let index = 0; index < runs; index++) times.push((await loadOnce(variant, path)).ms);
    return times;
}
