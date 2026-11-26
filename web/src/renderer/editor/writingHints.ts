// Schreibhinweise und Wortzähler im Editor (W7-3, Vorbild: `WritingHints.swift`, `ReferenceCheckStore.swift`).
// Der Text der Sitzung wird 0,6 s nach der letzten Änderung vom Analyse-Worker geprüft (nie im UI-Thread); die Hinweise
// erscheinen als blau gepunktete Unterstreichung (`cm-writing-hint`, getrennt von den Syntaxmeldungen aus
// `diagnostics.ts`) mit dem Hinweistext als Tooltip (`title`). Dieselbe Antwort liefert die Wörter der Datei für die
// Statusleiste, auch bei ausgeschalteten Hinweisen.
//
// Aufbau wie bei der Diagnose: `writingField` hält Version, Wortzahl und Dekorationen im `EditorState` der Sitzung;
// `WritingDriver` entprellt, fragt über den geteilten `WritingHub` an und setzt Antworten ein. Der Schalter
// „Schreibhinweise anzeigen“ wirkt beim Zeichnen (`EditorView.decorations`), nicht im Zustand: Auch nicht sichtbare
// Sitzungen sind beim nächsten Anzeigen richtig.
import { EditorState, Facet, StateEffect, StateField, Transaction } from '@codemirror/state';
import type { Extension, TransactionSpec } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { languageFromPath } from '../../shared/core/language';
import type { WritingHint, WritingHintKind } from '../../shared/core/latex/writingHints';
import { useSettingsStore } from '../stores/settings';
import { ANALYSIS_DEBOUNCE_MS, AnalysisClient } from '../workers/analysisClient';
import type { AnalysisCallbacks, AnalysisTimer } from '../workers/analysisClient';
import type { WritingResult } from '../workers/analysisLogic';
import type { FeatureContext } from './extensions';

// ---------- Client und Hub ----------

/** Der Teil des `AnalysisClient`, den die Schreibprüfung braucht (Tests liefern eine Fälschung) */
export interface WritingClient {
    requestWriting(docId: string, version: number, text: string, includeHints: boolean): void;
    dispose(): void;
}

export type WritingClientFactory = (callbacks: Pick<AnalysisCallbacks, 'onWriting'>) => WritingClient;
export type WritingListener = (version: number, result: WritingResult) => void;

/** Entprellt wird in der Erweiterung, bevor der Text als Zeichenkette entsteht; der Client bekommt keine zweite Frist */
const CLIENT_DEBOUNCE_MS = 0;
/** Ohne offene Sitzung im View wird der Worker nach dieser Zeit beendet */
const IDLE_DISPOSE_MS = 30_000;

const browserTimer: AnalysisTimer = {
    set: (callback, delayMs) => setTimeout(callback, delayMs),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function createWritingClient(callbacks: Pick<AnalysisCallbacks, 'onWriting'>): WritingClient {
    return new AnalysisClient(callbacks, { debounceMs: CLIENT_DEBOUNCE_MS });
}

/**
 * Ein eigener Worker für die Schreibprüfung (die regulären Ausdrücke brauchen bei langen Texten spürbar länger als die
 * Syntaxprüfung und sollen deren Meldungen nicht aufhalten); verteilt Antworten nach `docId` an den Hörer der Sitzung.
 */
export class WritingHub {
    private client: WritingClient | null = null;
    private readonly listeners = new Map<string, WritingListener>();
    private idleHandle: unknown = undefined;

    constructor(
        private readonly createClient: WritingClientFactory = createWritingClient,
        private readonly timer: AnalysisTimer = browserTimer,
    ) {}

    /** Meldet einen Hörer für `docId` an; der Rückgabewert meldet ihn wieder ab */
    subscribe(docId: string, listener: WritingListener): () => void {
        this.cancelIdleDispose();
        this.listeners.set(docId, listener);
        return () => this.unsubscribe(docId, listener);
    }

    requestWriting(docId: string, version: number, text: string, includeHints: boolean): void {
        this.client ??= this.createClient({
            onWriting: (id, resultVersion, result) => this.listeners.get(id)?.(resultVersion, result),
        });
        this.client.requestWriting(docId, version, text, includeHints);
    }

    dispose(): void {
        this.cancelIdleDispose();
        this.listeners.clear();
        this.stopClient();
    }

    private unsubscribe(docId: string, listener: WritingListener): void {
        if (this.listeners.get(docId) !== listener) return;
        this.listeners.delete(docId);
        if (this.listeners.size > 0) return;
        this.idleHandle = this.timer.set(() => {
            this.idleHandle = undefined;
            this.stopClient();
        }, IDLE_DISPOSE_MS);
    }

    private cancelIdleDispose(): void {
        if (this.idleHandle === undefined) return;
        this.timer.clear(this.idleHandle);
        this.idleHandle = undefined;
    }

    private stopClient(): void {
        this.client?.dispose();
        this.client = null;
    }
}

let sharedHub: WritingHub | null = null;

/** Der Hub der App mit dem echten Worker, bei der ersten Nutzung angelegt */
export function sharedWritingHub(): WritingHub {
    sharedHub ??= new WritingHub();
    return sharedHub;
}

// ---------- Einstellung ----------

/** Schalter „Schreibhinweise anzeigen“; im Test eine Fälschung, in der App der Einstellungs-Store */
export interface WritingSettings {
    isEnabled(): boolean;
    /** Meldet jede Änderung irgendeiner Einstellung; die Rückgabe meldet ab */
    subscribe(listener: () => void): () => void;
}

const appWritingSettings: WritingSettings = {
    isEnabled: () => useSettingsStore.getState().values.writingHints,
    subscribe: (listener) => useSettingsStore.subscribe(() => listener()),
};

const writingSettings = Facet.define<WritingSettings, WritingSettings>({
    combine: (values) => values[0] ?? appWritingSettings,
});

// ---------- Ereignis „Ergebnis eingetroffen“ ----------

type ResultListener = () => void;

const resultListeners = new Set<ResultListener>();

/** Für die Statusleiste: Eine Antwort (neue Wortzahl) wurde in eine Sitzung eingesetzt. Kein Text, nur der Anstoß */
export function onWritingResult(listener: ResultListener): () => void {
    resultListeners.add(listener);
    return () => {
        resultListeners.delete(listener);
    };
}

function notifyWritingResult(): void {
    for (const listener of resultListeners) listener();
}

// ---------- Zustand ----------

interface WritingFieldValue {
    /** Zähler der Textstände; steht für den Text, nicht der Text selbst */
    readonly version: number;
    /** Stand, für den die letzte Antwort stammt (`null`: noch keine) */
    readonly analyzedVersion: number | null;
    /** Enthielt die Antwort für `analyzedVersion` Hinweise? */
    readonly hintsIncluded: boolean;
    /** Wörter der Datei laut letzter Antwort (bleibt beim Tippen stehen, bis die nächste eintrifft) */
    readonly words: number | null;
    readonly decorations: DecorationSet;
}

interface HintSpec {
    readonly kind: WritingHintKind;
    readonly message: string;
}

interface ResultEffect {
    readonly version: number;
    readonly includeHints: boolean;
    readonly result: WritingResult;
}

const setResult = StateEffect.define<ResultEffect>();
/** Zwingt den View, die Dekorationen neu zu bewerten (nach dem Umschalten der Einstellung) */
const refreshHints = StateEffect.define<null>();

let lastIssuedVersion = 0;

function issueVersion(): number {
    lastIssuedVersion += 1;
    return lastIssuedVersion;
}

const HINT_CLASS = 'cm-writing-hint';

function hintDecoration(hint: WritingHint): Decoration {
    const spec: HintSpec = { kind: hint.kind, message: hint.message };
    return Decoration.mark({ class: HINT_CLASS, attributes: { title: hint.message }, ...spec });
}

function buildDecorations(hints: readonly WritingHint[], docLength: number): DecorationSet {
    const ranges = [];
    for (const hint of hints) {
        const from = Math.min(Math.max(hint.start, 0), docLength);
        const to = Math.min(hint.end, docLength);
        if (to > from) ranges.push(hintDecoration(hint).range(from, to));
    }
    return Decoration.set(ranges, true);
}

function appliedResult(tr: Transaction, version: number): WritingFieldValue | null {
    for (const effect of tr.effects) {
        if (!effect.is(setResult) || effect.value.version !== version) continue;
        const { includeHints, result } = effect.value;
        return {
            version,
            analyzedVersion: version,
            hintsIncluded: includeHints,
            words: result.words,
            decorations: buildDecorations(result.hints, tr.newDoc.length),
        };
    }
    return null;
}

/** Antworten gelten nur für den Stand, dessen Version sie tragen; bis dahin wandern die Hinweise mit den Änderungen */
const writingField = StateField.define<WritingFieldValue>({
    create: () => ({ version: issueVersion(), analyzedVersion: null, hintsIncluded: false, words: null, decorations: Decoration.none }),
    update(value, tr) {
        const version = tr.docChanged ? issueVersion() : value.version;
        const applied = appliedResult(tr, version);
        if (applied !== null) return applied;
        if (!tr.docChanged) return value;
        return { ...value, version, decorations: value.decorations.map(tr.changes) };
    },
});

/** Wörter der Datei laut letzter Antwort; `null`, solange noch keine vorliegt */
export function wordCountOf(state: EditorState): number | null {
    return state.field(writingField, false)?.words ?? null;
}

/** Aktuelle Hinweise der Sitzung (Positionen wie im aktuellen Text), nach Position sortiert */
export function writingHintsOf(state: EditorState): WritingHint[] {
    const value = state.field(writingField, false);
    if (value === undefined) return [];
    const hints: WritingHint[] = [];
    for (const cursor = value.decorations.iter(); cursor.value !== null; cursor.next()) {
        const { kind, message } = cursor.value.spec as HintSpec;
        hints.push({ kind, start: cursor.from, end: cursor.to, message });
    }
    return hints;
}

function versionOf(state: EditorState): number | null {
    return state.field(writingField, false)?.version ?? null;
}

// ---------- Anfragen entprellen und Antworten einsetzen ----------

/** Was der Treiber vom Editor braucht: `EditorView` erfüllt das, Tests nehmen eine einfache Fälschung */
export interface WritingHost {
    readonly state: EditorState;
    dispatch(spec: TransactionSpec): void;
}

export interface WritingDriverSettings {
    readonly docId: string;
    readonly hub: WritingHub;
    readonly timer: AnalysisTimer;
    readonly debounceMs: number;
    /** `false` (BibTeX): nur zählen, nie Hinweise anfordern */
    readonly hintsAllowed: boolean;
}

export class WritingDriver {
    private timerHandle: unknown = undefined;
    private destroyed = false;
    /** Ob die zuletzt gesendete Anfrage Hinweise verlangte (die Antwort trägt es nicht) */
    private requestedHints = false;
    private readonly unsubscribe: () => void;

    constructor(
        private readonly host: WritingHost,
        private readonly settings: WritingDriverSettings,
    ) {
        this.unsubscribe = settings.hub.subscribe(settings.docId, (version, result) => this.receive(version, result));
        this.requestNow();
    }

    /** Nach jeder Transaktion des Views: Textänderung startet die Frist neu */
    handleUpdate(startState: EditorState, state: EditorState): void {
        if (versionOf(state) !== versionOf(startState)) this.schedule();
    }

    /** Der Schalter wurde umgelegt: neu zeichnen, beim Einschalten sofort Hinweise anfordern */
    settingsChanged(): void {
        if (this.destroyed) return;
        this.host.dispatch({ effects: refreshHints.of(null) });
        this.requestNow();
    }

    destroy(): void {
        this.destroyed = true;
        this.cancelTimer();
        this.unsubscribe();
    }

    private wantsHints(state: EditorState): boolean {
        return this.settings.hintsAllowed && state.facet(writingSettings).isEnabled();
    }

    private schedule(): void {
        this.cancelTimer();
        this.timerHandle = this.settings.timer.set(() => {
            this.timerHandle = undefined;
            this.requestNow();
        }, this.settings.debounceMs);
    }

    private cancelTimer(): void {
        if (this.timerHandle === undefined) return;
        this.settings.timer.clear(this.timerHandle);
        this.timerHandle = undefined;
    }

    /** Fragt an, wenn für den aktuellen Stand noch keine (passende) Antwort vorliegt; erst hier entsteht der Text */
    private requestNow(): void {
        this.cancelTimer();
        const { state } = this.host;
        const value = state.field(writingField, false);
        if (this.destroyed || value === undefined) return;
        const includeHints = this.wantsHints(state);
        if (value.analyzedVersion === value.version && (value.hintsIncluded || !includeHints)) return;
        this.requestedHints = includeHints;
        this.settings.hub.requestWriting(this.settings.docId, value.version, state.doc.toString(), includeHints);
    }

    private receive(version: number, result: WritingResult): void {
        if (this.destroyed || versionOf(this.host.state) !== version) return;
        this.host.dispatch({
            effects: setResult.of({ version, includeHints: this.requestedHints, result }),
            annotations: Transaction.addToHistory.of(false),
        });
        notifyWritingResult();
    }
}

class WritingPlugin {
    private readonly driver: WritingDriver;
    private readonly stopSettings: () => void;
    private lastEnabled: boolean;

    constructor(view: EditorView, driverSettings: WritingDriverSettings) {
        const settings = view.state.facet(writingSettings);
        this.lastEnabled = settings.isEnabled();
        this.driver = new WritingDriver(view, driverSettings);
        this.stopSettings = settings.subscribe(() => this.handleSettingsChange(settings));
    }

    update(update: { readonly startState: EditorState; readonly state: EditorState }): void {
        this.driver.handleUpdate(update.startState, update.state);
    }

    destroy(): void {
        this.stopSettings();
        this.driver.destroy();
    }

    private handleSettingsChange(settings: WritingSettings): void {
        const enabled = settings.isEnabled();
        if (enabled === this.lastEnabled) return;
        this.lastEnabled = enabled;
        this.driver.settingsChanged();
    }
}

// ---------- Darstellung ----------

/** Farbe aus `theme.ts`; der Rückfall hält die Linie sichtbar, solange kein Farbschema gesetzt ist */
const HINT_COLOR = 'var(--editor-diagnostic-hint, currentColor)';

/** Blau gepunktet wie in der Swift-App; Syntaxfehler sind dagegen rot gestrichelt (`diagnostics.ts`) */
const writingBaseTheme = EditorView.baseTheme({
    [`.${HINT_CLASS}`]: { textDecoration: `underline dotted ${HINT_COLOR}`, textDecorationThickness: '1.5px' },
});

// ---------- Erweiterung ----------

export interface WritingOptions {
    /** Schalter; Standard: Einstellung `writingHints` aus dem Einstellungs-Store */
    readonly settings?: WritingSettings;
    readonly hub?: WritingHub;
    readonly timer?: AnalysisTimer;
    readonly debounceMs?: number;
}

/**
 * Schreibprüfung für eine Sitzung (`docId` = Pfad der Datei). BibTeX-Dateien bekommen nur den Wortzähler, keine
 * Hinweise (die Regeln kennen nur LaTeX-Fließtext).
 */
export function writingHintsExtension(context: FeatureContext, options: WritingOptions = {}): Extension {
    const hintsAllowed = languageFromPath(context.name ?? context.path) === 'latex';
    const driverSettings = (): WritingDriverSettings => ({
        docId: context.path,
        hub: options.hub ?? sharedWritingHub(),
        timer: options.timer ?? browserTimer,
        debounceMs: options.debounceMs ?? ANALYSIS_DEBOUNCE_MS,
        hintsAllowed,
    });
    return [
        options.settings === undefined ? [] : writingSettings.of(options.settings),
        writingField,
        writingBaseTheme,
        EditorView.decorations.of((view) => visibleHints(view.state, hintsAllowed)),
        ViewPlugin.define((view) => new WritingPlugin(view, driverSettings())),
    ];
}

function visibleHints(state: EditorState, hintsAllowed: boolean): DecorationSet {
    if (!hintsAllowed || !state.facet(writingSettings).isEnabled()) return Decoration.none;
    return state.field(writingField, false)?.decorations ?? Decoration.none;
}
