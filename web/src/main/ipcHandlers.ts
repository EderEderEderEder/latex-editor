import { REQUEST_CHANNELS, type RequestArgs, type RequestChannel, type RequestResult } from '../shared/contract';
import { IpcFailure } from '../shared/ipcResult';

// Handler-Register: jeder Kanal des Vertrags hat genau einen Handler. Fachhandler
// (Dateisystem, Build, Git …) ersetzen die Platzhalter in späteren Aufgaben.

export type IpcHandler<C extends RequestChannel> = (...args: RequestArgs<C>) => Promise<RequestResult<C>>;
export type IpcHandlers = { readonly [C in RequestChannel]: IpcHandler<C> };

const PING_REPLY = 'pong';

const IMPLEMENTED_HANDLERS: Partial<IpcHandlers> = {
    'app:ping': () => Promise.resolve(PING_REPLY),
};

export function notImplementedHandler(channel: RequestChannel): () => Promise<never> {
    return () =>
        Promise.reject(
            new IpcFailure({ kind: 'notImplemented', message: `„${channel}“ ist noch nicht implementiert` }),
        );
}

export function createHandlerRegistry(overrides: Partial<IpcHandlers> = {}): IpcHandlers {
    const registry: Partial<Record<RequestChannel, unknown>> = {};
    for (const channel of REQUEST_CHANNELS) {
        registry[channel] = overrides[channel] ?? IMPLEMENTED_HANDLERS[channel] ?? notImplementedHandler(channel);
    }
    // Die Schleife deckt alle Kanäle ab; der Compiler kann das nicht aus einer Schleife ableiten.
    return registry as IpcHandlers;
}
