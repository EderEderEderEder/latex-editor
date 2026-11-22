import type { IpcError, IpcResult } from './contract';

export function ok<T>(value: T): IpcResult<T> {
    return { ok: true, value };
}

export function fail<T = never>(error: IpcError): IpcResult<T> {
    return { ok: false, error };
}

// Trägt einen strukturierten Fehler durch `throw`, z. B. aus einem Fachhandler im Main
// oder aus `unwrap` im Renderer.
export class IpcFailure extends Error {
    readonly error: IpcError;

    constructor(error: IpcError) {
        super(error.message);
        this.name = 'IpcFailure';
        this.error = error;
    }
}

export function unwrap<T>(result: IpcResult<T>): T {
    if (result.ok) return result.value;
    throw new IpcFailure(result.error);
}

export function toIpcError(error: unknown): IpcError {
    if (error instanceof IpcFailure) return error.error;
    const detail = error instanceof Error ? error.message : String(error);
    return { kind: 'internal', message: `Interner Fehler: ${detail}` };
}
