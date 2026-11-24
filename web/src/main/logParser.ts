import { dirname } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { GeneralError } from '../shared/contract';
import type { LogIssue } from '../shared/core/latex/logParser';
import { PARSE_WORKER_DATA, type ParseWorkerRequest, type ParseWorkerResponse } from './workers/parse.worker';

// Client des Log-Workers (W2-11): `parseLogFile(logPath, biberPath?)` liefert die Meldungen aus dem Log, ohne den
// Main-Prozess zu blockieren. Der Worker startet bei der ersten Anfrage; nach Absturz, Ende oder Zeitüberschreitung
// wird er verworfen und die nächste Anfrage startet einen neuen. Die Worker-Fabrik ist einspeisbar.

export const PARSE_TIMEOUT_MS = 30_000;

/** Das, was der Client vom Worker braucht (erfüllt `worker_threads.Worker`, in Tests gefälscht) */
export interface ParseWorkerLike {
    postMessage(request: ParseWorkerRequest): void;
    on(event: 'message', listener: (response: ParseWorkerResponse) => void): unknown;
    on(event: 'error', listener: (error: Error) => void): unknown;
    on(event: 'exit', listener: (code: number) => void): unknown;
    terminate(): unknown;
}

export type ParseWorkerFactory = () => ParseWorkerLike;

export class LogParserError extends Error {
    constructor(readonly error: GeneralError) {
        super(error.message);
        this.name = 'LogParserError';
    }
}

export interface LogParserOptions {
    readonly createWorker: ParseWorkerFactory;
    readonly timeoutMs?: number;
}

export interface LogParser {
    /** `baseDirectory`: Ordner der Hauptdatei (Standard: Ordner der Logdatei, also ohne `-output-directory`) */
    parseLogFile(logPath: string, biberPath?: string, baseDirectory?: string): Promise<LogIssue[]>;
    dispose(): void;
}

/** Fabrik für den echten Thread; `workerScript` ist die gebündelte `parse.worker`-Datei */
export function workerThreadFactory(workerScript: string): ParseWorkerFactory {
    return () => new Worker(workerScript, { workerData: PARSE_WORKER_DATA }) as unknown as ParseWorkerLike;
}

interface Pending {
    readonly resolve: (issues: LogIssue[]) => void;
    readonly reject: (error: Error) => void;
    readonly timer: NodeJS.Timeout;
}

class WorkerLogParser implements LogParser {
    private worker: ParseWorkerLike | null = null;
    private nextId = 1;
    private readonly pending = new Map<number, Pending>();

    constructor(private readonly options: LogParserOptions) {}

    parseLogFile(logPath: string, biberPath?: string, baseDirectory?: string): Promise<LogIssue[]> {
        return new Promise((resolve, reject) => {
            const worker = this.startWorker(reject);
            if (worker === null) return;
            const id = this.nextId++;
            const timer = setTimeout(() => this.timeOut(id), this.options.timeoutMs ?? PARSE_TIMEOUT_MS);
            this.pending.set(id, { resolve, reject, timer });
            worker.postMessage({ id, logPath, biberPath, baseDirectory: baseDirectory ?? dirname(logPath) });
        });
    }

    dispose(): void {
        this.discardWorker(new Error('Log-Parser beendet'));
    }

    private startWorker(reject: (error: Error) => void): ParseWorkerLike | null {
        if (this.worker !== null) return this.worker;
        try {
            const worker = this.options.createWorker();
            worker.on('message', (response) => this.settle(response));
            worker.on('error', (error) => this.discardIfCurrent(worker, new Error(`Log-Worker abgestürzt: ${error.message}`)));
            worker.on('exit', (code) => this.discardIfCurrent(worker, new Error(`Log-Worker beendet (Code ${code})`)));
            this.worker = worker;
            return worker;
        } catch (error) {
            reject(new Error(`Log-Worker konnte nicht starten: ${String(error)}`));
            return null;
        }
    }

    private settle(response: ParseWorkerResponse): void {
        const entry = this.pending.get(response.id);
        if (entry === undefined) return;
        clearTimeout(entry.timer);
        this.pending.delete(response.id);
        if (response.ok) entry.resolve([...response.value]);
        else entry.reject(new LogParserError(response.error));
    }

    private timeOut(id: number): void {
        if (!this.pending.has(id)) return;
        this.discardWorker(new Error('Log-Worker antwortet nicht (Zeitüberschreitung)'));
    }

    private discardIfCurrent(worker: ParseWorkerLike, reason: Error): void {
        if (this.worker === worker) this.discardWorker(reason);
    }

    // Der Worker kann mitten in einer Anfrage hängen: alles Offene scheitert, die nächste Anfrage startet neu.
    private discardWorker(reason: Error): void {
        const worker = this.worker;
        this.worker = null;
        for (const entry of this.pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(reason);
        }
        this.pending.clear();
        void worker?.terminate();
    }
}

export function createLogParser(options: LogParserOptions): LogParser {
    return new WorkerLogParser(options);
}
