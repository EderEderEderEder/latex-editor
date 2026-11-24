// Einklappen im Editor (W1-8b): CodeMirror-Anbindung von `FoldState` aus `core/latex/foldRegions.ts`.
// Ansatz: eigenes `StateField` mit `Decoration.replace` (Platzhalter „⋯“) und eigener Gutter-Spalte statt
// `codeFolding`/`foldService`. CodeMirrors Faltung hat andere Regeln (klappt nur beim Löschen oder bei der
// Cursorposition auf, eigene Bereichsgrenzen); `FoldState` bildet das Swift-Verhalten bereits ab (Bereiche wandern mit,
// Bearbeitung im Ausgeblendeten klappt auf, `adjustedSelection`, `adopt`, `generation`) und wird hier nur angeschlossen.
// Der Text bleibt unverändert: Zuklappen ist nur eine Dekoration.
//
// CSS-Klassen: .cm-fold-gutter (Spalte), .cm-fold-marker (Pfeil, zusätzlich -open oder -folded),
// .cm-fold-placeholder (Feld „⋯“). Farben nur über Variablen aus `theme.ts`.
import { EditorSelection, EditorState, Prec, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import type {
    ChangeSet, Extension, SelectionRange, StateCommand, Text, Transaction, TransactionSpec,
} from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, ViewPlugin, WidgetType, gutter, keymap } from '@codemirror/view';
import type { BlockInfo, DecorationSet, PluginValue, ViewUpdate } from '@codemirror/view';
import { languageFromPath } from '../../shared/core/language';
import { FoldState, LineIndex, scanFoldRegions } from '../../shared/core/latex/foldRegions';
import type { FoldRegion, LineSplice, TextRange } from '../../shared/core/latex/foldRegions';
import type { FeatureContext } from './extensions';

/** Entprellung des Neu-Scannens nach einer Textänderung */
export const FOLD_SCAN_DELAY_MS = 300;
/** Erster Scan nach dem Anzeigen einer Sitzung: sofort, aber nicht mitten in einem View-Update */
const INITIAL_SCAN_DELAY_MS = 0;
export const FOLD_PLACEHOLDER_TEXT = '⋯';
const PLACEHOLDER_TITLE = 'Aufklappen';
const MARKER_FOLDED_TEXT = '▸';
const MARKER_OPEN_TEXT = '▾';
const MARKER_FOLDED_TITLE = 'Aufklappen';
const MARKER_OPEN_TITLE = 'Zuklappen';
const FOLD_GUTTER_CLASS = 'cm-fold-gutter';
const PLACEHOLDER_CLASS = 'cm-fold-placeholder';
const FOLD_GUTTER_WIDTH = '14px';
/** Abstand, Innenabstand, Radius und Deckkraft wie `LatexTextView+Folding.swift` */
const PLACEHOLDER_GAP = '5px';
const PLACEHOLDER_PADDING = '0 5px';
const PLACEHOLDER_RADIUS = '4px';
const PLACEHOLDER_BACKGROUND = 'color-mix(in srgb, currentColor 10%, transparent)';
const NEVER_SCANNED = -1;
const DELETE_EVENT = 'delete';

/**
 * Tastenkürzel (Vorschlag): macOS wie die Swift-Version (⌥⌘← / ⌥⌘→, mit ⇧ alles); Windows/Linux als Akkord nach
 * VS Code (Strg+K, dann …), weil Strg+Alt dort AltGr ist und Strg+Umschalt+Pfeil schon „Wort markieren“ bedeutet.
 */
export const FOLD_KEYS = {
    foldAtCursor: { mac: 'Mod-Alt-ArrowLeft', other: 'Ctrl-k Ctrl-ArrowLeft' },
    unfoldAtCursor: { mac: 'Mod-Alt-ArrowRight', other: 'Ctrl-k Ctrl-ArrowRight' },
    foldAll: { mac: 'Shift-Mod-Alt-ArrowLeft', other: 'Ctrl-k Ctrl-0' },
    unfoldAll: { mac: 'Shift-Mod-Alt-ArrowRight', other: 'Ctrl-k Ctrl-j' },
} as const;

// ---------- Zeilenindex über dem CodeMirror-Dokument ----------

/**
 * `LineIndex` für `FoldState`, aber direkt auf `Text` (Zeilensuche logarithmisch, kein Feld mit allen
 * Zeilenanfängen, das pro Tastendruck neu gebaut würde). Zeilen 0-basiert wie in `foldRegions.ts`.
 */
class DocLineIndex extends LineIndex {
    constructor(private readonly doc: Text) {
        super('');
    }

    override get lineCount(): number {
        return this.doc.lines;
    }

    override get length(): number {
        return this.doc.length;
    }

    override start(line: number): number {
        return this.isLine(line) ? this.doc.line(line + 1).from : this.doc.length;
    }

    override contentEnd(line: number): number {
        return this.isLine(line) ? this.doc.line(line + 1).to : this.doc.length;
    }

    override lineContaining(offset: number): number {
        return this.doc.lineAt(Math.min(Math.max(offset, 0), this.doc.length)).number - 1;
    }

    override applyEdit(): LineSplice {
        throw new Error('DocLineIndex folgt dem Dokument von selbst');
    }

    private isLine(line: number): boolean {
        return line >= 0 && line < this.doc.lines;
    }
}

/**
 * `FoldState` ist veränderlich, ein `EditorState` darf es nicht sein (Filter und Rückgängig rechnen Zustände auch
 * mehrfach aus demselben Vorgänger). Darum bekommt jede Änderung eine Kopie. Nur `foldedRanges` wird in
 * `FoldState` an Ort und Stelle verändert (`push`/`sort`), alle anderen Felder werden ersetzt und dürfen geteilt
 * werden. Die Felder sind nur zur Übersetzungszeit privat; besser wäre ein `clone()` in `foldRegions.ts`.
 */
function cloneFoldState(source: FoldState): FoldState {
    const copy = Object.assign(Object.create(FoldState.prototype) as FoldState, source);
    (copy as unknown as { foldedRanges: TextRange[] }).foldedRanges = [...source.folded];
    copy.detach();
    return copy;
}

function endOf(range: TextRange): number {
    return range.location + range.length;
}

// ---------- Zustandsfeld ----------

/** Nur lesen: das Feld gehört dem Zustand, Änderungen laufen über die Befehle unten */
export type FoldSnapshot = Pick<FoldState, 'regions' | 'folded' | 'hiddenRanges' | 'hasFolds' | 'generation'>;

export type FoldAction =
    | { readonly kind: 'fold'; readonly region: FoldRegion }
    | { readonly kind: 'toggle'; readonly line: number }
    | { readonly kind: 'unfoldHeaderLine'; readonly line: number }
    | { readonly kind: 'unfoldAt'; readonly location: number }
    | { readonly kind: 'foldAll' }
    | { readonly kind: 'unfoldAll' };

interface AdoptedRegions {
    readonly regions: readonly FoldRegion[];
    /** `generation` beim Start des Scans; passt sie nicht mehr, wird das Ergebnis verworfen */
    readonly generation: number;
}

interface FoldFieldValue {
    readonly engine: FoldState;
    readonly decorations: DecorationSet;
    /** `generation`, zu der zuletzt ein Scan übernommen wurde */
    readonly scannedGeneration: number;
}

export const foldActionEffect = StateEffect.define<FoldAction>();
export const adoptFoldRegionsEffect = StateEffect.define<AdoptedRegions>();

class FoldPlaceholderWidget extends WidgetType {
    eq(): boolean {
        return true;
    }

    toDOM(view: EditorView) {
        const element = view.dom.ownerDocument.createElement('span');
        element.className = PLACEHOLDER_CLASS;
        element.textContent = FOLD_PLACEHOLDER_TEXT;
        element.title = PLACEHOLDER_TITLE;
        element.onmousedown = (event: { preventDefault(): void }) => {
            event.preventDefault();
            unfoldPlaceholderAt(view, view.posAtDOM(element));
        };
        return element;
    }
}

const placeholderDecoration = Decoration.replace({ widget: new FoldPlaceholderWidget() });

function buildDecorations(hidden: readonly TextRange[], docLength: number): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    for (const range of hidden) {
        const to = Math.min(endOf(range), docLength);
        if (to > range.location) builder.add(range.location, to, placeholderDecoration);
    }
    return builder.finish();
}

interface ChangedSpan {
    readonly fromA: number;
    readonly toA: number;
    readonly toB: number;
}

/** Alle Änderungen einer Transaktion als ein Bereich (wie `editedRange` in AppKit bei mehreren Cursorn) */
function changedSpan(changes: ChangeSet): ChangedSpan | null {
    let fromA = Infinity;
    let toA = -1;
    let toB = -1;
    changes.iterChangedRanges((changeFromA, changeToA, _changeFromB, changeToB) => {
        fromA = Math.min(fromA, changeFromA);
        toA = Math.max(toA, changeToA);
        toB = Math.max(toB, changeToB);
    });
    return toA < 0 ? null : { fromA, toA, toB };
}

/** Rückschritt am Anfang der Zeile hinter einem Bereich löscht dessen Zeilenumbruch: vorher aufklappen (wie Swift) */
function unfoldBeforeDeletedBreak(engine: FoldState, deletedFrom: number): void {
    for (const hidden of engine.hiddenRanges) {
        if (endOf(hidden) === deletedFrom) engine.unfoldStartingAt(hidden.location);
    }
}

function applyDocChange(engine: FoldState, tr: Transaction, lines: DocLineIndex): void {
    const span = changedSpan(tr.changes);
    if (span === null) return;
    if (tr.isUserEvent(DELETE_EVENT)) unfoldBeforeDeletedBreak(engine, span.fromA);
    const oldDoc = tr.startState.doc;
    const firstLine = oldDoc.lineAt(span.fromA).number;
    const splice: LineSplice = {
        firstLine: firstLine - 1,
        removedLineCount: oldDoc.lineAt(span.toA).number - firstLine,
        insertedLineCount: tr.newDoc.lineAt(span.toB).number - firstLine,
    };
    const delta = tr.newDoc.length - oldDoc.length;
    engine.applyEdit({ location: span.fromA, length: span.toB - span.fromA }, delta, splice, lines);
}

function applyFoldAction(engine: FoldState, action: FoldAction, lines: DocLineIndex): void {
    switch (action.kind) {
        case 'fold':
            engine.fold(action.region, lines);
            return;
        case 'toggle': {
            const region = engine.region(action.line);
            if (region !== undefined) engine.toggle(region, lines);
            return;
        }
        case 'unfoldHeaderLine':
            engine.unfoldHeaderLine(action.line, lines);
            return;
        case 'unfoldAt':
            engine.unfoldStartingAt(action.location);
            return;
        case 'foldAll':
            engine.foldAll(lines);
            return;
        case 'unfoldAll':
            engine.unfoldAll();
    }
}

/** Auswahlrand mitten im Ausgeblendeten klappt auf; das Versetzen des Cursors übernimmt der Filter unten */
function unfoldAtSelection(engine: FoldState, tr: Transaction): void {
    const main = tr.newSelection.main;
    engine.adjustedSelection({
        selection: { location: main.from, length: main.to - main.from },
        previousLocation: tr.changes.mapPos(tr.startState.selection.main.head),
        textLength: tr.newDoc.length,
    });
}

function isFoldEffect(effect: StateEffect<unknown>): boolean {
    return effect.is(foldActionEffect) || effect.is(adoptFoldRegionsEffect);
}

function needsUpdate(value: FoldFieldValue, tr: Transaction): boolean {
    if (tr.docChanged || tr.effects.some(isFoldEffect)) return true;
    return tr.selection !== undefined && value.engine.hasFolds;
}

function nextValue(previous: FoldFieldValue, engine: FoldState, scanned: number, docLength: number): FoldFieldValue {
    const old = previous.engine;
    const hiddenSame = engine.hiddenRanges === old.hiddenRanges;
    const unchanged = hiddenSame && engine.regions === old.regions && engine.generation === old.generation;
    if (unchanged && scanned === previous.scannedGeneration) return previous;
    // Gleiche Liste heißt gleiche Stellen: `FoldState` ersetzt sie bei jeder Verschiebung.
    const decorations = hiddenSame ? previous.decorations : buildDecorations(engine.hiddenRanges, docLength);
    return { engine, decorations, scannedGeneration: scanned };
}

function updateFoldField(value: FoldFieldValue, tr: Transaction): FoldFieldValue {
    if (!needsUpdate(value, tr)) return value;
    const engine = cloneFoldState(value.engine);
    const lines = new DocLineIndex(tr.newDoc);
    let scanned = value.scannedGeneration;
    if (tr.docChanged) applyDocChange(engine, tr, lines);
    for (const effect of tr.effects) {
        if (effect.is(foldActionEffect)) applyFoldAction(engine, effect.value, lines);
        if (!effect.is(adoptFoldRegionsEffect) || effect.value.generation !== engine.generation) continue;
        engine.adopt(effect.value.regions, lines);
        scanned = engine.generation;
    }
    if (tr.selection !== undefined && engine.hasFolds) unfoldAtSelection(engine, tr);
    return nextValue(value, engine, scanned, tr.newDoc.length);
}

const foldField = StateField.define<FoldFieldValue>({
    create: () => ({ engine: new FoldState(), decorations: Decoration.none, scannedGeneration: NEVER_SCANNED }),
    update: updateFoldField,
    provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/** Einklapp-Zustand einer Sitzung; `undefined`, wenn die Datei kein Einklappen hat (z. B. .bib) */
export function foldSnapshotOf(state: EditorState): FoldSnapshot | undefined {
    return state.field(foldField, false)?.engine;
}

// ---------- Cursor nie im Ausgeblendeten ----------

/**
 * CodeMirror springt über den Platzhalter in zwei Schritten (Kopfzeilenende → hinter „⋯“ → nächste Zeile), AppKit
 * erwartet einen. Pfeil rechts am Kopfzeilenende geht deshalb gleich hinter den Bereich, Pfeil links vom Anfang der
 * Zeile dahinter an das Kopfzeilenende (Swift: `hopOverFold`).
 */
function hoppedHead(hidden: readonly TextRange[], previous: number, head: number, docLength: number): number {
    for (const range of hidden) {
        const end = endOf(range);
        if (head !== end) continue;
        if (previous === range.location) return Math.min(end + 1, docLength);
        if (previous === end + 1) return range.location;
    }
    return head;
}

/** Neue Auswahl, wenn der Hauptcursor im Ausgeblendeten landen würde; `null`: Auswahl bleibt */
function relocatedSelection(engine: FoldState, tr: Transaction): EditorSelection | null {
    const selection = tr.newSelection;
    const main = selection.main;
    const docLength = tr.newDoc.length;
    const previous = tr.changes.mapPos(tr.startState.selection.main.head);
    const head = hoppedHead(engine.hiddenRanges, previous, main.head, docLength);
    let range = EditorSelection.range(main.empty ? head : main.anchor, head);
    if (range.empty) {
        const adjusted = cloneFoldState(engine).adjustedSelection({
            selection: { location: head, length: 0 },
            previousLocation: previous,
            textLength: docLength,
        });
        if (adjusted !== null) range = EditorSelection.cursor(adjusted.location);
    }
    return range.eq(main) ? null : selection.replaceRange(range, selection.mainIndex);
}

const keepSelectionOutOfFolds = EditorState.transactionFilter.of((tr) => {
    if (tr.selection === undefined) return tr;
    const engine = tr.state.field(foldField, false)?.engine;
    if (engine === undefined || !engine.hasFolds) return tr;
    const selection = relocatedSelection(engine, tr);
    return selection === null ? tr : [tr, { selection, sequential: true }];
});

// ---------- Befehle ----------

type CommandTarget = Parameters<StateCommand>[0];

/** Nach dem Zuklappen: lag die Auswahl im Ausgeblendeten, steht der Cursor am Ende der Kopfzeile (Swift) */
function caretOutsideHidden(state: EditorState): SelectionRange | null {
    const hidden = foldSnapshotOf(state)?.hiddenRanges ?? [];
    const { from, to } = state.selection.main;
    const covering = hidden.find((range) => [from, to].some((edge) => edge > range.location && edge <= endOf(range)));
    return covering === undefined ? null : EditorSelection.cursor(covering.location);
}

function runFoldAction(target: CommandTarget, action: FoldAction): boolean {
    const { state } = target;
    if (state.field(foldField, false) === undefined) return false;
    const effects = foldActionEffect.of(action);
    const caret = caretOutsideHidden(state.update({ effects }).state);
    const spec: TransactionSpec = caret === null ? { effects } : { effects, selection: caret, scrollIntoView: true };
    target.dispatch(state.update(spec));
    return true;
}

function cursorLine(state: EditorState): number {
    return state.doc.lineAt(state.selection.main.from).number - 1;
}

/** Innersten offenen Bereich am Cursor zuklappen */
export const foldAtCursor: StateCommand = (target) => {
    const { state } = target;
    const region = state.field(foldField, false)?.engine.innermostOpenRegion(cursorLine(state), new DocLineIndex(state.doc));
    return region !== undefined && runFoldAction(target, { kind: 'fold', region });
};

/** Bereiche aufklappen, deren Kopfzeile die Cursorzeile ist */
export const unfoldAtCursor: StateCommand = (target) =>
    foldSnapshotOf(target.state)?.hasFolds === true
    && runFoldAction(target, { kind: 'unfoldHeaderLine', line: cursorLine(target.state) });

/** Alles zuklappen außer `document` */
export const foldAll: StateCommand = (target) =>
    (foldSnapshotOf(target.state)?.regions.length ?? 0) > 0 && runFoldAction(target, { kind: 'foldAll' });

export const unfoldAll: StateCommand = (target) =>
    foldSnapshotOf(target.state)?.hasFolds === true && runFoldAction(target, { kind: 'unfoldAll' });

/** Klick auf den Pfeil: Bereich mit Kopfzeile `line` (0-basiert) auf- oder zuklappen */
export function toggleFoldAtLine(target: CommandTarget, line: number): boolean {
    const region = target.state.field(foldField, false)?.engine.region(line);
    return region !== undefined && runFoldAction(target, { kind: 'toggle', line });
}

/** Klick auf „⋯“: `location` ist der Anfang des Ausgeblendeten (Ende der Kopfzeile) */
export function unfoldPlaceholderAt(target: CommandTarget, location: number): boolean {
    return foldSnapshotOf(target.state)?.hasFolds === true && runFoldAction(target, { kind: 'unfoldAt', location });
}

const foldKeymap = Prec.high(keymap.of([
    { key: FOLD_KEYS.foldAtCursor.other, mac: FOLD_KEYS.foldAtCursor.mac, run: foldAtCursor },
    { key: FOLD_KEYS.unfoldAtCursor.other, mac: FOLD_KEYS.unfoldAtCursor.mac, run: unfoldAtCursor },
    { key: FOLD_KEYS.foldAll.other, mac: FOLD_KEYS.foldAll.mac, run: foldAll },
    { key: FOLD_KEYS.unfoldAll.other, mac: FOLD_KEYS.unfoldAll.mac, run: unfoldAll },
]));

// ---------- Scan, entprellt ----------

export interface FoldScanTimer {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
}

export interface FoldScanOptions {
    readonly timer?: FoldScanTimer;
    readonly delayMs?: number;
    /** Standard: `scanFoldRegions` synchron; ein Promise erlaubt später einen Worker */
    readonly scan?: (text: string) => readonly FoldRegion[] | Promise<readonly FoldRegion[]>;
}

/** Wohin der Scan sein Ergebnis gibt; `EditorView` erfüllt das direkt */
export interface FoldScanTarget {
    readonly state: EditorState;
    dispatch(spec: TransactionSpec): void;
}

const DEFAULT_TIMER: FoldScanTimer = {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as Parameters<typeof globalThis.clearTimeout>[0]),
};

/** Scannt nur nach Textänderungen (entprellt) und einmal nach dem Anzeigen, nie beim Rendern */
export class FoldScanScheduler {
    private handle: unknown = null;
    private disposed = false;
    private readonly timer: FoldScanTimer;
    private readonly delayMs: number;
    private readonly scan: NonNullable<FoldScanOptions['scan']>;

    constructor(private readonly target: FoldScanTarget, options: FoldScanOptions = {}) {
        this.timer = options.timer ?? DEFAULT_TIMER;
        this.delayMs = options.delayMs ?? FOLD_SCAN_DELAY_MS;
        this.scan = options.scan ?? scanFoldRegions;
    }

    /** Nach einer Textänderung: Zeitgeber neu starten */
    scanSoon(): void {
        this.schedule(this.delayMs);
    }

    /** Beim Anzeigen: nur, wenn seit dem letzten Scan bearbeitet wurde oder nie gescannt wurde */
    scanIfNeeded(): void {
        const value = this.target.state.field(foldField, false);
        if (value !== undefined && value.scannedGeneration !== value.engine.generation) this.schedule(INITIAL_SCAN_DELAY_MS);
    }

    dispose(): void {
        this.disposed = true;
        this.cancel();
    }

    private schedule(delayMs: number): void {
        if (this.disposed) return;
        this.cancel();
        this.handle = this.timer.setTimeout(() => void this.run(), delayMs);
    }

    private cancel(): void {
        if (this.handle === null) return;
        this.timer.clearTimeout(this.handle);
        this.handle = null;
    }

    private async run(): Promise<void> {
        this.handle = null;
        const state = this.target.state;
        const generation = state.field(foldField, false)?.engine.generation;
        if (generation === undefined) return;
        const regions = await this.scan(state.doc.toString());
        // Seit dem Start bearbeitet: verwerfen, der nächste entprellte Scan kommt ohnehin
        if (this.disposed || this.target.state.field(foldField, false)?.engine.generation !== generation) return;
        this.target.dispatch({ effects: adoptFoldRegionsEffect.of({ regions, generation }) });
    }
}

class FoldScanPlugin implements PluginValue {
    private readonly scheduler: FoldScanScheduler;

    constructor(view: EditorView, options: FoldScanOptions) {
        this.scheduler = new FoldScanScheduler(view, options);
        this.scheduler.scanIfNeeded();
    }

    update(update: ViewUpdate): void {
        if (update.docChanged) this.scheduler.scanSoon();
    }

    destroy(): void {
        this.scheduler.dispose();
    }
}

// ---------- Gutter ----------

class FoldMarker extends GutterMarker {
    constructor(private readonly folded: boolean) {
        super();
    }

    eq(other: GutterMarker): boolean {
        return other instanceof FoldMarker && other.folded === this.folded;
    }

    toDOM(view: EditorView) {
        const element = view.dom.ownerDocument.createElement('span');
        element.className = `cm-fold-marker ${this.folded ? 'cm-fold-marker-folded' : 'cm-fold-marker-open'}`;
        element.textContent = this.folded ? MARKER_FOLDED_TEXT : MARKER_OPEN_TEXT;
        element.title = this.folded ? MARKER_FOLDED_TITLE : MARKER_OPEN_TITLE;
        return element;
    }
}

const foldedMarker = new FoldMarker(true);
const openMarker = new FoldMarker(false);

/**
 * Abstandhalter der Spalte: gleiches Zeichen, aber ohne `cm-fold-marker`. Er steht unsichtbar im DOM; mit der
 * Klasse zählte er wie ein Pfeil (und das Darüberfahren-CSS träfe ihn mit).
 */
class FoldSpacer extends GutterMarker {
    toDOM(view: EditorView) {
        const element = view.dom.ownerDocument.createElement('span');
        element.textContent = MARKER_FOLDED_TEXT;
        return element;
    }
}

const foldSpacer = new FoldSpacer();

function lineNumberOf(view: EditorView, line: BlockInfo): number {
    return view.state.doc.lineAt(line.from).number - 1;
}

function markerForLine(view: EditorView, line: BlockInfo): GutterMarker | null {
    const engine = view.state.field(foldField, false)?.engine;
    const region = engine?.region(lineNumberOf(view, line));
    if (engine === undefined || region === undefined) return null;
    return engine.isFolded(region, new DocLineIndex(view.state.doc)) ? foldedMarker : openMarker;
}

function foldMarkersChanged(update: ViewUpdate): boolean {
    const before = update.startState.field(foldField, false)?.engine;
    const after = update.state.field(foldField, false)?.engine;
    return before?.regions !== after?.regions || before?.hiddenRanges !== after?.hiddenRanges;
}

const foldGutter = gutter({
    class: FOLD_GUTTER_CLASS,
    lineMarker: markerForLine,
    lineMarkerChange: foldMarkersChanged,
    initialSpacer: () => foldSpacer,
    domEventHandlers: {
        mousedown: (view, line, event) => {
            if (!toggleFoldAtLine(view, lineNumberOf(view, line))) return false;
            event.preventDefault();
            return true;
        },
    },
});

const foldTheme = EditorView.baseTheme({
    [`.${FOLD_GUTTER_CLASS}`]: { width: FOLD_GUTTER_WIDTH },
    [`.${FOLD_GUTTER_CLASS} .cm-gutterElement`]: { padding: '0', textAlign: 'center', cursor: 'pointer' },
    '.cm-fold-marker': { color: 'var(--editor-gutter-text)' },
    // Wie Swift: zugeklappt immer sichtbar, offen nur beim Darüberfahren
    '.cm-fold-marker-open': { opacity: '0' },
    '.cm-gutters:hover .cm-fold-marker-open': { opacity: '1' },
    [`.${PLACEHOLDER_CLASS}`]: {
        marginLeft: PLACEHOLDER_GAP,
        padding: PLACEHOLDER_PADDING,
        borderRadius: PLACEHOLDER_RADIUS,
        backgroundColor: PLACEHOLDER_BACKGROUND,
        color: 'var(--editor-gutter-text)',
        cursor: 'pointer',
    },
});

/** Einklappen für LaTeX-Dateien; .bib bekommt nichts (wie Swift: dort gibt es nichts zuzuklappen) */
export function foldingExtension(context: FeatureContext, options: FoldScanOptions = {}): Extension {
    if (languageFromPath(context.path) !== 'latex') return [];
    return [
        foldField,
        keepSelectionOutOfFolds,
        foldKeymap,
        foldGutter,
        foldTheme,
        ViewPlugin.define((view) => new FoldScanPlugin(view, options)),
    ];
}
