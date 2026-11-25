// IPC-Vertrag zwischen Main, Preload und Renderer (PLAN-WEBUI.md §2).
// Konventionen für alle Kanäle:
// - Pfade sind absolute, native Pfade des Betriebssystems (Windows `C:\…`, UNC `\\server\share\…`).
//   Der Main-Prozess normalisiert und prüft jeden Pfad (`main/paths.ts`): Pfade vom Renderer gelten nur
//   innerhalb des aktuell geöffneten Projekts, das der Main selbst kennt.
// - Pfade außerhalb des Projekts (Dialoge, „Zuletzt geöffnet“, Drag & Drop) sieht der Renderer nie als
//   Pfad, sondern als Kennung (`GrantId`), die nur der Main vergeben hat (`main/grants.ts`).
// - Offsets und Spalten zählen UTF-16-Codeeinheiten (wie JavaScript-Strings), 0-basiert.
// - Zeilennummern sind 1-basiert (wie SyncTeX, Log-Meldungen und die Anzeige im Editor).
// - Zeiten sind Millisekunden seit 1970 (`Date.now()`), Koordinaten im PDF sind Punkte, Ursprung oben links.

export type AbsolutePath = string;
/** Ziel einer Dateioperation: absoluter Pfad im Projekt ODER `GrantId` einer gewährten Einzeldatei (Dialog); Ergebnisse geben das Ziel unverändert zurück */
export type FileTarget = string;
export type RelativePath = string;
export type Utf16Offset = number;
export type LineNumber = number;
export type EpochMillis = number;
export type ContentHash = string;
export type UndoToken = string;
export type SearchId = string;
// Vom Main vergebene Kennung für einen Pfad außerhalb des Projekts (Dialog, Zuletzt geöffnet, Drop).
export type GrantId = string;

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

// ---------- Fehler ----------

export type GeneralErrorKind =
    | 'notImplemented'
    | 'invalidInput'
    | 'forbiddenSender'
    | 'forbiddenPath'
    | 'notFound'
    | 'alreadyExists'
    | 'conflict'
    | 'io'
    | 'internal';

export type GitErrorKind =
    | 'gitMissing'
    | 'notARepository'
    | 'nothingToCommit'
    | 'nonFastForward'
    | 'noUpstream'
    | 'authRequired'
    | 'network'
    | 'gitFailed';

export interface GeneralError {
    readonly kind: GeneralErrorKind;
    readonly message: string;
}

export interface GitError {
    readonly kind: GitErrorKind;
    readonly message: string;
}

export type IpcError = GeneralError | GitError;

export type IpcResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: IpcError };

// ---------- Werkzeuge, Projekt, Dialoge ----------

export type TexDistribution = 'miktex' | 'texlive' | 'mactex' | 'unknown';
export type ToolName = 'latexmk' | 'perl' | 'git' | 'synctex';

export interface ToolProblem {
    readonly tool: ToolName;
    readonly message: string;
}

export interface ToolsInfo {
    readonly latexmk: AbsolutePath | null;
    readonly git: AbsolutePath | null;
    readonly synctexRef: AbsolutePath | null;
    readonly distro: TexDistribution | null;
    readonly problems: readonly ToolProblem[];
}

export interface FileNode {
    readonly kind: 'file';
    readonly name: string;
    readonly path: AbsolutePath;
    /** Erzeugte Datei (Build-Ausgabe wie `.aux`, `.log`); der Baum zeigt sie gedämpft */
    readonly isBuildFile?: boolean;
}

export interface DirectoryNode {
    readonly kind: 'directory';
    readonly name: string;
    readonly path: AbsolutePath;
    readonly children: readonly TreeNode[];
}

export type TreeNode = FileNode | DirectoryNode;

export interface ProjectInfo {
    readonly root: AbsolutePath;
    readonly mainFile: AbsolutePath | null;
    readonly tree: DirectoryNode;
    /** Der Baum wurde wegen der Obergrenze an Einträgen gekürzt */
    readonly truncated?: boolean;
}

// Pfad, den der Main gewährt hat: der Renderer bekommt nur Kennung und Anzeigenamen.
export interface GrantedPath {
    readonly grantId: GrantId;
    readonly name: string;
}

export interface RecentProject extends GrantedPath {
    readonly openedAt: EpochMillis;
}

// Ergebnis von Drag & Drop: abgelehnte Dateien (Endung, Größe, Netzwerkpfad) nur mit Namen.
export interface DropGrantResult {
    readonly granted: readonly GrantedPath[];
    readonly rejected: readonly string[];
}

export interface FileFilter {
    readonly name: string;
    readonly extensions: readonly string[];
}

export interface PickFilesOptions {
    readonly title?: string;
    readonly filters?: readonly FileFilter[];
    readonly multiple?: boolean;
}

export interface SaveAsOptions {
    readonly title?: string;
    readonly defaultPath?: AbsolutePath;
    readonly filters?: readonly FileFilter[];
}

// ---------- Dateien ----------

export type TextEncoding = 'utf8' | 'latin1';
export type LineEnding = 'lf' | 'crlf';
export type CreateKind = 'file' | 'directory';

// `path` ist das Ziel, das der Renderer geschickt hat (Schlüssel der Sitzung, bei Dialog-Dateien die `GrantId`);
// `name` ist der Anzeigename mit Endung (Tab-Titel, Statusleiste, Sprache), nie ein Pfad.
export interface TextFile {
    readonly path: FileTarget;
    readonly name: string;
    readonly text: string;
    readonly encoding: TextEncoding;
    readonly eol: LineEnding;
    readonly hash: ContentHash;
    readonly mtime: EpochMillis;
}

export interface ReadManyItem {
    readonly path: FileTarget;
    readonly name: string;
    readonly result: IpcResult<TextFile>;
}

export interface WriteResult {
    readonly hash: ContentHash;
    readonly mtime: EpochMillis;
}

export interface FileOpResult {
    readonly path: AbsolutePath;
    readonly undoToken: UndoToken;
}

export interface ImportResult {
    readonly paths: readonly AbsolutePath[];
    readonly undoToken: UndoToken;
}

// ---------- Suche, Build, SyncTeX ----------

export interface SearchOptions {
    readonly caseSensitive: boolean;
    readonly wholeWord: boolean;
    readonly regex: boolean;
}

export interface SearchHit {
    readonly path: AbsolutePath;
    readonly line: LineNumber;
    readonly column: Utf16Offset;
    readonly length: number;
    readonly preview: string;
}

export type LatexEngine = 'pdflatex' | 'xelatex' | 'lualatex';

export interface BuildOptions {
    readonly engine: LatexEngine;
}

export type BuildState = 'idle' | 'queued' | 'running' | 'cancelling';
export type IssueSeverity = 'error' | 'warning' | 'badBox' | 'info';

export interface BuildIssue {
    readonly severity: IssueSeverity;
    readonly message: string;
    readonly file: AbsolutePath | null;
    readonly line: LineNumber | null;
}

export interface PdfRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface SyncTexForwardResult {
    readonly page: number;
    readonly rects: readonly PdfRect[];
}

export interface SyncTexBackwardResult {
    readonly file: AbsolutePath;
    readonly line: LineNumber;
}

// ---------- Git ----------

export type GitFileState = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';

export interface GitStatusEntry {
    readonly path: AbsolutePath;
    readonly originalPath: AbsolutePath | null;
    readonly staged: GitFileState | null;
    readonly unstaged: GitFileState | null;
}

export interface GitStatus {
    readonly branch: string | null;
    readonly upstream: string | null;
    readonly ahead: number;
    readonly behind: number;
    readonly entries: readonly GitStatusEntry[];
}

export type GitRevision = 'HEAD' | 'index';

export interface GitBlobSpec {
    readonly path: AbsolutePath;
    readonly revision: GitRevision;
}

export interface GitCommitResult {
    readonly hash: string;
}

export interface GitPullResult {
    readonly updated: boolean;
}

export interface GitBranches {
    readonly current: string | null;
    readonly local: readonly string[];
}

export type GitResetAction = 'restore' | 'delete';

export interface GitResetPlanEntry {
    readonly path: AbsolutePath;
    readonly action: GitResetAction;
}

export interface GitResetPlan {
    readonly planId: string;
    readonly entries: readonly GitResetPlanEntry[];
}

export interface GitResetResult {
    readonly undoToken: UndoToken;
}

// ---------- App-Daten, Bilder, PDF ----------

// Gesicherter, ungespeicherter Text einer Datei (W2-14). `path` ist das Ziel wie bei `fs:*` (Projektpfad oder
// `GrantId`); den echten Pfad, das Projekt und den Hash der Plattendatei hält der Main (`main/recovery.ts`).
export interface RecoveryEntry {
    readonly path: FileTarget;
    readonly text: string;
    readonly savedAt: EpochMillis;
}

/** Plattendatei beim Auflisten gegenüber dem Stand beim Sichern: unverändert, anders oder nicht mehr da */
export type RecoveryDiskState = 'unchanged' | 'changed' | 'missing';

/** Angebotene Sicherung eines früheren App-Laufs: `path` ist ein Projektpfad oder eine frisch gewährte `GrantId` */
export interface RecoveryItem extends RecoveryEntry {
    readonly name: string;
    readonly diskState: RecoveryDiskState;
}

export type SettingsData = { readonly [key: string]: JsonValue };

// Tab-Gedächtnis je Projekt (W2-4): Der Main legt es im App-Datenordner ab und kennt das Projekt selbst.
// Pfade sind relativ zur Projektwurzel und haben immer `/` als Trenner; Auswahl und Scrollposition je Tab.
export const TAB_MEMORY_VERSION = 1;

export interface TabMemoryEntry {
    readonly path: RelativePath;
    /** Vorschau-Tab (kursiv) statt festem Tab */
    readonly isPreview: boolean;
    readonly anchor: Utf16Offset;
    readonly head: Utf16Offset;
    /** Pixel von oben im Editor */
    readonly scrollTop: number;
}

export interface TabMemory {
    readonly version: typeof TAB_MEMORY_VERSION;
    /** Tabs in Leistenreihenfolge */
    readonly tabs: readonly TabMemoryEntry[];
    readonly active: RelativePath | null;
}

export interface ImageImportResult {
    readonly relPath: RelativePath;
    readonly reused: boolean;
}

/** PDF-Transport laut Spike S9: nur Bytes über IPC (kein eigenes Protokoll) */
export type PdfSource = { readonly kind: 'bytes'; readonly bytes: Uint8Array };

// ---------- Anfragen (invoke → handle) ----------

interface Request<Args extends readonly unknown[], Result> {
    readonly args: Args;
    readonly result: Result;
}

export interface IpcRequests {
    'app:ping': Request<[], 'pong'>;
    // Antwort auf `app:closeRequested`: Der Renderer hat Ungespeichertes geklärt, der Main schließt das Fenster.
    'app:confirmClose': Request<[], void>;
    'tools:detect': Request<[], ToolsInfo>;
    'project:open': Request<[projectGrant: GrantId], ProjectInfo>;
    'project:recent': Request<[], RecentProject[]>;
    'dialog:openProject': Request<[], GrantedPath | null>;
    'dialog:pickFiles': Request<[options: PickFilesOptions], GrantedPath[] | null>;
    'dialog:saveAs': Request<[options: SaveAsOptions], GrantedPath | null>;
    // Nur für den Preload (`dragDrop.grantFiles`), nicht als `window.api.drop.grant` sichtbar.
    'drop:grant': Request<[paths: AbsolutePath[]], DropGrantResult>;
    'fs:readText': Request<[path: FileTarget], TextFile>;
    'fs:readMany': Request<[paths: FileTarget[]], ReadManyItem[]>;
    'fs:writeText': Request<
        [path: FileTarget, text: string, encoding: TextEncoding, eol: LineEnding, expectedHash?: ContentHash],
        WriteResult
    >;
    'fs:create': Request<[parentDir: AbsolutePath, name: string, kind: CreateKind], FileOpResult>;
    'fs:rename': Request<[path: AbsolutePath, newName: string], FileOpResult>;
    'fs:move': Request<[path: AbsolutePath, targetDir: AbsolutePath], FileOpResult>;
    'fs:duplicate': Request<[path: AbsolutePath], FileOpResult>;
    'fs:import': Request<[sourceGrants: GrantId[], targetDir: AbsolutePath], ImportResult>;
    'fs:trash': Request<[path: AbsolutePath], UndoToken>;
    'fs:restore': Request<[undoToken: UndoToken], UndoToken>;
    'search:project': Request<[query: string, options: SearchOptions, excludePaths: AbsolutePath[]], SearchId>;
    'build:start': Request<[mainFile: AbsolutePath, options: BuildOptions], void>;
    'build:cancel': Request<[], void>;
    'build:clean': Request<[mainFile: AbsolutePath], void>;
    'synctex:forward': Request<[file: AbsolutePath, line: LineNumber], SyncTexForwardResult | null>;
    'synctex:backward': Request<[page: number, x: number, y: number], SyncTexBackwardResult | null>;
    'git:status': Request<[], GitStatus>;
    'git:blob': Request<[spec: GitBlobSpec], string | null>;
    'git:stage': Request<[paths: AbsolutePath[]], void>;
    'git:unstage': Request<[paths: AbsolutePath[]], void>;
    'git:commit': Request<[message: string], GitCommitResult>;
    'git:fetch': Request<[], void>;
    'git:pullFf': Request<[], GitPullResult>;
    'git:push': Request<[], void>;
    'git:branches': Request<[], GitBranches>;
    'git:checkout': Request<[branch: string], void>;
    'git:create': Request<[branch: string], void>;
    'git:resetPlan': Request<[], GitResetPlan>;
    'git:resetApply': Request<[planId: string], GitResetResult>;
    'marks:load': Request<[], string | null>;
    'marks:save': Request<[json: string], void>;
    'recovery:save': Request<[entry: RecoveryEntry], void>;
    'recovery:list': Request<[], RecoveryItem[]>;
    'recovery:delete': Request<[path: FileTarget], void>;
    'settings:get': Request<[], SettingsData>;
    'settings:set': Request<[key: string, value: JsonValue], void>;
    // Beide gehören zum aktuellen Projekt des Main; ohne Projekt liefert `memoryLoad` `null`, `memorySave` einen Fehler.
    'tabs:memoryLoad': Request<[], TabMemory | null>;
    'tabs:memorySave': Request<[memory: TabMemory], void>;
    'image:import': Request<[sourceGrant: GrantId, imagesDir: AbsolutePath], ImageImportResult>;
    'pdf:open': Request<[path: AbsolutePath], PdfSource>;
}

export type RequestChannel = keyof IpcRequests;
export type RequestArgs<C extends RequestChannel> = IpcRequests[C]['args'];
export type RequestResult<C extends RequestChannel> = IpcRequests[C]['result'];

// ---------- Ereignisse (webContents.send → Abonnement) ----------

export type FsChangeKind = 'created' | 'changed' | 'deleted';
export type GitChangeReason = 'head' | 'index' | 'refs';

export interface IpcEvents {
    'fs:changed': {
        readonly paths: readonly AbsolutePath[];
        readonly kinds: readonly FsChangeKind[];
        readonly treeChanged: boolean;
        readonly gitChanged: boolean;
    };
    'build:status': { readonly state: BuildState; readonly startedAt: EpochMillis | null };
    'build:finished': {
        readonly ok: boolean;
        readonly cancelled: boolean;
        readonly report: readonly BuildIssue[];
        readonly pdfPath: AbsolutePath | null;
        readonly durationMs: number;
    };
    'synctex:ready': { readonly pdfMtime: EpochMillis };
    'git:changed': { readonly reasons: readonly GitChangeReason[] };
    'search:hits': { readonly searchId: SearchId; readonly hits: readonly SearchHit[]; readonly done: boolean };
    'menu:command': { readonly commandId: string };
    'app:closeRequested': null;
}

export type EventChannel = keyof IpcEvents;

// ---------- Allow-Listen (Laufzeit) ----------
// Als Record, damit der Compiler fehlende oder überzählige Namen meldet.

const REQUEST_CHANNEL_TABLE: Readonly<Record<RequestChannel, true>> = {
    'app:ping': true,
    'app:confirmClose': true,
    'tools:detect': true,
    'project:open': true,
    'project:recent': true,
    'dialog:openProject': true,
    'dialog:pickFiles': true,
    'dialog:saveAs': true,
    'drop:grant': true,
    'fs:readText': true,
    'fs:readMany': true,
    'fs:writeText': true,
    'fs:create': true,
    'fs:rename': true,
    'fs:move': true,
    'fs:duplicate': true,
    'fs:import': true,
    'fs:trash': true,
    'fs:restore': true,
    'search:project': true,
    'build:start': true,
    'build:cancel': true,
    'build:clean': true,
    'synctex:forward': true,
    'synctex:backward': true,
    'git:status': true,
    'git:blob': true,
    'git:stage': true,
    'git:unstage': true,
    'git:commit': true,
    'git:fetch': true,
    'git:pullFf': true,
    'git:push': true,
    'git:branches': true,
    'git:checkout': true,
    'git:create': true,
    'git:resetPlan': true,
    'git:resetApply': true,
    'marks:load': true,
    'marks:save': true,
    'recovery:save': true,
    'recovery:list': true,
    'recovery:delete': true,
    'settings:get': true,
    'settings:set': true,
    'tabs:memoryLoad': true,
    'tabs:memorySave': true,
    'image:import': true,
    'pdf:open': true,
};

const EVENT_CHANNEL_TABLE: Readonly<Record<EventChannel, true>> = {
    'fs:changed': true,
    'build:status': true,
    'build:finished': true,
    'synctex:ready': true,
    'git:changed': true,
    'search:hits': true,
    'menu:command': true,
    'app:closeRequested': true,
};

// Kanäle, die nur der Preload selbst aufruft (nicht Teil von `window.api.<bereich>`). `drop:grant`
// bekommt nur Pfade aus `webUtils.getPathForFile`, die der Renderer nicht fälschen kann.
export type PreloadOnlyChannel = 'drop:grant';
export type RendererChannel = Exclude<RequestChannel, PreloadOnlyChannel>;

const PRELOAD_ONLY_CHANNEL_TABLE: Readonly<Record<PreloadOnlyChannel, true>> = {
    'drop:grant': true,
};

export const REQUEST_CHANNELS = Object.freeze(Object.keys(REQUEST_CHANNEL_TABLE) as RequestChannel[]);
export const EVENT_CHANNELS = Object.freeze(Object.keys(EVENT_CHANNEL_TABLE) as EventChannel[]);

export function isRequestChannel(name: unknown): name is RequestChannel {
    return typeof name === 'string' && Object.hasOwn(REQUEST_CHANNEL_TABLE, name);
}

export function isEventChannel(name: unknown): name is EventChannel {
    return typeof name === 'string' && Object.hasOwn(EVENT_CHANNEL_TABLE, name);
}

export function isPreloadOnlyChannel(name: unknown): name is PreloadOnlyChannel {
    return typeof name === 'string' && Object.hasOwn(PRELOAD_ONLY_CHANNEL_TABLE, name);
}

export const RENDERER_CHANNELS = Object.freeze(
    REQUEST_CHANNELS.filter((channel): channel is RendererChannel => !isPreloadOnlyChannel(channel)),
);

const GIT_ERROR_KINDS: Readonly<Record<GitErrorKind, true>> = {
    gitMissing: true,
    notARepository: true,
    nothingToCommit: true,
    nonFastForward: true,
    noUpstream: true,
    authRequired: true,
    network: true,
    gitFailed: true,
};

export function isGitError(error: IpcError): error is GitError {
    return Object.hasOwn(GIT_ERROR_KINDS, error.kind);
}

// ---------- Renderer-API `window.api.<bereich>.<methode>` ----------

const CHANNEL_SEPARATOR = ':';

type AreaOf<C extends string> = C extends `${infer Area}:${string}` ? Area : never;
type MethodOf<C extends string> = C extends `${string}:${infer Method}` ? Method : never;
export type ApiArea = AreaOf<RendererChannel>;

export type ApiMethod<C extends RequestChannel> = (...args: RequestArgs<C>) => Promise<IpcResult<RequestResult<C>>>;

export type RequestApi = {
    readonly [A in ApiArea]: {
        readonly [C in RendererChannel as AreaOf<C> extends A ? MethodOf<C> : never]: ApiMethod<C>;
    };
};

export type Unsubscribe = () => void;
export type EventListener<E extends EventChannel> = (payload: IpcEvents[E]) => void;

export interface EventApi {
    on<E extends EventChannel>(event: E, listener: EventListener<E>): Unsubscribe;
}

export interface DragDropApi {
    // Meldet abgelegte Dateien dem Main; der Renderer sieht ihre Pfade nie. Dateien ohne Pfad
    // (z. B. im Renderer erzeugte `File`-Objekte) werden übergangen.
    grantFiles(files: readonly File[]): Promise<IpcResult<DropGrantResult>>;
}

export type RendererApi = RequestApi & {
    readonly events: EventApi;
    readonly dragDrop: DragDropApi;
};

export function splitChannel(channel: RequestChannel): { area: ApiArea; method: string } {
    const separatorIndex = channel.indexOf(CHANNEL_SEPARATOR);
    return {
        area: channel.slice(0, separatorIndex) as ApiArea,
        method: channel.slice(separatorIndex + 1),
    };
}
