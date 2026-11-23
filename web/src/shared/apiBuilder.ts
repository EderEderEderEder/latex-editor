import {
    type ApiArea,
    type DropGrantResult,
    type EventChannel,
    type IpcEvents,
    type IpcResult,
    type RendererApi,
    type RequestChannel,
    type Unsubscribe,
    isEventChannel,
    RENDERER_CHANNELS,
    splitChannel,
} from './contract';

// Baut `window.api` aus der Allow-Liste des Vertrags. Preload und Test-Stub nutzen dieselbe
// Funktion, damit beide genau dieselbe Form haben. Kein Electron-Import: die Verbindung zum
// Main-Prozess kommt als `ApiTransport` herein.

export interface ApiTransport {
    invoke(channel: RequestChannel, args: readonly unknown[]): Promise<IpcResult<unknown>>;
    subscribe(event: EventChannel, listener: (payload: unknown) => void): Unsubscribe;
    getPathForFile(file: File): string;
}

// Die Bereiche `events` und `dragDrop` dürfen nicht mit einem Kanalbereich zusammenfallen.
type ReservedAreaClash = Extract<ApiArea, 'events' | 'dragDrop'>;
const RESERVED_AREAS_FREE: [ReservedAreaClash] extends [never] ? true : never = true;

type MutableArea = Record<string, (...args: readonly unknown[]) => Promise<IpcResult<unknown>>>;

function buildRequestAreas(transport: ApiTransport): Record<string, MutableArea> {
    const areas: Record<string, MutableArea> = {};
    for (const channel of RENDERER_CHANNELS) {
        const { area, method } = splitChannel(channel);
        const target = (areas[area] ??= {});
        target[method] = (...args) => transport.invoke(channel, args);
    }
    return areas;
}

function subscribeChecked<E extends EventChannel>(
    transport: ApiTransport,
    event: E,
    listener: (payload: IpcEvents[E]) => void,
): Unsubscribe {
    if (!isEventChannel(event)) throw new Error(`Unbekanntes Ereignis: ${String(event)}`);
    if (typeof listener !== 'function') throw new Error('Abonnement braucht eine Funktion');
    return transport.subscribe(event, (payload) => listener(payload as IpcEvents[E]));
}

const NO_PATH = '';

// Die Pfade holt der Preload selbst (`webUtils.getPathForFile`); fehlt einer, ist die Datei nicht echt abgelegt.
function grantDroppedFiles(transport: ApiTransport, files: readonly File[]): Promise<IpcResult<DropGrantResult>> {
    const paths = Array.from(files, (file) => transport.getPathForFile(file)).filter((path) => path !== NO_PATH);
    if (paths.length === 0) return Promise.resolve({ ok: true, value: { granted: [], rejected: [] } });
    return transport.invoke('drop:grant', [paths]) as Promise<IpcResult<DropGrantResult>>;
}

export function buildRendererApi(transport: ApiTransport): RendererApi {
    const api = {
        ...buildRequestAreas(transport),
        events: {
            on: <E extends EventChannel>(event: E, listener: (payload: IpcEvents[E]) => void) =>
                subscribeChecked(transport, event, listener),
        },
        dragDrop: {
            grantFiles: (files: readonly File[]) => grantDroppedFiles(transport, files),
        },
    };
    void RESERVED_AREAS_FREE;
    // Die Form ist durch die Schleife über RENDERER_CHANNELS vollständig; der Compiler kann das
    // aus einer Schleife nicht ableiten, deshalb die Umwandlung.
    return api as unknown as RendererApi;
}
