import type { IpcResult, RendererApi } from '../../shared/contract';
import { unwrap } from '../../shared/ipcResult';

// Dünner Zugriff auf `window.api` aus dem Preload. Komponenten importieren von hier statt
// `window.api` direkt anzufassen, damit Tests den Stub (`tests/support/preloadStub.ts`) einsetzen können.

export { IpcFailure, unwrap } from '../../shared/ipcResult';

export function getApi(): RendererApi {
    return window.api;
}

// Wartet auf eine Anfrage und wirft bei Fehler eine `IpcFailure` mit dem strukturierten Fehler.
export async function expectValue<T>(request: Promise<IpcResult<T>>): Promise<T> {
    return unwrap(await request);
}
