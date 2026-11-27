// Undefinierte Verweise im Text (W4-12, Vorlage: rote Unterstreichung des `ReferenceCheckStore` in Swift): `\ref`,
// `\cite` und Abkürzungen ohne Ziel im Projekt sind rot gestrichelt unterstrichen, die Meldung steht als Tooltip
// (`title`). Geprüft wird nie hier: Das Ergebnis kommt aus dem Index-Worker (`app/completionIndex*.ts`, entprellt bei
// Tippen und `fs:changed`) über den Hinweis-Store; diese Erweiterung setzt nur die Dekorationen der Sitzung.
//
// Positionen stammen aus dem Text, den der Worker gesehen hat. Hat sich der Text seither geändert, passt der Schlüssel
// nicht mehr an der Stelle: Solche Meldungen werden verworfen (die nächste Antwort ersetzt alles). Bis dahin wandern
// die Markierungen mit den Änderungen mit (`map`). Rot gestrichelt wie die Syntaxfehler aus `diagnostics.ts`.
import { StateEffect, StateField, Transaction } from '@codemirror/state';
import type { EditorState, Extension, Text, TransactionSpec } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { languageFromPath } from '../../shared/core/language';
import type { ReferenceProblem } from '../../shared/core/latex/referenceCheck';
import { hintsStore } from '../stores/hints';
import type { FeatureContext } from './extensions';

/** Woher die Probleme kommen (Tests liefern eine Fälschung, die App den Hinweis-Store) */
export interface ReferenceMarkSource {
    problemsFor(path: string): readonly ReferenceProblem[];
    /** Meldet jede Änderung des Ergebnisses; die Rückgabe meldet ab */
    subscribe(listener: () => void): () => void;
}

const appSource: ReferenceMarkSource = {
    problemsFor: (path) => hintsStore.getState().references.problems.find((entry) => entry.file === path)?.problems ?? [],
    subscribe: (listener) => hintsStore.subscribe((state, previous) => {
        if (state.references !== previous.references) listener();
    }),
};

export const REFERENCE_MARK_CLASS = 'cm-reference-error';

interface MarkSpec {
    readonly kind: ReferenceProblem['kind'];
    readonly message: string;
}

const setReferenceMarks = StateEffect.define<DecorationSet>();

/** Nur Meldungen, deren Schlüssel noch an der Stelle steht (sonst ist der Text inzwischen ein anderer) */
function decorationsOf(problems: readonly ReferenceProblem[], doc: Text): DecorationSet {
    const ranges = [];
    for (const problem of problems) {
        if (problem.end <= problem.start || problem.end > doc.length) continue;
        if (doc.sliceString(problem.start, problem.end) !== problem.key) continue;
        const spec: MarkSpec = { kind: problem.kind, message: problem.message };
        const mark = Decoration.mark({ class: REFERENCE_MARK_CLASS, attributes: { title: problem.message }, ...spec });
        ranges.push(mark.range(problem.start, problem.end));
    }
    return Decoration.set(ranges, true);
}

const referenceMarksField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
        for (const effect of tr.effects) if (effect.is(setReferenceMarks)) return effect.value;
        return tr.docChanged ? value.map(tr.changes) : value;
    },
    provide: (field) => EditorView.decorations.from(field),
});

/** Aktuelle Markierungen der Sitzung (Positionen wie im aktuellen Text), nach Position sortiert */
export function referenceMarksOf(state: EditorState): { start: number; end: number; kind: ReferenceProblem['kind']; message: string }[] {
    const value = state.field(referenceMarksField, false);
    if (value === undefined) return [];
    const marks = [];
    for (const cursor = value.iter(); cursor.value !== null; cursor.next()) {
        const { kind, message } = cursor.value.spec as MarkSpec;
        marks.push({ start: cursor.from, end: cursor.to, kind, message });
    }
    return marks;
}

/** Was der Treiber vom Editor braucht: `EditorView` erfüllt das, Tests nehmen eine einfache Fälschung */
export interface ReferenceMarksHost {
    readonly state: EditorState;
    dispatch(spec: TransactionSpec): void;
}

/** Holt das Ergebnis der Datei und setzt es ein, beim Start und bei jeder Änderung des Ergebnisses */
export class ReferenceMarksDriver {
    private destroyed = false;
    private readonly unsubscribe: () => void;

    constructor(private readonly host: ReferenceMarksHost, private readonly path: string, private readonly source: ReferenceMarkSource) {
        this.unsubscribe = source.subscribe(() => this.refresh());
    }

    refresh(): void {
        if (this.destroyed || this.host.state.field(referenceMarksField, false) === undefined) return;
        const marks = decorationsOf(this.source.problemsFor(this.path), this.host.state.doc);
        this.host.dispatch({ effects: setReferenceMarks.of(marks), annotations: Transaction.addToHistory.of(false) });
    }

    destroy(): void {
        this.destroyed = true;
        this.unsubscribe();
    }
}

/** Beim Aufbau läuft gerade eine Aktualisierung des Views: erst danach darf eingesetzt werden */
function startDriver(view: EditorView, path: string, source: ReferenceMarkSource): ReferenceMarksDriver {
    const driver = new ReferenceMarksDriver(view, path, source);
    queueMicrotask(() => driver.refresh());
    return driver;
}

/** Farbe aus `theme.ts`; der Rückfall hält die Linie sichtbar, solange kein Farbschema gesetzt ist */
const ERROR_COLOR = 'var(--editor-diagnostic-error, currentColor)';

const referenceMarksBaseTheme = EditorView.baseTheme({
    [`.${REFERENCE_MARK_CLASS}`]: { textDecoration: `underline dashed ${ERROR_COLOR}` },
});

export interface ReferenceMarksOptions {
    /** Standard: der Hinweis-Store der App */
    readonly source?: ReferenceMarkSource;
}

/** Markierungen für eine Sitzung (`path` = Schlüssel der Datei); BibTeX-Dateien haben keine Verweise */
export function referenceMarksExtension(context: FeatureContext, options: ReferenceMarksOptions = {}): Extension {
    if (languageFromPath(context.name ?? context.path) !== 'latex') return [];
    const source = options.source ?? appSource;
    return [
        referenceMarksField,
        referenceMarksBaseTheme,
        ViewPlugin.define((view) => {
            const driver = startDriver(view, context.path, source);
            return { destroy: () => driver.destroy() };
        }),
    ];
}
