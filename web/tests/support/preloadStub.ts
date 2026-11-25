import { buildRendererApi } from '../../src/shared/apiBuilder';
import type {
    BuildIssue,
    ToolsInfo,
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
    RecoveryDiskState,
    RecoveryItem,
    SyncTexBackwardResult,
    SyncTexForwardResult,
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
    /** Zustand der Plattendatei, den `recovery:list` für alle angebotenen Sicherungen meldet (Standard `unchanged`) */
    setRecoveryDiskState(state: RecoveryDiskState): void;
    /**
     * Alle Sicherungen, die `recovery:save` gespeichert hat (auch die aus einem früheren Lauf mit demselben
     * `--user-data-dir`, die noch nicht verworfen sind); Text und Ziel
     */
    recoveryBackups(): { path: string; text: string }[];
    /** Schickt ein Ereignis wie der Main (z. B. `app:closeRequested` beim Schließen des Fensters) */
    emit(event: EventChannel, payload: unknown): void;
    /**
     * Schaltet ein kleines Beispielprojekt ein (`project:open`, `project:recent`, `dialog:openProject`, Dateitexte);
     * `extraFileCount` legt zusätzlich so viele Dateien in den Ordner `viele/` (für die Virtualisierung).
     */
    installSampleProject(extraFileCount?: number): void;
    /** Fügt dem Beispielprojekt eine Datei hinzu (relativer Pfad mit `/`); der Baum ändert sich beim nächsten `project:open` */
    addProjectFile(relativePath: string, text: string): void;
    /** Werkzeuge, die `tools:detect` meldet (Standard: latexmk fehlt); die Aufrufe stehen in `calls()` */
    setTools(tools: ToolsInfo): void;
    /**
     * Bericht und Ergebnis des nächsten `build:start`: Der Stub sendet `build:status` (running), dann `build:finished`
     * (und `build:status` idle). `ok` fehlt: Erfolg, wenn der Bericht keinen Fehler enthält.
     */
    setBuildResult(report: BuildIssue[], options?: { ok?: boolean; durationMs?: number }): void;
    /** `true`: Ein Build bleibt im Zustand `running`, bis `finishBuild()` oder `build:cancel` ihn beendet */
    holdBuilds(hold: boolean): void;
    /** Beendet einen gehaltenen Build regulär */
    finishBuild(): void;
    /** Legt ein PDF ab, das `pdf:open` für diesen Pfad liefert (Bytes als Base64); `null` entfernt es (dann `notFound`) */
    setPdf(path: string, base64: string | null): void;
    /** Lässt `pdf:open` mit diesem Fehler antworten (z. B. unvollständiges PDF); `null` schaltet es wieder aus */
    failPdf(kind: GeneralErrorKind | null, message?: string): void;
    /**
     * Antworten von `synctex:forward` und `synctex:backward` für alle folgenden Anfragen (Standard: beide `null` wie
     * ohne geladene Daten); die Anfragen selbst stehen in `calls()`. `synctex:ready` schickt der Test mit `emit`.
     */
    setSyncTeX(forward: SyncTexForwardResult | null, backward: SyncTexBackwardResult | null): void;
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

    /** Anzeigename einer Datei (Dialog-Datei: Name der Kennung), sonst der letzte Pfadteil */
    displayNameOf(target: string): string {
        return this.files.get(target)?.grant.name ?? baseName(target);
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

// ---------- Sicherung ungespeicherten Texts (W2-14) ----------

const RECOVERY_STORAGE_KEY = 'latexeditor-stub-recovery';

interface StoredBackup {
    path: string;
    name: string;
    text: string;
    savedAt: number;
}

/** `localStorage` des Fensters überlebt einen Neustart mit demselben `--user-data-dir` (simulierter Absturz) */
function recoveryStorage(): Storage | null {
    try {
        return (globalThis as { localStorage?: Storage }).localStorage ?? null;
    } catch {
        return null;
    }
}

interface StoredRecovery {
    backups: StoredBackup[];
    diskState: RecoveryDiskState;
}

function loadStoredRecovery(): StoredRecovery {
    try {
        const raw = recoveryStorage()?.getItem(RECOVERY_STORAGE_KEY);
        if (raw !== null && raw !== undefined) return JSON.parse(raw) as StoredRecovery;
    } catch {
        // unlesbarer Speicher: wie leer
    }
    return { backups: [], diskState: 'unchanged' };
}

/**
 * Wie der Main: Sicherungen früherer Läufe (`previous`) bietet `recovery:list` an, die des laufenden nicht; ein neues
 * Sichern derselben Datei ersetzt die alte. Der Speicher ist `localStorage`, damit ein Neustart mit demselben
 * `--user-data-dir` sie wiederfindet (simulierter Absturz); dort steht auch der Plattenzustand, den der nächste Lauf meldet.
 */
class VirtualRecovery implements Pick<StubControl, 'setRecoveryDiskState' | 'recoveryBackups'> {
    private readonly previous = new Map<string, StoredBackup>();
    private readonly current = new Map<string, StoredBackup>();
    private diskState: RecoveryDiskState;

    constructor(private readonly nameOf: (path: string) => string) {
        const stored = loadStoredRecovery();
        this.diskState = stored.diskState;
        for (const backup of stored.backups) this.previous.set(backup.path, backup);
    }

    setRecoveryDiskState(state: RecoveryDiskState): void {
        this.diskState = state;
        this.persist();
    }

    recoveryBackups(): { path: string; text: string }[] {
        return [...this.previous.values(), ...this.current.values()].map(({ path, text }) => ({ path, text }));
    }

    private persist(): void {
        try {
            const backups = [...this.previous.values(), ...this.current.values()];
            const stored: StoredRecovery = { backups, diskState: this.diskState };
            recoveryStorage()?.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(stored));
        } catch {
            // ohne Speicher bleibt die Sicherung im Speicher des Laufs
        }
    }

    readonly responders: Pick<StubResponders, 'recovery:save' | 'recovery:list' | 'recovery:delete'> = {
        'recovery:save': (entry) => {
            this.previous.delete(entry.path);
            this.current.set(entry.path, { ...entry, name: this.nameOf(entry.path) });
            this.persist();
        },
        'recovery:list': (): RecoveryItem[] =>
            [...this.previous.values()].map((backup) => ({ ...backup, diskState: this.diskState })),
        'recovery:delete': (path) => {
            this.previous.delete(path);
            this.current.delete(path);
            this.persist();
        },
    };
}

// ---------- PDF (W3-3) ----------

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

/** PDFs im Speicher je Pfad; jede Antwort ist eine frische Kopie (pdf.js darf den Speicher übernehmen) */
class VirtualPdfs implements Pick<StubControl, 'setPdf' | 'failPdf'> {
    private readonly files = new Map<string, Uint8Array>();
    private failure: { kind: GeneralErrorKind; message: string } | null = null;

    setPdf(path: string, base64: string | null): void {
        if (base64 === null) this.files.delete(path);
        else this.files.set(path, base64ToBytes(base64));
    }

    failPdf(kind: GeneralErrorKind | null, message = 'PDF ist unvollständig (Stub)'): void {
        this.failure = kind === null ? null : { kind, message };
    }

    readonly responders: Pick<StubResponders, 'pdf:open'> = {
        'pdf:open': (path) => {
            if (this.failure !== null) throw new IpcFailure(this.failure);
            const bytes = this.files.get(path);
            if (bytes === undefined) throw new IpcFailure({ kind: 'notFound', message: `PDF nicht gefunden: ${path}` });
            return { kind: 'bytes', bytes: bytes.slice() };
        },
    };
}

// ---------- SyncTeX (W3-5) ----------

/** Feste Antworten der beiden SyncTeX-Kanäle (der Stub hat keinen Index) */
class VirtualSyncTeX implements Pick<StubControl, 'setSyncTeX'> {
    private forward: SyncTexForwardResult | null = null;
    private backward: SyncTexBackwardResult | null = null;

    setSyncTeX(forward: SyncTexForwardResult | null, backward: SyncTexBackwardResult | null): void {
        this.forward = forward;
        this.backward = backward;
    }

    readonly responders: Pick<StubResponders, 'synctex:forward' | 'synctex:backward'> = {
        'synctex:forward': () => this.forward,
        'synctex:backward': () => this.backward,
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

// ---------- Build (W2-12) ----------

const BUILD_DEFAULT_DURATION_MS = 3200;
const STUB_PDF = `${STUB_ROOT}/main.pdf`;

/** Spielt den Ablauf des Mains nach: running → finished (→ idle); ein zweiter Start während des Laufs wird `queued` */
class VirtualBuild {
    private report: BuildIssue[] = [];
    private ok: boolean | undefined;
    private durationMs = BUILD_DEFAULT_DURATION_MS;
    private holds = false;
    private isActive = false;
    tools: ToolsInfo = { latexmk: null, git: null, synctexRef: null, distro: null, problems: [] };

    constructor(private readonly emit: (event: EventChannel, payload: unknown) => void) {}

    setResult(report: BuildIssue[], options: { ok?: boolean; durationMs?: number } = {}): void {
        this.report = report;
        this.ok = options.ok;
        this.durationMs = options.durationMs ?? BUILD_DEFAULT_DURATION_MS;
    }

    hold(hold: boolean): void {
        this.holds = hold;
    }

    start(): void {
        if (this.isActive) {
            this.emit('build:status', { state: 'queued', startedAt: Date.now() });
            return;
        }
        this.isActive = true;
        this.emit('build:status', { state: 'running', startedAt: Date.now() });
        if (!this.holds) setTimeout(() => this.finish(false), 0);
    }

    cancel(): void {
        if (!this.isActive) return;
        this.emit('build:status', { state: 'cancelling', startedAt: Date.now() });
        this.finish(true);
    }

    finish(cancelled: boolean): void {
        if (!this.isActive) return;
        this.isActive = false;
        const ok = !cancelled && (this.ok ?? !this.report.some((issue) => issue.severity === 'error'));
        this.emit('build:finished', {
            ok,
            cancelled,
            report: cancelled ? [] : this.report,
            pdfPath: cancelled ? null : STUB_PDF,
            durationMs: this.durationMs,
        });
        this.emit('build:status', { state: 'idle', startedAt: null });
    }
}

export function createPreloadStub(overrides: Partial<StubResponders> = {}): PreloadStub {
    const virtualFiles = new VirtualFiles();
    const virtualTabMemory = new VirtualTabMemory();
    const virtualRecovery = new VirtualRecovery((path) => virtualFiles.displayNameOf(path));
    const virtualPdfs = new VirtualPdfs();
    const virtualSyncTeX = new VirtualSyncTeX();
    const listeners = new Map<EventChannel, Set<AnyListener>>();
    const virtualBuild = new VirtualBuild((event, payload) => emitEvent(listeners, event, payload));
    const responders: Record<string, unknown> = {
        ...DEFAULT_STUB_RESPONSES,
        ...virtualFiles.responders,
        ...virtualTabMemory.responders,
        ...virtualRecovery.responders,
        ...virtualPdfs.responders,
        ...virtualSyncTeX.responders,
        'tools:detect': () => virtualBuild.tools,
        'build:start': () => virtualBuild.start(),
        'build:cancel': () => virtualBuild.cancel(),
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
        setRecoveryDiskState: (state) => virtualRecovery.setRecoveryDiskState(state),
        recoveryBackups: () => virtualRecovery.recoveryBackups(),
        emit: (event, payload) => emitEvent(listeners, event, payload),
        installSampleProject,
        addProjectFile: (relativePath, text) => sampleProject?.addFile(relativePath, text),
        setTools: (tools) => {
            virtualBuild.tools = tools;
        },
        setBuildResult: (report, options) => virtualBuild.setResult(report, options),
        holdBuilds: (hold) => virtualBuild.hold(hold),
        finishBuild: () => virtualBuild.finish(false),
        setPdf: (path, base64) => virtualPdfs.setPdf(path, base64),
        failPdf: (kind, message) => virtualPdfs.failPdf(kind, message),
        setSyncTeX: (forward, backward) => virtualSyncTeX.setSyncTeX(forward, backward),
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
