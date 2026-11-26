import { describe, expect, it } from 'vitest';
import { AnalysisClient } from '../../src/renderer/workers/analysisClient';
import type { AnalysisTimer, AnalysisWorkerLike } from '../../src/renderer/workers/analysisClient';
import { handleAnalysisRequest } from '../../src/renderer/workers/analysisLogic';
import type { AnalysisRequest, AnalysisResponse, WritingResult } from '../../src/renderer/workers/analysisLogic';

// Schreibprüfung im Analyse-Worker (W7-3): Logik und Client-Anbindung (`writing`)

describe('Analyse-Logik: writing', () => {
    it('liefert Hinweise und Wörter, trägt docId und version', () => {
        const response = handleAnalysisRequest({
            kind: 'writing', docId: 'a', version: 4, text: 'Das das ist ein Test.', includeHints: true,
        });
        if (response.kind !== 'writing') throw new Error('falsche Antwortart');
        expect(response).toMatchObject({ docId: 'a', version: 4 });
        expect(response.result.words).toBe(5);
        expect(response.result.hints.map((hint) => hint.kind)).toEqual(['repeatedWord']);
    });

    it('ohne includeHints nur die Wörter (Schreibhinweise aus)', () => {
        const response = handleAnalysisRequest({
            kind: 'writing', docId: 'a', version: 1, text: 'Das das ist ein Test.', includeHints: false,
        });
        expect(response).toMatchObject({ kind: 'writing', result: { hints: [], words: 5 } });
    });

    it('zählt Fließtext ohne Befehle und Kommentare', () => {
        const text = '\\section{Titel}\n% Kommentar hier\nEin Satz mit \\emph{Betonung}.';
        const response = handleAnalysisRequest({ kind: 'writing', docId: 'a', version: 1, text, includeHints: false });
        if (response.kind !== 'writing') throw new Error('falsche Antwortart');
        expect(response.result.words).toBe(5);
    });
});

class FakeTimer implements AnalysisTimer {
    private readonly callbacks: (() => void)[] = [];
    set(callback: () => void): unknown {
        this.callbacks.push(callback);
        return this.callbacks.length;
    }
    clear(): void {}
    flush(): void {
        for (const callback of this.callbacks.splice(0)) callback();
    }
}

class FakeWorker implements AnalysisWorkerLike {
    readonly posted: AnalysisRequest[] = [];
    onmessage: AnalysisWorkerLike['onmessage'] = null;
    onerror: AnalysisWorkerLike['onerror'] = null;
    onmessageerror: AnalysisWorkerLike['onmessageerror'] = null;
    postMessage(request: AnalysisRequest): void {
        this.posted.push(request);
    }
    terminate(): void {}
    reply(response: AnalysisResponse): void {
        this.onmessage?.({ data: response });
    }
}

describe('AnalysisClient: writing', () => {
    function setup() {
        const timer = new FakeTimer();
        const worker = new FakeWorker();
        const results: string[] = [];
        const client = new AnalysisClient(
            { onWriting: (docId, version, result) => results.push(`${docId}:${version}:${result.words}`) },
            { timer, createWorker: () => worker },
        );
        return { client, timer, worker, results };
    }
    const RESULT: WritingResult = { hints: [], words: 7 };

    it('sendet die Anfrage mit includeHints und liefert die Antwort an onWriting', () => {
        const { client, timer, worker, results } = setup();
        client.requestWriting('a', 2, 'Text', true);
        timer.flush();
        expect(worker.posted).toEqual([{ kind: 'writing', docId: 'a', version: 2, text: 'Text', includeHints: true }]);
        worker.reply({ kind: 'writing', docId: 'a', version: 2, result: RESULT });
        expect(results).toEqual(['a:2:7']);
    });

    it('verwirft eine Antwort mit veralteter Version', () => {
        const { client, timer, worker, results } = setup();
        client.requestWriting('a', 2, 'Text', true);
        timer.flush();
        client.requestWriting('a', 3, 'Text2', true);
        worker.reply({ kind: 'writing', docId: 'a', version: 2, result: RESULT });
        expect(results).toEqual([]);
    });
});
