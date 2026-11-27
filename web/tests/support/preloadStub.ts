import { buildRendererApi } from '../../src/shared/apiBuilder';
import type {
    BuildIssue,
    ToolsInfo,
    EventChannel,
    FsChangeKind,
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
import { copyName, newFileName, renamedFileName, assertValidFileName } from '../../src/shared/core/fileNames';
import { isValidUserWord, MAX_USER_WORDS } from '../../src/shared/core/spelling/userWords';

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
    /**
     * Einträge des Beispielprojekts (relative Pfade, Ordner mit `/` am Ende), sortiert; `fs:create/rename/move/duplicate/
     * trash/restore` ändern sie wie der Main (W2-9)
     */
    projectEntries(): string[];
    /** Aktueller Text einer Datei des Beispielprojekts (relativer Pfad) oder `null` */
    projectFileText(relativePath: string): string | null;
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
    /**
     * W2-13: ändert eine Datei „außerhalb der App“ (neuer Text, eigener Hash) und schickt `fs:changed` wie der Main.
     * Danach antwortet `fs:writeText` mit erwartetem Hash nur bei diesem Hash, sonst mit `conflict`.
     */
    changeFileExternally(path: string, text: string): void;
    /** W2-13: löscht eine Datei „außerhalb der App“ (`fs:readText` meldet `notFound`) und schickt `fs:changed` */
    deleteFileExternally(path: string): void;
    /** W7-2: Benutzerwörterbuch, das `spell:words` liefert und `spell:addWord` ergänzt (wie der Main, nur im Speicher) */
    spellWords(): string[];
    setSpellWords(words: string[]): void;
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
    'git:status': () => ({ branch: null, commit: null, upstream: null, ahead: 0, behind: 0, entries: [], stagedOutsideProject: 0 }),
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
    'bib:append': (bibPath) => ({ path: bibPath, hash: STUB_HASH, mtime: STUB_TIME, created: false, undoToken: STUB_UNDO }),
    'bib:undo': nothing,
    'pdf:open': () => ({ kind: 'bytes', bytes: new Uint8Array() }),
    'spell:words': () => [],
    'spell:addWord': (word) => [word],
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
    /** Hash nach einer externen Änderung (W2-13); sonst gilt `STUB_HASH` */
    externalHash?: string;
    /** Extern gelöscht (W2-13): Lesen meldet `notFound`, Schreiben legt die Datei wieder an */
    deleted?: boolean;
}

const EXTERNAL_HASH_PREFIX = 'extern-';

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

    /** Entfernt eine Projektdatei (Umbenennen, Verschieben, Papierkorb im Stub) */
    unregisterFile(path: string): void {
        this.files.delete(path);
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

    private externalChanges = 0;

    /** W2-13: Text und Hash ändern sich wie nach dem Speichern in einem anderen Programm */
    changeExternally(path: string, text: string): void {
        this.registerFile(path, text);
        const file = this.files.get(path);
        if (file === undefined) return;
        file.deleted = false;
        file.externalHash = `${EXTERNAL_HASH_PREFIX}${++this.externalChanges}`;
    }

    /** W2-13: Datei verschwindet von der Platte */
    deleteExternally(path: string): void {
        const file = this.files.get(path);
        if (file !== undefined) file.deleted = true;
    }

    private readText(target: string): TextFile {
        const file = this.files.get(target);
        if (file?.deleted === true) throw new IpcFailure({ kind: 'notFound', message: `Datei nicht gefunden: ${target}` });
        if (file === undefined) return textFile(target);
        return { ...textFile(target, file.grant.name), text: file.text, hash: file.externalHash ?? STUB_HASH };
    }

    /** Nach einer externen Änderung wie der Main: fremder erwarteter Hash ergibt `conflict` */
    private assertWritable(file: VirtualFile | undefined, expectedHash: string | undefined): void {
        if (file?.externalHash === undefined || expectedHash === undefined || file.deleted === true) return;
        if (expectedHash !== file.externalHash) {
            throw new IpcFailure({ kind: 'conflict', message: `Die Datei wurde seit dem Laden geändert: ${file.path}` });
        }
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
                try {
                    const file = this.readText(target);
                    return { path: target, name: file.name, result: ok(file) };
                } catch (error) {
                    return { path: target, name: this.displayNameOf(target), result: fail<TextFile>(toIpcError(error)) };
                }
            }),
        'fs:writeText': (path, text, _encoding, _eol, expectedHash) => {
            if (this.writeFailure !== null) throw new IpcFailure(this.writeFailure);
            const file = this.files.get(path);
            this.assertWritable(file, expectedHash);
            if (file !== undefined) {
                file.text = text;
                file.externalHash = undefined;
                file.deleted = false;
            }
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

// ---------- Benutzerwörterbuch (W7-2) ----------

/** Wörter im Speicher; Prüfung und Obergrenze wie `main/handlers/spellHandlers.ts` */
class VirtualSpellWords implements Pick<StubControl, 'spellWords' | 'setSpellWords'> {
    private words: string[] = [];

    spellWords(): string[] {
        return [...this.words];
    }

    setSpellWords(words: string[]): void {
        this.words = [...words];
    }

    readonly responders: Pick<StubResponders, 'spell:words' | 'spell:addWord'> = {
        'spell:words': () => [...this.words],
        'spell:addWord': (word) => {
            if (!isValidUserWord(word)) throw new IpcFailure({ kind: 'invalidInput', message: 'Ungültiges Wort (Stub)' });
            if (this.words.includes(word)) return [...this.words];
            if (this.words.length >= MAX_USER_WORDS) throw new IpcFailure({ kind: 'invalidInput', message: 'Wörterbuch voll (Stub)' });
            this.words = [...this.words, word].sort((first, second) => first.localeCompare(second, 'de'));
            return [...this.words];
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

function addFolderChain(root: MutableFolder, relative: string): MutableFolder {
    const parts = relative.split('/');
    let folder = root;
    parts.forEach((part, depth) => {
        folder = folderIn(folder, part, `${STUB_ROOT}/${parts.slice(0, depth + 1).join('/')}`);
    });
    return folder;
}

function buildSampleTree(files: readonly string[], folders: readonly string[] = []): DirectoryNode {
    const root: MutableFolder = { kind: 'directory', name: PROJECT_GRANT.name, path: STUB_ROOT, children: [] };
    for (const folder of folders) addFolderChain(root, folder);
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

/** Beispielprojekt im Speicher: Dateiliste (Texte in `VirtualFiles`) und leere Ordner, daraus Baum und `ProjectInfo` */
class SampleProject {
    readonly files = new Set<string>();
    readonly folders = new Set<string>();

    constructor(readonly virtualFiles: VirtualFiles, extraFileCount: number) {
        for (const [relative, text] of Object.entries(SAMPLE_FILES)) this.addFile(relative, text);
        for (let index = 1; index <= extraFileCount; index++) {
            this.addFile(`${EXTRA_FOLDER}/datei-${String(index).padStart(EXTRA_NAME_DIGITS, '0')}.txt`, '');
        }
    }

    addFile(relative: string, text: string): void {
        this.files.add(relative);
        this.virtualFiles.registerFile(`${STUB_ROOT}/${relative}`, text);
    }

    removeFile(relative: string): void {
        this.files.delete(relative);
        this.virtualFiles.unregisterFile(`${STUB_ROOT}/${relative}`);
    }

    textOf(relative: string): string | null {
        return this.files.has(relative) ? this.virtualFiles.writtenText(`${STUB_ROOT}/${relative}`) ?? '' : null;
    }

    entries(): string[] {
        return [...this.files, ...[...this.folders].map((folder) => `${folder}/`)].sort();
    }

    info(): ProjectInfo {
        return { root: STUB_ROOT, mainFile: `${STUB_ROOT}/main.tex`, tree: buildSampleTree([...this.files], [...this.folders]) };
    }
}

// ---------- Dateiaktionen im Beispielprojekt (W2-9) ----------

/** Stand eines Eintrags samt Inhalt (für Papierkorb und Wiederherstellen) */
interface EntrySnapshot {
    readonly files: readonly (readonly [string, string])[];
    readonly folders: readonly string[];
}

type StubUndoRecord =
    | { readonly kind: 'created'; readonly relative: string }
    | { readonly kind: 'trashed'; readonly relative: string; readonly snapshot: EntrySnapshot }
    | { readonly kind: 'relocated'; readonly from: string; readonly to: string };

const STUB_PLATFORM = { windows: false } as const;

function relativeOf(path: string): string {
    if (path === STUB_ROOT) return '';
    if (!path.startsWith(`${STUB_ROOT}/`)) throw new IpcFailure({ kind: 'forbiddenPath', message: `Nicht im Projekt (Stub): ${path}` });
    return path.slice(STUB_ROOT.length + 1);
}

function under(relative: string, base: string): boolean {
    return relative === base || relative.startsWith(`${base}/`);
}

function joinRelative(directory: string, name: string): string {
    return directory === '' ? name : `${directory}/${name}`;
}

function parentRelative(relative: string): string {
    const cut = relative.lastIndexOf('/');
    return cut < 0 ? '' : relative.slice(0, cut);
}

/** Spielt `main/fsOps.ts` auf dem Beispielprojekt nach: dieselben Namensregeln, Kennungen mit Gegenschritt */
class VirtualFileOps {
    private readonly records = new Map<string, StubUndoRecord>();
    private nextToken = 1;

    constructor(private readonly project: () => SampleProject | null) {}

    private requireProject(): SampleProject {
        const project = this.project();
        if (project === null) throw new IpcFailure({ kind: 'notFound', message: 'Kein Beispielprojekt (Stub)' });
        return project;
    }

    private exists(relative: string): boolean {
        const project = this.requireProject();
        return project.files.has(relative) || project.folders.has(relative) ||
            [...project.files].some((file) => file.startsWith(`${relative}/`));
    }

    private isDirectory(relative: string): boolean {
        return relative === '' || (this.exists(relative) && !this.requireProject().files.has(relative));
    }

    private assertFree(relative: string): void {
        if (this.exists(relative)) {
            throw new IpcFailure({ kind: 'alreadyExists', message: `„${baseName(relative)}“ existiert an dieser Stelle bereits.` });
        }
    }

    private assertExists(relative: string): void {
        if (relative === '' || !this.exists(relative)) {
            throw new IpcFailure({ kind: 'notFound', message: `„${baseName(relative)}“ wurde nicht gefunden.` });
        }
    }

    private register(record: StubUndoRecord): string {
        const token = `stub-undo-${this.nextToken++}`;
        this.records.set(token, record);
        return token;
    }

    private snapshot(relative: string): EntrySnapshot {
        const project = this.requireProject();
        const files = [...project.files].filter((file) => under(file, relative)).map((file) => [file, project.textOf(file) ?? ''] as const);
        const folders = [...project.folders].filter((folder) => under(folder, relative));
        return { files, folders: this.isDirectory(relative) ? [...new Set([relative, ...folders])] : folders };
    }

    private remove(relative: string): EntrySnapshot {
        const project = this.requireProject();
        const snapshot = this.snapshot(relative);
        for (const [file] of snapshot.files) project.removeFile(file);
        for (const folder of snapshot.folders) project.folders.delete(folder);
        return snapshot;
    }

    private place(snapshot: EntrySnapshot, from: string, to: string): void {
        const project = this.requireProject();
        const map = (path: string): string => to + path.slice(from.length);
        for (const folder of snapshot.folders) project.folders.add(map(folder));
        for (const [file, text] of snapshot.files) project.addFile(map(file), text);
    }

    private relocate(from: string, to: string): void {
        this.assertExists(from);
        if (from.toLowerCase() !== to.toLowerCase()) this.assertFree(to);
        this.place(this.remove(from), from, to);
    }

    private relocated(from: string, to: string) {
        if (from !== to) this.relocate(from, to);
        return { path: `${STUB_ROOT}/${to}`, undoToken: this.register({ kind: 'relocated', from, to }) };
    }

    create(parentDir: string, rawName: string, kind: 'file' | 'directory') {
        const parent = relativeOf(parentDir);
        const name = kind === 'file' ? newFileName(rawName, STUB_PLATFORM) : assertValidFileName(rawName, STUB_PLATFORM);
        const relative = joinRelative(parent, name);
        this.assertFree(relative);
        if (kind === 'file') this.requireProject().addFile(relative, '');
        else this.requireProject().folders.add(relative);
        return { path: `${STUB_ROOT}/${relative}`, undoToken: this.register({ kind: 'created', relative }) };
    }

    rename(path: string, rawName: string) {
        const from = relativeOf(path);
        this.assertExists(from);
        const name = renamedFileName(rawName, baseName(from), this.isDirectory(from), STUB_PLATFORM);
        return this.relocated(from, joinRelative(parentRelative(from), name));
    }

    move(path: string, targetDir: string) {
        const from = relativeOf(path);
        const directory = relativeOf(targetDir);
        if (under(directory, from)) throw new IpcFailure({ kind: 'invalidInput', message: 'Ein Ordner kann nicht in sich selbst verschoben werden.' });
        return this.relocated(from, joinRelative(directory, baseName(from)));
    }

    duplicate(path: string) {
        const source = relativeOf(path);
        this.assertExists(source);
        const name = baseName(source);
        const dot = name.lastIndexOf('.');
        const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
        let number = 1;
        while (this.exists(joinRelative(parentRelative(source), copyName(stem, extension, number)))) number++;
        const target = joinRelative(parentRelative(source), copyName(stem, extension, number));
        this.place(this.snapshot(source), source, target);
        return { path: `${STUB_ROOT}/${target}`, undoToken: this.register({ kind: 'created', relative: target }) };
    }

    trash(path: string): string {
        const relative = relativeOf(path);
        this.assertExists(relative);
        return this.register({ kind: 'trashed', relative, snapshot: this.remove(relative) });
    }

    restore(token: string): string {
        const record = this.records.get(token);
        if (record === undefined) throw new IpcFailure({ kind: 'notFound', message: 'Dieser Schritt ist unbekannt oder schon zurückgenommen.' });
        this.records.delete(token);
        if (record.kind === 'created') return this.register({ kind: 'trashed', relative: record.relative, snapshot: this.remove(record.relative) });
        if (record.kind === 'trashed') {
            if (this.exists(record.relative)) {
                throw new IpcFailure({ kind: 'conflict', message: `„${baseName(record.relative)}“ existiert schon; nichts wurde überschrieben.` });
            }
            this.place(record.snapshot, record.relative, record.relative);
            return this.register({ kind: 'created', relative: record.relative });
        }
        this.relocate(record.to, record.from);
        return this.register({ kind: 'relocated', from: record.to, to: record.from });
    }

    readonly responders: Pick<StubResponders, 'fs:create' | 'fs:rename' | 'fs:move' | 'fs:duplicate' | 'fs:trash' | 'fs:restore'> = {
        'fs:create': (parentDir, name, kind) => this.create(parentDir, name, kind),
        'fs:rename': (path, newName) => this.rename(path, newName),
        'fs:move': (path, targetDir) => this.move(path, targetDir),
        'fs:duplicate': (path) => this.duplicate(path),
        'fs:trash': (path) => this.trash(path),
        'fs:restore': (token) => this.restore(token),
    };
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
    const virtualSpellWords = new VirtualSpellWords();
    const listeners = new Map<EventChannel, Set<AnyListener>>();
    const virtualBuild = new VirtualBuild((event, payload) => emitEvent(listeners, event, payload));
    const responders: Record<string, unknown> = {
        ...DEFAULT_STUB_RESPONSES,
        ...virtualFiles.responders,
        ...virtualTabMemory.responders,
        ...virtualRecovery.responders,
        ...virtualPdfs.responders,
        ...virtualSyncTeX.responders,
        ...virtualSpellWords.responders,
        'tools:detect': () => virtualBuild.tools,
        'build:start': () => virtualBuild.start(),
        'build:cancel': () => virtualBuild.cancel(),
        ...overrides,
    };
    let sampleProject: SampleProject | null = null;
    const installSampleProject = (extraFileCount = 0): void => {
        sampleProject = new SampleProject(virtualFiles, extraFileCount);
        Object.assign(responders, new VirtualFileOps(() => sampleProject).responders);
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
        projectEntries: () => sampleProject?.entries() ?? [],
        projectFileText: (relativePath) => sampleProject?.textOf(relativePath) ?? null,
        setTools: (tools) => {
            virtualBuild.tools = tools;
        },
        setBuildResult: (report, options) => virtualBuild.setResult(report, options),
        holdBuilds: (hold) => virtualBuild.hold(hold),
        finishBuild: () => virtualBuild.finish(false),
        setPdf: (path, base64) => virtualPdfs.setPdf(path, base64),
        failPdf: (kind, message) => virtualPdfs.failPdf(kind, message),
        setSyncTeX: (forward, backward) => virtualSyncTeX.setSyncTeX(forward, backward),
        changeFileExternally: (path, text) => {
            virtualFiles.changeExternally(path, text);
            emitEvent(listeners, 'fs:changed', externalChange(path, 'changed'));
        },
        deleteFileExternally: (path) => {
            virtualFiles.deleteExternally(path);
            emitEvent(listeners, 'fs:changed', externalChange(path, 'deleted'));
        },
        spellWords: () => virtualSpellWords.spellWords(),
        setSpellWords: (words) => virtualSpellWords.setSpellWords(words),
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

/** `fs:changed` wie der Main nach einer Änderung außerhalb der App (W2-13) */
function externalChange(path: string, kind: FsChangeKind): IpcEvents['fs:changed'] {
    return { paths: [path], kinds: [kind], treeChanged: kind === 'deleted', gitChanged: false };
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
