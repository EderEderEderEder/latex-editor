import { EventEmitter } from 'node:events';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogParser, LogParserError, type ParseWorkerLike, workerThreadFactory } from '../../src/main/logParser';
import {
    createParseRequestHandler,
    type ParseWorkerRequest,
    type ParseWorkerResponse,
    shouldStartWorker,
    PARSE_WORKER_DATA,
} from '../../src/main/workers/parse.worker';
import { specDirectory } from '../support/specVectors';

// Client mit gefälschtem Worker (Zeitüberschreitung, Absturz, Neustart) und der Handler ohne Thread; ein echter
// worker_threads-Worker nur über Vites build-API nach $TMPDIR (wie im SyncTeX-Test, kein neues Paket).
const WORKER_SOURCE = fileURLToPath(new URL('../../src/main/workers/parse.worker.ts', import.meta.url));
const WORKER_FILE_NAME = 'parse.worker.cjs';
const SHORT_TIMEOUT_MS = 30;
const CRASH_EXIT_CODE = 3;

class FakeWorker extends EventEmitter implements ParseWorkerLike {
    readonly requests: ParseWorkerRequest[] = [];
    terminated = false;

    constructor(private readonly respond: (request: ParseWorkerRequest, worker: FakeWorker) => void) {
        super();
    }

    postMessage(request: ParseWorkerRequest): void {
        this.requests.push(request);
        this.respond(request, this);
    }

    terminate(): void {
        this.terminated = true;
    }

    reply(response: ParseWorkerResponse): void {
        this.emit('message', response);
    }
}

function factoryOf(workers: FakeWorker[], respond: (request: ParseWorkerRequest, worker: FakeWorker) => void) {
    return () => {
        const worker = new FakeWorker(respond);
        workers.push(worker);
        return worker;
    };
}

const echoIssue = { id: 0, severity: 'error', message: 'x', file: null, line: 1, detail: null } as const;
const answerWithIssue = (request: ParseWorkerRequest, worker: FakeWorker): void =>
    worker.reply({ id: request.id, ok: true, value: [echoIssue] });

describe('Log-Client mit gefälschtem Worker', () => {
    it('schickt Pfade und Basisordner (Standard: Ordner der Logdatei) und liefert die Meldungen', async () => {
        const workers: FakeWorker[] = [];
        const parser = createLogParser({ createWorker: factoryOf(workers, answerWithIssue) });
        const issues = await parser.parseLogFile(join('/p', 'main.log'), join('/p', 'main.blg'));
        expect(issues).toEqual([echoIssue]);
        expect(workers[0]?.requests[0]).toMatchObject({ logPath: join('/p', 'main.log'), biberPath: join('/p', 'main.blg'), baseDirectory: '/p' });
        await parser.parseLogFile(join('/p', 'out', 'main.log'), undefined, '/p');
        expect(workers[0]?.requests[1]).toMatchObject({ baseDirectory: '/p' });
        expect(workers).toHaveLength(1);
        parser.dispose();
    });

    it('Fehlerantwort des Workers wird zu LogParserError mit Art', async () => {
        const respond = (request: ParseWorkerRequest, worker: FakeWorker): void =>
            worker.reply({ id: request.id, ok: false, error: { kind: 'notFound', message: 'weg' } });
        const parser = createLogParser({ createWorker: factoryOf([], respond) });
        const error = await parser.parseLogFile('/p/main.log').catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(LogParserError);
        expect((error as LogParserError).error.kind).toBe('notFound');
        parser.dispose();
    });

    it('Absturz: offene Anfrage scheitert, die nächste startet einen neuen Worker', async () => {
        const workers: FakeWorker[] = [];
        const respond = (request: ParseWorkerRequest, worker: FakeWorker): void => {
            if (workers.length === 1) worker.emit('error', new Error('kaputt'));
            else answerWithIssue(request, worker);
        };
        const parser = createLogParser({ createWorker: factoryOf(workers, respond) });
        await expect(parser.parseLogFile('/p/main.log')).rejects.toThrow('abgestürzt: kaputt');
        expect(workers[0]?.terminated).toBe(true);
        await expect(parser.parseLogFile('/p/main.log')).resolves.toEqual([echoIssue]);
        expect(workers).toHaveLength(2);
        parser.dispose();
    });

    it('Ende des Workers (exit) gilt wie ein Absturz', async () => {
        const workers: FakeWorker[] = [];
        const respond = (_request: ParseWorkerRequest, worker: FakeWorker): void => {
            worker.emit('exit', CRASH_EXIT_CODE);
        };
        const parser = createLogParser({ createWorker: factoryOf(workers, respond) });
        await expect(parser.parseLogFile('/p/main.log')).rejects.toThrow(`Code ${CRASH_EXIT_CODE}`);
        parser.dispose();
    });

    it('Zeitüberschreitung: Anfrage scheitert, Worker wird beendet, danach Neustart', async () => {
        const workers: FakeWorker[] = [];
        const respond = (request: ParseWorkerRequest, worker: FakeWorker): void => {
            if (workers.length > 1) answerWithIssue(request, worker);
        };
        const parser = createLogParser({ createWorker: factoryOf(workers, respond), timeoutMs: SHORT_TIMEOUT_MS });
        await expect(parser.parseLogFile('/p/main.log')).rejects.toThrow('Zeitüberschreitung');
        expect(workers[0]?.terminated).toBe(true);
        await expect(parser.parseLogFile('/p/main.log')).resolves.toEqual([echoIssue]);
        parser.dispose();
    });

    it('Worker-Fabrik wirft: Anfrage scheitert mit Meldung, nächste Anfrage versucht es erneut', async () => {
        let calls = 0;
        const parser = createLogParser({
            createWorker: () => {
                calls += 1;
                if (calls === 1) throw new Error('kein Start');
                return new FakeWorker(answerWithIssue);
            },
        });
        await expect(parser.parseLogFile('/p/main.log')).rejects.toThrow('konnte nicht starten');
        await expect(parser.parseLogFile('/p/main.log')).resolves.toHaveLength(1);
        parser.dispose();
    });

    it('dispose lässt offene Anfragen scheitern und beendet den Worker', async () => {
        const workers: FakeWorker[] = [];
        const parser = createLogParser({ createWorker: factoryOf(workers, () => undefined) });
        const pending = parser.parseLogFile('/p/main.log');
        parser.dispose();
        await expect(pending).rejects.toThrow('beendet');
        expect(workers[0]?.terminated).toBe(true);
    });
});

let directory: string;
let workerScript: string;
let logPath: string;
let biberPath: string;

beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'parse-worker-'));
    logPath = join(directory, 'errors.log');
    biberPath = join(directory, 'biber.blg');
    await copyFile(join(specDirectory(), 'fixtures', 'errors.log'), logPath);
    await copyFile(join(specDirectory(), 'fixtures', 'biber.blg'), biberPath);
    await build({
        configFile: false,
        logLevel: 'warn',
        build: {
            ssr: WORKER_SOURCE,
            outDir: directory,
            emptyOutDir: false,
            minify: false,
            rollupOptions: { output: { format: 'cjs', entryFileNames: WORKER_FILE_NAME } },
        },
    });
    workerScript = join(directory, WORKER_FILE_NAME);
});

afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
});

describe('Log-Worker: Anfragen ohne Thread', () => {
    it('liest Log und Biber-Log, Biber-Nummern schließen an', async () => {
        const handle = createParseRequestHandler();
        const response = await handle({ id: 1, logPath, biberPath, baseDirectory: directory });
        expect(response.ok).toBe(true);
        if (!response.ok) return;
        expect(response.value.map((issue) => issue.id)).toEqual([0, 1, 2, 3, 4]);
        expect(response.value[0]).toMatchObject({ severity: 'error', line: 3, file: join(directory, 'chapters', 'kapitel.tex') });
        expect(response.value[4]?.message).toContain('Biber: ');
    });

    it('fehlende Logdatei ist notFound, fehlende Biber-Datei ist nur leer, falsche Anfrage invalidInput', async () => {
        const handle = createParseRequestHandler();
        const missingLog = await handle({ id: 1, logPath: join(directory, 'fehlt.log'), baseDirectory: directory });
        expect(missingLog).toMatchObject({ ok: false, error: { kind: 'notFound' } });
        const missingBiber = await handle({ id: 2, logPath, biberPath: join(directory, 'fehlt.blg'), baseDirectory: directory });
        expect(missingBiber).toMatchObject({ ok: true });
        const invalid = await handle({ id: 3, logPath: 42 as unknown as string, baseDirectory: directory });
        expect(invalid).toMatchObject({ ok: false, error: { kind: 'invalidInput' } });
        const directoryAsLog = await handle({ id: 4, logPath: directory, baseDirectory: directory });
        expect(directoryAsLog).toMatchObject({ ok: false, error: { kind: 'io' } });
    });

    it('startet nur im eigenen Thread mit eigener Kennung, nie als Nebenwirkung des Imports', () => {
        expect(shouldStartWorker(true, PARSE_WORKER_DATA)).toBe(false);
        expect(shouldStartWorker(false, PARSE_WORKER_DATA)).toBe(true);
        expect(shouldStartWorker(false, undefined)).toBe(false);
        expect(shouldStartWorker(false, { kind: 'vitest' })).toBe(false);
    });
});

describe('Log-Worker (worker_threads)', () => {
    it('Client mit echtem Thread: Meldungen aus Log und Biber-Log, danach Neustart nach Ende', async () => {
        const parser = createLogParser({ createWorker: workerThreadFactory(workerScript), timeoutMs: 10_000 });
        const issues = await parser.parseLogFile(logPath, biberPath);
        expect(issues.map((issue) => issue.severity)).toEqual(['error', 'error', 'error', 'error', 'warning']);
        expect(issues[4]?.id).toBe(4);
        await expect(parser.parseLogFile(join(directory, 'fehlt.log'))).rejects.toBeInstanceOf(LogParserError);
        await expect(parser.parseLogFile(logPath)).resolves.toHaveLength(4);
        parser.dispose();
    });

    it('ohne Kennung in workerData antwortet der Worker nicht (Thread endet ohne Arbeit)', async () => {
        const worker = new Worker(workerScript);
        const exitCode = await new Promise<number>((resolve) => worker.once('exit', resolve));
        expect(exitCode).toBe(0);
    });

    it('nicht lesbare Datei im Thread: Fehlerantwort statt Absturz', async () => {
        const unreadable = join(directory, 'leer');
        await writeFile(unreadable, '');
        const parser = createLogParser({ createWorker: workerThreadFactory(workerScript), timeoutMs: 10_000 });
        await expect(parser.parseLogFile(unreadable)).resolves.toEqual([]);
        await expect(parser.parseLogFile(directory)).rejects.toMatchObject({ error: { kind: 'io' } });
        parser.dispose();
    });
});
