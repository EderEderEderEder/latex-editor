import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { PdfRect } from '../../src/shared/contract';
import {
    backwardSearch,
    decompressSyncTeX,
    forwardSearch,
    parseSyncTeX,
    sourcePathKey,
    type SyncTeXIndex,
    unionRect,
} from '../../src/main/synctex';
import { type PdfPoint, pdfRectFromSyncTeX, syncTeXPointFromPdf } from '../../src/shared/core/synctexCoordinates';
import { loadSpec, type SpecCase, specDirectory } from '../support/specVectors';

// Gemeinsame Vektoren `shared/spec/synctex.json` (Format: `notes` der Datei, `shared/spec/README.md`).
// Pfade der Vektoren sind POSIX-Pfade unter macOS-Regeln (`/private/tmp` ↔ `/tmp`), deshalb Plattform `darwin`.
const PLATFORM = 'darwin' as const;
const GZIP_HEADER_WITH_NAME = [0x1f, 0x8b, 0x08, 0x08, 0, 0, 0, 0, 0x00, 0x03];
const GZIP_TRAILER_LENGTH = 8;
const UINT32_BYTES = 4;
const HALF = 2;
const EXPECTED_CASE_COUNT = 30;

type Input = Record<string, unknown> & { readonly op: string };
type Expect = Record<string, unknown>;
type ForwardOutcome = { page: number; x: number; y: number; width: number; height: number } | null;

const spec = loadSpec('synctex');
const decoder = new TextDecoder();
const encoder = new TextEncoder();

function fixtureBytes(input: Input): Uint8Array {
    return readFileSync(join(specDirectory(), String(input.fixture)));
}

// Gültiger gzip-Container mit Dateinamen-Feld (RFC 1952), siehe `notes` der Vektordatei.
function gzipWithFileName(original: string, fileName: string): Uint8Array {
    const data = encoder.encode(original);
    const trailer = Buffer.alloc(GZIP_TRAILER_LENGTH);
    trailer.writeUInt32LE(crc32(data), 0);
    trailer.writeUInt32LE(data.length, UINT32_BYTES);
    const name = Buffer.from(`${fileName}\0`, 'utf8');
    return Buffer.concat([Buffer.from(GZIP_HEADER_WITH_NAME), name, deflateRawSync(data), trailer]);
}

function gzipInput(input: Input): Uint8Array {
    const original = input.original;
    if (typeof original === 'string') return gzipWithFileName(original, String(input.fileName));
    const bytes = input.text === undefined ? fixtureBytes(input) : encoder.encode(String(input.text));
    return input.truncateToHalf === true ? bytes.subarray(0, Math.floor(bytes.length / HALF)) : bytes;
}

async function indexOf(input: Input): Promise<SyncTeXIndex> {
    const bytes = input.text === undefined ? await decompressSyncTeX(fixtureBytes(input)) : encoder.encode(String(input.text));
    return parseSyncTeX(bytes, { platform: PLATFORM });
}

function forwardOutcome(index: SyncTeXIndex, file: string, line: number): ForwardOutcome {
    const result = forwardSearch(index, file, line);
    const rect = unionRect(result?.rects ?? []);
    return result === null || rect === null ? null : { page: result.page, ...rect };
}

function samePath(actual: string | undefined, expected: unknown): boolean {
    return actual !== undefined && sourcePathKey(actual, PLATFORM) === sourcePathKey(String(expected), PLATFORM);
}

async function checkGzip(input: Input, expected: Expect): Promise<void> {
    const outcome = decompressSyncTeX(gzipInput(input));
    if (expected.error === true) {
        await expect(outcome).rejects.toThrow();
        return;
    }
    const text = decoder.decode(await outcome);
    if (expected.text !== undefined) expect(text).toBe(expected.text);
    if (expected.textPrefix !== undefined) expect(text.startsWith(String(expected.textPrefix))).toBe(true);
    if (expected.textContains !== undefined) expect(text).toContain(String(expected.textContains));
}

async function checkParse(input: Input, expected: Expect): Promise<void> {
    if (expected.error === true) {
        await expect(indexOf(input)).rejects.toThrow();
        return;
    }
    const index = await indexOf(input);
    if (expected.inputCount !== undefined) expect(index.inputs.size).toBe(expected.inputCount);
    if (expected.pages !== undefined) expect([...index.pageRanges.keys()].sort((a, b) => a - b)).toEqual(expected.pages);
    if (expected.magnification !== undefined) expect(index.geometry.magnification).toBe(expected.magnification);
}

function checkBox(result: NonNullable<ForwardOutcome>, expected: Expect): void {
    const tolerance = Number(expected.tolerance ?? 0);
    if (expected.left !== undefined) expect(Math.abs(result.x - Number(expected.left))).toBeLessThan(tolerance);
    if (expected.width !== undefined) expect(Math.abs(result.width - Number(expected.width))).toBeLessThan(tolerance);
    if (expected.baseline === undefined) return;
    const baseline = Number(expected.baseline);
    expect(result.y).toBeLessThanOrEqual(baseline);
    expect(baseline).toBeLessThanOrEqual(result.y + result.height + tolerance);
}

async function checkForward(input: Input, expected: Expect): Promise<void> {
    const index = input.decompressFirst === true
        ? parseSyncTeX(await decompressSyncTeX(fixtureBytes(input)), { platform: PLATFORM })
        : await indexOf(input);
    const result = forwardOutcome(index, String(input.file), Number(input.line));
    if ('result' in expected) expect(result).toEqual(expected.result);
    if (expected.found === true) expect(result).not.toBeNull();
    if (expected.sameResultAsLine !== undefined) {
        expect(result).toEqual(forwardOutcome(index, String(input.file), Number(expected.sameResultAsLine)));
    }
    if (expected.page !== undefined) expect(result?.page).toBe(expected.page);
    if (result !== null) checkBox(result, expected);
}

async function checkForwardPaths(input: Input, expected: Expect): Promise<void> {
    const index = await indexOf(input);
    const results = (input.files as string[]).map((file) => forwardOutcome(index, file, Number(input.line)));
    if (expected.allFoundAndEqual !== true) return;
    expect(results[0]).not.toBeNull();
    for (const result of results) expect(result).toEqual(results[0]);
}

async function checkBackward(input: Input, expected: Expect): Promise<void> {
    const index = await indexOf(input);
    const result = backwardSearch(index, Number(input.page), Number(input.x), Number(input.y));
    if ('result' in expected) expect(result).toEqual(expected.result);
    if (expected.file !== undefined) expect(samePath(result?.file, expected.file)).toBe(true);
    if (expected.line !== undefined) expect(result?.line).toBe(expected.line);
}

async function checkRoundTrip(input: Input, expected: Expect): Promise<void> {
    const index = await indexOf(input);
    const box = forwardOutcome(index, String(input.file), Number(input.line));
    expect(box).not.toBeNull();
    const location = backwardSearch(index, box!.page, box!.x + box!.width / HALF, box!.y + box!.height / HALF);
    expect(samePath(location?.file, expected.file)).toBe(true);
    const distance = Math.abs((location?.line ?? Infinity) - Number(input.line));
    expect(distance).toBeLessThanOrEqual(Number(expected.lineTolerance));
}

function checkCoordinates(input: Input, expected: Expect): void {
    const mediaBox = input.mediaBox as PdfRect;
    const result = input.op === 'pdfRectFromSyncTeX'
        ? pdfRectFromSyncTeX(input.rect as PdfRect, mediaBox)
        : syncTeXPointFromPdf(input.point as PdfPoint, mediaBox);
    expect(result).toEqual(expected);
}

const CHECKS: Record<string, (input: Input, expected: Expect) => void | Promise<void>> = {
    gzipDecompress: checkGzip,
    parse: checkParse,
    forward: checkForward,
    forwardPaths: checkForwardPaths,
    backward: checkBackward,
    roundTrip: checkRoundTrip,
    pdfRectFromSyncTeX: checkCoordinates,
    syncTeXPointFromPDF: checkCoordinates,
};

function runCase(testCase: SpecCase): void | Promise<void> {
    const input = testCase.input as Input;
    const check = CHECKS[input.op];
    if (check === undefined) throw new Error(`Unbekannte Operation ${input.op}`);
    return check(input, testCase.expect as Expect);
}

describe('Vektoren synctex.json', () => {
    it('enthält alle Fälle', () => {
        expect(spec.cases).toHaveLength(EXPECTED_CASE_COUNT);
    });

    it.each(spec.cases)('$id: $name', (testCase) => runCase(testCase));
});
