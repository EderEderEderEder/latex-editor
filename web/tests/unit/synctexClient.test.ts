import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    SYNCTEX_CLIENT_MESSAGES,
    SyncTeXClient,
    SyncTeXClientError,
    type SyncTeXWorkerLike,
    syncTeXWorkerThreadFactory,
} from '../../src/main/synctexClient';
import type { SyncTeXWorkerRequest, SyncTeXWorkerResponse } from '../../src/main/workers/synctex.worker';
import { bundleSyncTeXWorker } from '../support/synctexWorkerClient';

// Main-Client des SyncTeX-Workers: gefälschter Worker für id-Zuordnung, Zeitüberschreitung und Neustart,
// dazu ein echter worker_threads-Worker (mit Vites build-API nach $TMPDIR gebündelt) für Laden und Wiederherstellen.
const FIXTURE = fileURLToPath(new URL('../../../shared/spec/fixtures/two-chapters.synctex.gz', import.meta.url));
const CHAPTER_TWO = '/tmp/LatexEditor SyncTeX Fixture/chapters/zwei.tex';
const SHORT_TIMEOUT_MS = 30;
const CRASH_EXIT_CODE = 3;
const SUMMARY = { inputs: 1, records: 2, pages: 1, durationMs: 0 } as const;

type Respond = (request: SyncTeXWorkerRequest, worker: FakeWorker) => void;

class FakeWorker extends EventEmitter implements SyncTeXWorkerLike {
    readonly requests: SyncTeXWorkerRequest[] = [];
    terminated = false;

    constructor(private readonly respond: Respond) {
        super();
    }

    postMessage(request: SyncTeXWorkerRequest): void {
        this.requests.push(request);
        this.respond(request, this);
    }

    terminate(): void {
        this.terminated = true;
    }

    reply(response: SyncTeXWorkerResponse): void {
        this.emit('message', response);
    }
}

function clientWith(respond: Respond, timeoutMs?: number): { client: SyncTeXClient; workers: FakeWorker[] } {
    const workers: FakeWorker[] = [];
    const createWorker = (): FakeWorker => {
        const worker = new FakeWorker(respond);
        workers.push(worker);
        return worker;
    };
    return { client: new SyncTeXClient({ createWorker, timeoutMs }), workers };
}

// Antwortet sofort: `load` mit Zusammenfassung, sonst `null`.
const answerAll: Respond = (request, worker) =>
    worker.reply({ id: request.id, ok: true, value: request.type === 'load' ? SUMMARY : null });

const neverAnswer: Respond = () => undefined;

describe('SyncTeX-Client mit gefälschtem Worker', () => {
    it('ordnet Antworten über die id zu, auch in anderer Reihenfolge', async () => {
        const { client, workers } = clientWith(neverAnswer);
        const first = client.forward('/a.tex', 1);
        const second = client.backward(1, 2, 3);
        const [forward, backward] = workers[0]!.requests;
        const backwardResult = { file: '/a.tex', line: 7 };
        const forwardResult = { page: 1, rects: [{ x: 1, y: 2, width: 3, height: 4 }] };
        workers[0]!.reply({ id: backward!.id, ok: true, value: backwardResult });
        workers[0]!.reply({ id: forward!.id, ok: true, value: forwardResult });
        await expect(first).resolves.toEqual(forwardResult);
        await expect(second).resolves.toEqual(backwardResult);
        expect(forward).toMatchObject({ type: 'forward', file: '/a.tex', line: 1 });
        expect(backward).toMatchObject({ type: 'backward', page: 1, x: 2, y: 3 });
        client.dispose();
    });

    it('Fehlerantwort wird zu SyncTeXClientError mit Art', async () => {
        const respond: Respond = (request, worker) =>
            worker.reply({ id: request.id, ok: false, error: { kind: 'notFound', message: 'keine Daten' } });
        const { client } = clientWith(respond);
        const error = await client.forward('/a.tex', 1).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(SyncTeXClientError);
        expect((error as SyncTeXClientError).error.kind).toBe('notFound');
        client.dispose();
    });

    it('Zeitüberschreitung beendet den Worker, die nächste Anfrage startet einen neuen', async () => {
        let hang = true;
        const respond: Respond = (request, worker) => {
            if (!hang) answerAll(request, worker);
        };
        const { client, workers } = clientWith(respond, SHORT_TIMEOUT_MS);
        await expect(client.forward('/a.tex', 1)).rejects.toThrow(SYNCTEX_CLIENT_MESSAGES.timeout);
        expect(workers[0]!.terminated).toBe(true);
        hang = false;
        await expect(client.forward('/a.tex', 1)).resolves.toBeNull();
        expect(workers).toHaveLength(2);
        client.dispose();
    });

    it('exit: offene Anfragen scheitern, die nächste startet neu und lädt die letzte Datei wieder', async () => {
        let hang = false;
        const respond: Respond = (request, worker) => {
            if (!hang || request.type === 'load') answerAll(request, worker);
        };
        const { client, workers } = clientWith(respond);
        await client.load('/p/main.synctex.gz', 'win32');
        hang = true;
        const open = client.forward('/a.tex', 1);
        workers[0]!.emit('exit', CRASH_EXIT_CODE);
        await expect(open).rejects.toThrow(SYNCTEX_CLIENT_MESSAGES.exited(CRASH_EXIT_CODE));
        hang = false;
        await expect(client.forward('/a.tex', 2)).resolves.toBeNull();
        expect(workers).toHaveLength(2);
        expect(workers[1]!.requests.map((request) => request.type)).toEqual(['load', 'forward']);
        expect(workers[1]!.requests[0]).toMatchObject({ file: '/p/main.synctex.gz', platform: 'win32' });
        client.dispose();
    });

    it('error: Absturz meldet den Grund; nach forget lädt ein Neustart nichts nach', async () => {
        const { client, workers } = clientWith(neverAnswer);
        const load = client.load('/p/main.synctex.gz');
        workers[0]!.reply({ id: workers[0]!.requests[0]!.id, ok: true, value: SUMMARY });
        await load;
        client.forget();
        const open = client.forward('/a.tex', 1);
        workers[0]!.emit('error', new Error('kaputt'));
        await expect(open).rejects.toThrow(SYNCTEX_CLIENT_MESSAGES.crashed('kaputt'));
        void client.forward('/a.tex', 1).catch(() => undefined);
        expect(workers[1]!.requests.map((request) => request.type)).toEqual(['forward']);
        client.dispose();
    });

    it('Ereignisse eines verworfenen Workers stören den neuen nicht', async () => {
        const { client, workers } = clientWith(neverAnswer, SHORT_TIMEOUT_MS);
        await expect(client.forward('/a.tex', 1)).rejects.toThrow();
        const next = client.forward('/a.tex', 2);
        workers[0]!.emit('exit', CRASH_EXIT_CODE);
        workers[1]!.reply({ id: workers[1]!.requests[0]!.id, ok: true, value: null });
        await expect(next).resolves.toBeNull();
        client.dispose();
    });

    it('Startfehler und dispose: Anfragen scheitern, statt zu hängen', async () => {
        const failing = new SyncTeXClient({ createWorker: () => { throw new Error('kein Thread'); } });
        await expect(failing.forward('/a.tex', 1)).rejects.toThrow('kein Thread');
        const { client, workers } = clientWith(neverAnswer);
        const open = client.forward('/a.tex', 1);
        client.dispose();
        await expect(open).rejects.toThrow(SYNCTEX_CLIENT_MESSAGES.disposed);
        expect(workers[0]!.terminated).toBe(true);
        await expect(client.forward('/a.tex', 1)).rejects.toThrow(SYNCTEX_CLIENT_MESSAGES.disposed);
    });
});

describe('SyncTeX-Client mit echtem Worker', () => {
    let directory: string;
    let workerScript: string;

    beforeAll(async () => {
        directory = await mkdtemp(join(tmpdir(), 'synctex-client-'));
        workerScript = await bundleSyncTeXWorker(directory);
    });

    afterAll(async () => {
        await rm(directory, { recursive: true, force: true });
    });

    it('lädt, sucht und stellt die Daten nach einem beendeten Worker wieder her', async () => {
        const created: SyncTeXWorkerLike[] = [];
        const factory = syncTeXWorkerThreadFactory(workerScript);
        const client = new SyncTeXClient({ createWorker: () => {
            const worker = factory();
            created.push(worker);
            return worker;
        } });
        try {
            await expect(client.load(FIXTURE, 'darwin')).resolves.toMatchObject({ inputs: 12, pages: 3 });
            await expect(client.forward(CHAPTER_TWO, 3)).resolves.toMatchObject({ page: 2 });
            // Erst nach `exit` (der Client hört vorher zu) gilt der Worker als verworfen.
            const exited = new Promise<void>((resolve) => created[0]!.on('exit', () => resolve()));
            void created[0]!.terminate();
            await exited;
            await expect(client.backward(2, 200, 339)).resolves.toMatchObject({ line: 3 });
            expect(created).toHaveLength(2);
        } finally {
            client.dispose();
        }
    });
});
