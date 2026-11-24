// Zeilenleiste (W1-7): Zeilennummern, aktuelle Zeile und eine Markierungsspalte (Vorbild: `LineNumberRulerView.swift`).
// Marken liegen als Dokumentpositionen (Zeilenanfang) im `StateField` und wandern mit Änderungen mit; die Zeilennummer
// ist nur die Eingabe/Ausgabe-Form. Die Breite hängt nie vom Scrollstand ab (CodeMirror-Abstandhalter aus der letzten
// Zeilennummer, Markierungsspalte fest, `overflow: hidden`).
//
// CSS-Klassen und Variablen (Farben nur aus `theme.ts`, hier keine eigenen Werte):
//   .cm-gutter-marks                Markierungsspalte
//   .cm-line-marks                  Inhalt einer Zeile (trägt den Tooltip als `title`)
//   .cm-mark-shape-{error|warning|box}   Kreis / Dreieck / Raute
//   .cm-gutterElement.cm-mark-git-{modified|added}   Streifen gestrichelt / durchgehend
//   Farben: --editor-diagnostic-error / -warning / -hint (Box), --editor-gutter-text (Git-Streifen; Wunsch an theme.ts:
//   eigene Variablen --editor-git-modified / --editor-git-added, bis dahin gilt der Rückfall).
import { EditorState, MapMode, RangeSet, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import type { Extension, Transaction } from '@codemirror/state';
import { EditorView, GutterMarker, gutter, highlightActiveLine, highlightActiveLineGutter, lineNumbers } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import type { FeatureContext } from './extensions';

export type GutterMarkKind = 'error' | 'warning' | 'box' | 'gitModified' | 'gitAdded';

export interface GutterMark {
    /** 1-basiert, bezogen auf das Dokument zum Zeitpunkt des Setzens */
    readonly line: number;
    readonly kind: GutterMarkKind;
    readonly message?: string;
}

/** Reihenfolge der Darstellung und des Tooltips: Fehler vor Warnung vor Box vor Git */
const KIND_PRIORITY: Readonly<Record<GutterMarkKind, number>> = {
    error: 0,
    warning: 1,
    box: 2,
    gitModified: 3,
    gitAdded: 4,
};

const GIT_DEFAULT_MESSAGE: Readonly<Partial<Record<GutterMarkKind, string>>> = {
    gitModified: 'Geändert seit dem letzten Commit',
    gitAdded: 'Neu seit dem letzten Commit',
};

const SHAPE_CLASS: Readonly<Partial<Record<GutterMarkKind, string>>> = {
    error: 'cm-mark-shape-error',
    warning: 'cm-mark-shape-warning',
    box: 'cm-mark-shape-box',
};

const GIT_CLASS: Readonly<Partial<Record<GutterMarkKind, string>>> = {
    gitModified: 'cm-mark-git-modified',
    gitAdded: 'cm-mark-git-added',
};

const MARK_COLUMN_WIDTH = '16px';
const SHAPE_SIZE = '0.62em';
const GIT_STRIPE_WIDTH = '3px';
const TRIANGLE_CLIP = 'polygon(50% 0, 100% 100%, 0 100%)';
const DIAMOND_CLIP = 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)';

/** Im Zustand gespeichert: Position (Zeilenanfang), damit Änderungen sie per `mapPos` verschieben */
interface StoredMark {
    readonly pos: number;
    readonly kind: GutterMarkKind;
    readonly message?: string;
}

export const setGutterMarksEffect = StateEffect.define<readonly GutterMark[]>();

/** Ersetzt alle Marken der Sitzung (Zeilennummern beziehen sich auf das Dokument der Transaktion) */
export function setGutterMarks(marks: readonly GutterMark[]): StateEffect<readonly GutterMark[]> {
    return setGutterMarksEffect.of(marks);
}

function compareMarks(first: StoredMark, second: StoredMark): number {
    return first.pos - second.pos || KIND_PRIORITY[first.kind] - KIND_PRIORITY[second.kind];
}

function storeMarks(marks: readonly GutterMark[], state: EditorState): StoredMark[] {
    const doc = state.doc;
    return marks
        .filter((mark) => Number.isInteger(mark.line) && mark.line >= 1 && mark.line <= doc.lines)
        .map((mark) => ({ pos: doc.line(mark.line).from, kind: mark.kind, message: mark.message }))
        .sort(compareMarks);
}

/** Gelöscht heißt: reine Löschung, die die ganze Zeile samt einem Zeilenumbruch erfasst */
function isLineDeleted(transaction: Transaction, pos: number): boolean {
    const line = transaction.startState.doc.lineAt(pos);
    let deleted = false;
    transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
        const pureDeletion = fromB === toB;
        const coversLine = fromA <= line.from && toA >= line.to;
        const includesBreak = fromA < line.from || toA > line.to;
        if (pureDeletion && coversLine && includesBreak) deleted = true;
    });
    return deleted;
}

/** Neue Position der Marke (Zeilenanfang) oder `null`, wenn ihre Zeile gelöscht wurde */
function mappedPosition(mark: StoredMark, transaction: Transaction): number | null {
    if (isLineDeleted(transaction, mark.pos)) return null;
    const pos = transaction.changes.mapPos(mark.pos, 1, MapMode.Simple) ?? mark.pos;
    return transaction.newDoc.lineAt(pos).from;
}

/** Dasselbe Array, solange sich keine Marke verschiebt oder entfällt (die Markierungsspalte zeichnet dann nicht neu) */
function mapMarks(marks: readonly StoredMark[], transaction: Transaction): readonly StoredMark[] {
    if (marks.length === 0) return marks;
    const mapped: StoredMark[] = [];
    let isUnchanged = true;
    for (const mark of marks) {
        const pos = mappedPosition(mark, transaction);
        if (pos === null) {
            isUnchanged = false;
            continue;
        }
        if (pos !== mark.pos) isUnchanged = false;
        mapped.push(pos === mark.pos ? mark : { ...mark, pos });
    }
    return isUnchanged ? marks : mapped.sort(compareMarks);
}

/** Nur für Tests exportiert (Prüfung, dass unveränderte Marken dasselbe Array bleiben) */
export const gutterMarksField = StateField.define<readonly StoredMark[]>({
    create: () => [],
    update(marks, transaction) {
        let current = transaction.docChanged ? mapMarks(marks, transaction) : marks;
        for (const effect of transaction.effects) {
            if (effect.is(setGutterMarksEffect)) current = storeMarks(effect.value, transaction.state);
        }
        return current;
    },
});

/** Aktuelle Marken mit Zeilennummern des jetzigen Dokuments, sortiert nach Zeile und Priorität */
export function gutterMarksOf(state: EditorState): GutterMark[] {
    return state.field(gutterMarksField).map((mark) => ({
        line: state.doc.lineAt(mark.pos).number,
        kind: mark.kind,
        ...(mark.message === undefined ? {} : { message: mark.message }),
    }));
}

function marksOfLine(state: EditorState, line: number): StoredMark[] {
    if (line < 1 || line > state.doc.lines) return [];
    const { from } = state.doc.line(line);
    return state.field(gutterMarksField).filter((mark) => mark.pos === from);
}

/** Tooltip einer Zeile: Meldungen in der Reihenfolge Fehler, Warnung, Box, Git; leer ohne Marken */
export function gutterTooltipOf(state: EditorState, line: number): string {
    return marksOfLine(state, line)
        .map((mark) => mark.message ?? GIT_DEFAULT_MESSAGE[mark.kind] ?? '')
        .filter((text) => text !== '')
        .join('\n');
}

/** Darstellung einer Zeile: das stärkste Formzeichen und der Git-Streifen; `eq` verhindert unnötiges Neuzeichnen */
class LineMarksMarker extends GutterMarker {
    readonly elementClass: string;

    constructor(private readonly shapeClass: string, gitClass: string, private readonly title: string) {
        super();
        this.elementClass = gitClass;
    }

    eq(other: GutterMarker): boolean {
        return other instanceof LineMarksMarker
            && other.shapeClass === this.shapeClass
            && other.elementClass === this.elementClass
            && other.title === this.title;
    }

    toDOM(view: EditorView) {
        const wrapper = view.dom.ownerDocument.createElement('div');
        wrapper.className = 'cm-line-marks';
        if (this.title !== '') wrapper.title = this.title;
        if (this.shapeClass === '') return wrapper;
        const shape = view.dom.ownerDocument.createElement('span');
        shape.className = this.shapeClass;
        wrapper.append(shape);
        return wrapper;
    }
}

function firstClass(marks: readonly StoredMark[], classes: Readonly<Partial<Record<GutterMarkKind, string>>>): string {
    const found = marks.find((mark) => classes[mark.kind] !== undefined);
    return found === undefined ? '' : classes[found.kind]!;
}

function markerForLine(state: EditorState, marks: readonly StoredMark[]): LineMarksMarker {
    const line = state.doc.lineAt(marks[0]!.pos).number;
    return new LineMarksMarker(firstClass(marks, SHAPE_CLASS), firstClass(marks, GIT_CLASS), gutterTooltipOf(state, line));
}

function buildMarkers(state: EditorState): RangeSet<GutterMarker> {
    const builder = new RangeSetBuilder<GutterMarker>();
    const marks = state.field(gutterMarksField);
    let start = 0;
    while (start < marks.length) {
        let end = start + 1;
        while (end < marks.length && marks[end]!.pos === marks[start]!.pos) end += 1;
        builder.add(marks[start]!.pos, marks[start]!.pos, markerForLine(state, marks.slice(start, end)));
        start = end;
    }
    return builder.finish();
}

/** Gleicher Zustand → dieselbe Menge (CodeMirror ruft `markers` bei jedem Update) */
const markersCache = new WeakMap<object, RangeSet<GutterMarker>>();

function markersOf(view: EditorView): RangeSet<GutterMarker> {
    const marks = view.state.field(gutterMarksField);
    const cached = markersCache.get(marks);
    if (cached !== undefined) return cached;
    const built = buildMarkers(view.state);
    markersCache.set(marks, built);
    return built;
}

const marksChanged = (update: ViewUpdate): boolean =>
    update.startState.field(gutterMarksField) !== update.state.field(gutterMarksField);

const gutterTheme = EditorView.baseTheme({
    '.cm-gutter-marks': { width: MARK_COLUMN_WIDTH, overflow: 'hidden' },
    '.cm-gutter-marks .cm-gutterElement': { padding: '0', overflow: 'hidden', boxSizing: 'border-box' },
    '.cm-line-marks': { height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    '.cm-mark-shape-error, .cm-mark-shape-warning, .cm-mark-shape-box': {
        display: 'block',
        width: SHAPE_SIZE,
        height: SHAPE_SIZE,
    },
    '.cm-mark-shape-error': { borderRadius: '50%', backgroundColor: 'var(--editor-diagnostic-error)' },
    '.cm-mark-shape-warning': { clipPath: TRIANGLE_CLIP, backgroundColor: 'var(--editor-diagnostic-warning)' },
    '.cm-mark-shape-box': { clipPath: DIAMOND_CLIP, backgroundColor: 'var(--editor-diagnostic-hint)' },
    '.cm-mark-git-modified': {
        borderLeft: `${GIT_STRIPE_WIDTH} dashed var(--editor-git-modified, var(--editor-gutter-text))`,
    },
    '.cm-mark-git-added': {
        borderLeft: `${GIT_STRIPE_WIDTH} solid var(--editor-git-added, var(--editor-gutter-text))`,
    },
});

/**
 * Der Abstandhalter steht unsichtbar im DOM der Spalte; mit einer Formklasse zählte er wie eine echte Marke.
 * Die Breite legt ohnehin `MARK_COLUMN_WIDTH` fest.
 */
const spacerMarker = new LineMarksMarker('', '', '');

export function gutterExtension(_context: FeatureContext): Extension {
    return [
        gutterMarksField,
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        gutter({
            class: 'cm-gutter-marks',
            markers: markersOf,
            initialSpacer: () => spacerMarker,
            lineMarkerChange: marksChanged,
        }),
        gutterTheme,
    ];
}
