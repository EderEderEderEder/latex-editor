import { performance } from 'node:perf_hooks';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { GeneralError, SyncTexBackwardResult, SyncTexForwardResult } from '../../shared/contract';
import { backwardSearch, forwardSearch, loadSyncTeX, SyncTeXError, type SyncTeXIndex } from '../synctex';

// SyncTeX-Worker (worker_threads): hält den Index und beantwortet Anfragen, der Main-Prozess
// schickt nur Pfade und Koordinaten. Anfragen werden der Reihe nach beantwortet; ein `forward`
// direkt nach `load` sieht also schon die neuen Daten. Schlägt `load` fehl, bleiben die alten.

// Kennung in `workerData`: nur ein so gestarteter Thread beantwortet Anfragen. Ohne sie bliebe der Import
// eine Nebenwirkung, z. B. in einem Vitest-Thread, dessen `parentPort` dem Testlauf gehört.
export const SYNCTEX_WORKER_KIND = 'latexeditor-synctex';

export interface SyncTeXWorkerData {
    readonly kind: typeof SYNCTEX_WORKER_KIND;
}

export const SYNCTEX_WORKER_DATA: SyncTeXWorkerData = { kind: SYNCTEX_WORKER_KIND };

export type SyncTeXWorkerRequest =
    | { readonly id: number; readonly type: 'load'; readonly file: string; readonly platform?: NodeJS.Platform }
    | { readonly id: number; readonly type: 'forward'; readonly file: string; readonly line: number }
    | { readonly id: number; readonly type: 'backward'; readonly page: number; readonly x: number; readonly y: number };

export interface SyncTeXLoadSummary {
    readonly inputs: number;
    readonly records: number;
    readonly pages: number;
    readonly durationMs: number;
}

export type SyncTeXWorkerValue = SyncTeXLoadSummary | SyncTexForwardResult | SyncTexBackwardResult | null;

export type SyncTeXWorkerResponse =
    | { readonly id: number; readonly ok: true; readonly value: SyncTeXWorkerValue }
    | { readonly id: number; readonly ok: false; readonly error: GeneralError };

export type SyncTeXRequestHandler = (request: SyncTeXWorkerRequest) => Promise<SyncTeXWorkerResponse>;

function failure(id: number, error: GeneralError): SyncTeXWorkerResponse {
    return { id, ok: false, error };
}

function loadError(error: unknown): GeneralError {
    if (error instanceof SyncTeXError) return { kind: 'io', message: `SyncTeX-Datei unlesbar: ${error.message}` };
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') return { kind: 'notFound', message: 'SyncTeX-Datei nicht gefunden' };
    const detail = error instanceof Error ? error.message : String(error);
    return { kind: 'io', message: `SyncTeX-Datei konnte nicht gelesen werden: ${detail}` };
}

function summarize(index: SyncTeXIndex, durationMs: number): SyncTeXLoadSummary {
    return { inputs: index.inputs.size, records: index.records.count, pages: index.pageRanges.size, durationMs };
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isValidQuery(request: SyncTeXWorkerRequest): boolean {
    if (request.type === 'forward') return typeof request.file === 'string' && isFiniteNumber(request.line);
    if (request.type === 'backward') {
        return isFiniteNumber(request.page) && isFiniteNumber(request.x) && isFiniteNumber(request.y);
    }
    return typeof request.file === 'string';
}

// Reine Logik ohne Thread, damit Vitest sie auch direkt prüfen kann.
export function createSyncTeXRequestHandler(): SyncTeXRequestHandler {
    let index: SyncTeXIndex | null = null;
    return async (request) => {
        if (!isValidQuery(request)) return failure(request.id, { kind: 'invalidInput', message: 'Ungültige Anfrage' });
        if (request.type === 'load') {
            const started = performance.now();
            try {
                index = await loadSyncTeX(request.file, { platform: request.platform });
            } catch (error) {
                return failure(request.id, loadError(error));
            }
            return { id: request.id, ok: true, value: summarize(index, performance.now() - started) };
        }
        if (index === null) return failure(request.id, { kind: 'notFound', message: 'Keine SyncTeX-Daten geladen' });
        if (request.type === 'forward') {
            return { id: request.id, ok: true, value: forwardSearch(index, request.file, request.line) };
        }
        return { id: request.id, ok: true, value: backwardSearch(index, request.page, request.x, request.y) };
    };
}

export function shouldStartWorker(mainThread: boolean, data: unknown): boolean {
    if (mainThread || typeof data !== 'object' || data === null) return false;
    return 'kind' in data && data.kind === SYNCTEX_WORKER_KIND;
}

function startWorker(): void {
    const port = parentPort;
    if (port === null) return;
    const handle = createSyncTeXRequestHandler();
    let queue: Promise<void> = Promise.resolve();
    port.on('message', (request: SyncTeXWorkerRequest) => {
        queue = queue
            .then(() => handle(request))
            .then((response) => port.postMessage(response))
            .catch((error: unknown) => {
                const message = `Interner Fehler im SyncTeX-Worker: ${String(error)}`;
                port.postMessage(failure(request.id, { kind: 'internal', message }));
            });
    });
}

if (shouldStartWorker(isMainThread, workerData)) startWorker();
