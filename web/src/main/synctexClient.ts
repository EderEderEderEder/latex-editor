import { Worker } from 'node:worker_threads';
import type { GeneralError, SyncTexBackwardResult, SyncTexForwardResult } from '../shared/contract';
import {
    SYNCTEX_WORKER_DATA,
    type SyncTeXLoadSummary,
    type SyncTeXWorkerRequest,
    type SyncTeXWorkerResponse,
    type SyncTeXWorkerValue,
} from './workers/synctex.worker';

// Main-Client des SyncTeX-Workers (W3-2): ordnet Antworten über die `id` zu, bricht hängende Anfragen nach einer
// Zeitüberschreitung ab und startet den Worker nach `exit`/`error` bei der nächsten Anfrage neu. Ein neuer Worker
// lädt zuerst die zuletzt erfolgreich geladene Datei, damit Suchen danach wieder Daten haben. Fabrik einspeisbar.

export const SYNCTEX_TIMEOUT_MS = 30_000;

/** Das, was der Client vom Worker braucht (erfüllt `worker_threads.Worker`, in Tests gefälscht) */
export interface SyncTeXWorkerLike {
    postMessage(request: SyncTeXWorkerRequest): void;
    on(event: 'message', listener: (response: SyncTeXWorkerResponse) => void): unknown;
    on(event: 'error', listener: (error: Error) => void): unknown;
    on(event: 'exit', listener: (code: number) => void): unknown;
    terminate(): unknown;
}

export type SyncTeXWorkerFactory = () => SyncTeXWorkerLike;

/** Was Handler und Nachladen brauchen (erfüllt `SyncTeXClient`, in Tests gefälscht) */
export interface SyncTeXBackend {
    load(file: string, platform?: NodeJS.Platform): Promise<SyncTeXLoadSummary>;
    forward(file: string, line: number): Promise<SyncTexForwardResult | null>;
    backward(page: number, x: number, y: number): Promise<SyncTexBackwardResult | null>;
    /** Vergisst die zuletzt geladene Datei (Projektwechsel): ein Neustart lädt dann nichts nach */
    forget(): void;
}

export interface SyncTeXClientOptions {
    readonly createWorker: SyncTeXWorkerFactory;
    readonly timeoutMs?: number | undefined;
}

/** Fehlerantwort des Workers (`notFound`: keine Daten oder Datei fehlt, `io`: unlesbar, `invalidInput`) */
export class SyncTeXClientError extends Error {
    constructor(readonly error: GeneralError) {
        super(error.message);
        this.name = 'SyncTeXClientError';
    }
}

export const SYNCTEX_CLIENT_MESSAGES = {
    crashed: (detail: string) => `SyncTeX-Worker abgestürzt: ${detail}`,
    exited: (code: number) => `SyncTeX-Worker beendet (Code ${code})`,
    timeout: 'SyncTeX-Worker antwortet nicht (Zeitüberschreitung)',
    startFailed: (detail: string) => `SyncTeX-Worker konnte nicht starten: ${detail}`,
    disposed: 'SyncTeX beendet',
} as const;

/** Fabrik für den echten Thread; `workerScript` ist die gebündelte `synctex.worker`-Datei (`out/main/`) */
export function syncTeXWorkerThreadFactory(workerScript: string): SyncTeXWorkerFactory {
    return () => new Worker(workerScript, { workerData: SYNCTEX_WORKER_DATA }) as unknown as SyncTeXWorkerLike;
}

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
type RequestBody = WithoutId<SyncTeXWorkerRequest>;
type LoadBody = Extract<RequestBody, { readonly type: 'load' }>;

interface Callbacks {
    readonly resolve: (value: SyncTeXWorkerValue) => void;
    readonly reject: (error: Error) => void;
}

interface Pending extends Callbacks {
    readonly timer: NodeJS.Timeout;
}

const IGNORE = (): void => undefined;
// Das Wiederherstellen nach einem Neustart hat keinen Aufrufer, der auf das Ergebnis wartet.
const IGNORED_CALLBACKS: Callbacks = { resolve: IGNORE, reject: IGNORE };

export class SyncTeXClient implements SyncTeXBackend {
    private worker: SyncTeXWorkerLike | null = null;
    private nextId = 1;
    private readonly pending = new Map<number, Pending>();
    private lastLoaded: LoadBody | null = null;
    private disposed = false;

    constructor(private readonly options: SyncTeXClientOptions) {}

    async load(file: string, platform?: NodeJS.Platform): Promise<SyncTeXLoadSummary> {
        const body: LoadBody = platform === undefined ? { type: 'load', file } : { type: 'load', file, platform };
        const summary = (await this.request(body)) as SyncTeXLoadSummary;
        this.lastLoaded = body;
        return summary;
    }

    async forward(file: string, line: number): Promise<SyncTexForwardResult | null> {
        return (await this.request({ type: 'forward', file, line })) as SyncTexForwardResult | null;
    }

    async backward(page: number, x: number, y: number): Promise<SyncTexBackwardResult | null> {
        return (await this.request({ type: 'backward', page, x, y })) as SyncTexBackwardResult | null;
    }

    forget(): void {
        this.lastLoaded = null;
    }

    dispose(): void {
        this.disposed = true;
        this.discardWorker(new Error(SYNCTEX_CLIENT_MESSAGES.disposed));
    }

    private request(body: RequestBody): Promise<SyncTeXWorkerValue> {
        return new Promise((resolve, reject) => {
            if (this.disposed) {
                reject(new Error(SYNCTEX_CLIENT_MESSAGES.disposed));
                return;
            }
            const worker = this.ensureWorker(reject);
            if (worker !== null) this.send(worker, body, { resolve, reject });
        });
    }

    private send(worker: SyncTeXWorkerLike, body: RequestBody, callbacks: Callbacks): void {
        const id = this.nextId++;
        const timer = setTimeout(() => this.timeOut(id), this.options.timeoutMs ?? SYNCTEX_TIMEOUT_MS);
        this.pending.set(id, { ...callbacks, timer });
        worker.postMessage({ ...body, id } as SyncTeXWorkerRequest);
    }

    private ensureWorker(reject: (error: Error) => void): SyncTeXWorkerLike | null {
        if (this.worker !== null) return this.worker;
        let worker: SyncTeXWorkerLike;
        try {
            worker = this.options.createWorker();
        } catch (error) {
            reject(new Error(SYNCTEX_CLIENT_MESSAGES.startFailed(String(error))));
            return null;
        }
        worker.on('message', (response) => this.settle(response));
        worker.on('error', (error) => this.discardIfCurrent(worker, new Error(SYNCTEX_CLIENT_MESSAGES.crashed(error.message))));
        worker.on('exit', (code) => this.discardIfCurrent(worker, new Error(SYNCTEX_CLIENT_MESSAGES.exited(code))));
        this.worker = worker;
        // Der Worker beantwortet der Reihe nach: die folgende Anfrage sieht die wieder geladenen Daten.
        if (this.lastLoaded !== null) this.send(worker, this.lastLoaded, IGNORED_CALLBACKS);
        return worker;
    }

    private settle(response: SyncTeXWorkerResponse): void {
        const entry = this.pending.get(response.id);
        if (entry === undefined) return;
        clearTimeout(entry.timer);
        this.pending.delete(response.id);
        if (response.ok) entry.resolve(response.value);
        else entry.reject(new SyncTeXClientError(response.error));
    }

    private timeOut(id: number): void {
        if (!this.pending.has(id)) return;
        this.discardWorker(new Error(SYNCTEX_CLIENT_MESSAGES.timeout));
    }

    private discardIfCurrent(worker: SyncTeXWorkerLike, reason: Error): void {
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
