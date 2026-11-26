// Nachrichten zwischen Messseite und Rechtschreib-Worker (Spike S8).

export interface LoadRequest {
    readonly type: 'load';
    readonly aff: string;
    readonly dic: string;
}

/** Text ab `offset` (Normalzustand des Tokenizers angenommen); geprüft werden nur Wörter im sichtbaren Bereich */
export interface CheckRequest {
    readonly type: 'check';
    readonly id: number;
    readonly text: string;
    readonly offset: number;
    readonly visibleFrom: number;
    readonly visibleTo: number;
}

export type WorkerRequest = LoadRequest | CheckRequest;

export interface CheckResponse {
    readonly type: 'result';
    readonly id: number;
    readonly errors: [number, number][];
    readonly words: number;
    readonly checkMs: number;
}

export type WorkerResponse = { readonly type: 'loaded'; readonly buildMs: number } | CheckResponse;
