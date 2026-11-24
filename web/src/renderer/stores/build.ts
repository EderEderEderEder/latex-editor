// Build-Store (W2-12): Zustand des Builds (aus `build:status` und `build:finished`), Ergebnis und Meldungen des letzten
// Laufs, Werkzeuge aus `tools:detect`, Filter und Auswahl der Meldungsliste. Hält nie Text; gesetzt wird nur bei
// echter Änderung. `compile()` speichert zuerst alle ungespeicherten Dateien des Projekts (`saveAll`) und startet nur,
// wenn das gelang. Den Rest (Warteschlange, Abbruch, Zusammenfassen) erledigt der Main.
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import type {
    AbsolutePath, BuildIssue, BuildState, EpochMillis, IpcEvents, LatexEngine, RendererApi, ToolsInfo, Unsubscribe,
} from '../../shared/contract';
import {
    DEFAULT_ISSUE_FILTER, EMPTY_ISSUE_COUNTS, countIssues, groupIssues, issueInDirection, issuesByFile, navigableEntries,
    sameIssues,
} from '../app/issueNavigation';
import type { IssueCounts, IssueDirection, IssueEntry, IssueFilter, IssueFilterKey } from '../app/issueNavigation';
import type { StatusMessage } from './status';

export type BuildResult = IpcEvents['build:finished'];
export type BuildApi = Pick<RendererApi, 'build' | 'tools' | 'events'>;
export type CompileOutcome = 'started' | 'noMainFile' | 'saveFailed' | 'toolsMissing' | 'startFailed';

/** Der Vertrag kennt keine Einstellung für die Engine; latexmk bekommt immer pdflatex */
export const DEFAULT_ENGINE: LatexEngine = 'pdflatex';

export const BUILD_TEXTS = {
    noMainFile: 'Kompilieren braucht ein geöffnetes Projekt mit Hauptdatei.',
    saveFailed: 'Nicht kompiliert: Eine Datei ließ sich nicht speichern.',
    toolsMissing: 'Nicht kompiliert: latexmk wurde nicht gefunden.',
    startFailed: (detail: string) => `Kompilieren nicht gestartet: ${detail}`,
    cleaned: 'Hilfsdateien gelöscht.',
    cleanFailed: (detail: string) => `Hilfsdateien löschen fehlgeschlagen: ${detail}`,
} as const;

type ResultFields = Pick<BuildStoreState, 'issues' | 'fileIssues' | 'counts' | 'selectedKey'>;

export interface BuildStoreState {
    readonly status: BuildState;
    readonly startedAt: EpochMillis | null;
    /** Läuft gerade das Speichern vor dem Build */
    readonly isSaving: boolean;
    readonly isCleaning: boolean;
    /** Letzter Lauf, auch ein abgebrochener */
    readonly lastResult: BuildResult | null;
    /** Meldungen des letzten nicht abgebrochenen Laufs (nach Abbruch bleiben die davor) */
    readonly issues: readonly BuildIssue[];
    readonly fileIssues: ReadonlyMap<string, readonly BuildIssue[]>;
    readonly counts: IssueCounts;
    readonly tools: ToolsInfo | null;
    /** Meldung des Mains, wenn `build:start` abgelehnt wurde */
    readonly startFailure: string | null;
    readonly filter: IssueFilter;
    readonly selectedKey: string | null;
    /** Abonniert `build:status` und `build:finished`, holt die Werkzeuge; der Rückgabewert meldet wieder ab */
    connect(): Unsubscribe;
    compile(): Promise<CompileOutcome>;
    cancel(): Promise<void>;
    clean(): Promise<boolean>;
    refreshTools(): Promise<void>;
    /** Projektwechsel: Ergebnis und Meldungen des alten Projekts verwerfen */
    clearResults(): void;
    setFilter(key: IssueFilterKey, isOn: boolean): void;
    select(key: string | null): void;
    /** Wählt die nächste/vorherige Meldung der gefilterten Liste (nur Dateien im Projekt); `null` ohne Treffer */
    navigate(direction: IssueDirection): IssueEntry | null;
}

export type BuildStore = StoreApi<BuildStoreState>;

export interface BuildStoreDeps {
    readonly api: () => BuildApi;
    readonly mainFile: () => AbsolutePath | null;
    readonly root: () => AbsolutePath | null;
    /** Speichert alle ungespeicherten Dateien des Projekts; `false`, wenn etwas offen blieb (Meldung ist schon gezeigt) */
    readonly saveAll: () => Promise<boolean>;
    readonly report: (message: StatusMessage) => void;
}

type SetState = BuildStore['setState'];
type GetState = BuildStore['getState'];

function sameTools(a: ToolsInfo | null, b: ToolsInfo): boolean {
    if (a === null) return false;
    return a.latexmk === b.latexmk && a.git === b.git && a.synctexRef === b.synctexRef && a.distro === b.distro &&
        a.problems.length === b.problems.length &&
        a.problems.every((problem, index) => problem.tool === b.problems[index]?.tool && problem.message === b.problems[index]?.message);
}

function sameResult(a: BuildResult | null, b: BuildResult): boolean {
    return a !== null && a.ok === b.ok && a.cancelled === b.cancelled && a.pdfPath === b.pdfPath &&
        a.durationMs === b.durationMs && sameIssues(a.report, b.report);
}

/** Neue Meldungen nur, wenn der Lauf nicht abgebrochen wurde und sich der Bericht geändert hat; sonst `null` */
function changedIssues(state: BuildStoreState, result: BuildResult): ResultFields | null {
    if (result.cancelled || sameIssues(state.issues, result.report)) return null;
    return {
        issues: result.report,
        fileIssues: issuesByFile(result.report),
        counts: countIssues(result.report),
        selectedKey: null,
    };
}

function applyFinished(set: SetState, get: GetState, result: BuildResult): void {
    const state = get();
    const issues = changedIssues(state, result);
    const resultChanged = !sameResult(state.lastResult, result);
    if (issues === null && !resultChanged && state.startFailure === null) return;
    set({ ...(issues ?? {}), lastResult: resultChanged ? result : state.lastResult, startFailure: null });
}

function applyStatus(set: SetState, get: GetState, event: IpcEvents['build:status']): void {
    const state = get();
    const startFailure = event.state === 'idle' ? state.startFailure : null;
    if (state.status === event.state && state.startedAt === event.startedAt && state.startFailure === startFailure) return;
    set({ status: event.state, startedAt: event.startedAt, startFailure });
}

function setFlag(set: SetState, get: GetState, flag: 'isSaving' | 'isCleaning', value: boolean): void {
    if (get()[flag] === value) return;
    set(flag === 'isSaving' ? { isSaving: value } : { isCleaning: value });
}

const INITIAL_STATE = {
    status: 'idle',
    startedAt: null,
    isSaving: false,
    isCleaning: false,
    lastResult: null,
    issues: [],
    fileIssues: new Map(),
    counts: EMPTY_ISSUE_COUNTS,
    tools: null,
    startFailure: null,
    filter: DEFAULT_ISSUE_FILTER,
    selectedKey: null,
} as const satisfies Partial<BuildStoreState>;

type Actions = Omit<BuildStoreState, keyof typeof INITIAL_STATE>;

async function refreshToolsOf(deps: BuildStoreDeps, set: SetState, get: GetState): Promise<void> {
    const result = await deps.api().tools.detect();
    if (result.ok && !sameTools(get().tools, result.value)) set({ tools: result.value });
}

async function startBuild(deps: BuildStoreDeps, set: SetState, get: GetState): Promise<CompileOutcome> {
    setFlag(set, get, 'isSaving', true);
    const saved = await deps.saveAll().finally(() => setFlag(set, get, 'isSaving', false));
    if (!saved) return reportOutcome(deps, 'saveFailed');
    const mainFile = deps.mainFile();
    if (mainFile === null) return reportOutcome(deps, 'noMainFile');
    if (!(await toolsAvailable(get, () => refreshToolsOf(deps, set, get)))) return reportOutcome(deps, 'toolsMissing');
    const started = await deps.api().build.start(mainFile, { engine: DEFAULT_ENGINE });
    if (started.ok) return 'started';
    set({ startFailure: started.error.message });
    return reportOutcome(deps, 'startFailed', started.error.message);
}

/** Zwei gleichzeitige Aufrufe teilen sich einen Lauf (Strg+B während des Speicherns) */
function compileAction(deps: BuildStoreDeps, set: SetState, get: GetState): () => Promise<CompileOutcome> {
    let running: Promise<CompileOutcome> | null = null;
    return () => {
        if (deps.mainFile() === null) return Promise.resolve(reportOutcome(deps, 'noMainFile'));
        running ??= startBuild(deps, set, get).finally(() => {
            running = null;
        });
        return running;
    };
}

async function cancelBuild(deps: BuildStoreDeps, get: GetState): Promise<void> {
    if (get().status === 'idle') return;
    const result = await deps.api().build.cancel();
    if (!result.ok) deps.report({ text: result.error.message, kind: 'error' });
}

function issueViewActions(set: SetState, get: GetState): Pick<Actions, 'setFilter' | 'select'> {
    return {
        setFilter: (key, isOn) => {
            if (get().filter[key] !== isOn) set({ filter: { ...get().filter, [key]: isOn } });
        },
        select: (key) => {
            if (get().selectedKey !== key) set({ selectedKey: key });
        },
    };
}

export function createBuildStore(deps: BuildStoreDeps): BuildStore {
    return createStore<BuildStoreState>()((set, get) => ({
        ...INITIAL_STATE,
        ...issueViewActions(set, get),
        connect: () => connectEvents(deps, set, get, () => refreshToolsOf(deps, set, get)),
        compile: compileAction(deps, set, get),
        cancel: () => cancelBuild(deps, get),
        clean: () => cleanBuild(deps, set, get),
        refreshTools: () => refreshToolsOf(deps, set, get),
        clearResults: () => clearResults(set, get),
        navigate: (direction) => navigateIssues(deps, set, get, direction),
    }));
}

function clearResults(set: SetState, get: GetState): void {
    const state = get();
    if (state.lastResult === null && state.issues.length === 0 && state.startFailure === null) return;
    set({
        lastResult: null, issues: [], fileIssues: new Map(), counts: EMPTY_ISSUE_COUNTS, selectedKey: null, startFailure: null,
    });
}

function reportOutcome(deps: BuildStoreDeps, outcome: Exclude<CompileOutcome, 'started'>, detail = ''): CompileOutcome {
    const texts: Record<typeof outcome, string> = {
        noMainFile: BUILD_TEXTS.noMainFile,
        saveFailed: BUILD_TEXTS.saveFailed,
        toolsMissing: BUILD_TEXTS.toolsMissing,
        startFailed: BUILD_TEXTS.startFailed(detail),
    };
    deps.report({ text: texts[outcome], kind: outcome === 'noMainFile' ? 'info' : 'error' });
    return outcome;
}

/** Fehlt latexmk laut letzter Erkennung, wird neu gesucht (nach einer Installation ohne Neustart der App) */
async function toolsAvailable(get: GetState, refreshTools: () => Promise<void>): Promise<boolean> {
    if (get().tools?.latexmk === null) await refreshTools();
    return get().tools?.latexmk !== null;
}

function connectEvents(
    deps: BuildStoreDeps, set: SetState, get: GetState, refreshTools: () => Promise<void>,
): Unsubscribe {
    const { events } = deps.api();
    const stops = [
        events.on('build:status', (event) => applyStatus(set, get, event)),
        events.on('build:finished', (result) => applyFinished(set, get, result)),
    ];
    void refreshTools();
    return () => stops.forEach((stop) => stop());
}

async function cleanBuild(deps: BuildStoreDeps, set: SetState, get: GetState): Promise<boolean> {
    const mainFile = deps.mainFile();
    if (mainFile === null) {
        reportOutcome(deps, 'noMainFile');
        return false;
    }
    setFlag(set, get, 'isCleaning', true);
    try {
        const result = await deps.api().build.clean(mainFile);
        deps.report(result.ok
            ? { text: BUILD_TEXTS.cleaned, kind: 'info' }
            : { text: BUILD_TEXTS.cleanFailed(result.error.message), kind: 'error' });
        return result.ok;
    } finally {
        setFlag(set, get, 'isCleaning', false);
    }
}

function navigateIssues(deps: BuildStoreDeps, set: SetState, get: GetState, direction: IssueDirection): IssueEntry | null {
    const { issues, filter, selectedKey } = get();
    const entries = navigableEntries(groupIssues(issues, filter, deps.root()));
    const target = issueInDirection(entries, selectedKey, direction);
    if (target !== null && target.key !== selectedKey) set({ selectedKey: target.key });
    return target;
}

/** `window.api` ohne DOM-Typen (der Node-tsconfig der Tests kennt `window` nicht) */
export function defaultBuildApi(): BuildApi {
    return (globalThis as unknown as { api: RendererApi }).api;
}
