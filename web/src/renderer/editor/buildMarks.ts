// Marken des Builds im Text (W2-12): Fehler, Warnungen und Boxen aus dem Bericht unterstreichen die Zeile der Meldung
// (wellig bzw. doppelt, getrennt von den gestrichelten Syntaxmeldungen aus `diagnostics.ts`) und stehen als Formen in
// der Zeilenleiste (`gutter.ts`). Die Unterstreichungen liegen als Dekorationen im Zustand der Sitzung und wandern mit
// Änderungen mit; der nächste Build ersetzt sie (`setBuildMarks`). Zeilennummern sind 1-basiert.
import { StateEffect, StateField, Transaction } from '@codemirror/state';
import type { EditorState, Extension, Text, TransactionSpec } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import type { BuildIssue } from '../../shared/contract';
import { gutterMarksOf, setGutterMarks } from './gutter';
import type { GutterMark } from './gutter';

export type BuildMarkSeverity = 'error' | 'warning' | 'badBox';

export interface BuildMark {
    readonly line: number;
    readonly severity: BuildMarkSeverity;
    readonly message: string;
}

export interface TextRange {
    readonly from: number;
    readonly to: number;
}

/** Was eine Sitzung für die Marken braucht (`EditorSession` erfüllt es) */
export interface BuildMarkTarget {
    readonly state: EditorState;
    dispatch(...specs: TransactionSpec[]): void;
}

const SEVERITY_CLASS: Readonly<Record<BuildMarkSeverity, string>> = {
    error: 'cm-build-mark-error',
    warning: 'cm-build-mark-warning',
    badBox: 'cm-build-mark-box',
};

const GUTTER_KIND: Readonly<Record<BuildMarkSeverity, GutterMark['kind']>> = {
    error: 'error',
    warning: 'warning',
    badBox: 'box',
};

const GIT_KINDS: ReadonlySet<GutterMark['kind']> = new Set(['gitModified', 'gitAdded']);
const UNDERLINE_THICKNESS = '1px';

/** Meldungsart → Markenart; `info` und alles ohne Zeile bekommen keine Marke */
export function markSeverityOf(issue: BuildIssue): BuildMarkSeverity | null {
    if (issue.line === null || !Number.isInteger(issue.line) || issue.line < 1) return null;
    if (issue.severity === 'error' || issue.severity === 'warning' || issue.severity === 'badBox') return issue.severity;
    return null;
}

/** Marken einer Datei aus ihren Meldungen (der Aufrufer hat schon nach Datei gefiltert) */
export function marksOfIssues(issues: readonly BuildIssue[]): BuildMark[] {
    const marks: BuildMark[] = [];
    for (const issue of issues) {
        const severity = markSeverityOf(issue);
        if (severity !== null && issue.line !== null) marks.push({ line: issue.line, severity, message: issue.message });
    }
    return marks;
}

/** Zeilenbereich der Meldung: von der ersten bis zur letzten nicht leeren Stelle; `null` für leere oder fehlende Zeilen */
export function lineRangeOf(doc: Text, line: number): TextRange | null {
    if (!Number.isInteger(line) || line < 1 || line > doc.lines) return null;
    const { from, text } = doc.line(line);
    const trimmedStart = text.length - text.trimStart().length;
    const trimmedEnd = text.trimEnd().length;
    if (trimmedEnd <= trimmedStart) return null;
    return { from: from + trimmedStart, to: from + trimmedEnd };
}

export const setBuildMarksEffect = StateEffect.define<readonly BuildMark[]>();

interface MarkValue {
    readonly severity: BuildMarkSeverity;
    readonly message: string;
}

function decorationOf(mark: BuildMark): Decoration {
    const value: MarkValue = { severity: mark.severity, message: mark.message };
    return Decoration.mark({ class: SEVERITY_CLASS[mark.severity], attributes: { title: mark.message }, ...value });
}

function buildDecorations(marks: readonly BuildMark[], doc: Text): DecorationSet {
    const ranges = [];
    for (const mark of marks) {
        const range = lineRangeOf(doc, mark.line);
        if (range !== null) ranges.push(decorationOf(mark).range(range.from, range.to));
    }
    return Decoration.set(ranges, true);
}

const buildMarksField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(decorations, transaction) {
        let current = transaction.docChanged ? decorations.map(transaction.changes) : decorations;
        for (const effect of transaction.effects) {
            if (effect.is(setBuildMarksEffect)) current = buildDecorations(effect.value, transaction.newDoc);
        }
        return current;
    },
    provide: (field) => EditorView.decorations.from(field),
});

/** Aktuelle Unterstreichungen mit Positionen im jetzigen Text (für Tests und Anzeige) */
export function buildMarksOf(state: EditorState): { severity: BuildMarkSeverity; from: number; to: number; message: string }[] {
    const found = [];
    for (const cursor = state.field(buildMarksField).iter(); cursor.value !== null; cursor.next()) {
        const { severity, message } = cursor.value.spec as MarkValue;
        found.push({ severity, from: cursor.from, to: cursor.to, message });
    }
    return found;
}

/** Marken der Zeilenleiste für den Bericht dieser Datei (jede Meldung eine Marke mit Text als Tooltip) */
export function gutterMarksForBuild(marks: readonly BuildMark[]): GutterMark[] {
    return marks.map((mark) => ({ line: mark.line, kind: GUTTER_KIND[mark.severity], message: mark.message }));
}

/** Ersetzt nur die Build-Marken der Zeilenleiste; Git-Streifen bleiben stehen (`setGutterMarks` ersetzt alles) */
export function mergeGutterMarks(existing: readonly GutterMark[], build: readonly GutterMark[]): GutterMark[] {
    return [...existing.filter((mark) => GIT_KINDS.has(mark.kind)), ...build];
}

/** Setzt Unterstreichungen und Marken der Zeilenleiste einer Sitzung; ohne Verlauf, nie eine Textänderung */
export function applyBuildMarks(target: BuildMarkTarget, marks: readonly BuildMark[]): void {
    const gutter = mergeGutterMarks(gutterMarksOf(target.state), gutterMarksForBuild(marks));
    target.dispatch({
        effects: [setBuildMarksEffect.of(marks), setGutterMarks(gutter)],
        annotations: Transaction.addToHistory.of(false),
    });
}

/** Farben aus `theme.ts`; der Rückfall greift, solange kein Farbschema gesetzt ist */
const color = (severity: 'error' | 'warning' | 'hint'): string => `var(--editor-diagnostic-${severity}, currentColor)`;

const buildMarksTheme = EditorView.baseTheme({
    '.cm-build-mark-error': {
        textDecoration: `underline wavy ${color('error')}`, textDecorationThickness: UNDERLINE_THICKNESS,
    },
    '.cm-build-mark-warning': {
        textDecoration: `underline wavy ${color('warning')}`, textDecorationThickness: UNDERLINE_THICKNESS,
    },
    '.cm-build-mark-box': {
        textDecoration: `underline double ${color('hint')}`, textDecorationThickness: UNDERLINE_THICKNESS,
    },
});

export function buildMarksExtension(): Extension {
    return [buildMarksField, buildMarksTheme];
}
