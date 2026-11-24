import { buildRendererApi } from '../../src/shared/apiBuilder';
import type {
    EventChannel,
    IpcEvents,
    IpcResult,
    RendererApi,
    RequestArgs,
    RequestChannel,
    RequestResult,
    GeneralErrorKind,
    DirectoryNode,
    FileNode,
    GrantedPath,
    ProjectInfo,
    TabMemory,
    TreeNode,
    TextFile,
    Unsubscribe,
} from '../../src/shared/contract';
import { IpcFailure, fail, ok, toIpcError } from '../../src/shared/ipcResult';

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

/**
 * Steuerung für Playwright-Tests: hängt als `__stub` an `window.api` des Stub-Preloads (nie am echten Preload).
 * Rückgaben sind einfache Werte, damit sie über `contextBridge` kopiert werden können.
 */
export interface StubControl {
    /** Aufgezeichnete Aufrufe (Kanal und Argumente) seit dem Start oder dem letzten `clearCalls` */
    calls(): StubCall[];
    clearCalls(): void;
    /** Legt eine Datei an, die der nächste Dialog `dialog:pickFiles` liefert; `readText` kennt sie danach */
    prepareFile(name: string, text: string): void;
    /** Lässt `fs:writeText` mit diesem Fehler antworten; `null` schaltet es wieder aus */
    failWrites(kind: GeneralErrorKind | null, message?: string): void;
    /** Zuletzt geschriebener Text je Ziel (Kennung oder Pfad) */
    writtenText(path: string): string | null;
    /** Setzt das Tab-Gedächtnis, das `tabs:memoryLoad` liefert (`null` = keins) */
    setTabMemory(memory: TabMemory | null): void;
    /** Zuletzt über `tabs:memorySave` gespeichertes Tab-Gedächtnis (oder das gesetzte) */
    tabMemory(): TabMemory | null;
    /** Schickt ein Ereignis wie der Main (z. B. `app:closeRequested` beim Schließen des Fensters) */
    emit(event: EventChannel, payload: unknown): void;
    /**
     * Schaltet ein kleines Beispielprojekt ein (`project:open`, `project:recent`, `dialog:openProject`, Dateitexte);
     * `extraFileCount` legt zusätzlich so viele Dateien in den Ordner `viele/` (für die Virtualisierung).
     */
    installSampleProject(extraFileCount?: number): void;
    /** Fügt dem Beispielprojekt eine Datei hinzu (relativer Pfad mit `/`); der Baum ändert sich beim nächsten `project:open` */
    addProjectFile(relativePath: string, text: string): void;
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
const baseName = (path: string): string => path.split(PATH_SEPARATOR).at(-1) ?? path;
/** Wie der Main: `path` ist das Ziel der Anfrage, `name` der Anzeigename */
const textFile = (path: string, name = baseName(path)): TextFile => ({
    path,
    name,
    text: '',
    encoding: 'utf8',
    eol: 'lf',
    hash: STUB_HASH,
    mtime: STUB_TIME,
});
const nothing = (): void => undefined;
const stubGrant = (path: string, index: number) => ({ grantId: `stub-grant-${index}`, name: baseName(path) });

export const DEFAULT_STUB_RESPONSES: StubResponders = {
    'app:ping': () => 'pong',
    'app:confirmClose': nothing,
    'tools:detect': () => ({ latexmk: null, git: null, synctexRef: null, distro: null, problems: [] }),
    'project:open': () => ({ root: STUB_ROOT, mainFile: STUB_MAIN, tree: STUB_TREE }),
    'project:recent': () => [],
    'dialog:openProject': () => null,
    'dialog:pickFiles': () => null,
    'dialog:saveAs': () => null,
    'drop:grant': (paths) => ({ granted: paths.map(stubGrant), rejected: [] }),
    'fs:readText': (path) => textFile(path),
    'fs:readMany': (paths) => paths.map((path) => ({ path, name: baseName(path), result: ok(textFile(path)) })),
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
    'tabs:memoryLoad': () => null,
    'tabs:memorySave': nothing,
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

interface VirtualFile {
    readonly grant: GrantedPath;
    readonly path: string;
    text: string;
}

const VIRTUAL_FILE_DIRECTORY = `${STUB_ROOT}/`;

/** Kleine Platte im Speicher für die Abläufe Öffnen und Speichern (Kennung oder Pfad führen zur Datei) */
class VirtualFiles implements Pick<StubControl, 'prepareFile' | 'failWrites' | 'writtenText'> {
    private readonly files = new Map<string, VirtualFile>();
    private pending: VirtualFile[] = [];
    private writeFailure: { kind: GeneralErrorKind; message: string } | null = null;

    /** Derselbe Name ergibt dieselbe Kennung (wie `GrantStore.grant` im Main) */
    prepareFile(name: string, text: string): void {
        const path = `${VIRTUAL_FILE_DIRECTORY}${name}`;
        const existing = this.files.get(path);
        const file: VirtualFile = existing ?? { grant: stubGrant(path, this.files.size), path, text };
        file.text = text;
        this.files.set(file.grant.grantId, file);
        this.files.set(path, file);
        this.pending.push(file);
    }

    /** Datei, die nur über ihren Pfad lesbar ist (Projektdatei); kommt nie aus dem Dialog */
    registerFile(path: string, text: string): void {
        const existing = this.files.get(path);
        if (existing !== undefined) {
            existing.text = text;
            return;
        }
        this.files.set(path, { grant: { grantId: `stub-file-${path}`, name: baseName(path) }, path, text });
    }

    failWrites(kind: GeneralErrorKind | null, message = 'Schreiben abgelehnt (Stub)'): void {
        this.writeFailure = kind === null ? null : { kind, message };
    }

    writtenText(path: string): string | null {
        return this.files.get(path)?.text ?? null;
    }

    private readText(target: string): TextFile {
        const file = this.files.get(target);
        return file === undefined ? textFile(target) : { ...textFile(target, file.grant.name), text: file.text };
    }

    readonly responders: Pick<StubResponders, 'dialog:pickFiles' | 'fs:readText' | 'fs:readMany' | 'fs:writeText'> = {
        'dialog:pickFiles': () => {
            const picked = this.pending.map((file) => file.grant);
            this.pending = [];
            return picked.length === 0 ? null : picked;
        },
        'fs:readText': (target) => this.readText(target),
        'fs:readMany': (targets) =>
            targets.map((target) => {
                const file = this.readText(target);
                return { path: target, name: file.name, result: ok(file) };
            }),
        'fs:writeText': (path, text) => {
            if (this.writeFailure !== null) throw new IpcFailure(this.writeFailure);
            const file = this.files.get(path);
            if (file !== undefined) file.text = text;
            return { hash: STUB_HASH, mtime: STUB_TIME };
        },
    };
}

/** Ein Tab-Gedächtnis im Speicher: `tabs:memorySave` merkt es, `tabs:memoryLoad` liefert es zurück */
class VirtualTabMemory implements Pick<StubControl, 'setTabMemory' | 'tabMemory'> {
    private memory: TabMemory | null = null;

    setTabMemory(memory: TabMemory | null): void {
        this.memory = memory;
    }

    tabMemory(): TabMemory | null {
        return this.memory;
    }

    readonly responders: Pick<StubResponders, 'tabs:memoryLoad' | 'tabs:memorySave'> = {
        'tabs:memoryLoad': () => this.memory,
        'tabs:memorySave': (memory) => {
            this.memory = memory;
        },
    };
}

// ---------- Beispielprojekt (W2-3) ----------

const PROJECT_GRANT: GrantedPath = { grantId: 'stub-project-grant', name: 'projekt' };
const BUILD_FILE_EXTENSIONS: readonly string[] = ['.aux', '.log'];
const EXTRA_FOLDER = 'viele';
const EXTRA_NAME_DIGITS = 4;

const SAMPLE_FILES: Readonly<Record<string, string>> = {
    'main.tex': '\\chapter{Einleitung}\n\\input{kapitel/einleitung}\n\\input{kapitel/fazit}\n',
    'kapitel/einleitung.tex': '\\section{Motivation}\nText\n\\section{Ziel}\nText\n',
    'kapitel/fazit.tex': '\\section{Ergebnis}\nText\n',
    'literatur.bib': '@book{a,\n}\n',
    'bilder/logo.png': '',
    'main.aux': '',
};

interface MutableFolder {
    kind: 'directory';
    name: string;
    path: string;
    children: (MutableFolder | FileNode)[];
}

function compareNodes(a: TreeNode | MutableFolder, b: TreeNode | MutableFolder): number {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
}

function folderIn(parent: MutableFolder, name: string, path: string): MutableFolder {
    const existing = parent.children.find((child) => child.path === path);
    if (existing?.kind === 'directory') return existing;
    const created: MutableFolder = { kind: 'directory', name, path, children: [] };
    parent.children.push(created);
    return created;
}

function sortTree(folder: MutableFolder): void {
    folder.children.sort(compareNodes);
    for (const child of folder.children) if (child.kind === 'directory') sortTree(child);
}

function buildSampleTree(files: readonly string[]): DirectoryNode {
    const root: MutableFolder = { kind: 'directory', name: PROJECT_GRANT.name, path: STUB_ROOT, children: [] };
    for (const relative of files) {
        const parts = relative.split('/');
        let folder = root;
        parts.slice(0, -1).forEach((part, depth) => {
            folder = folderIn(folder, part, `${STUB_ROOT}/${parts.slice(0, depth + 1).join('/')}`);
        });
        const name = parts.at(-1) ?? relative;
        const path = `${STUB_ROOT}/${relative}`;
        const isBuildFile = BUILD_FILE_EXTENSIONS.some((extension) => name.endsWith(extension));
        folder.children.push(isBuildFile ? { kind: 'file', name, path, isBuildFile } : { kind: 'file', name, path });
    }
    sortTree(root);
    return root;
}

/** Beispielprojekt im Speicher: Dateiliste mit Texten, daraus Baum und `ProjectInfo` */
class SampleProject {
    private readonly texts = new Map<string, string>();

    constructor(private readonly virtualFiles: VirtualFiles, extraFileCount: number) {
        for (const [relative, text] of Object.entries(SAMPLE_FILES)) this.addFile(relative, text);
        for (let index = 1; index <= extraFileCount; index++) {
            this.addFile(`${EXTRA_FOLDER}/datei-${String(index).padStart(EXTRA_NAME_DIGITS, '0')}.txt`, '');
        }
    }

    addFile(relative: string, text: string): void {
        this.texts.set(relative, text);
        this.virtualFiles.registerFile(`${STUB_ROOT}/${relative}`, text);
    }

    info(): ProjectInfo {
        return { root: STUB_ROOT, mainFile: `${STUB_ROOT}/main.tex`, tree: buildSampleTree([...this.texts.keys()]) };
    }
}

export function createPreloadStub(overrides: Partial<StubResponders> = {}): PreloadStub {
    const virtualFiles = new VirtualFiles();
    const virtualTabMemory = new VirtualTabMemory();
    const responders: Record<string, unknown> = {
        ...DEFAULT_STUB_RESPONSES,
        ...virtualFiles.responders,
        ...virtualTabMemory.responders,
        ...overrides,
    };
    let sampleProject: SampleProject | null = null;
    const installSampleProject = (extraFileCount = 0): void => {
        sampleProject = new SampleProject(virtualFiles, extraFileCount);
        responders['dialog:openProject'] = () => PROJECT_GRANT;
        responders['project:recent'] = () => [{ ...PROJECT_GRANT, openedAt: STUB_TIME }];
        responders['project:open'] = (grantId: string) => {
            if (grantId !== PROJECT_GRANT.grantId || sampleProject === null) {
                throw new IpcFailure({ kind: 'notFound', message: 'Unbekannte Projektkennung (Stub)' });
            }
            return sampleProject.info();
        };
    };
    const calls: StubCall[] = [];
    const listeners = new Map<EventChannel, Set<AnyListener>>();
    const filePaths = new WeakMap<File, string>();
    const baseApi = buildRendererApi({
        invoke: (channel, args) => {
            calls.push({ channel, args });
            return answer(responders[channel] as AnyResponder, args);
        },
        subscribe: (event, listener) => subscribe(listeners, event, listener),
        getPathForFile: (file) => filePaths.get(file) ?? '',
    });
    const stubControl: StubControl = {
        prepareFile: (name, text) => virtualFiles.prepareFile(name, text),
        failWrites: (kind, message) => virtualFiles.failWrites(kind, message),
        writtenText: (path) => virtualFiles.writtenText(path),
        setTabMemory: (memory) => virtualTabMemory.setTabMemory(memory),
        tabMemory: () => virtualTabMemory.tabMemory(),
        emit: (event, payload) => emitEvent(listeners, event, payload),
        installSampleProject,
        addProjectFile: (relativePath, text) => sampleProject?.addFile(relativePath, text),
        calls: () => calls.map((call) => ({ channel: call.channel, args: [...call.args] })),
        clearCalls: () => {
            calls.length = 0;
        },
    };
    const api = Object.assign({}, baseApi, { __stub: stubControl }) as RendererApi;
    return {
        api,
        calls,
        respond: (channel, responder) => {
            responders[channel] = responder;
        },
        emit: (event, payload) => emitEvent(listeners, event, payload),
        listenerCount: (event) => listeners.get(event)?.size ?? 0,
        setPathForFile: (file, path) => filePaths.set(file, path),
    };
}

function emitEvent(listeners: Map<EventChannel, Set<AnyListener>>, event: EventChannel, payload: unknown): void {
    listeners.get(event)?.forEach((listener) => listener(payload));
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
