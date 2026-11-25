// pdf.js-Einstellungen der Messseite: Worker-Dateien und Hilfsdaten liegen im eigenen out-Ordner (wie im Paket),
// Rendern wahlweise im Hauptthread (`disableWorkerRendering: true`, wie S2) oder im Render-Worker (OffscreenCanvas).
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentLoadingTask } from 'pdfjs-dist';

export type RenderMode = 'mainThread' | 'worker';

const ASSET_FOLDERS = { cMapUrl: './cmaps/', standardFontDataUrl: './standard_fonts/', wasmUrl: './wasm/', iccUrl: './iccs/' };

function assetUrl(relative: string): string {
    return new URL(relative, document.baseURI).href;
}

/** Wird von `src/page.mts` (S2) schon gesetzt; hier nur der Render-Worker */
function configureRenderer(): void {
    const renderer = document.documentElement.dataset.pdfRenderer;
    if (renderer !== undefined) GlobalWorkerOptions.rendererSrc = assetUrl(renderer);
}

export function openDocument(bytes: Uint8Array, mode: RenderMode): PDFDocumentLoadingTask {
    configureRenderer();
    return getDocument({
        data: bytes.slice(),
        disableWorkerRendering: mode === 'mainThread',
        cMapUrl: assetUrl(ASSET_FOLDERS.cMapUrl),
        cMapPacked: true,
        standardFontDataUrl: assetUrl(ASSET_FOLDERS.standardFontDataUrl),
        wasmUrl: assetUrl(ASSET_FOLDERS.wasmUrl),
        iccUrl: assetUrl(ASSET_FOLDERS.iccUrl),
    });
}

interface RendererWorkerHandle {
    _rendererWorker?: { messageHandler?: unknown } | null;
}

/** Läuft der Render-Worker wirklich (sonst fällt pdf.js still auf den Hauptthread zurück)? */
export function isWorkerRenderingActive(task: PDFDocumentLoadingTask): boolean {
    const worker = (task as unknown as RendererWorkerHandle)._rendererWorker;
    return worker !== null && worker !== undefined && worker.messageHandler !== null && worker.messageHandler !== undefined;
}

export function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}
