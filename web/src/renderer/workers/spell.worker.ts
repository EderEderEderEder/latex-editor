import nspell from 'nspell';
import { SpellService } from '../../shared/core/spelling/spellService';
import type { SpellRequest, SpellResponse } from '../../shared/core/spelling/spellProtocol';

// Dünne Hülle um `SpellService` (W7-2): nspell mit `dictionary-de-at`, Aufbau (~0,5 s) hier statt im UI-Thread.
// Ein Fehler in einer Anfrage wird als `failed` gemeldet; der Worker läuft weiter.

interface SpellWorkerScope {
    onmessage: ((event: MessageEvent<SpellRequest>) => void) | null;
    postMessage(message: SpellResponse): void;
}

const scope = self as unknown as SpellWorkerScope;
const service = new SpellService((affix, dictionary) => nspell(affix, dictionary));

function failure(request: SpellRequest, error: unknown): SpellResponse {
    const message = error instanceof Error ? error.message : String(error);
    const id = request.kind === 'check' || request.kind === 'suggest' ? request.id : null;
    return { kind: 'failed', id, message, fatal: request.kind === 'load' };
}

scope.onmessage = (event) => {
    const request = event.data;
    try {
        const response = service.handle(request);
        if (response !== null) scope.postMessage(response);
    } catch (error) {
        scope.postMessage(failure(request, error));
    }
};
