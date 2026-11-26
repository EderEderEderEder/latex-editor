/**
 * Client im Renderer für den Analyse-Worker: entprellt Anfragen, fasst sie je Art und Dokument zusammen
 * (nur die letzte läuft), verwirft Antworten mit veralteter Version und startet den Worker nach einem Fehler neu.
 */
import type { LabelEntry } from '../../shared/core/latex/duplicateLabels';
import type { TextMark } from '../../shared/core/latex/syntaxChecker';
import type { AnalysisRequest, AnalysisResponse, WritingResult } from './analysisLogic';

export const ANALYSIS_DEBOUNCE_MS = 600;

/** Der Teil von `Worker`, den der Client braucht (Tests liefern eine Fälschung) */
export interface AnalysisWorkerLike {
    postMessage(request: AnalysisRequest): void;
    terminate(): void;
    onmessage: ((event: { readonly data: AnalysisResponse }) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onmessageerror: ((event: unknown) => void) | null;
}

export type AnalysisWorkerFactory = () => AnalysisWorkerLike;

export interface AnalysisTimer {
    set(callback: () => void, delayMs: number): unknown;
    clear(handle: unknown): void;
}

export interface AnalysisCallbacks {
    onMarks?(docId: string, version: number, marks: readonly TextMark[]): void;
    onWriting?(docId: string, version: number, result: WritingResult): void;
    onLabels?(docId: string, version: number, file: string, entries: readonly LabelEntry[]): void;
    onDuplicates?(docId: string, version: number, entries: readonly LabelEntry[]): void;
    /** `docId`/`version` fehlen, wenn der Worker selbst ausgefallen ist (er wird dann neu gestartet) */
    onError?(message: string, docId?: string, version?: number): void;
}

export interface AnalysisClientOptions {
    readonly createWorker?: AnalysisWorkerFactory;
    readonly timer?: AnalysisTimer;
    readonly debounceMs?: number;
}

// Über `globalThis`, weil die Tests auch mit der Node-Typprüfung (ohne DOM-Typen) übersetzt werden.
interface ModuleWorkerConstructor {
    new (url: URL, options: { readonly type: 'module' }): AnalysisWorkerLike;
}

export function createDefaultWorker(): AnalysisWorkerLike {
    const { Worker } = globalThis as unknown as { Worker: ModuleWorkerConstructor };
    return new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
}

const browserTimer: AnalysisTimer = {
    set: (callback, delayMs) => setTimeout(callback, delayMs),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class AnalysisClient {
    private worker: AnalysisWorkerLike | null = null;
    private disposed = false;
    private readonly createWorker: AnalysisWorkerFactory;
    private readonly timer: AnalysisTimer;
    private readonly debounceMs: number;
    private readonly timers = new Map<string, unknown>();
    private readonly latestVersions = new Map<string, number>();

    constructor(
        private readonly callbacks: AnalysisCallbacks,
        options: AnalysisClientOptions = {},
    ) {
        this.createWorker = options.createWorker ?? createDefaultWorker;
        this.timer = options.timer ?? browserTimer;
        this.debounceMs = options.debounceMs ?? ANALYSIS_DEBOUNCE_MS;
    }

    requestCheck(docId: string, version: number, text: string): void {
        this.schedule({ kind: 'check', docId, version, text });
    }

    requestWriting(docId: string, version: number, text: string, includeHints: boolean): void {
        this.schedule({ kind: 'writing', docId, version, text, includeHints });
    }

    requestLabels(docId: string, version: number, text: string, file: string): void {
        this.schedule({ kind: 'labels', docId, version, text, file });
    }

    requestDuplicates(docId: string, version: number, entries: readonly LabelEntry[]): void {
        this.schedule({ kind: 'duplicates', docId, version, entries });
    }

    dispose(): void {
        this.disposed = true;
        for (const handle of this.timers.values()) this.timer.clear(handle);
        this.timers.clear();
        this.latestVersions.clear();
        this.stopWorker();
    }

    private schedule(request: AnalysisRequest): void {
        if (this.disposed) return;
        const key = `${request.kind}:${request.docId}`;
        const pending = this.timers.get(key);
        if (pending !== undefined) this.timer.clear(pending);
        this.latestVersions.set(key, request.version);
        this.timers.set(
            key,
            this.timer.set(() => {
                this.timers.delete(key);
                this.send(request);
            }, this.debounceMs),
        );
    }

    private send(request: AnalysisRequest): void {
        this.worker ??= this.startWorker();
        this.worker.postMessage(request);
    }

    private startWorker(): AnalysisWorkerLike {
        const worker = this.createWorker();
        worker.onmessage = (event) => this.receive(worker, event.data);
        worker.onerror = () => this.restart(worker, 'Analyse-Worker ist ausgefallen');
        worker.onmessageerror = () => this.restart(worker, 'Antwort des Analyse-Workers unlesbar');
        return worker;
    }

    private restart(failed: AnalysisWorkerLike, message: string): void {
        if (this.disposed || this.worker !== failed) return;
        this.stopWorker();
        this.callbacks.onError?.(message);
    }

    private stopWorker(): void {
        this.worker?.terminate();
        this.worker = null;
    }

    private receive(source: AnalysisWorkerLike, response: AnalysisResponse): void {
        if (this.disposed || this.worker !== source) return;
        if (response.kind === 'error') {
            this.callbacks.onError?.(response.message, response.docId, response.version);
            return;
        }
        if (this.latestVersions.get(`${response.kind}:${response.docId}`) !== response.version) return;
        this.deliver(response);
    }

    private deliver(response: Exclude<AnalysisResponse, { kind: 'error' }>): void {
        const { docId, version } = response;
        if (response.kind === 'check') this.callbacks.onMarks?.(docId, version, response.marks);
        else if (response.kind === 'writing') this.callbacks.onWriting?.(docId, version, response.result);
        else if (response.kind === 'labels') this.callbacks.onLabels?.(docId, version, response.file, response.entries);
        else this.callbacks.onDuplicates?.(docId, version, response.entries);
    }
}
