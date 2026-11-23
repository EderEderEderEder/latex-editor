import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import type { PdfRect, SyncTexBackwardResult, SyncTexForwardResult } from '../shared/contract';
import { comparisonKey, currentPathPlatform, normalizeAbsolutePath, type PathPlatform } from './paths';

// SyncTeX ohne `synctex`-Programm (Port von swift/Sources/LatexEditor/Model/SyncTeX.swift).
// Koordinaten in PDF-Punkten (bp), Ursprung oben links der Seite, y nach unten. Ohne Electron,
// der Index besteht nur aus Maps und typisierten Arrays und ist damit strukturiert klonbar.

export class SyncTeXError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SyncTeXError';
    }
}

export interface SyncTeXRecords {
    readonly count: number;
    readonly kind: Uint8Array;
    readonly tag: Int32Array;
    readonly line: Int32Array;
    readonly page: Int32Array;
    readonly x: Int32Array;
    readonly y: Int32Array;
    readonly width: Int32Array;
    readonly height: Int32Array;
    readonly depth: Int32Array;
    // Index der umschließenden Box oder -1
    readonly parent: Int32Array;
    // Bei Boxen: erster Index nach dem Box-Inhalt
    readonly end: Int32Array;
}

export interface SyncTeXGeometry {
    readonly unit: number;
    readonly magnification: number;
    readonly xOffset: number;
    readonly yOffset: number;
}

export interface SyncTeXPageRange {
    readonly start: number;
    readonly end: number;
}

export interface SyncTeXIndex {
    readonly platform: NodeJS.Platform;
    // Tag → absoluter Pfad (lexikalisch normalisiert, sonst wie in der Datei)
    readonly inputs: ReadonlyMap<number, string>;
    readonly records: SyncTeXRecords;
    readonly pageRanges: ReadonlyMap<number, SyncTeXPageRange>;
    readonly geometry: SyncTeXGeometry;
    // Vergleichsschlüssel des Pfads → Record-Indizes, sortiert nach Zeile, dann Position.
    // Steht eine Datei mehrfach in der `Input:`-Liste, sind ihre Tags hier schon zusammengeführt.
    readonly recordsByPath: ReadonlyMap<string, Int32Array>;
}

export interface SyncTeXParseOptions {
    readonly platform?: NodeJS.Platform;
    // Bezug für relative `Input:`-Pfade (Ordner der .synctex-Datei)
    readonly baseDirectory?: string;
}

// TeX-Punkte (sp) pro PDF-Punkt (bp): 65536 · 72,27 / 72
const SCALED_POINTS_PER_BIG_POINT = 65_781.76;
const DEFAULT_MAGNIFICATION = 1_000;
const DEFAULT_UNIT = 1;
// Höhe einer Markierung, wenn ein Element ohne umschließende Zeilenbox gefunden wurde (bp)
const FALLBACK_LINE_HEIGHT = 10;
const FALLBACK_WIDTH = 1;
const INT32_MAX = 2_147_483_647;
const INT32_MIN = -2_147_483_648;
const NO_PARENT = -1;
const TEX_EXTENSION = '.tex';

const GZIP_MAGIC_FIRST = 0x1f;
const GZIP_MAGIC_SECOND = 0x8b;
const GZIP_HEADER_LENGTH = 10;

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const MINUS = 0x2d;
const DIGIT_ZERO = 0x30;
const DIGIT_NINE = 0x39;
const COLON = 0x3a;
const DECIMAL_BASE = 10;

const VBOX = 0x5b; // [
const HBOX = 0x28; // (
const VBOX_CLOSE = 0x5d; // ]
const HBOX_CLOSE = 0x29; // )
const PAGE_OPEN = 0x7b; // {
const PAGE_CLOSE = 0x7d; // }
const VOID_HBOX = 0x68; // h
const VOID_VBOX = 0x76; // v
const KERN = 0x6b; // k
const GLUE = 0x67; // g
const CURRENT = 0x78; // x
const MATH = 0x24; // $
const RULE = 0x72; // r

const BOX_FIELD_COUNT = 7;
const KERN_FIELD_COUNT = 5;
const POINT_FIELD_COUNT = 4;
const MIN_RECORD_FIELDS = 4;
const MAX_FIELD_COUNT = 7;

const encoder = new TextEncoder();
const INPUT_PREFIX = encoder.encode('Input:');
const UNIT_PREFIX = encoder.encode('Unit:');
const MAGNIFICATION_PREFIX = encoder.encode('Magnification:');
const X_OFFSET_PREFIX = encoder.encode('X Offset:');
const Y_OFFSET_PREFIX = encoder.encode('Y Offset:');
// macOS: `/tmp`, `/var`, `/etc` sind Symlinks nach `/private/…`; immer abschneiden (wie Swift),
// damit der Schlüssel nicht davon abhängt, ob die Datei existiert. Schlüssel sind dort kleingeschrieben.
const MACOS_PRIVATE_PREFIXES = ['/private/tmp/', '/private/var/', '/private/etc/'];
const MACOS_PRIVATE = '/private';

const gunzipAsync = promisify(gunzip);

function clampInt32(value: number): number {
    if (!Number.isFinite(value)) return value > 0 ? INT32_MAX : 0;
    return Math.min(INT32_MAX, Math.max(INT32_MIN, Math.trunc(value)));
}

function isBox(kind: number): boolean {
    return kind === HBOX || kind === VBOX;
}

// ---------- Pfade ----------

function absoluteSourcePath(file: string, platform: PathPlatform, baseDirectory?: string): string | null {
    try {
        return normalizeAbsolutePath(file, platform);
    } catch {
        if (baseDirectory === undefined || file.length === 0) return null;
    }
    try {
        return normalizeAbsolutePath(platform.path.join(baseDirectory, file), platform);
    } catch {
        return null;
    }
}

function stripMacPrivatePrefix(key: string): string {
    if (!MACOS_PRIVATE_PREFIXES.some((prefix) => key.startsWith(prefix))) return key;
    return key.slice(MACOS_PRIVATE.length);
}

// Vergleichsschlüssel für Quelldateien (aus der SyncTeX-Datei wie vom Editor): Trenner, `./`, `..`,
// Laufwerk, Unicode NFC und Groß-/Kleinschreibung wie `paths.comparisonKey`. Symlinks und
// Windows-8.3-Namen löst das nicht auf (dafür `resolveRealPath` vor der Anfrage).
export function sourcePathKey(file: string, platformName: NodeJS.Platform, baseDirectory?: string): string | null {
    const platform = currentPathPlatform(platformName);
    const absolute = absoluteSourcePath(file, platform, baseDirectory);
    if (absolute === null) return null;
    const key = comparisonKey(absolute, platform);
    return platformName === 'darwin' ? stripMacPrivatePrefix(key) : key;
}

// ---------- gzip ----------

export function isGzip(bytes: Uint8Array): boolean {
    return bytes.length >= GZIP_HEADER_LENGTH && bytes[0] === GZIP_MAGIC_FIRST && bytes[1] === GZIP_MAGIC_SECOND;
}

// Asynchron (Thread-Pool von libuv), blockiert also auch im Main nicht.
export async function decompressSyncTeX(bytes: Uint8Array): Promise<Uint8Array> {
    if (!isGzip(bytes)) throw new SyncTeXError('Keine gzip-Daten');
    try {
        return await gunzipAsync(bytes);
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new SyncTeXError(`gzip-Daten beschädigt oder unvollständig: ${detail}`);
    }
}

// ---------- Parser ----------

interface MutableRecords {
    count: number;
    kind: Uint8Array;
    tag: Int32Array;
    line: Int32Array;
    page: Int32Array;
    x: Int32Array;
    y: Int32Array;
    width: Int32Array;
    height: Int32Array;
    depth: Int32Array;
    parent: Int32Array;
    end: Int32Array;
}

const INT_FIELDS = ['tag', 'line', 'page', 'x', 'y', 'width', 'height', 'depth', 'parent', 'end'] as const;

function allocateRecords(capacity: number): MutableRecords {
    const records = { count: 0, kind: new Uint8Array(capacity) } as MutableRecords;
    for (const field of INT_FIELDS) records[field] = new Int32Array(capacity);
    return records;
}

// Kopiert auf die genutzte Länge, damit die Reserve (eine Zeile je Eintrag) freigegeben wird.
function trimRecords(records: MutableRecords): SyncTeXRecords {
    const trimmed = { count: records.count, kind: records.kind.slice(0, records.count) } as MutableRecords;
    for (const field of INT_FIELDS) trimmed[field] = records[field].slice(0, records.count);
    return trimmed;
}

function countLines(bytes: Uint8Array): number {
    let lines = 1;
    let position = bytes.indexOf(NEWLINE);
    while (position >= 0) {
        lines++;
        position = bytes.indexOf(NEWLINE, position + 1);
    }
    return lines;
}

function hasPrefix(bytes: Uint8Array, start: number, end: number, prefix: Uint8Array): boolean {
    if (end - start < prefix.length) return false;
    for (let offset = 0; offset < prefix.length; offset++) {
        if (bytes[start + offset] !== prefix[offset]) return false;
    }
    return true;
}

// Liest bis zu `count` ganze Zahlen (mit Vorzeichen) ab `start` nach `out`; Trenner sind `,` und `:`
// (genau ein Zeichen, wie in Swift). Gibt die Anzahl gelesener Zahlen zurück.
function readIntegers(bytes: Uint8Array, start: number, end: number, count: number, out: number[]): number {
    let found = 0;
    let position = start;
    while (position < end && found < count) {
        const negative = bytes[position] === MINUS;
        if (negative) position++;
        let value = 0;
        let hasDigits = false;
        let byte = bytes[position] ?? 0;
        while (position < end && byte >= DIGIT_ZERO && byte <= DIGIT_NINE) {
            value = value * DECIMAL_BASE + (byte - DIGIT_ZERO);
            hasDigits = true;
            position++;
            byte = bytes[position] ?? 0;
        }
        if (!hasDigits) break;
        out[found++] = negative ? -value : value;
        position++;
    }
    return found;
}

class SyncTeXParser {
    readonly rawInputs = new Map<number, string>();
    readonly pageRanges = new Map<number, SyncTeXPageRange>();
    readonly records: MutableRecords;
    unit = DEFAULT_UNIT;
    magnification = DEFAULT_MAGNIFICATION;
    xOffset = 0;
    yOffset = 0;
    private page = 0;
    private pageStart = 0;
    private openBoxes: number[] = [];
    private readonly values: number[] = new Array<number>(MAX_FIELD_COUNT).fill(0);
    private readonly decoder = new TextDecoder('utf-8');

    constructor(private readonly bytes: Uint8Array) {
        this.records = allocateRecords(countLines(bytes));
    }

    parse(): void {
        const bytes = this.bytes;
        let start = 0;
        while (start < bytes.length) {
            let end = bytes.indexOf(NEWLINE, start);
            if (end < 0) end = bytes.length;
            // MiKTeX/Windows: CRLF möglich, sonst hinge `\r` am Pfad der `Input:`-Zeile
            const lineEnd = end > start && bytes[end - 1] === CARRIAGE_RETURN ? end - 1 : end;
            if (lineEnd > start) this.parseLine(start, lineEnd);
            start = end + 1;
        }
        if (this.records.count === 0 && this.rawInputs.size === 0) {
            throw new SyncTeXError('Keine SyncTeX-Daten gefunden');
        }
    }

    private parseLine(start: number, end: number): void {
        const first = this.bytes[start] ?? 0;
        switch (first) {
            case VBOX: case HBOX: case VOID_HBOX: case VOID_VBOX: case RULE:
                return this.addRecord(start, end, first, BOX_FIELD_COUNT);
            case KERN:
                return this.addRecord(start, end, first, KERN_FIELD_COUNT);
            case GLUE: case CURRENT: case MATH:
                return this.addRecord(start, end, first, POINT_FIELD_COUNT);
            case VBOX_CLOSE: case HBOX_CLOSE:
                return this.closeBox();
            case PAGE_OPEN:
                return this.openPage(start, end);
            case PAGE_CLOSE:
                this.pageRanges.set(this.page, { start: this.pageStart, end: this.records.count });
                return;
            default:
                return this.parseHeader(start, end);
        }
    }

    private openPage(start: number, end: number): void {
        const found = readIntegers(this.bytes, start + 1, end, 1, this.values);
        this.page = found > 0 ? clampInt32(this.values[0] ?? 0) : 0;
        this.pageStart = this.records.count;
        this.openBoxes = [];
    }

    private addRecord(start: number, end: number, kind: number, fieldCount: number): void {
        const values = this.values;
        const found = readIntegers(this.bytes, start + 1, end, fieldCount, values);
        if (found < MIN_RECORD_FIELDS || this.page <= 0) return;
        const value = (index: number): number => (index < found ? clampInt32(values[index] ?? 0) : 0);
        const records = this.records;
        const index = records.count++;
        records.kind[index] = kind;
        records.tag[index] = value(0);
        records.line[index] = value(1);
        records.page[index] = this.page;
        records.x[index] = value(2);
        records.y[index] = value(3);
        records.width[index] = value(4);
        records.height[index] = value(5);
        records.depth[index] = value(6);
        records.parent[index] = this.openBoxes.at(-1) ?? NO_PARENT;
        records.end[index] = index + 1;
        if (isBox(kind)) this.openBoxes.push(index);
    }

    private closeBox(): void {
        const box = this.openBoxes.pop();
        if (box !== undefined) this.records.end[box] = this.records.count;
    }

    private headerInteger(start: number, end: number, prefix: Uint8Array, fallback: number): number {
        const found = readIntegers(this.bytes, start + prefix.length, end, 1, this.values);
        return found > 0 ? (this.values[0] ?? fallback) : fallback;
    }

    private parseHeader(start: number, end: number): void {
        const bytes = this.bytes;
        if (hasPrefix(bytes, start, end, INPUT_PREFIX)) return this.parseInput(start + INPUT_PREFIX.length, end);
        if (hasPrefix(bytes, start, end, UNIT_PREFIX)) {
            this.unit = this.headerInteger(start, end, UNIT_PREFIX, DEFAULT_UNIT);
        } else if (hasPrefix(bytes, start, end, MAGNIFICATION_PREFIX)) {
            this.magnification = this.headerInteger(start, end, MAGNIFICATION_PREFIX, DEFAULT_MAGNIFICATION);
        } else if (hasPrefix(bytes, start, end, X_OFFSET_PREFIX)) {
            this.xOffset = this.headerInteger(start, end, X_OFFSET_PREFIX, 0);
        } else if (hasPrefix(bytes, start, end, Y_OFFSET_PREFIX)) {
            this.yOffset = this.headerInteger(start, end, Y_OFFSET_PREFIX, 0);
        }
    }

    // `Input:<Tag>:<Pfad>`; der Pfad darf selbst Doppelpunkte enthalten (Windows-Laufwerk `C:`).
    private parseInput(start: number, end: number): void {
        const colon = this.bytes.indexOf(COLON, start);
        if (colon < 0 || colon >= end) return;
        if (readIntegers(this.bytes, start, end, 1, this.values) === 0) return;
        const tag = clampInt32(this.values[0] ?? 0);
        this.rawInputs.set(tag, this.decoder.decode(this.bytes.subarray(colon + 1, end)));
    }
}

// ---------- Index ----------

function groupByPath(records: SyncTeXRecords, keysByTag: ReadonlyMap<number, string>): Map<string, Int32Array> {
    const groups = new Map<string, number[]>();
    for (let index = 0; index < records.count; index++) {
        if (records.line[index]! <= 0 || records.kind[index] === VBOX) continue;
        const key = keysByTag.get(records.tag[index]!);
        if (key === undefined) continue;
        const group = groups.get(key);
        if (group === undefined) groups.set(key, [index]);
        else group.push(index);
    }
    const lines = records.line;
    const sorted = new Map<string, Int32Array>();
    for (const [key, indices] of groups) {
        sorted.set(key, Int32Array.from(indices).sort((a, b) => lines[a]! - lines[b]! || a - b));
    }
    return sorted;
}

function resolveInputs(
    rawInputs: ReadonlyMap<number, string>,
    platformName: NodeJS.Platform,
    baseDirectory?: string,
): { inputs: Map<number, string>; keysByTag: Map<number, string> } {
    const platform = currentPathPlatform(platformName);
    const inputs = new Map<number, string>();
    const keysByTag = new Map<number, string>();
    for (const [tag, raw] of rawInputs) {
        inputs.set(tag, absoluteSourcePath(raw, platform, baseDirectory) ?? raw);
        const key = sourcePathKey(raw, platformName, baseDirectory);
        if (key !== null) keysByTag.set(tag, key);
    }
    return { inputs, keysByTag };
}

export function parseSyncTeX(bytes: Uint8Array, options: SyncTeXParseOptions = {}): SyncTeXIndex {
    const platform = options.platform ?? process.platform;
    const parser = new SyncTeXParser(bytes);
    parser.parse();
    const records = trimRecords(parser.records);
    const { inputs, keysByTag } = resolveInputs(parser.rawInputs, platform, options.baseDirectory);
    return {
        platform,
        inputs,
        records,
        pageRanges: parser.pageRanges,
        geometry: {
            unit: parser.unit,
            magnification: parser.magnification,
            xOffset: parser.xOffset,
            yOffset: parser.yOffset,
        },
        recordsByPath: groupByPath(records, keysByTag),
    };
}

// Liest `.synctex.gz` oder unkomprimiertes `.synctex`. Entpacken asynchron, das Zerlegen ist
// CPU-Arbeit und gehört in den Worker (`workers/synctex.worker.ts`).
export async function loadSyncTeX(filePath: string, options: SyncTeXParseOptions = {}): Promise<SyncTeXIndex> {
    const platform = options.platform ?? process.platform;
    const data: Uint8Array = await readFile(filePath);
    const text = isGzip(data) ? await decompressSyncTeX(data) : data;
    const baseDirectory = options.baseDirectory ?? currentPathPlatform(platform).path.dirname(filePath);
    return parseSyncTeX(text, { platform, baseDirectory });
}

// ---------- Geometrie ----------

function toBigPoints(index: SyncTeXIndex, value: number, offset: number): number {
    const { unit, magnification } = index.geometry;
    return ((value * unit * magnification) / DEFAULT_MAGNIFICATION + offset) / SCALED_POINTS_PER_BIG_POINT;
}

function boxRect(index: SyncTeXIndex, record: number): PdfRect {
    const { records, geometry } = index;
    const left = toBigPoints(index, records.x[record]!, geometry.xOffset);
    const baseline = toBigPoints(index, records.y[record]!, geometry.yOffset);
    const height = toBigPoints(index, records.height[record]!, 0);
    const depth = toBigPoints(index, records.depth[record]!, 0);
    const width = toBigPoints(index, records.width[record]!, 0);
    return { x: left, y: baseline - height, width, height: height + depth };
}

function isLineBox(index: SyncTeXIndex, record: number): boolean {
    return index.records.kind[record] === HBOX && index.records.width[record]! > 0;
}

// Rechteck der Zeilenbox (hbox), in der das Element steht; sonst ein schmaler Strich am Punkt.
function highlightRect(index: SyncTeXIndex, record: number): PdfRect {
    for (let current = record; current >= 0; current = index.records.parent[current]!) {
        if (isLineBox(index, current)) return boxRect(index, current);
    }
    const { records, geometry } = index;
    const x = toBigPoints(index, records.x[record]!, geometry.xOffset);
    const y = toBigPoints(index, records.y[record]!, geometry.yOffset);
    return { x, y: y - FALLBACK_LINE_HEIGHT, width: FALLBACK_WIDTH, height: FALLBACK_LINE_HEIGHT };
}

function sameRect(first: PdfRect, second: PdfRect): boolean {
    return first.x === second.x && first.y === second.y && first.width === second.width && first.height === second.height;
}

export function unionRect(rects: readonly PdfRect[]): PdfRect | null {
    if (rects.length === 0) return null;
    const minX = Math.min(...rects.map((rect) => rect.x));
    const minY = Math.min(...rects.map((rect) => rect.y));
    const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
    const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ---------- Vorwärtssuche ----------

function lowerBound(lines: Int32Array, candidates: Int32Array, target: number): number {
    let low = 0;
    let high = candidates.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (lines[candidates[middle]!]! < target) low = middle + 1;
        else high = middle;
    }
    return low;
}

// Einträge der gesuchten Zeile; fehlt sie, die der nächsten Zeile davor, sonst danach.
function bestLineRange(lines: Int32Array, candidates: Int32Array, target: number): Int32Array {
    const firstAtOrAfter = lowerBound(lines, candidates, target);
    const atOrAfter = candidates[firstAtOrAfter];
    let chosen: number;
    if (atOrAfter !== undefined && lines[atOrAfter] === target) chosen = target;
    else if (firstAtOrAfter > 0) chosen = lines[candidates[firstAtOrAfter - 1]!]!;
    else chosen = lines[atOrAfter!]!;
    const start = lowerBound(lines, candidates, chosen);
    // Eine beschädigte Datei kann die größte Zeilennummer enthalten: `chosen + 1` liefe dann über
    const end = chosen === INT32_MAX ? candidates.length : lowerBound(lines, candidates, chosen + 1);
    return candidates.subarray(start, end);
}

function distinctRects(rects: PdfRect[]): PdfRect[] {
    return rects.filter((rect, position) => rects.findIndex((other) => sameRect(rect, other)) === position);
}

// Quelltextzeile (1-basiert) → Seite und Rechtecke der Zeilenboxen (je PDF-Zeile eins, ohne Doppelte).
export function forwardSearch(index: SyncTeXIndex, file: string, line: number): SyncTexForwardResult | null {
    const key = sourcePathKey(file, index.platform);
    const candidates = key === null ? undefined : index.recordsByPath.get(key);
    if (candidates === undefined || candidates.length === 0) return null;
    const { records } = index;
    const matching = Array.from(bestLineRange(records.line, candidates, clampInt32(line)));
    const page = Math.min(...matching.map((record) => records.page[record]!));
    const onPage = matching.filter((record) => records.page[record] === page);
    const leaves = onPage.filter((record) => !isBox(records.kind[record]!));
    const chosen = leaves.length > 0 ? leaves : onPage;
    const rects = distinctRects(chosen.map((record) => highlightRect(index, record)));
    return rects.length === 0 ? null : { page, rects };
}

// ---------- Rückwärtssuche ----------

function contains(rect: PdfRect, x: number, y: number): boolean {
    return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

function verticalDistance(rect: PdfRect, y: number): number {
    if (y < rect.y) return rect.y - y;
    return Math.max(y - (rect.y + rect.height), 0);
}

// Kleinste Zeilenbox, die den Punkt enthält; sonst die vertikal nächstgelegene (bei Gleichstand die erste).
function lineBoxAt(index: SyncTeXIndex, range: SyncTeXPageRange, x: number, y: number): number {
    let smallest = -1;
    let smallestArea = Infinity;
    let nearest = -1;
    let nearestDistance = Infinity;
    for (let record = range.start; record < range.end; record++) {
        if (!isLineBox(index, record)) continue;
        const rect = boxRect(index, record);
        const area = rect.width * rect.height;
        if (contains(rect, x, y) && area < smallestArea) {
            smallest = record;
            smallestArea = area;
        }
        const distance = verticalDistance(rect, y);
        if (distance < nearestDistance) {
            nearest = record;
            nearestDistance = distance;
        }
    }
    return smallest >= 0 ? smallest : nearest;
}

function isTeXSource(index: SyncTeXIndex, tag: number): boolean {
    const file = index.inputs.get(tag);
    if (file === undefined) return false;
    return currentPathPlatform(index.platform).path.extname(file).toLowerCase() === TEX_EXTENSION;
}

function isSourceLeaf(index: SyncTeXIndex, record: number): boolean {
    const { records } = index;
    return !isBox(records.kind[record]!) && records.line[record]! > 0 && isTeXSource(index, records.tag[record]!);
}

// Element in der Box mit dem horizontal nächsten Punkt (bei Gleichstand das erste), sonst -1.
function nearestLeaf(index: SyncTeXIndex, box: number, x: number): number {
    let best = -1;
    let bestDistance = Infinity;
    for (let record = box + 1; record < index.records.end[box]!; record++) {
        if (!isSourceLeaf(index, record)) continue;
        const distance = Math.abs(toBigPoints(index, index.records.x[record]!, index.geometry.xOffset) - x);
        if (distance < bestDistance) {
            best = record;
            bestDistance = distance;
        }
    }
    return best;
}

// Seite (1-basiert) und Punkt (bp, oben links) → Datei und Zeile. Nur `.tex`-Dateien; Treffer in
// Hilfsdateien (`.aux`, `.toc`, Klassen) ergeben null.
export function backwardSearch(index: SyncTeXIndex, page: number, x: number, y: number): SyncTexBackwardResult | null {
    const range = index.pageRanges.get(page);
    if (range === undefined) return null;
    const box = lineBoxAt(index, range, x, y);
    if (box < 0) return null;
    const leaf = nearestLeaf(index, box, x);
    const source = leaf >= 0 ? leaf : box;
    const { line, tag } = index.records;
    if (line[source]! <= 0 || !isTeXSource(index, tag[source]!)) return null;
    const file = index.inputs.get(tag[source]!);
    return file === undefined ? null : { file, line: line[source]! };
}

// Größe der typisierten Arrays in Bytes (ohne Maps und Pfad-Zeichenketten).
export function indexArrayBytes(index: SyncTeXIndex): number {
    let bytes = index.records.kind.byteLength;
    for (const field of INT_FIELDS) bytes += index.records[field].byteLength;
    for (const group of index.recordsByPath.values()) bytes += group.byteLength;
    return bytes;
}
