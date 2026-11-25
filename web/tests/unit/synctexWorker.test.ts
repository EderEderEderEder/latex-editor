import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    createSyncTeXRequestHandler,
    shouldStartWorker,
    SYNCTEX_WORKER_DATA,
} from '../../src/main/workers/synctex.worker';
import { bundleSyncTeXWorker, WorkerClient, withWorker } from '../support/synctexWorkerClient';

// Echter worker_threads-Worker, mit Vites build-API nach $TMPDIR gebündelt (nicht der Produkt-Build mit dem
// Einstieg in electron.vite.config.ts). Langsame Messungen: tests/slow/. Main-Client: synctexClient.test.ts.
const FIXTURE = fileURLToPath(new URL('../../../shared/spec/fixtures/two-chapters.synctex.gz', import.meta.url));
const CHAPTER_TWO = '/tmp/LatexEditor SyncTeX Fixture/chapters/zwei.tex';
const CRASH_EXIT_CODE = 3;

let directory: string;
let workerScript: string;

beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'synctex-worker-'));
    workerScript = await bundleSyncTeXWorker(directory);
});

afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
});

describe('SyncTeX-Worker: Anfragen ohne Thread', () => {
    it('Ohne geladene Daten gibt es notFound, falsche Anfragen invalidInput', async () => {
        const handle = createSyncTeXRequestHandler();
        const forward = await handle({ id: 1, type: 'forward', file: CHAPTER_TWO, line: 3 });
        expect(forward).toMatchObject({ ok: false, error: { kind: 'notFound' } });
        const invalid = await handle({ id: 2, type: 'backward', page: 1, x: Number.NaN, y: 0 });
        expect(invalid).toMatchObject({ ok: false, error: { kind: 'invalidInput' } });
    });

    it('startet nur im eigenen Thread mit eigener Kennung, nie als Nebenwirkung des Imports', () => {
        expect(shouldStartWorker(true, SYNCTEX_WORKER_DATA)).toBe(false);
        expect(shouldStartWorker(false, SYNCTEX_WORKER_DATA)).toBe(true);
        expect(shouldStartWorker(false, undefined)).toBe(false);
        expect(shouldStartWorker(false, { kind: 'vitest' })).toBe(false);
    });
});

describe('SyncTeX-Worker (worker_threads)', () => {
    it('lädt die Fixture und beantwortet Vorwärts- und Rückwärtssuche', async () => {
        await withWorker(workerScript, async (client) => {
            const load = await client.request({ type: 'load', file: FIXTURE, platform: 'darwin' });
            expect(load).toMatchObject({ ok: true, value: { inputs: 12, pages: 3 } });
            const forward = await client.request({ type: 'forward', file: CHAPTER_TWO, line: 3 });
            expect(forward).toMatchObject({ ok: true, value: { page: 2 } });
            const backward = await client.request({ type: 'backward', page: 2, x: 200, y: 339 });
            expect(backward).toMatchObject({ ok: true, value: { line: 3 } });
        });
    });

    it('Fehlende oder abgeschnittene Datei behält die bisherigen Daten', async () => {
        const broken = join(directory, 'broken.synctex.gz');
        await writeFile(broken, gzipSync(Buffer.from('SyncTeX Version:1\n')).subarray(0, 12));
        await withWorker(workerScript, async (client) => {
            await client.request({ type: 'load', file: FIXTURE, platform: 'darwin' });
            const failed = await client.request({ type: 'load', file: broken, platform: 'darwin' });
            expect(failed).toMatchObject({ ok: false, error: { kind: 'io' } });
            const missing = await client.request({ type: 'load', file: join(directory, 'fehlt.gz') });
            expect(missing).toMatchObject({ ok: false, error: { kind: 'notFound' } });
            const forward = await client.request({ type: 'forward', file: CHAPTER_TWO, line: 3 });
            expect(forward).toMatchObject({ ok: true, value: { page: 2 } });
        });
    });

    it('ohne Kennung in workerData antwortet der Worker nicht (Thread endet ohne Arbeit)', async () => {
        const worker = new Worker(workerScript);
        const exitCode = await new Promise<number>((resolve) => worker.once('exit', resolve));
        expect(exitCode).toBe(0);
    });
});

describe('Worker-Client', () => {
    it('beendeter Worker: offene und spätere Anfragen schlagen fehl statt zu hängen', async () => {
        const worker = new Worker(`setTimeout(() => process.exit(${CRASH_EXIT_CODE}), 20)`, { eval: true });
        const client = new WorkerClient(worker);
        await expect(client.request({ type: 'forward', file: CHAPTER_TWO, line: 1 })).rejects.toThrow(`Code ${CRASH_EXIT_CODE}`);
        await expect(client.request({ type: 'forward', file: CHAPTER_TWO, line: 1 })).rejects.toThrow('beendet');
    });

    it('Absturz im Worker (error) meldet den Fehler', async () => {
        const worker = new Worker("throw new Error('kaputt')", { eval: true });
        const client = new WorkerClient(worker);
        await expect(client.request({ type: 'forward', file: CHAPTER_TWO, line: 1 })).rejects.toThrow('abgestürzt: kaputt');
    });
});
