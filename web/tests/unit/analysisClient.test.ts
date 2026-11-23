import { describe, expect, it } from 'vitest';
import {
    AnalysisClient,
    type AnalysisCallbacks,
    type AnalysisTimer,
    type AnalysisWorkerLike,
} from '../../src/renderer/workers/analysisClient';
import type { AnalysisRequest, AnalysisResponse } from '../../src/renderer/workers/analysisLogic';

const DEBOUNCE_MS = 600;

class FakeTimer implements AnalysisTimer {
    now = 0;
    private nextHandle = 1;
    private readonly scheduled = new Map<number, { at: number; callback: () => void }>();

    set(callback: () => void, delayMs: number): unknown {
        const handle = this.nextHandle++;
        this.scheduled.set(handle, { at: this.now + delayMs, callback });
        return handle;
    }

    clear(handle: unknown): void {
        this.scheduled.delete(handle as number);
    }

    advance(ms: number): void {
        this.now += ms;
        for (const [handle, entry] of [...this.scheduled]) {
            if (entry.at > this.now) continue;
            this.scheduled.delete(handle);
            entry.callback();
        }
    }
}

class FakeWorker implements AnalysisWorkerLike {
    readonly posted: AnalysisRequest[] = [];
    terminated = false;
    onmessage: AnalysisWorkerLike['onmessage'] = null;
    onerror: AnalysisWorkerLike['onerror'] = null;
    onmessageerror: AnalysisWorkerLike['onmessageerror'] = null;

    postMessage(request: AnalysisRequest): void {
        this.posted.push(request);
    }

    terminate(): void {
        this.terminated = true;
    }

    reply(response: AnalysisResponse): void {
        this.onmessage?.({ data: response });
    }
}

function setup() {
    const timer = new FakeTimer();
    const workers: FakeWorker[] = [];
    const marks: string[] = [];
    const errors: string[] = [];
    const callbacks: AnalysisCallbacks = {
        onMarks: (docId, version, list) => marks.push(`${docId}:${version}:${list.length}`),
        onError: (message, docId, version) => errors.push(`${message}|${docId ?? '-'}|${version ?? '-'}`),
    };
    const client = new AnalysisClient(callbacks, {
        timer,
        createWorker: () => {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        },
    });
    return { client, timer, workers, marks, errors };
}

const MARK = { severity: 'error', start: 0, end: 1, message: 'm' } as const;

describe('AnalysisClient', () => {
    it('entprellt: vor Ablauf der Frist wird nichts gesendet, der Worker startet erst bei Bedarf', () => {
        const { client, timer, workers } = setup();
        client.requestCheck('a', 1, 'x');
        timer.advance(DEBOUNCE_MS - 1);
        expect(workers).toHaveLength(0);
        timer.advance(1);
        expect(workers).toHaveLength(1);
        expect(workers[0]?.posted).toEqual([{ kind: 'check', docId: 'a', version: 1, text: 'x' }]);
    });

    it('fasst Anfragen je Dokument zusammen: nur die letzte läuft; andere Dokumente bleiben getrennt', () => {
        const { client, timer, workers } = setup();
        client.requestCheck('a', 1, 'eins');
        timer.advance(300);
        client.requestCheck('a', 2, 'zwei');
        client.requestCheck('b', 7, 'andere');
        timer.advance(DEBOUNCE_MS);
        const posted = workers[0]?.posted ?? [];
        expect(posted.map((request) => `${request.docId}:${request.version}`)).toEqual(['a:2', 'b:7']);
    });

    it('verwirft Antworten mit veralteter Version, liefert die aktuelle', () => {
        const { client, timer, workers, marks } = setup();
        client.requestCheck('a', 1, 'x');
        timer.advance(DEBOUNCE_MS);
        client.requestCheck('a', 2, 'y');
        workers[0]?.reply({ kind: 'check', docId: 'a', version: 1, marks: [MARK] });
        expect(marks).toEqual([]);
        timer.advance(DEBOUNCE_MS);
        workers[0]?.reply({ kind: 'check', docId: 'a', version: 2, marks: [MARK, MARK] });
        expect(marks).toEqual(['a:2:2']);
    });

    it('meldet error-Antworten mit docId und version, der Worker bleibt', () => {
        const { client, timer, workers, errors } = setup();
        client.requestCheck('a', 1, 'x');
        timer.advance(DEBOUNCE_MS);
        workers[0]?.reply({ kind: 'error', docId: 'a', version: 1, message: 'kaputt' });
        expect(errors).toEqual(['kaputt|a|1']);
        expect(workers[0]?.terminated).toBe(false);
    });

    it('startet den Worker nach error und messageerror neu und ignoriert Antworten des alten', () => {
        const { client, timer, workers, errors, marks } = setup();
        client.requestCheck('a', 1, 'x');
        timer.advance(DEBOUNCE_MS);
        const first = workers[0];
        first?.onerror?.({});
        expect(first?.terminated).toBe(true);
        client.requestCheck('a', 2, 'y');
        timer.advance(DEBOUNCE_MS);
        expect(workers).toHaveLength(2);
        workers[1]?.onmessageerror?.({});
        client.requestCheck('a', 3, 'z');
        timer.advance(DEBOUNCE_MS);
        expect(workers).toHaveLength(3);
        first?.reply({ kind: 'check', docId: 'a', version: 3, marks: [MARK] });
        expect(marks).toEqual([]);
        expect(errors).toHaveLength(2);
    });

    it('dispose stoppt Zeitgeber und Worker und ignoriert spätere Anfragen und Antworten', () => {
        const { client, timer, workers, marks } = setup();
        client.requestCheck('a', 1, 'x');
        timer.advance(DEBOUNCE_MS);
        client.requestCheck('a', 2, 'y');
        client.dispose();
        expect(workers[0]?.terminated).toBe(true);
        timer.advance(DEBOUNCE_MS);
        client.requestCheck('a', 3, 'z');
        timer.advance(DEBOUNCE_MS);
        workers[0]?.reply({ kind: 'check', docId: 'a', version: 2, marks: [MARK] });
        expect(workers).toHaveLength(1);
        expect(workers[0]?.posted).toHaveLength(1);
        expect(marks).toEqual([]);
    });
});
