import { readFile } from 'node:fs/promises';
import type { PdfSource } from '../../shared/contract';
import { IpcFailure } from '../../shared/ipcResult';
import type { GrantStore } from '../grants';
import type { IpcHandlers } from '../ipcHandlers';
import type { RealpathFunction } from '../paths';

// `pdf:open` (W3-3, Spike S9): liest ein PDF des aktuellen Projekts und liefert die Bytes über IPC, kein eigenes
// Protokoll. Nur absolute Pfade mit Endung `.pdf`, die (nach Auflösen der Symlinks) im Projekt liegen. Eine Datei,
// die latexmk gerade schreibt, hat noch kein `%%EOF` am Ende: Dann wird kurz gewartet und neu gelesen; bleibt sie
// unvollständig, bekommt der Renderer einen Fehler und behält seine alte Ansicht.

export type PdfHandlers = Pick<IpcHandlers, 'pdf:open'>;

export type ReadBytesFunction = (path: string) => Promise<Uint8Array>;
export type WaitFunction = (milliseconds: number) => Promise<void>;

export interface PdfHandlerDependencies {
    readonly grants: GrantStore;
    readonly realpath?: RealpathFunction;
    /** Nur für Tests: Lesen und Warten ersetzen (Standard: `fs/promises.readFile`, `setTimeout`) */
    readonly readBytes?: ReadBytesFunction;
    readonly wait?: WaitFunction;
}

export const PDF_READ_ATTEMPTS = 3;
export const PDF_RETRY_DELAY_MS = 250;

const PDF_EXTENSION = '.pdf';
const PDF_HEADER = '%PDF-';
const PDF_EOF_MARKER = '%%EOF';
// pdf.js sucht das Ende ebenfalls nur in den letzten 1024 Bytes (Leerzeilen oder Müll nach `%%EOF` sind erlaubt).
const PDF_EOF_SEARCH_BYTES = 1024;
const PATH_SEPARATORS = /[\\/]/;
const PARENT_SEGMENT = '..';
const ASCII = 'latin1';

export const PDF_MESSAGES = {
    parentSegment: 'Pfade mit „..“ sind nicht erlaubt',
    notPdf: 'Nur PDF-Dateien lassen sich anzeigen',
    notFound: 'PDF nicht gefunden',
    unreadable: 'PDF lässt sich nicht lesen',
    incomplete: 'PDF ist unvollständig (wird vermutlich gerade geschrieben)',
} as const;

function errorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
    return typeof error.code === 'string' ? error.code : undefined;
}

function rejectInvalidTarget(target: string): void {
    if (target.split(PATH_SEPARATORS).includes(PARENT_SEGMENT)) {
        throw new IpcFailure({ kind: 'forbiddenPath', message: PDF_MESSAGES.parentSegment });
    }
    if (!target.toLowerCase().endsWith(PDF_EXTENSION)) {
        throw new IpcFailure({ kind: 'invalidInput', message: PDF_MESSAGES.notPdf });
    }
}

/** Kopf `%PDF-` am Anfang und `%%EOF` am Ende: sonst schreibt latexmk vermutlich noch */
export function isCompletePdf(bytes: Uint8Array): boolean {
    const decoder = new TextDecoder(ASCII);
    const header = decoder.decode(bytes.subarray(0, PDF_HEADER.length));
    if (header !== PDF_HEADER) return false;
    const tail = decoder.decode(bytes.subarray(Math.max(0, bytes.length - PDF_EOF_SEARCH_BYTES)));
    return tail.includes(PDF_EOF_MARKER);
}

async function readBytesOnce(path: string, read: ReadBytesFunction): Promise<Uint8Array> {
    try {
        return await read(path);
    } catch (error) {
        if (errorCode(error) === 'ENOENT') throw new IpcFailure({ kind: 'notFound', message: `${PDF_MESSAGES.notFound}: ${path}` });
        const detail = error instanceof Error ? error.message : String(error);
        throw new IpcFailure({ kind: 'io', message: `${PDF_MESSAGES.unreadable}: ${detail}` });
    }
}

const defaultWait: WaitFunction = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readCompletePdf(path: string, deps: PdfHandlerDependencies): Promise<Uint8Array> {
    const read: ReadBytesFunction = deps.readBytes ?? ((file) => readFile(file));
    const wait: WaitFunction = deps.wait ?? defaultWait;
    for (let attempt = 1; ; attempt++) {
        const bytes = await readBytesOnce(path, read);
        if (isCompletePdf(bytes)) return bytes;
        if (attempt >= PDF_READ_ATTEMPTS) throw new IpcFailure({ kind: 'io', message: PDF_MESSAGES.incomplete });
        await wait(PDF_RETRY_DELAY_MS);
    }
}

// Ein `Buffer` aus dem Pool teilt sich seinen Speicher mit anderen; IPC kopierte sonst den ganzen Speicherblock.
function ownBytes(bytes: Uint8Array): Uint8Array {
    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
        return new Uint8Array(bytes.buffer, 0, bytes.byteLength);
    }
    return bytes.slice();
}

export async function openPdf(target: string, deps: PdfHandlerDependencies): Promise<PdfSource> {
    rejectInvalidTarget(target);
    const realPath = await deps.grants.assertInProject(target, deps.realpath);
    return { kind: 'bytes', bytes: ownBytes(await readCompletePdf(realPath, deps)) };
}

export function createPdfHandlers(deps: PdfHandlerDependencies): PdfHandlers {
    return {
        'pdf:open': (target) => openPdf(target, deps),
    };
}
