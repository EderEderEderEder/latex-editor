// CodeMirror-Bausteine für Spike S8: `spellcheck`-Attribut, Syntax-Spans mit `spellcheck="false"` (Weg a)
// und eigene Fehler-Dekorationen aus dem Worker (Weg b).
import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { NORMAL_STATE, tokenizeLineWithOffset } from '../../../src/shared/core/latex/tokenizer';

const syntaxMark = Decoration.mark({ attributes: { spellcheck: 'false' }, class: 'cm-spike-syntax' });
const errorMark = Decoration.mark({ class: 'cm-spike-error' });

export function spellcheckAttribute(enabled: boolean): Extension {
    return EditorView.contentAttributes.of({ spellcheck: enabled ? 'true' : 'false' });
}

/** Ganzes Dokument tokenisieren (nur für das kleine Prüfdokument), Tokens als Spans ohne Rechtschreibprüfung */
function buildSyntaxMarks(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    let state: Parameters<typeof tokenizeLineWithOffset>[2] = NORMAL_STATE;
    for (let number = 1; number <= view.state.doc.lines; number++) {
        const line = view.state.doc.line(number);
        const result = tokenizeLineWithOffset(line.text, line.from, state);
        for (const token of result.tokens) {
            if (token.length > 0) builder.add(token.location, token.location + token.length, syntaxMark);
        }
        state = result.state;
    }
    return builder.finish();
}

export const syntaxWithoutSpellcheck: Extension = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
            this.decorations = buildSyntaxMarks(view);
        }
        update(update: ViewUpdate): void {
            if (update.docChanged) this.decorations = buildSyntaxMarks(update.view);
        }
    },
    { decorations: (plugin) => plugin.decorations },
);

export const setSpellErrors = StateEffect.define<readonly [number, number][]>();

export const spellErrorField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, transaction) {
        let next = value.map(transaction.changes);
        for (const effect of transaction.effects) {
            if (!effect.is(setSpellErrors)) continue;
            next = Decoration.set(effect.value.map(([from, to]) => errorMark.range(from, to)));
        }
        return next;
    },
    provide: (field) => EditorView.decorations.from(field),
});
