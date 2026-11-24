// Text-E/A im Main: UTF-8 strikt, sonst Latin-1; Zeilenenden und BOM bleiben beim Speichern erhalten.
// Alle Zugriffe asynchron, kein Electron-Import. Fehler als IpcFailure mit den Arten aus dem Vertrag.
import { createHash, randomBytes } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { AbsolutePath, ContentHash, LineEnding, TextEncoding, TextFile, WriteResult } from '../shared/contract';
import { IpcFailure } from '../shared/ipcResult';

export const MAX_TEXT_FILE_BYTES = 50 * 1024 * 1024;
// Wartezeiten zwischen den Umbenennen-Versuchen (OneDrive/Virenscanner halten Dateien kurz fest).
export const RENAME_RETRY_DELAYS_MS: readonly number[] = [25, 50, 100, 200, 400, 800];
const RETRYABLE_RENAME_CODES: ReadonlySet<string> = new Set(['EBUSY', 'EPERM', 'EACCES']);
const TEMP_SUFFIX_BYTES = 6;
const DEFAULT_FILE_MODE = 0o666;

export const TEXT_IO_MESSAGES = {
    notFound: 'Datei nicht gefunden',
    access: 'Kein Zugriff auf die Datei',
    conflict: 'Die Datei wurde seit dem Laden geändert',
    tooLarge: 'Die Datei ist zu groß',
    notRepresentable: 'Der Text enthält Zeichen, die in Latin-1 nicht darstellbar sind',
    notAFile: 'Der Pfad ist keine Datei',
} as const;

export interface TextIoOptions {
    readonly rename?: (from: string, to: string) => Promise<void>;
    readonly sleep?: (ms: number) => Promise<void>;
}

interface DecodedText {
    readonly text: string;
    readonly encoding: TextEncoding;
}

export function hashBytes(bytes: Uint8Array): ContentHash {
    return createHash('sha256').update(bytes).digest('hex');
}

function failure(kind: 'notFound' | 'forbiddenPath' | 'conflict' | 'io' | 'invalidInput', message: string): IpcFailure {
    return new IpcFailure({ kind, message });
}

function errorCode(error: unknown): string | undefined {
    return (error as NodeJS.ErrnoException | undefined)?.code;
}

function mapFsError(error: unknown, path: string): IpcFailure {
    if (error instanceof IpcFailure) return error;
    const code = errorCode(error);
    if (code === 'ENOENT') return failure('notFound', `${TEXT_IO_MESSAGES.notFound}: ${path}`);
    if (code === 'EACCES' || code === 'EPERM') return failure('forbiddenPath', `${TEXT_IO_MESSAGES.access}: ${path}`);
    if (code === 'EISDIR') return failure('invalidInput', `${TEXT_IO_MESSAGES.notAFile}: ${path}`);
    const detail = error instanceof Error ? error.message : String(error);
    return failure('io', `Dateifehler (${path}): ${detail}`);
}

function decodeBytes(bytes: Buffer): DecodedText {
    try {
        // ignoreBOM: Das BOM bleibt als U+FEFF am Textanfang und wird beim Speichern wieder mitgeschrieben.
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        return { text, encoding: 'utf8' };
    } catch {
        return { text: bytes.toString('latin1'), encoding: 'latin1' };
    }
}

// Regel für Zeilenenden (N1):
// - Lesen: Die Mehrheit entscheidet `eol` (CRLF gegen einzelnes LF), bei Gleichstand LF; ein einzelnes CR ist kein
//   Zeilenende und bleibt als Zeichen im Text. Nur echte Paare `\r\n` werden zu LF (`"\r\r\n"` → `"\r\n"`, also
//   ein CR als Zeichen plus Umbruch).
// - Schreiben: Der Renderer schickt LF-Text; jedes LF wird zu `eol`, sonst bleibt der Text unverändert. So kommt
//   `"\r\r\n"` in einer CRLF-Datei byte-gleich zurück.
// - Gemischte Dateien werden beim Speichern auf die Mehrheit vereinheitlicht (bewusst: eine Datei, ein `eol`).
function detectLineEnding(text: string): LineEnding {
    const crlf = text.match(/\r\n/g)?.length ?? 0;
    const lf = (text.match(/\n/g)?.length ?? 0) - crlf;
    return crlf > lf ? 'crlf' : 'lf';
}

function normalizeToLf(text: string): string {
    return text.replace(/\r\n/g, '\n');
}

function applyLineEnding(text: string, eol: LineEnding): string {
    return eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
}

function encodeText(text: string, encoding: TextEncoding): Buffer {
    if (encoding === 'utf8') return Buffer.from(text, 'utf8');
    const bytes = Buffer.from(text, 'latin1');
    if (bytes.toString('latin1') !== text) throw failure('invalidInput', TEXT_IO_MESSAGES.notRepresentable);
    return bytes;
}

async function readCheckedBytes(path: AbsolutePath): Promise<{ bytes: Buffer; mtime: number }> {
    const stats = await fsp.stat(path);
    if (!stats.isFile()) throw failure('invalidInput', `${TEXT_IO_MESSAGES.notAFile}: ${path}`);
    if (stats.size > MAX_TEXT_FILE_BYTES) throw failure('invalidInput', `${TEXT_IO_MESSAGES.tooLarge}: ${path}`);
    const bytes = await fsp.readFile(path);
    return { bytes, mtime: Math.floor(stats.mtimeMs) };
}

export async function readTextFile(path: AbsolutePath): Promise<TextFile> {
    try {
        const { bytes, mtime } = await readCheckedBytes(path);
        const { text, encoding } = decodeBytes(bytes);
        const eol = detectLineEnding(text);
        return { path, name: basename(path), text: normalizeToLf(text), encoding, eol, hash: hashBytes(bytes), mtime };
    } catch (error) {
        throw mapFsError(error, path);
    }
}

async function currentHash(path: AbsolutePath): Promise<ContentHash | undefined> {
    try {
        return hashBytes(await fsp.readFile(path));
    } catch (error) {
        if (errorCode(error) === 'ENOENT') return undefined;
        throw error;
    }
}

async function assertNoConflict(path: AbsolutePath, expectedHash: ContentHash | undefined): Promise<void> {
    if (expectedHash === undefined) return;
    if ((await currentHash(path)) !== expectedHash) throw failure('conflict', `${TEXT_IO_MESSAGES.conflict}: ${path}`);
}

async function renameWithRetry(from: string, to: string, options: TextIoOptions): Promise<void> {
    const rename = options.rename ?? fsp.rename;
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 0; ; attempt++) {
        try {
            return await rename(from, to);
        } catch (error) {
            const delay = RENAME_RETRY_DELAYS_MS[attempt];
            const retryable = RETRYABLE_RENAME_CODES.has(errorCode(error) ?? '');
            if (!retryable || delay === undefined) throw error;
            await sleep(delay);
        }
    }
}

async function existingMode(path: AbsolutePath): Promise<number> {
    try {
        return (await fsp.stat(path)).mode & 0o777;
    } catch {
        return DEFAULT_FILE_MODE;
    }
}

async function writeTempFile(tempPath: string, bytes: Buffer, mode: number): Promise<void> {
    const handle = await fsp.open(tempPath, 'wx', mode);
    try {
        await handle.writeFile(bytes);
        await handle.sync();
    } finally {
        await handle.close();
    }
}

async function writeAtomically(path: AbsolutePath, bytes: Buffer, options: TextIoOptions): Promise<void> {
    const suffix = randomBytes(TEMP_SUFFIX_BYTES).toString('hex');
    const tempPath = join(dirname(path), `.${basename(path)}.${suffix}.tmp`);
    try {
        await writeTempFile(tempPath, bytes, await existingMode(path));
        await renameWithRetry(tempPath, path, options);
    } catch (error) {
        await fsp.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
}

export async function writeTextFile(
    path: AbsolutePath,
    text: string,
    encoding: TextEncoding,
    eol: LineEnding,
    expectedHash?: ContentHash,
    options: TextIoOptions = {},
): Promise<WriteResult> {
    try {
        const bytes = encodeText(applyLineEnding(text, eol), encoding);
        if (bytes.length > MAX_TEXT_FILE_BYTES) throw failure('invalidInput', `${TEXT_IO_MESSAGES.tooLarge}: ${path}`);
        await assertNoConflict(path, expectedHash);
        await writeAtomically(path, bytes, options);
        return { hash: hashBytes(bytes), mtime: Math.floor((await fsp.stat(path)).mtimeMs) };
    } catch (error) {
        throw mapFsError(error, path);
    }
}
