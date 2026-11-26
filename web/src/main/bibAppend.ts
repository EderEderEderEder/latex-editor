import { randomUUID } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { BibAppendResult, ContentHash, TextFile, UndoToken } from '../shared/contract';
import { appendix } from '../shared/core/bib/sourceBuilder';
import { IpcFailure } from '../shared/ipcResult';
import { hashBytes, readTextFile, type TextIoOptions, writeTextFile } from './textIo';

// Anhängen eines fertig formatierten Bib-Eintrags an die Literaturdatei (W4-8, Port von `appendToBibliography`
// aus der Swift-Version): Kodierung (Latin-1), BOM und Zeilenenden der Datei bleiben, geschrieben wird atomar
// mit Hash-Prüfung. Eine nicht lesbare `.bib` wird nie überschrieben (das Lesen wirft vorher). Zusätzlich zur
// Swift-Version: Sicherung der alten Datei im App-Datenordner und Rückgängig (`undo`), solange die Datei noch
// genau dem Stand nach dem Anhängen entspricht. Die Sicherung bleibt liegen.

export const MAX_BIB_FRAGMENT_CHARS = 1_000_000;
const MAX_UNDO_RECORDS = 200;
const NEW_FILE_MODE = 0o666;
const UNDO_TEMP_SUFFIX = '.undo.tmp';

export const BIB_APPEND_MESSAGES = {
    tooLarge: 'Der Eintrag ist zu groß',
    notBib: 'Ziel ist keine .bib-Datei',
    unknownToken: 'Dieser Schritt ist unbekannt oder schon zurückgenommen.',
    changed: 'Die Literaturdatei wurde seitdem geändert; Rückgängig würde diese Änderung überschreiben.',
} as const;

export interface BibAppenderOptions {
    readonly backupDir: string;
    readonly createToken?: () => UndoToken;
    readonly textIo?: TextIoOptions;
}

interface UndoRecord {
    readonly path: string;
    readonly kind: 'appended' | 'created';
    readonly backupFile: string;
    readonly afterHash: ContentHash;
}

function failure(kind: 'invalidInput' | 'conflict' | 'notFound', message: string): IpcFailure {
    return new IpcFailure({ kind, message });
}

function errorCode(error: unknown): string | undefined {
    return (error as NodeJS.ErrnoException | undefined)?.code;
}

async function fileStamp(path: string): Promise<{ hash: ContentHash; mtime: number }> {
    const [bytes, stats] = await Promise.all([fsp.readFile(path), fsp.stat(path)]);
    return { hash: hashBytes(bytes), mtime: Math.floor(stats.mtimeMs) };
}

export class BibAppender {
    private readonly records = new Map<UndoToken, UndoRecord>();
    private queue: Promise<unknown> = Promise.resolve();
    private readonly createToken: () => UndoToken;

    constructor(private readonly options: BibAppenderOptions) {
        this.createToken = options.createToken ?? randomUUID;
    }

    // `path`: aufgelöster, als „im Projekt“ geprüfter Pfad einer `.bib`.
    append(path: string, fragment: string): Promise<BibAppendResult> {
        return this.serialize(() => this.appendNow(path, fragment));
    }

    undo(token: UndoToken): Promise<void> {
        return this.serialize(() => this.undoNow(token));
    }

    private serialize<T>(task: () => Promise<T>): Promise<T> {
        const result = this.queue.then(task, task);
        this.queue = result.catch(() => undefined);
        return result;
    }

    private async appendNow(path: string, fragment: string): Promise<BibAppendResult> {
        if (fragment.length > MAX_BIB_FRAGMENT_CHARS) throw failure('invalidInput', BIB_APPEND_MESSAGES.tooLarge);
        if (!path.toLowerCase().endsWith('.bib')) throw failure('invalidInput', BIB_APPEND_MESSAGES.notBib);
        const entry = fragment.replace(/\r\n/g, '\n');
        const existing = await this.readExisting(path);
        if (existing === null) return this.createFile(path, entry);
        const token = this.createToken();
        const backupFile = await this.backUp(path, token);
        const text = existing.text + appendix(entry, existing.text);
        const written = await writeTextFile(path, text, existing.encoding, existing.eol, existing.hash, this.options.textIo);
        this.remember(token, { path, kind: 'appended', backupFile, afterHash: written.hash });
        return { path, hash: written.hash, mtime: written.mtime, created: false, undoToken: token };
    }

    private async readExisting(path: string): Promise<TextFile | null> {
        try {
            return await readTextFile(path);
        } catch (error) {
            if (error instanceof IpcFailure && error.error.kind === 'notFound') return null;
            throw error;
        }
    }

    // Neue Datei: UTF-8 mit LF. `wx` schlägt fehl, wenn sie inzwischen doch entstanden ist (nie überschreiben).
    private async createFile(path: string, entry: string): Promise<BibAppendResult> {
        await fsp.mkdir(dirname(path), { recursive: true });
        try {
            await fsp.writeFile(path, entry, { flag: 'wx', mode: NEW_FILE_MODE });
        } catch (error) {
            if (errorCode(error) === 'EEXIST') throw failure('conflict', `Die Datei wurde inzwischen angelegt: ${basename(path)}`);
            throw error;
        }
        const stamp = await fileStamp(path);
        const token = this.createToken();
        this.remember(token, { path, kind: 'created', backupFile: join(this.options.backupDir, token, basename(path)), afterHash: stamp.hash });
        return { path, hash: stamp.hash, mtime: stamp.mtime, created: true, undoToken: token };
    }

    private async backUp(path: string, token: UndoToken): Promise<string> {
        const folder = join(this.options.backupDir, token);
        await fsp.mkdir(folder, { recursive: true });
        const backupFile = join(folder, basename(path));
        await fsp.copyFile(path, backupFile);
        return backupFile;
    }

    private remember(token: UndoToken, record: UndoRecord): void {
        this.records.set(token, record);
        while (this.records.size > MAX_UNDO_RECORDS) {
            const oldest = this.records.keys().next().value;
            if (oldest === undefined) return;
            this.records.delete(oldest);
        }
    }

    private async undoNow(token: UndoToken): Promise<void> {
        const record = this.records.get(token);
        if (record === undefined) throw failure('notFound', BIB_APPEND_MESSAGES.unknownToken);
        const current = await fileStamp(record.path).catch(() => null);
        if (current === null || current.hash !== record.afterHash) throw failure('conflict', BIB_APPEND_MESSAGES.changed);
        if (record.kind === 'appended') await this.restoreBackup(record);
        else await this.moveToBackup(record);
        this.records.delete(token);
    }

    private async restoreBackup(record: UndoRecord): Promise<void> {
        const tempPath = join(dirname(record.path), `.${basename(record.path)}${UNDO_TEMP_SUFFIX}`);
        try {
            await fsp.copyFile(record.backupFile, tempPath);
            await fsp.rename(tempPath, record.path);
        } catch (error) {
            await fsp.rm(tempPath, { force: true }).catch(() => undefined);
            throw error;
        }
    }

    // Die angelegte Datei wandert in den Ablageordner statt gelöscht zu werden.
    private async moveToBackup(record: UndoRecord): Promise<void> {
        await fsp.mkdir(dirname(record.backupFile), { recursive: true });
        await fsp.copyFile(record.path, record.backupFile);
        await fsp.rm(record.path);
    }
}
