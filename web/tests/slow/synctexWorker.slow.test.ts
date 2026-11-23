import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backwardSearch, forwardSearch, indexArrayBytes, loadSyncTeX, type SyncTeXIndex } from '../../src/main/synctex';
import type { SyncTeXLoadSummary } from '../../src/main/workers/synctex.worker';
import { bundleSyncTeXWorker, withWorker } from '../support/synctexWorkerClient';

// Langsame, zeitabhängige SyncTeX-Prüfungen (nicht in `--fast`): Main-Blockade beim Einlesen von
// 250.000 Einträgen im Worker. Die Messung (S3, je 5 Läufe) läuft nur mit SYNCTEX_BENCH=1.
const RUN_BENCHMARK = process.env.SYNCTEX_BENCH === '1';
const BENCH_RECORD_TARGET = 250_000;
const BENCH_RUNS = 5;
const BENCH_QUERIES = 1_000;
const BENCH_TIMEOUT_MS = 180_000;
const LAG_INTERVAL_MS = 5;
// Großzügig wegen paralleler Agenten; das Zerlegen im Main-Thread dauert ein Vielfaches (ERGEBNIS.md).
const MAX_MAIN_LAG_MS = 50;
const BYTES_PER_MEGABYTE = 1024 * 1024;

let directory: string;
let workerScript: string;

beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'synctex-worker-slow-'));
    workerScript = await bundleSyncTeXWorker(directory);
});

afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
});

describe('SyncTeX-Worker: Main-Thread bleibt bedienbar', () => {
    it('beim Einlesen von 250.000 Einträgen', { timeout: BENCH_TIMEOUT_MS }, async () => {
        const large = await writeLargeFixture();
        await withWorker(workerScript, async (client) => {
            const { response, maxLagMs } = await measureMainLag(() => client.request({ type: 'load', file: large.path }));
            expect(response.ok).toBe(true);
            expect((response.ok ? (response.value as SyncTeXLoadSummary) : null)?.records).toBe(large.records);
            expect(maxLagMs).toBeLessThan(MAX_MAIN_LAG_MS);
        });
    });
});

// ---------- Synthetische große Datei ----------

const BENCH_INPUT_FILES = 20;
const BENCH_LINES_PER_PAGE = 45;
const BENCH_LINES_PER_FILE = 2_100;
const RECORDS_PER_LINE_BOX = 6;
const PAGE_LEFT = 8_799_518;
const PAGE_TOP = 6_571_294;
const LINE_SPACING = 786_432;
const LINE_WIDTH = 22_609_920;
const LEAF_STEP = 1_500_000;
const BENCH_DIRECTORY = '/tmp/Bench Projekt';

function benchFile(tag: number): string {
    return `${BENCH_DIRECTORY}/kapitel/kapitel-${tag}.tex`;
}

function lineBox(tag: number, line: number, baseline: number): string[] {
    const at = (step: number): number => PAGE_LEFT + step * LEAF_STEP;
    const prefix = `${tag},${line}:`;
    return [
        `(${prefix}${PAGE_LEFT},${baseline}:${LINE_WIDTH},455111,127431`,
        `h${prefix}${PAGE_LEFT},${baseline}:0,0,0`,
        `x${prefix}${at(1)},${baseline}`,
        `g${prefix}${at(2)},${baseline}`,
        `k${prefix}${at(3)},${baseline}:7936023`,
        `$${prefix}${at(4)},${baseline}`,
        ')',
    ];
}

function generateLargeSyncTeX(recordTarget: number): { text: string; records: number } {
    const lines = ['SyncTeX Version:1', `Input:1:${BENCH_DIRECTORY}/./main.tex`];
    for (let tag = 2; tag <= BENCH_INPUT_FILES + 1; tag++) lines.push(`Input:${tag}:${benchFile(tag)}`);
    lines.push('Output:pdf', 'Magnification:1000', 'Unit:1', 'X Offset:0', 'Y Offset:0', 'Content:');
    let records = 0;
    let sourceLine = 0;
    for (let page = 1; records < recordTarget; page++) {
        lines.push(`{${page}`, `[1,1:4736286,46220574:26673152,41484288,0`);
        records++;
        for (let row = 0; row < BENCH_LINES_PER_PAGE && records < recordTarget; row++, sourceLine++) {
            const tag = 2 + (Math.floor(sourceLine / BENCH_LINES_PER_FILE) % BENCH_INPUT_FILES);
            const line = (sourceLine % BENCH_LINES_PER_FILE) + 1;
            lines.push(...lineBox(tag, line, PAGE_TOP + row * LINE_SPACING));
            records += RECORDS_PER_LINE_BOX;
        }
        lines.push(']', `}${page}`);
    }
    lines.push('Postamble:', `Count:${records}`, '');
    return { text: lines.join('\n'), records };
}

async function writeLargeFixture(): Promise<{ path: string; records: number; bytes: number; compressed: number }> {
    const { text, records } = generateLargeSyncTeX(BENCH_RECORD_TARGET);
    const compressed = gzipSync(Buffer.from(text));
    const path = join(directory, 'large.synctex.gz');
    await writeFile(path, compressed);
    return { path, records, bytes: Buffer.byteLength(text), compressed: compressed.length };
}

// ---------- Messhilfen ----------

async function measureMainLag<T>(action: () => Promise<T>): Promise<{ response: T; maxLagMs: number }> {
    let maxLagMs = 0;
    let last = performance.now();
    const timer = setInterval(() => {
        const now = performance.now();
        maxLagMs = Math.max(maxLagMs, now - last - LAG_INTERVAL_MS);
        last = now;
    }, LAG_INTERVAL_MS);
    try {
        const response = await action();
        return { response, maxLagMs };
    } finally {
        clearInterval(timer);
    }
}

interface Spread {
    readonly fastest: number;
    readonly slowest: number;
    readonly median: number;
}

function spreadOf(measured: readonly number[]): Spread {
    const values = [...measured].sort((a, b) => a - b);
    const round = (value: number): number => Math.round(value * 1000) / 1000;
    return { fastest: round(values[0]!), slowest: round(values.at(-1)!), median: round(values[values.length >> 1]!) };
}

async function repeat(runs: number, action: () => Promise<number> | number): Promise<Spread> {
    const values: number[] = [];
    for (let run = 0; run < runs; run++) values.push(await action());
    return spreadOf(values);
}

async function timed(action: () => Promise<unknown> | unknown): Promise<number> {
    const started = performance.now();
    await action();
    return performance.now() - started;
}

// Deterministischer Zufall, damit alle Läufe dieselben Anfragen stellen
function pseudoRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return state / 2_147_483_648;
    };
}

function forwardQueries(count: number): Array<{ file: string; line: number }> {
    const random = pseudoRandom(1);
    return Array.from({ length: count }, () => ({
        file: benchFile(2 + Math.floor(random() * BENCH_INPUT_FILES)),
        line: 1 + Math.floor(random() * BENCH_LINES_PER_FILE),
    }));
}

function backwardQueries(count: number, pages: number): Array<{ page: number; x: number; y: number }> {
    const random = pseudoRandom(2);
    const pageWidth = 595;
    const pageHeight = 842;
    return Array.from({ length: count }, () => ({
        page: 1 + Math.floor(random() * pages),
        x: random() * pageWidth,
        y: random() * pageHeight,
    }));
}

// Speicher nur nach vollständiger Speicherbereinigung vergleichbar (ohne --expose-gc beim Start)
function collectGarbage(): void {
    setFlagsFromString('--expose-gc');
    (runInNewContext('gc') as () => void)();
}

function heapMegabytes(): number {
    collectGarbage();
    const usage = process.memoryUsage();
    return (usage.heapUsed + usage.arrayBuffers) / BYTES_PER_MEGABYTE;
}

async function measureInThread(path: string): Promise<{ load: Spread; index: SyncTeXIndex; memory: object }> {
    const load = await repeat(BENCH_RUNS, () => timed(() => loadSyncTeX(path)));
    const before = heapMegabytes();
    const index = await loadSyncTeX(path);
    // Index am Leben halten, damit die Bereinigung in heapMegabytes ihn nicht mitzählt
    expect(index.records.count).toBeGreaterThan(0);
    const after = heapMegabytes();
    const memory = {
        typedArraysMB: Math.round((indexArrayBytes(index) / BYTES_PER_MEGABYTE) * 10) / 10,
        heapDeltaMB: Math.round((after - before) * 10) / 10,
    };
    return { load, index, memory };
}

async function measureQueries(index: SyncTeXIndex): Promise<object> {
    const forward = forwardQueries(BENCH_QUERIES);
    const backward = backwardQueries(BENCH_QUERIES, index.pageRanges.size);
    const perQuery = (total: number): number => total / BENCH_QUERIES;
    const forwardMs = await repeat(BENCH_RUNS, async () =>
        perQuery(await timed(() => forward.forEach((query) => forwardSearch(index, query.file, query.line)))));
    const backwardMs = await repeat(BENCH_RUNS, async () =>
        perQuery(await timed(() => backward.forEach((query) => backwardSearch(index, query.page, query.x, query.y)))));
    const hits = forward.filter((query) => forwardSearch(index, query.file, query.line) !== null).length;
    return { forwardMs, backwardMs, forwardHits: hits };
}

async function measureWorker(path: string): Promise<object> {
    return withWorker(workerScript, async (client) => {
        const lags: number[] = [];
        const loadMs = await repeat(BENCH_RUNS, async () => {
            const started = performance.now();
            const { maxLagMs } = await measureMainLag(() => client.request({ type: 'load', file: path }));
            lags.push(maxLagMs);
            return performance.now() - started;
        });
        const queries = forwardQueries(BENCH_QUERIES);
        const roundTripMs = await repeat(BENCH_RUNS, async () => (await timed(async () => {
            for (const query of queries) await client.request({ type: 'forward', ...query });
        })) / BENCH_QUERIES);
        return { loadMs, maxMainLagMs: spreadOf(lags), roundTripMs };
    });
}

describe.runIf(RUN_BENCHMARK)('S3-Messung (SYNCTEX_BENCH=1)', () => {
    it('250.000 Einträge: Einlesen, Speicher, Suche, Main-Blockade', { timeout: BENCH_TIMEOUT_MS }, async () => {
        const large = await writeLargeFixture();
        const inThread = await measureInThread(large.path);
        const queries = await measureQueries(inThread.index);
        const worker = await measureWorker(large.path);
        const file = { records: large.records, megabytes: large.bytes / BYTES_PER_MEGABYTE, gzipBytes: large.compressed };
        console.log(`S3-ERGEBNIS ${JSON.stringify({ file, mainThreadLoadMs: inThread.load, memory: inThread.memory, queries, worker })}`);
        expect(inThread.index.records.count).toBe(large.records);
    });
});
