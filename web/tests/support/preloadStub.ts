import { buildRendererApi } from '../../src/shared/apiBuilder';
import type {
    EventChannel,
    IpcEvents,
    IpcResult,
    RendererApi,
    RequestArgs,
    RequestChannel,
    RequestResult,
    TextFile,
    Unsubscribe,
} from '../../src/shared/contract';
import { fail, ok, toIpcError } from '../../src/shared/ipcResult';

// Bildet `window.api` vollständig nach (gleiche Form wie der Preload, über `buildRendererApi`),
// damit Renderer-Code ohne Electron testbar ist. Antworten sind gefälschte, feste Daten und lassen
// sich je Kanal ersetzen; ein geworfener Fehler wird wie im Main zu `{ ok: false, error }`.

export type StubResponder<C extends RequestChannel> = (
    ...args: RequestArgs<C>
) => RequestResult<C> | Promise<RequestResult<C>>;

export type StubResponders = { [C in RequestChannel]: StubResponder<C> };

export interface StubCall {
    readonly channel: RequestChannel;
    readonly args: readonly unknown[];
}

export interface PreloadStub {
    readonly api: RendererApi;
    readonly calls: readonly StubCall[];
    respond<C extends RequestChannel>(channel: C, responder: StubResponder<C>): void;
    emit<E extends EventChannel>(event: E, payload: IpcEvents[E]): void;
    listenerCount(event: EventChannel): number;
    setPathForFile(file: File, path: string): void;
}

const STUB_ROOT = '/stub/projekt';
const STUB_MAIN = `${STUB_ROOT}/main.tex`;
const STUB_HASH = '0'.repeat(64);
const STUB_TIME = 0;
const STUB_UNDO = 'stub-undo';
const PATH_SEPARATOR = /[\\/]/;

const STUB_TREE = {
    kind: 'directory',
    name: 'projekt',
    path: STUB_ROOT,
    children: [{ kind: 'file', name: 'main.tex', path: STUB_MAIN }],
} as const;

const fileOp = (path: string) => ({ path, undoToken: STUB_UNDO });
const textFile = (path: string): TextFile => ({
    path,
    text: '',
    encoding: 'utf8',
    eol: 'lf',
    hash: STUB_HASH,
    mtime: STUB_TIME,
});
const nothing = (): void => undefined;
const baseName = (path: string): string => path.split(PATH_SEPARATOR).at(-1) ?? path;
const stubGrant = (path: string, index: number) => ({ grantId: `stub-grant-${index}`, name: baseName(path) });

export const DEFAULT_STUB_RESPONSES: StubResponders = {
    'app:ping': () => 'pong',
    'tools:detect': () => ({ latexmk: null, git: null, synctexRef: null, distro: null, problems: [] }),
    'project:open': () => ({ root: STUB_ROOT, mainFile: STUB_MAIN, tree: STUB_TREE }),
    'project:recent': () => [],
    'dialog:openProject': () => null,
    'dialog:pickFiles': () => null,
    'dialog:saveAs': () => null,
    'drop:grant': (paths) => ({ granted: paths.map(stubGrant), rejected: [] }),
    'fs:readText': (path) => textFile(path),
    'fs:readMany': (paths) => paths.map((path) => ({ path, result: ok(textFile(path)) })),
    'fs:writeText': () => ({ hash: STUB_HASH, mtime: STUB_TIME }),
    'fs:create': (parentDir, name) => fileOp(`${parentDir}/${name}`),
    'fs:rename': (path) => fileOp(path),
    'fs:move': (path) => fileOp(path),
    'fs:duplicate': (path) => fileOp(path),
    'fs:import': (sourceGrants, targetDir) => ({
        paths: sourceGrants.map((grant) => `${targetDir}/${grant}`),
        undoToken: STUB_UNDO,
    }),
    'fs:trash': () => STUB_UNDO,
    'fs:restore': () => STUB_UNDO,
    'search:project': () => 'stub-search',
    'build:start': nothing,
    'build:cancel': nothing,
    'build:clean': nothing,
    'synctex:forward': () => null,
    'synctex:backward': () => null,
    'git:status': () => ({ branch: null, upstream: null, ahead: 0, behind: 0, entries: [] }),
    'git:blob': () => null,
    'git:stage': nothing,
    'git:unstage': nothing,
    'git:commit': () => ({ hash: STUB_HASH }),
    'git:fetch': nothing,
    'git:pullFf': () => ({ updated: false }),
    'git:push': nothing,
    'git:branches': () => ({ current: null, local: [] }),
    'git:checkout': nothing,
    'git:create': nothing,
    'git:resetPlan': () => ({ planId: 'stub-plan', entries: [] }),
    'git:resetApply': () => ({ undoToken: STUB_UNDO }),
    'marks:load': () => null,
    'marks:save': nothing,
    'recovery:save': nothing,
    'recovery:list': () => [],
    'recovery:delete': nothing,
    'settings:get': () => ({}),
    'settings:set': nothing,
    'image:import': () => ({ relPath: 'images/bild.png', reused: false }),
    'pdf:open': () => ({ kind: 'bytes', bytes: new Uint8Array() }),
};

type AnyResponder = (...args: readonly unknown[]) => unknown;
type AnyListener = (payload: unknown) => void;

async function answer(responder: AnyResponder, args: readonly unknown[]): Promise<IpcResult<unknown>> {
    try {
        return ok(await responder(...args));
    } catch (error) {
        return fail(toIpcError(error));
    }
}

export function createPreloadStub(overrides: Partial<StubResponders> = {}): PreloadStub {
    const responders: Record<string, unknown> = { ...DEFAULT_STUB_RESPONSES, ...overrides };
    const calls: StubCall[] = [];
    const listeners = new Map<EventChannel, Set<AnyListener>>();
    const filePaths = new WeakMap<File, string>();
    const api = buildRendererApi({
        invoke: (channel, args) => {
            calls.push({ channel, args });
            return answer(responders[channel] as AnyResponder, args);
        },
        subscribe: (event, listener) => subscribe(listeners, event, listener),
        getPathForFile: (file) => filePaths.get(file) ?? '',
    });
    return {
        api,
        calls,
        respond: (channel, responder) => {
            responders[channel] = responder;
        },
        emit: (event, payload) => listeners.get(event)?.forEach((listener) => listener(payload)),
        listenerCount: (event) => listeners.get(event)?.size ?? 0,
        setPathForFile: (file, path) => filePaths.set(file, path),
    };
}

function subscribe(
    listeners: Map<EventChannel, Set<AnyListener>>,
    event: EventChannel,
    listener: AnyListener,
): Unsubscribe {
    const set = listeners.get(event) ?? new Set<AnyListener>();
    listeners.set(event, set);
    // Eigene Hülle je Abonnement, damit dieselbe Funktion zweimal abonniert werden kann (wie ipcRenderer.on).
    const entry: AnyListener = (payload) => listener(payload);
    set.add(entry);
    return () => {
        set.delete(entry);
    };
}
