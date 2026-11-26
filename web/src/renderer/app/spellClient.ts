/**
 * Client im Renderer für den Rechtschreib-Worker (W7-2): startet den Worker erst bei der ersten Anfrage (lazy), lädt
 * dann das Wörterbuch (Bytes ohne Kopie an den Worker), hält je Dokument nur die letzte Prüfung (ältere Antworten
 * verfallen) und holt Vorschläge auf Anforderung. Schlägt Laden oder Worker fehl, meldet er das einmal
 * (`onUnavailable`, Statusleiste) und prüft in dieser Sitzung nicht mehr; nie ein Absturz.
 */
import type { SpellCheckRequest, SpellRange, SpellRequest, SpellResponse } from '../../shared/core/spelling/spellProtocol';

export const SPELL_CLIENT_TEXTS = {
    unavailable: (detail: string) => `Rechtschreibprüfung nicht verfügbar: ${detail}`,
    workerFailed: 'Rechtschreib-Worker ist ausgefallen',
    unreadable: 'Antwort des Rechtschreib-Workers unlesbar',
    dictionaryMissing: (detail: string) => `Wörterbuch nicht lesbar (${detail})`,
} as const;

/** `index.aff`/`index.dic` als Bytes */
export interface SpellDictionaryFiles {
    readonly affix: ArrayBuffer;
    readonly dictionary: ArrayBuffer;
}

export type SpellDictionaryLoader = () => Promise<SpellDictionaryFiles>;

/** Der Teil von `Worker`, den der Client braucht (Tests liefern eine Fälschung) */
export interface SpellWorkerLike {
    postMessage(request: SpellRequest, transfer?: ArrayBuffer[]): void;
    terminate(): void;
    onmessage: ((event: { readonly data: SpellResponse }) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onmessageerror: ((event: unknown) => void) | null;
}

export type SpellWorkerFactory = () => SpellWorkerLike;
export type SpellCheckInput = Omit<SpellCheckRequest, 'kind' | 'id'>;
export type SpellErrorsListener = (errors: readonly SpellRange[]) => void;

export interface SpellClientOptions {
    readonly loadDictionary: SpellDictionaryLoader;
    readonly createWorker?: SpellWorkerFactory;
    /** Einmal je Sitzung, mit fertigem Meldungstext */
    readonly onUnavailable?: (message: string) => void;
}

// Über `globalThis`, weil die Tests auch mit der Node-Typprüfung (ohne DOM-Typen) übersetzt werden.
interface ModuleWorkerConstructor {
    new (url: URL, options: { readonly type: 'module' }): SpellWorkerLike;
}

export function createDefaultSpellWorker(): SpellWorkerLike {
    const { Worker } = globalThis as unknown as { Worker: ModuleWorkerConstructor };
    return new Worker(new URL('../workers/spell.worker.ts', import.meta.url), { type: 'module' });
}

interface PendingCheck {
    readonly docId: string;
    readonly listener: SpellErrorsListener;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class SpellClient {
    private worker: SpellWorkerLike | null = null;
    private ready: Promise<void> = Promise.resolve();
    private unavailable = false;
    private disposed = false;
    private nextId = 1;
    private words: readonly string[] = [];
    private readonly latestByDoc = new Map<string, number>();
    private readonly pendingChecks = new Map<number, PendingCheck>();
    private readonly pendingSuggestions = new Map<number, (suggestions: readonly string[]) => void>();
    private readonly createWorker: SpellWorkerFactory;

    constructor(private readonly options: SpellClientOptions) {
        this.createWorker = options.createWorker ?? createDefaultSpellWorker;
    }

    /** `false` nach einem Ladefehler oder Ausfall: Anfragen werden dann nicht mehr gestellt */
    get isAvailable(): boolean {
        return !this.unavailable && !this.disposed;
    }

    /** Prüft Text; eine neuere Anfrage desselben Dokuments ersetzt eine noch offene */
    check(docId: string, input: SpellCheckInput, listener: SpellErrorsListener): void {
        if (!this.isAvailable) return;
        const id = this.nextId++;
        const previous = this.latestByDoc.get(docId);
        if (previous !== undefined) this.pendingChecks.delete(previous);
        this.latestByDoc.set(docId, id);
        this.pendingChecks.set(id, { docId, listener });
        this.post({ kind: 'check', id, ...input });
    }

    /** Offene Prüfung eines Dokuments verwerfen (Sitzung geschlossen) */
    forget(docId: string): void {
        const id = this.latestByDoc.get(docId);
        if (id !== undefined) this.pendingChecks.delete(id);
        this.latestByDoc.delete(docId);
    }

    /** Vorschläge für ein Wort; ohne Worker oder bei Fehler leer */
    suggest(word: string): Promise<readonly string[]> {
        if (!this.isAvailable) return Promise.resolve([]);
        const id = this.nextId++;
        const result = new Promise<readonly string[]>((resolve) => this.pendingSuggestions.set(id, resolve));
        this.post({ kind: 'suggest', id, word });
        return result;
    }

    /** Benutzerwörter und ignorierte Wörter; geht erst mit dem Start des Workers hinaus */
    setWords(words: readonly string[]): void {
        this.words = [...words];
        if (this.worker !== null) this.post({ kind: 'words', words: this.words });
    }

    dispose(): void {
        this.disposed = true;
        this.stopWorker();
    }

    private post(request: SpellRequest): void {
        const worker = this.worker ?? this.startWorker();
        if (worker === null) return;
        void this.ready.then(() => {
            if (this.worker === worker) worker.postMessage(request);
        });
    }

    private startWorker(): SpellWorkerLike | null {
        let worker: SpellWorkerLike;
        try {
            worker = this.createWorker();
        } catch (error) {
            this.markUnavailable(describeError(error));
            return null;
        }
        worker.onmessage = (event) => this.receive(worker, event.data);
        worker.onerror = () => this.fail(worker, SPELL_CLIENT_TEXTS.workerFailed);
        worker.onmessageerror = () => this.fail(worker, SPELL_CLIENT_TEXTS.unreadable);
        this.worker = worker;
        this.ready = this.loadInto(worker);
        return worker;
    }

    /** Lädt das Wörterbuch und übergibt es; alle späteren Nachrichten warten darauf (Reihenfolge bleibt) */
    private async loadInto(worker: SpellWorkerLike): Promise<void> {
        try {
            const files = await this.options.loadDictionary();
            if (this.worker !== worker) return;
            worker.postMessage({ kind: 'words', words: this.words });
            worker.postMessage({ kind: 'load', ...files }, [files.affix, files.dictionary]);
        } catch (error) {
            this.fail(worker, SPELL_CLIENT_TEXTS.dictionaryMissing(describeError(error)));
        }
    }

    private receive(source: SpellWorkerLike, response: SpellResponse): void {
        if (this.worker !== source) return;
        if (response.kind === 'check') this.deliverCheck(response.id, response.errors);
        else if (response.kind === 'suggest') this.deliverSuggestions(response.id, response.suggestions);
        else if (response.kind === 'failed') this.handleFailure(source, response);
    }

    private deliverCheck(id: number, errors: readonly SpellRange[]): void {
        const pending = this.pendingChecks.get(id);
        this.pendingChecks.delete(id);
        if (pending === undefined || this.latestByDoc.get(pending.docId) !== id) return;
        pending.listener(errors);
    }

    private deliverSuggestions(id: number, suggestions: readonly string[]): void {
        this.pendingSuggestions.get(id)?.(suggestions);
        this.pendingSuggestions.delete(id);
    }

    private handleFailure(source: SpellWorkerLike, response: Extract<SpellResponse, { kind: 'failed' }>): void {
        if (response.fatal) {
            this.fail(source, response.message);
            return;
        }
        if (response.id === null) return;
        this.pendingChecks.delete(response.id);
        this.deliverSuggestions(response.id, []);
    }

    private fail(source: SpellWorkerLike, detail: string): void {
        if (this.worker !== source || this.disposed) return;
        this.stopWorker();
        this.markUnavailable(detail);
    }

    private markUnavailable(detail: string): void {
        if (this.unavailable) return;
        this.unavailable = true;
        this.options.onUnavailable?.(SPELL_CLIENT_TEXTS.unavailable(detail));
    }

    private stopWorker(): void {
        this.worker?.terminate();
        this.worker = null;
        this.pendingChecks.clear();
        this.latestByDoc.clear();
        for (const resolve of this.pendingSuggestions.values()) resolve([]);
        this.pendingSuggestions.clear();
    }
}
