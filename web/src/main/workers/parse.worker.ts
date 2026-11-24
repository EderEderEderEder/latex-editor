import { readFile } from 'node:fs/promises';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import type { GeneralError } from '../../shared/contract';
import { type LogIssue, parseBiberLog, parseLogBytes } from '../../shared/core/latex/logParser';

// Log-Worker (worker_threads): liest die Logdatei selbst und liefert die Meldungen; der Main-Prozess schickt nur
// Pfade. Eine Anfrage nach der anderen. Muster wie `synctex.worker.ts`.

// Kennung in `workerData`: nur ein so gestarteter Thread beantwortet Anfragen (kein Start durch den bloßen Import).
export const PARSE_WORKER_KIND = 'latexeditor-parse';

export interface ParseWorkerData {
    readonly kind: typeof PARSE_WORKER_KIND;
}

export const PARSE_WORKER_DATA: ParseWorkerData = { kind: PARSE_WORKER_KIND };

export interface ParseWorkerRequest {
    readonly id: number;
    readonly logPath: string;
    /** Fehlt die Datei, gibt es einfach keine Biber-Meldungen */
    readonly biberPath?: string | undefined;
    /** Löst relative Pfade im Log auf (Ordner der Hauptdatei) */
    readonly baseDirectory: string;
}

export type ParseWorkerResponse =
    | { readonly id: number; readonly ok: true; readonly value: readonly LogIssue[] }
    | { readonly id: number; readonly ok: false; readonly error: GeneralError };

export type ParseRequestHandler = (request: ParseWorkerRequest) => Promise<ParseWorkerResponse>;

function failure(id: number, error: GeneralError): ParseWorkerResponse {
    return { id, ok: false, error };
}

function errorCode(error: unknown): unknown {
    return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

function readError(error: unknown): GeneralError {
    if (errorCode(error) === 'ENOENT') return { kind: 'notFound', message: 'Logdatei nicht gefunden' };
    const detail = error instanceof Error ? error.message : String(error);
    return { kind: 'io', message: `Logdatei konnte nicht gelesen werden: ${detail}` };
}

async function readOptional(path: string): Promise<Buffer | null> {
    try {
        return await readFile(path);
    } catch (error) {
        if (errorCode(error) === 'ENOENT') return null;
        throw error;
    }
}

function isValidRequest(request: ParseWorkerRequest): boolean {
    const isOptionalString = request.biberPath === undefined || typeof request.biberPath === 'string';
    return typeof request.logPath === 'string' && typeof request.baseDirectory === 'string' && isOptionalString;
}

async function parseFiles(request: ParseWorkerRequest): Promise<readonly LogIssue[]> {
    const latexIssues = parseLogBytes(await readFile(request.logPath), request.baseDirectory);
    if (request.biberPath === undefined) return latexIssues;
    const biberLog = await readOptional(request.biberPath);
    if (biberLog === null) return latexIssues;
    return [...latexIssues, ...parseBiberLog(biberLog, latexIssues.length)];
}

// Reine Logik ohne Thread, damit Vitest sie auch direkt prüfen kann.
export function createParseRequestHandler(): ParseRequestHandler {
    return async (request) => {
        if (!isValidRequest(request)) return failure(request.id, { kind: 'invalidInput', message: 'Ungültige Anfrage' });
        try {
            return { id: request.id, ok: true, value: await parseFiles(request) };
        } catch (error) {
            return failure(request.id, readError(error));
        }
    };
}

export function shouldStartWorker(mainThread: boolean, data: unknown): boolean {
    if (mainThread || typeof data !== 'object' || data === null) return false;
    return 'kind' in data && data.kind === PARSE_WORKER_KIND;
}

function startWorker(): void {
    const port = parentPort;
    if (port === null) return;
    const handle = createParseRequestHandler();
    let queue: Promise<void> = Promise.resolve();
    port.on('message', (request: ParseWorkerRequest) => {
        queue = queue
            .then(() => handle(request))
            .then((response) => port.postMessage(response))
            .catch((error: unknown) => {
                const message = `Interner Fehler im Log-Worker: ${String(error)}`;
                port.postMessage(failure(request.id, { kind: 'internal', message }));
            });
    });
}

if (shouldStartWorker(isMainThread, workerData)) startWorker();
