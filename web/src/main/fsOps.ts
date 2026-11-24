// Dateiaktionen im Projekt (W2-7): anlegen, umbenennen, verschieben, duplizieren, importieren, Papierkorb und
// Rückgängig. Reines Node ohne Electron: Papierkorb (`shell.trashItem`) und App-Ablage kommen als Parameter herein.
// Verhalten nach der Swift-Version (`swift/Sources/LatexEditor/Model/FileOperations.swift`, `App/FileUndo.swift`).
import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, type BigIntStats } from 'node:fs';
import * as fsp from 'node:fs/promises';
import type { AbsolutePath, CreateKind, FileOpResult, GeneralErrorKind, ImportResult, UndoToken } from '../shared/contract';
import { IpcFailure } from '../shared/ipcResult';
import {
    assertInsideProject,
    comparisonKey,
    isPathWithin,
    normalizeAbsolutePath,
    resolveRealPath,
    type PathPlatform,
    type RealpathFunction,
} from './paths';
import { RENAME_RETRY_DELAYS_MS } from './textIo';

// ---------- Namen (reine Funktionen) ----------

export type FileNameProblem =
    | 'empty'
    | 'dotName'
    | 'controlCharacter'
    | 'separator'
    | 'alternateDataStream'
    | 'reservedCharacter'
    | 'trailingDotOrSpace'
    | 'deviceName'
    | 'hidden'
    | 'tooLong';

// Wie Swift (`FileOperations.maximumNameLength`); NTFS und APFS erlaubten 255.
export const MAX_FILE_NAME_LENGTH = 120;
// Windows ohne Langpfad-Präfix (MAX_PATH 260 mit Nullzeichen); TeX-Werkzeuge kennen `\\?\` meist nicht.
export const MAX_WINDOWS_PATH_LENGTH = 259;
// macOS PATH_MAX 1024 mit Nullzeichen (Linux erlaubt mehr, die kleinere Grenze gilt für beide).
export const MAX_POSIX_PATH_LENGTH = 1023;
export const DEFAULT_FILE_EXTENSION = '.tex';

export const FILE_NAME_MESSAGES: Readonly<Record<FileNameProblem, string>> = {
    empty: 'Der Name darf nicht leer sein.',
    dotName: '„.“ und „..“ sind keine Namen.',
    controlCharacter: 'Der Name enthält Steuerzeichen.',
    separator: 'Der Name darf weder „/“ noch „\\“ enthalten.',
    alternateDataStream: 'Der Name darf keinen „:“ enthalten (Windows-Datenstrom).',
    reservedCharacter: 'Der Name darf keines der Zeichen < > : " | ? * enthalten.',
    trailingDotOrSpace: 'Der Name darf unter Windows nicht auf Punkt oder Leerzeichen enden.',
    deviceName: 'Der Name ist unter Windows ein Gerätename (z. B. CON, NUL, COM1).',
    hidden: 'Namen mit Punkt am Anfang sind versteckte Dateien und würden im Baum nicht erscheinen.',
    tooLong: `Der Name ist zu lang (höchstens ${MAX_FILE_NAME_LENGTH} Zeichen).`,
};

// Cc und Cf wie Swift `CharacterSet.controlCharacters` (auch Richtungszeichen, die Namen verfälscht anzeigen).
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u;
const NAME_SEPARATORS = /[\\/]/;
const STREAM_SEPARATOR = ':';
const WINDOWS_RESERVED_CHARACTERS = /[<>"|?*]/;
const TRAILING_DOT_OR_SPACE = /[. ]$/;
// Windows reserviert diese Namen auch mit Endung („nul.tex“, „COM1 .txt“) und mit hochgestellten Ziffern.
const WINDOWS_DEVICE_NAMES = /^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/i;
const DOT_NAMES: ReadonlySet<string> = new Set(['.', '..']);

function windowsDeviceStem(name: string): string {
    return (name.split('.')[0] ?? '').trimEnd();
}

function windowsNameProblem(name: string): FileNameProblem | null {
    if (WINDOWS_RESERVED_CHARACTERS.test(name)) return 'reservedCharacter';
    if (TRAILING_DOT_OR_SPACE.test(name)) return 'trailingDotOrSpace';
    if (WINDOWS_DEVICE_NAMES.test(windowsDeviceStem(name))) return 'deviceName';
    return null;
}

// Prüft einen einzelnen Namen (kein Pfad). Windows-Regeln nur mit `platform.windows`; „:“ und „\“ sind
// überall verboten (macOS zeigt „:“ als „/“, wie in Swift).
export function validateFileName(name: string, platform: PathPlatform): FileNameProblem | null {
    if (name.trim().length === 0) return 'empty';
    if (DOT_NAMES.has(name)) return 'dotName';
    if (CONTROL_CHARACTERS.test(name)) return 'controlCharacter';
    if (NAME_SEPARATORS.test(name)) return 'separator';
    if (name.includes(STREAM_SEPARATOR)) return platform.windows ? 'alternateDataStream' : 'reservedCharacter';
    const windowsProblem = platform.windows ? windowsNameProblem(name) : null;
    if (windowsProblem !== null) return windowsProblem;
    if (name.startsWith('.')) return 'hidden';
    if (name.length > MAX_FILE_NAME_LENGTH) return 'tooLong';
    return null;
}

function invalidInput(message: string): IpcFailure {
    return new IpcFailure({ kind: 'invalidInput', message });
}

export function assertValidFileName(name: string, platform: PathPlatform): string {
    const problem = validateFileName(name, platform);
    if (problem !== null) throw invalidInput(FILE_NAME_MESSAGES[problem]);
    return name;
}

// Neue Datei ohne Endung bekommt `.tex` (wie Swift `newFileName`).
export function newFileName(raw: string, platform: PathPlatform): string {
    assertValidFileName(raw, platform);
    const name = platform.path.extname(raw) === '' ? raw + DEFAULT_FILE_EXTENSION : raw;
    return assertValidFileName(name, platform);
}

// Umbenennen: Wer bei einer Datei die Endung weglässt, behält die bisherige (wie Swift `renamedFileName`).
export function renamedFileName(raw: string, original: string, isDirectory: boolean, platform: PathPlatform): string {
    assertValidFileName(raw, platform);
    const originalExtension = platform.path.extname(original);
    const keepsExtension = isDirectory || originalExtension === '' || platform.path.extname(raw) !== '';
    return assertValidFileName(keepsExtension ? raw : raw + originalExtension, platform);
}

export type NumberedName = (stem: string, extension: string, number: number) => string;

// „kapitel Kopie.tex“, „kapitel Kopie 2.tex“ … (Swift `duplicate`)
export const copyName: NumberedName = (stem, extension, number) =>
    number === 1 ? `${stem} Kopie${extension}` : `${stem} Kopie ${number}${extension}`;

// „bild.png“, „bild 2.png“ … (Swift `copyIn`)
export const importName: NumberedName = (stem, extension, number) =>
    number === 1 ? `${stem}${extension}` : `${stem} ${number}${extension}`;

export function maxPathLength(platform: PathPlatform): number {
    return platform.windows ? MAX_WINDOWS_PATH_LENGTH : MAX_POSIX_PATH_LENGTH;
}

// ---------- Fehler ----------

export const FS_OPS_MESSAGES = {
    parentSegment: 'Pfade mit „..“ sind nicht erlaubt',
    streamPath: 'Pfade mit „:“ (Windows-Datenstrom) sind nicht erlaubt',
    projectRoot: 'Der Projektordner selbst kann hier nicht geändert werden.',
    notADirectory: 'Das Ziel ist kein Ordner.',
    intoItself: 'Ein Ordner kann nicht in sich selbst verschoben werden.',
    pathTooLong: 'Der Pfad ist zu lang.',
    alreadyExists: (name: string) => `„${name}“ existiert an dieser Stelle bereits.`,
    restoreConflict: (name: string) => `„${name}“ existiert schon; nichts wurde überschrieben.`,
    noUniqueName: (name: string) => `Kein freier Name für „${name}“ gefunden.`,
    notFound: (name: string) => `„${name}“ wurde nicht gefunden.`,
    unknownToken: 'Dieser Schritt ist unbekannt oder schon zurückgenommen.',
    noTrash: 'Der Papierkorb ist nicht angebunden.',
    noSources: 'Keine Dateien zum Importieren.',
    backupMismatch: 'Die Sicherung in der App-Ablage weicht vom Original ab; nichts wurde gelöscht.',
    access: 'Kein Zugriff auf die Datei.',
} as const;

function failure(kind: GeneralErrorKind, message: string): IpcFailure {
    return new IpcFailure({ kind, message });
}

function errorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
    return typeof error.code === 'string' ? error.code : undefined;
}

const KIND_BY_CODE: Readonly<Record<string, GeneralErrorKind>> = {
    ENOENT: 'notFound',
    EEXIST: 'alreadyExists',
    ENOTEMPTY: 'alreadyExists',
    EACCES: 'forbiddenPath',
    EPERM: 'forbiddenPath',
    ENOTDIR: 'invalidInput',
    EISDIR: 'invalidInput',
};

function mapFsError(error: unknown): IpcFailure {
    if (error instanceof IpcFailure) return error;
    const detail = error instanceof Error ? error.message : String(error);
    const kind = KIND_BY_CODE[errorCode(error) ?? ''] ?? 'io';
    return failure(kind, `Dateifehler: ${detail}`);
}

// ---------- Dateisystem-Hilfen ----------

const HASH_ALGORITHM = 'sha256';
const HASH_CHUNK_BYTES = 1024 * 1024;
const MAX_UNIQUE_ATTEMPTS = 1000;
// Obergrenze der gemerkten Schritte; ältere verfallen (ihre Sicherungen bleiben in der Ablage liegen).
export const MAX_UNDO_RECORDS = 1000;
const RETRYABLE_RENAME_CODES: ReadonlySet<string> = new Set(['EBUSY', 'EPERM', 'EACCES']);
// Zwischennamen beginnen mit Punkt: Der Dateibaum zeigt sie nicht.
const TEMP_PREFIX = { rename: '.umbenennen-', copy: '.kopie-' } as const;
// Kopien behalten Symlinks als Symlinks: Ihr Ziel (womöglich außerhalb des Projekts) wird nie gelesen.
const COPY_OPTIONS = { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false } as const;

async function lstatOrNull(path: string): Promise<BigIntStats | null> {
    try {
        return await fsp.lstat(path, { bigint: true });
    } catch (error) {
        if (errorCode(error) === 'ENOENT') return null;
        throw error;
    }
}

async function hashFile(path: string): Promise<string> {
    const hash = createHash(HASH_ALGORITHM);
    const handle = await fsp.open(path, 'r');
    try {
        const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
        for (;;) {
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (bytesRead === 0) break;
            hash.update(buffer.subarray(0, bytesRead));
        }
    } finally {
        await handle.close();
    }
    return hash.digest('hex');
}

async function sameDirectory(first: string, second: string, join: (...parts: string[]) => string): Promise<boolean> {
    const [left, right] = await Promise.all([fsp.readdir(first), fsp.readdir(second)]);
    left.sort();
    right.sort();
    if (left.length !== right.length || left.some((name, index) => name !== right[index])) return false;
    for (const name of left) {
        if (!(await sameTree(join(first, name), join(second, name), join))) return false;
    }
    return true;
}

// Byte-gleich: gleiche Struktur, gleiche Symlink-Ziele, gleicher Inhalt (Hash) jeder Datei.
async function sameTree(first: string, second: string, join: (...parts: string[]) => string): Promise<boolean> {
    const [left, right] = await Promise.all([fsp.lstat(first), fsp.lstat(second)]);
    if (left.isSymbolicLink() || right.isSymbolicLink()) {
        return left.isSymbolicLink() && right.isSymbolicLink() && (await fsp.readlink(first)) === (await fsp.readlink(second));
    }
    if (left.isDirectory() || right.isDirectory()) {
        return left.isDirectory() && right.isDirectory() && sameDirectory(first, second, join);
    }
    return left.size === right.size && (await hashFile(first)) === (await hashFile(second));
}

async function removeQuietly(path: string): Promise<void> {
    await fsp.rm(path, { recursive: true, force: true }).catch(() => undefined);
}

// ---------- Rückgängig-Schritte ----------

interface TrashedItem {
    // Pfad in der Form des Projekts (wie der Renderer ihn kennt)
    readonly original: AbsolutePath;
    readonly backup: string;
}

// created: angelegt, dupliziert, importiert oder wiederhergestellt → Rückgängig legt es in den Papierkorb.
// trashed: im Papierkorb, Sicherung in der Ablage → Rückgängig stellt byte-gleich wieder her.
// relocated: umbenannt oder verschoben → Rückgängig verschiebt zurück.
type UndoRecord =
    | { readonly kind: 'created'; readonly paths: readonly AbsolutePath[] }
    | { readonly kind: 'trashed'; readonly folder: string; readonly items: readonly TrashedItem[] }
    | { readonly kind: 'relocated'; readonly from: AbsolutePath; readonly to: AbsolutePath };

export type TrashItem = (path: string) => Promise<void>;

export interface FsOpsDependencies {
    readonly platform: PathPlatform;
    // Wurzel des aktuellen Projekts (wirft ohne Projekt), z. B. `GrantStore.requireProject`
    readonly projectRoot: () => string;
    // App-Ablage für Sicherungen vor dem Papierkorb (im App-Datenordner)
    readonly backupDir: string;
    readonly trashItem?: TrashItem;
    readonly realpath?: RealpathFunction;
    readonly createToken?: () => UndoToken;
    readonly rename?: (from: string, to: string) => Promise<void>;
    readonly sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// Alle Operationen laufen nacheinander (eindeutige Namen, Zwischennamen und Schritte überschneiden sich nicht).
// Ergebnis- und Schrittpfade stehen in der Form der Projektwurzel (nicht aufgelöst), damit sie zum Baum passen.
export class FsOps {
    private readonly records = new Map<UndoToken, UndoRecord>();
    private tail: Promise<unknown> = Promise.resolve();
    private readonly deps: FsOpsDependencies;
    private readonly createToken: () => UndoToken;

    constructor(deps: FsOpsDependencies) {
        this.deps = deps;
        this.createToken = deps.createToken ?? randomUUID;
    }

    create(parentDir: string, name: string, kind: CreateKind): Promise<FileOpResult> {
        return this.serialize(() => this.createNow(parentDir, name, kind));
    }

    rename(path: string, newName: string): Promise<FileOpResult> {
        return this.serialize(() => this.renameNow(path, newName));
    }

    move(path: string, targetDir: string): Promise<FileOpResult> {
        return this.serialize(() => this.moveNow(path, targetDir));
    }

    duplicate(path: string): Promise<FileOpResult> {
        return this.serialize(() => this.duplicateNow(path));
    }

    // Quellen sind schon geprüfte, aufgelöste Pfade (Gewährung und Allowlist prüft der Handler).
    importFiles(sources: readonly string[], targetDir: string): Promise<ImportResult> {
        return this.serialize(() => this.importNow(sources, targetDir));
    }

    trash(path: string): Promise<UndoToken> {
        return this.serialize(() => this.trashNow(path));
    }

    // Nimmt den Schritt zum Token zurück und liefert den Token für den Gegenschritt (Wiederholen).
    restore(token: UndoToken): Promise<UndoToken> {
        return this.serialize(() => this.restoreNow(token));
    }

    private serialize<T>(task: () => Promise<T>): Promise<T> {
        const run = this.tail.then(task, task).catch((error: unknown) => {
            throw mapFsError(error);
        });
        this.tail = run.catch(() => undefined);
        return run;
    }

    // ---------- Pfade ----------

    private get path() {
        return this.deps.platform.path;
    }

    private realOptions() {
        const { platform, realpath } = this.deps;
        return realpath === undefined ? { platform } : { platform, realpath };
    }

    // `..` lehnt schon die Eingabe ab (auch wenn es im Projekt bliebe), ebenso Datenströme (`main.tex:x`).
    private normalizeInput(input: string): string {
        if (input.split(NAME_SEPARATORS).includes('..')) throw failure('forbiddenPath', FS_OPS_MESSAGES.parentSegment);
        const normalized = normalizeAbsolutePath(input, this.deps.platform);
        const rest = normalized.slice(this.path.parse(normalized).root.length);
        if (this.deps.platform.windows && rest.includes(STREAM_SEPARATOR)) throw invalidInput(FS_OPS_MESSAGES.streamPath);
        return normalized;
    }

    private assertInside(candidate: string): Promise<string> {
        return assertInsideProject(candidate, this.deps.projectRoot(), this.realOptions());
    }

    private realRoot(): Promise<string> {
        return resolveRealPath(this.deps.projectRoot(), this.realOptions());
    }

    private sameKey(first: string, second: string): boolean {
        return comparisonKey(first, this.deps.platform) === comparisonKey(second, this.deps.platform);
    }

    // Aufgelöster Pfad → Pfad unter der Projektwurzel, wie der Renderer sie kennt.
    private async toProjectPath(real: string): Promise<AbsolutePath> {
        const relative = this.path.relative(await this.realRoot(), real);
        return relative === '' ? this.deps.projectRoot() : this.path.join(this.deps.projectRoot(), relative);
    }

    // Ein Eintrag (Datei, Ordner oder der Symlink selbst): Aufgelöst wird nur der Elternordner, damit Umbenennen und
    // Löschen den Symlink treffen und nicht sein Ziel. Ein Symlink, der aus dem Projekt zeigt, ist tabu.
    private async resolveEntry(input: string): Promise<string> {
        const normalized = this.normalizeInput(input);
        if (this.sameKey(normalized, this.deps.projectRoot())) throw failure('forbiddenPath', FS_OPS_MESSAGES.projectRoot);
        const entry = this.path.join(await this.assertInside(this.path.dirname(normalized)), this.path.basename(normalized));
        if (isPathWithin(await this.realRoot(), entry, this.deps.platform)) {
            throw failure('forbiddenPath', FS_OPS_MESSAGES.projectRoot);
        }
        const info = await lstatOrNull(entry);
        if (info === null) throw failure('notFound', FS_OPS_MESSAGES.notFound(this.path.basename(entry)));
        if (info.isSymbolicLink()) await this.assertInside(entry);
        return entry;
    }

    private async resolveDirectory(input: string): Promise<string> {
        const directory = await this.assertInside(this.normalizeInput(input));
        const info = await lstatOrNull(directory);
        if (info === null) throw failure('notFound', FS_OPS_MESSAGES.notFound(this.path.basename(directory)));
        if (!info.isDirectory()) throw invalidInput(FS_OPS_MESSAGES.notADirectory);
        return directory;
    }

    // Ziel für Wiederherstellen/Zurückverschieben: im Projekt, Elternordner darf fehlen.
    private async resolveTarget(input: string): Promise<string> {
        const normalized = this.normalizeInput(input);
        const parent = await this.assertInside(this.path.dirname(normalized));
        return this.checkPathLength(this.path.join(parent, this.path.basename(normalized)));
    }

    private checkPathLength(target: string): string {
        if (target.length > maxPathLength(this.deps.platform)) throw invalidInput(FS_OPS_MESSAGES.pathTooLong);
        return target;
    }

    private async freeTarget(directory: string, name: string): Promise<string> {
        const target = this.checkPathLength(this.path.join(directory, name));
        if ((await lstatOrNull(target)) !== null) throw failure('alreadyExists', FS_OPS_MESSAGES.alreadyExists(name));
        return target;
    }

    private async uniqueTarget(directory: string, name: string, numbered: NumberedName): Promise<string> {
        const extension = this.path.extname(name);
        const stem = name.slice(0, name.length - extension.length);
        for (let number = 1; number <= MAX_UNIQUE_ATTEMPTS; number++) {
            const candidate = assertValidFileName(numbered(stem, extension, number), this.deps.platform);
            const target = this.checkPathLength(this.path.join(directory, candidate));
            if ((await lstatOrNull(target)) === null) return target;
        }
        throw failure('alreadyExists', FS_OPS_MESSAGES.noUniqueName(name));
    }

    // ---------- Umbenennen und Verschieben ----------

    private async renameWithRetry(from: string, to: string): Promise<void> {
        const rename = this.deps.rename ?? fsp.rename;
        const sleep = this.deps.sleep ?? defaultSleep;
        for (let attempt = 0; ; attempt++) {
            try {
                return await rename(from, to);
            } catch (error) {
                const delay = RENAME_RETRY_DELAYS_MS[attempt];
                if (!RETRYABLE_RENAME_CODES.has(errorCode(error) ?? '') || delay === undefined) throw error;
                await sleep(delay);
            }
        }
    }

    // Dieselbe Datei unter anderer Schreibweise (NTFS/APFS: Groß-/Kleinschreibung, NFC/NFD)?
    // Ohne Dateinummer (FAT/exFAT liefern 0) entscheidet der Vergleichsschlüssel der Plattform.
    private async isSameEntry(source: string, target: string, existing: BigIntStats): Promise<boolean> {
        const info = await fsp.lstat(source, { bigint: true });
        if (existing.ino === 0n || info.ino === 0n) return this.sameKey(source, target);
        return info.ino === existing.ino && info.dev === existing.dev;
    }

    // Reine Änderung der Schreibweise über einen Zwischennamen; scheitert der zweite Schritt, kommt der Eintrag an
    // seinen alten Platz zurück (sonst läge er unsichtbar unter dem Zwischennamen).
    private async renameViaTemporary(source: string, target: string): Promise<void> {
        const temporary = this.path.join(this.path.dirname(source), TEMP_PREFIX.rename + randomUUID());
        await this.renameWithRetry(source, temporary);
        try {
            await this.renameWithRetry(temporary, target);
        } catch (error) {
            await this.renameWithRetry(temporary, source).catch(() => undefined);
            throw error;
        }
    }

    private async relocate(source: string, target: string, existsKind: GeneralErrorKind): Promise<void> {
        if (source === target) return;
        const existing = await lstatOrNull(target);
        const sameEntry = existing !== null && (await this.isSameEntry(source, target, existing));
        if (existing !== null && !sameEntry) {
            throw failure(existsKind, FS_OPS_MESSAGES.alreadyExists(this.path.basename(target)));
        }
        await fsp.mkdir(this.path.dirname(target), { recursive: true });
        if (sameEntry) return this.renameViaTemporary(source, target);
        return this.renameWithRetry(source, target);
    }

    private async renameNow(input: string, rawName: string): Promise<FileOpResult> {
        const source = await this.resolveEntry(input);
        const isDirectory = (await fsp.lstat(source)).isDirectory();
        const name = renamedFileName(rawName, this.path.basename(source), isDirectory, this.deps.platform);
        const target = this.checkPathLength(this.path.join(this.path.dirname(source), name));
        await this.relocate(source, target, 'alreadyExists');
        return this.relocated(source, target);
    }

    private async moveNow(input: string, targetDir: string): Promise<FileOpResult> {
        const source = await this.resolveEntry(input);
        const directory = await this.resolveDirectory(targetDir);
        if (isPathWithin(directory, source, this.deps.platform)) throw invalidInput(FS_OPS_MESSAGES.intoItself);
        if (this.sameKey(this.path.dirname(source), directory)) return this.relocated(source, source);
        const target = await this.freeTarget(directory, this.path.basename(source));
        await this.relocate(source, target, 'alreadyExists');
        return this.relocated(source, target);
    }

    private async relocated(source: string, target: string): Promise<FileOpResult> {
        const [from, to] = [await this.toProjectPath(source), await this.toProjectPath(target)];
        return { path: to, undoToken: this.register({ kind: 'relocated', from, to }) };
    }

    // ---------- Anlegen, Duplizieren, Importieren ----------

    private async createNow(parentDir: string, rawName: string, kind: CreateKind): Promise<FileOpResult> {
        const directory = await this.resolveDirectory(parentDir);
        const { platform } = this.deps;
        const name = kind === 'file' ? newFileName(rawName, platform) : assertValidFileName(rawName, platform);
        const target = await this.freeTarget(directory, name);
        if (kind === 'directory') {
            await fsp.mkdir(target);
        } else {
            await (await fsp.open(target, 'wx')).close();
        }
        return this.created([target]);
    }

    private async created(targets: readonly string[]): Promise<{ path: AbsolutePath; paths: AbsolutePath[]; undoToken: UndoToken }> {
        const paths: AbsolutePath[] = [];
        for (const target of targets) paths.push(await this.toProjectPath(target));
        return { path: paths[0] ?? '', paths, undoToken: this.register({ kind: 'created', paths }) };
    }

    // Erst unter einem Zwischennamen fertig kopieren, dann an den Platz; bei Fehlern bleibt keine halbe Kopie.
    private async placeCopy(target: string, copy: (temporary: string) => Promise<void>, existsKind: GeneralErrorKind): Promise<void> {
        const temporary = this.path.join(this.path.dirname(target), TEMP_PREFIX.copy + randomUUID());
        try {
            await copy(temporary);
            if ((await lstatOrNull(target)) !== null) {
                throw failure(existsKind, FS_OPS_MESSAGES.alreadyExists(this.path.basename(target)));
            }
            await this.renameWithRetry(temporary, target);
        } catch (error) {
            await removeQuietly(temporary);
            throw error;
        }
    }

    private async duplicateNow(input: string): Promise<FileOpResult> {
        const source = await this.resolveEntry(input);
        const target = await this.uniqueTarget(this.path.dirname(source), this.path.basename(source), copyName);
        await this.placeCopy(target, (temporary) => fsp.cp(source, temporary, COPY_OPTIONS), 'alreadyExists');
        const { path, undoToken } = await this.created([target]);
        return { path, undoToken };
    }

    private async importOne(source: string, directory: string): Promise<string> {
        const name = assertValidFileName(this.path.basename(source), this.deps.platform);
        const target = await this.uniqueTarget(directory, name, importName);
        const copy = (temporary: string) => fsp.copyFile(source, temporary, fsConstants.COPYFILE_EXCL);
        await this.placeCopy(target, copy, 'alreadyExists');
        return target;
    }

    // Alles oder nichts: Scheitert eine Datei, werden die schon kopierten wieder entfernt.
    private async importNow(sources: readonly string[], targetDir: string): Promise<ImportResult> {
        if (sources.length === 0) throw invalidInput(FS_OPS_MESSAGES.noSources);
        const directory = await this.resolveDirectory(targetDir);
        const targets: string[] = [];
        try {
            for (const source of sources) targets.push(await this.importOne(source, directory));
        } catch (error) {
            await Promise.all(targets.map((target) => removeQuietly(target)));
            throw error;
        }
        const { paths, undoToken } = await this.created(targets);
        return { paths, undoToken };
    }

    // ---------- Papierkorb und Wiederherstellen ----------

    private requireTrash(): TrashItem {
        if (this.deps.trashItem === undefined) throw failure('notImplemented', FS_OPS_MESSAGES.noTrash);
        return this.deps.trashItem;
    }

    private async backup(entry: string, folder: string): Promise<TrashedItem> {
        await fsp.mkdir(folder, { recursive: true });
        const backup = this.path.join(folder, this.path.basename(entry));
        await fsp.cp(entry, backup, COPY_OPTIONS);
        if (!(await sameTree(entry, backup, this.path.join))) throw failure('io', FS_OPS_MESSAGES.backupMismatch);
        return { original: await this.toProjectPath(entry), backup };
    }

    private async backupAll(entries: readonly string[], folder: string): Promise<TrashedItem[]> {
        const items: TrashedItem[] = [];
        try {
            for (const [index, entry] of entries.entries()) {
                items.push(await this.backup(entry, this.path.join(folder, String(index))));
            }
        } catch (error) {
            await removeQuietly(folder);
            throw error;
        }
        return items;
    }

    // Erst die geprüfte Sicherung in der Ablage, dann der Papierkorb. Scheitert er, kommen schon gelöschte Einträge
    // aus der Sicherung zurück; die Sicherung bleibt nur liegen, wenn das nicht ganz gelang.
    private async trashEntries(entries: readonly string[], token: UndoToken): Promise<UndoRecord> {
        const trashItem = this.requireTrash();
        const folder = this.path.join(this.deps.backupDir, token);
        const items = await this.backupAll(entries, folder);
        const done: TrashedItem[] = [];
        try {
            for (const [index, item] of items.entries()) {
                await trashItem(entries[index] ?? '');
                done.push(item);
            }
        } catch (error) {
            const rolledBack = await this.rollbackTrash(done);
            if (rolledBack) await removeQuietly(folder);
            throw error;
        }
        return { kind: 'trashed', folder, items };
    }

    private async rollbackTrash(items: readonly TrashedItem[]): Promise<boolean> {
        try {
            await this.restoreItems(items);
            return true;
        } catch {
            return false;
        }
    }

    private async trashNow(input: string): Promise<UndoToken> {
        this.requireTrash();
        const entry = await this.resolveEntry(input);
        const token = this.createToken();
        return this.register(await this.trashEntries([entry], token), token);
    }

    private async restoreItem(item: TrashedItem, target: string): Promise<void> {
        await fsp.mkdir(this.path.dirname(target), { recursive: true });
        await this.placeCopy(
            target,
            async (temporary) => {
                await fsp.cp(item.backup, temporary, COPY_OPTIONS);
                if (!(await sameTree(item.backup, temporary, this.path.join))) throw failure('io', FS_OPS_MESSAGES.backupMismatch);
            },
            'conflict',
        );
    }

    // Alles oder nichts: Erst alle Ziele prüfen (vorhanden → `conflict`), dann kopieren; Fehler räumen Kopien weg.
    private async restoreItems(items: readonly TrashedItem[]): Promise<string[]> {
        const targets: string[] = [];
        for (const item of items) targets.push(await this.resolveTarget(item.original));
        for (const target of targets) {
            if ((await lstatOrNull(target)) !== null) {
                throw failure('conflict', FS_OPS_MESSAGES.restoreConflict(this.path.basename(target)));
            }
        }
        const restored: string[] = [];
        try {
            for (const [index, item] of items.entries()) {
                await this.restoreItem(item, targets[index] ?? '');
                restored.push(targets[index] ?? '');
            }
        } catch (error) {
            await Promise.all(restored.map((target) => removeQuietly(target)));
            throw error;
        }
        return restored;
    }

    private async undoRecord(record: UndoRecord, nextToken: UndoToken): Promise<UndoRecord> {
        if (record.kind === 'trashed') {
            const restored = await this.restoreItems(record.items);
            await removeQuietly(record.folder);
            const paths: AbsolutePath[] = [];
            for (const target of restored) paths.push(await this.toProjectPath(target));
            return { kind: 'created', paths };
        }
        if (record.kind === 'created') {
            this.requireTrash();
            const entries: string[] = [];
            for (const path of record.paths) entries.push(await this.resolveEntry(path));
            return this.trashEntries(entries, nextToken);
        }
        const source = await this.resolveEntry(record.to);
        await this.relocate(source, await this.resolveTarget(record.from), 'conflict');
        return { kind: 'relocated', from: record.to, to: record.from };
    }

    private async restoreNow(token: UndoToken): Promise<UndoToken> {
        const record = this.records.get(token);
        if (record === undefined) throw failure('notFound', FS_OPS_MESSAGES.unknownToken);
        const nextToken = this.createToken();
        const next = await this.undoRecord(record, nextToken);
        this.records.delete(token);
        return this.register(next, nextToken);
    }

    private register(record: UndoRecord, token: UndoToken = this.createToken()): UndoToken {
        this.records.set(token, record);
        while (this.records.size > MAX_UNDO_RECORDS) {
            const oldest = this.records.keys().next().value;
            if (oldest === undefined) break;
            this.records.delete(oldest);
        }
        return token;
    }
}
