// Diagnose im Editor (W1-9c): Der Text der Sitzung wird 0,6 s nach der letzten Änderung vom Analyse-Worker geprüft,
// die Syntaxmeldungen erscheinen als Unterstreichungen (Fehler rot gestrichelt, Warnung orange strichpunktiert,
// Hinweis blau gepunktet wie in der Swift-App) mit dem Meldungstext als Tooltip (`title`).
//
// Aufbau: `diagnosticsField` hält Version und Dekorationen im `EditorState` (gehört zur Sitzung, überlebt den
// Wechsel der Sitzung im View). `DiagnosticsDriver` entprellt, fragt über den geteilten `DiagnosticsHub` an und
// liefert Antworten zurück; er kennt nur `state` und `dispatch` und ist darum ohne DOM testbar.
import { EditorState, Facet, StateEffect, StateField, Transaction } from '@codemirror/state';
import type { Extension, TransactionSpec } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { languageFromPath } from '../../shared/core/language';
import type { Severity, TextMark } from '../../shared/core/latex/syntaxChecker';
import { ANALYSIS_DEBOUNCE_MS, AnalysisClient } from '../workers/analysisClient';
import type { AnalysisCallbacks, AnalysisTimer } from '../workers/analysisClient';
import type { FeatureContext } from './extensions';

// ---------- Client und Hub ----------

/** Der Teil des `AnalysisClient`, den die Diagnose braucht (Tests liefern eine Fälschung) */
export interface DiagnosticsClient {
    requestCheck(docId: string, version: number, text: string): void;
    dispose(): void;
}

export type DiagnosticsClientFactory = (callbacks: Pick<AnalysisCallbacks, 'onMarks'>) => DiagnosticsClient;

export type MarksListener = (version: number, marks: readonly TextMark[]) => void;

/**
 * Entprellt wird hier in der Erweiterung, bevor der Text als Zeichenkette entsteht (sonst würde jeder Tastendruck
 * den ganzen Text kopieren). Der Client bekommt daher keine zweite Frist.
 */
const CLIENT_DEBOUNCE_MS = 0;
/** Ohne offene Sitzung im View wird der Worker nach dieser Zeit beendet (ein Tabwechsel soll ihn nicht neu starten) */
const IDLE_DISPOSE_MS = 30_000;

const browserTimer: AnalysisTimer = {
    set: (callback, delayMs) => setTimeout(callback, delayMs),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function createAnalysisClient(callbacks: Pick<AnalysisCallbacks, 'onMarks'>): DiagnosticsClient {
    return new AnalysisClient(callbacks, { debounceMs: CLIENT_DEBOUNCE_MS });
}

/**
 * Ein geteilter Client (also ein Worker) für alle Sitzungen: verteilt Antworten nach `docId` an den Hörer der
 * Sitzung. Der Client entsteht bei der ersten Anfrage und wird beendet, wenn eine Weile niemand mehr zuhört.
 */
export class DiagnosticsHub {
    private client: DiagnosticsClient | null = null;
    private readonly listeners = new Map<string, MarksListener>();
    private idleHandle: unknown = undefined;

    constructor(
        private readonly createClient: DiagnosticsClientFactory = createAnalysisClient,
        private readonly timer: AnalysisTimer = browserTimer,
    ) {}

    /** Meldet einen Hörer für `docId` an; der Rückgabewert meldet ihn wieder ab */
    subscribe(docId: string, listener: MarksListener): () => void {
        this.cancelIdleDispose();
        this.listeners.set(docId, listener);
        return () => this.unsubscribe(docId, listener);
    }

    requestCheck(docId: string, version: number, text: string): void {
        this.client ??= this.createClient({
            onMarks: (id, markVersion, marks) => this.listeners.get(id)?.(markVersion, marks),
        });
        this.client.requestCheck(docId, version, text);
    }

    /** Beendet den Client sofort (z. B. beim Schließen des Fensters); eine neue Anfrage startet ihn wieder */
    dispose(): void {
        this.cancelIdleDispose();
        this.listeners.clear();
        this.stopClient();
    }

    private unsubscribe(docId: string, listener: MarksListener): void {
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

let sharedHub: DiagnosticsHub | null = null;

/** Der Hub der App mit dem echten Worker, bei der ersten Nutzung angelegt */
export function sharedDiagnosticsHub(): DiagnosticsHub {
    sharedHub ??= new DiagnosticsHub();
    return sharedHub;
}

// ---------- Zustand ----------

/** Ein-/Ausschalter (Einstellung „Fehler und Warnungen im Text markieren“); ohne Angabe an */
export const diagnosticsEnabled = Facet.define<boolean, boolean>({
    combine: (values) => values[0] ?? true,
});

interface DiagnosticsFieldValue {
    /** Zähler der Textstände; steht für den Text, nicht der Text selbst */
    readonly version: number;
    /** Stand, für den `decorations` aus einer Analyse stammen (`null`: noch keine) */
    readonly analyzedVersion: number | null;
    readonly decorations: DecorationSet;
}

interface MarkSpec {
    readonly severity: Severity;
    readonly message: string;
}

const setMarks = StateEffect.define<{ readonly version: number; readonly marks: readonly TextMark[] }>();

/**
 * Versionen kommen aus einem Zähler für alle Sitzungen: Wird ein Tab geschlossen und dieselbe Datei neu geöffnet,
 * kann eine späte Antwort der alten Sitzung (gleiche `docId`) nie zur Version der neuen passen.
 */
let lastIssuedVersion = 0;

function issueVersion(): number {
    lastIssuedVersion += 1;
    return lastIssuedVersion;
}

const SEVERITY_CLASS: Readonly<Record<Severity, string>> = {
    hint: 'cm-diagnostic-hint',
    warning: 'cm-diagnostic-warning',
    error: 'cm-diagnostic-error',
};

function markDecoration(mark: TextMark): Decoration {
    const spec: MarkSpec = { severity: mark.severity, message: mark.message };
    return Decoration.mark({ class: SEVERITY_CLASS[mark.severity], attributes: { title: mark.message }, ...spec });
}

/** Bereich im Text, mindestens ein Zeichen (leere Markierungen gibt es bei Mark-Dekorationen nicht) */
function clampedRange(mark: TextMark, docLength: number): { from: number; to: number } | null {
    if (docLength === 0) return null;
    const from = Math.min(Math.max(mark.start, 0), docLength - 1);
    const to = Math.min(Math.max(mark.end, from + 1), docLength);
    return { from, to };
}

function buildDecorations(marks: readonly TextMark[], docLength: number): DecorationSet {
    const ranges = [];
    for (const mark of marks) {
        const range = clampedRange(mark, docLength);
        if (range !== null) ranges.push(markDecoration(mark).range(range.from, range.to));
    }
    return Decoration.set(ranges, true);
}

function appliedMarks(tr: Transaction, version: number): DecorationSet | null {
    let applied: DecorationSet | null = null;
    for (const effect of tr.effects) {
        if (effect.is(setMarks) && effect.value.version === version) {
            applied = buildDecorations(effect.value.marks, tr.newDoc.length);
        }
    }
    return applied;
}

function disabledValue(value: DiagnosticsFieldValue, version: number): DiagnosticsFieldValue {
    if (value.decorations === Decoration.none && value.version === version) return value;
    return { version, analyzedVersion: null, decorations: Decoration.none };
}

/**
 * Eine Antwort gilt nur für den Stand, dessen Version sie trägt. Bis dahin wandern die Markierungen mit den
 * Änderungen (`map`): Löscht man ihren ganzen Text, verschwinden sie. Die Versionszählung hat keine reine
 * Funktion als Quelle; `tr.state` wird je Transaktion nur einmal berechnet, Lücken im Zähler schaden nicht.
 */
const diagnosticsField = StateField.define<DiagnosticsFieldValue>({
    create: () => ({ version: issueVersion(), analyzedVersion: null, decorations: Decoration.none }),
    update(value, tr) {
        const version = tr.docChanged ? issueVersion() : value.version;
        if (!tr.state.facet(diagnosticsEnabled)) return disabledValue(value, version);
        const applied = appliedMarks(tr, version);
        if (applied !== null) return { version, analyzedVersion: version, decorations: applied };
        if (!tr.docChanged) return value;
        return { version, analyzedVersion: value.analyzedVersion, decorations: value.decorations.map(tr.changes) };
    },
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** Aktuelle Meldungen der Sitzung (Positionen wie im aktuellen Text), nach Position sortiert */
export function diagnosticsOf(state: EditorState): TextMark[] {
    const value = state.field(diagnosticsField, false);
    if (value === undefined) return [];
    const marks: TextMark[] = [];
    for (const cursor = value.decorations.iter(); cursor.value !== null; cursor.next()) {
        const { severity, message } = cursor.value.spec as MarkSpec;
        marks.push({ severity, start: cursor.from, end: cursor.to, message });
    }
    return marks;
}

// ---------- Anfragen entprellen und Antworten einsetzen ----------

/** Was der Treiber vom Editor braucht: `EditorView` erfüllt das, Tests nehmen eine einfache Fälschung */
export interface DiagnosticsHost {
    readonly state: EditorState;
    dispatch(spec: TransactionSpec): void;
}

export interface DiagnosticsDriverSettings {
    readonly docId: string;
    readonly hub: DiagnosticsHub;
    readonly timer: AnalysisTimer;
    readonly debounceMs: number;
}

export class DiagnosticsDriver {
    private timerHandle: unknown = undefined;
    private destroyed = false;
    private readonly unsubscribe: () => void;

    constructor(
        private readonly host: DiagnosticsHost,
        private readonly settings: DiagnosticsDriverSettings,
    ) {
        this.unsubscribe = settings.hub.subscribe(settings.docId, (version, marks) => this.receive(version, marks));
        this.requestNow();
    }

    /** Nach jeder Transaktion des Views: Textänderung startet die Frist neu, Einschalten fragt sofort an */
    handleUpdate(startState: EditorState, state: EditorState): void {
        if (!state.facet(diagnosticsEnabled)) {
            this.cancelTimer();
            return;
        }
        if (versionOf(state) !== versionOf(startState)) {
            this.schedule();
            return;
        }
        if (!startState.facet(diagnosticsEnabled)) this.requestNow();
    }

    destroy(): void {
        this.destroyed = true;
        this.cancelTimer();
        this.unsubscribe();
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

    /** Fragt an, wenn für den aktuellen Stand noch keine Analyse vorliegt; erst hier entsteht der Text */
    private requestNow(): void {
        this.cancelTimer();
        const { state } = this.host;
        const value = state.field(diagnosticsField, false);
        if (this.destroyed || value === undefined || !state.facet(diagnosticsEnabled)) return;
        if (value.analyzedVersion === value.version) return;
        this.settings.hub.requestCheck(this.settings.docId, value.version, state.doc.toString());
    }

    private receive(version: number, marks: readonly TextMark[]): void {
        if (this.destroyed) return;
        const { state } = this.host;
        if (!state.facet(diagnosticsEnabled) || versionOf(state) !== version) return;
        this.host.dispatch({ effects: setMarks.of({ version, marks }), annotations: Transaction.addToHistory.of(false) });
    }
}

function versionOf(state: EditorState): number | null {
    return state.field(diagnosticsField, false)?.version ?? null;
}

class DiagnosticsPlugin {
    private readonly driver: DiagnosticsDriver;

    constructor(view: EditorView, settings: DiagnosticsDriverSettings) {
        this.driver = new DiagnosticsDriver(view, settings);
    }

    update(update: ViewUpdate): void {
        this.driver.handleUpdate(update.startState, update.state);
    }

    destroy(): void {
        this.driver.destroy();
    }
}

// ---------- Darstellung ----------

/**
 * Farbe aus `theme.ts`. Der Rückfall greift, solange kein Farbschema gesetzt ist: Ohne ihn wäre die ganze
 * `text-decoration`-Angabe ungültig und die Unterstreichung verschwände (berechneter Stil `solid`, keine Linie).
 */
function severityColor(severity: Severity): string {
    return `var(--editor-diagnostic-${severity}, currentColor)`;
}

// Strichpunktiert: Strich, Lücke, Punkt, Lücke (Periode 9 px)
const DASH_LENGTH_PX = 4;
const DOT_LENGTH_PX = 1;
const PATTERN_GAP_PX = 2;
const WARNING_LINE_THICKNESS_PX = 1.5;
const WARNING_LINE_OFFSET_PX = 1;

function dashDotGradient(color: string): string {
    const dotStart = DASH_LENGTH_PX + PATTERN_GAP_PX;
    const dotEnd = dotStart + DOT_LENGTH_PX;
    const period = dotEnd + PATTERN_GAP_PX;
    return `repeating-linear-gradient(to right, ${color} 0 ${DASH_LENGTH_PX}px, transparent ${DASH_LENGTH_PX}px ${dotStart}px, `
        + `${color} ${dotStart}px ${dotEnd}px, transparent ${dotEnd}px ${period}px)`;
}

/**
 * Einzige Quelle für die Form der Unterstreichungen (`theme.ts` liefert nur die Farben als Variablen).
 * CSS kennt `text-decoration-style` nur als solid, double, dotted, dashed und wavy, kein Strich-Punkt-Muster.
 * Die Warnung bekommt darum einen Farbverlauf als Hintergrund, der unten im Zeilenkasten sitzt. Gewählt gegenüber
 * einem SVG-Bild (`data:`-URI, in der CSP erlaubt), weil ein SVG die Farbe nicht aus `--editor-diagnostic-warning`
 * lesen kann und je Farbschema neu erzeugt werden müsste; der Verlauf folgt dem Farbschema von selbst.
 */
const diagnosticsBaseTheme = EditorView.baseTheme({
    '.cm-diagnostic-error': { textDecoration: `underline dashed ${severityColor('error')}` },
    '.cm-diagnostic-hint': { textDecoration: `underline dotted ${severityColor('hint')}` },
    '.cm-diagnostic-warning': {
        textDecoration: 'none',
        backgroundImage: dashDotGradient(severityColor('warning')),
        backgroundRepeat: 'no-repeat',
        backgroundSize: `100% ${WARNING_LINE_THICKNESS_PX}px`,
        backgroundPosition: `0 calc(100% - ${WARNING_LINE_OFFSET_PX}px)`,
    },
});

// ---------- Erweiterung ----------

export interface DiagnosticsOptions {
    /** Anfangszustand des Ein-/Ausschalters; ohne Angabe bestimmt `diagnosticsEnabled` (Standard: an) */
    readonly enabled?: boolean;
    /** Hub mit dem Client; Standard: der geteilte Hub mit dem echten Worker */
    readonly hub?: DiagnosticsHub;
    readonly timer?: AnalysisTimer;
    readonly debounceMs?: number;
}

/**
 * Diagnose für eine Sitzung (`docId` = Pfad der Datei). BibTeX-Dateien werden nicht geprüft: der Prüfer kennt
 * nur LaTeX.
 */
export function diagnosticsExtension(context: FeatureContext, options: DiagnosticsOptions = {}): Extension {
    if (languageFromPath(context.name ?? context.path) !== 'latex') return [];
    const createSettings = (): DiagnosticsDriverSettings => ({
        docId: context.path,
        hub: options.hub ?? sharedDiagnosticsHub(),
        timer: options.timer ?? browserTimer,
        debounceMs: options.debounceMs ?? ANALYSIS_DEBOUNCE_MS,
    });
    return [
        options.enabled === undefined ? [] : diagnosticsEnabled.of(options.enabled),
        diagnosticsField,
        diagnosticsBaseTheme,
        ViewPlugin.define((view) => new DiagnosticsPlugin(view, createSettings())),
    ];
}
