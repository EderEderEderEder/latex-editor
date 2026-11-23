// Einfärbung im Editor (W1-4, Spike S1): eigenes `ViewPlugin` über dem `LineStateCache`. Dekorationen entstehen nur
// für den sichtbaren Bereich; nach einer Bearbeitung wird synchron höchstens bis `SYNC_MARGIN_LINES` hinter den
// Sichtbereich nachgerechnet, der Rest im Leerlauf. Nur CSS-Klassen, keine Farben (die kommen mit W1-11, `theme.ts`).
import { RangeSetBuilder } from '@codemirror/state';
import type { Extension, Text } from '@codemirror/state';
import { Decoration, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, EditorView, PluginValue, ViewUpdate } from '@codemirror/view';
import { languageFromPath } from '../../shared/core/language';
import type { SyntaxLanguage } from '../../shared/core/language';
import type { TokenKind } from '../../shared/core/latex/tokenizer';
import { LineStateCache, bibSyntax, latexSyntax, spliceFromChanges, textLineSource } from './lineStateCache';
import type { LineSource, LineSyntax } from './lineStateCache';

/** Zeilen, die nach einer Bearbeitung höchstens über den sichtbaren Bereich hinaus synchron nachgerechnet werden */
const SYNC_MARGIN_LINES = 200;
/** Zeilen je Leerlauf-Schritt; danach wird die verbleibende Leerlaufzeit geprüft */
const IDLE_CHUNK_LINES = 500;
/** Spätestens nach dieser Zeit läuft ein Leerlauf-Schritt auch ohne freie Zeit */
const IDLE_TIMEOUT_MS = 200;

/** CSS-Klasse je Token-Art; die Farben setzt das Farbschema (W1-11) */
export const TOKEN_CLASS_BY_KIND: Readonly<Record<TokenKind, string>> = {
    command: 'cm-syntax-command',
    delimiter: 'cm-syntax-delimiter',
    optionalArgument: 'cm-syntax-optional-argument',
    keyArgument: 'cm-syntax-key-argument',
    math: 'cm-syntax-math',
    comment: 'cm-syntax-comment',
    verbatim: 'cm-syntax-verbatim',
};

const MARK_BY_KIND = Object.fromEntries(
    Object.entries(TOKEN_CLASS_BY_KIND).map(([kind, className]) => [kind, Decoration.mark({ class: className })]),
) as Record<TokenKind, Decoration>;

/** Letzte sichtbare Zeile, 0-basiert */
function lastVisibleLine(view: EditorView): number {
    return view.state.doc.lineAt(view.viewport.to).number - 1;
}

class SyntaxHighlightPlugin<State> implements PluginValue {
    decorations: DecorationSet;
    private readonly cache: LineStateCache<State>;
    private idleHandle: number | null = null;

    constructor(private readonly view: EditorView, syntax: LineSyntax<State>) {
        this.cache = new LineStateCache(syntax, view.state.doc.lines);
        this.cache.ensureValid(this.source(), lastVisibleLine(view));
        this.decorations = this.buildDecorations();
        this.scheduleIdle();
    }

    update(update: ViewUpdate): void {
        if (!update.docChanged && !update.viewportChanged) return;
        const lastLine = lastVisibleLine(update.view);
        if (update.docChanged) {
            this.cancelIdle();
            this.applyChanges(update, lastLine + SYNC_MARGIN_LINES);
        }
        this.cache.ensureValid(this.source(), lastLine);
        this.decorations = this.buildDecorations();
        this.scheduleIdle();
    }

    destroy(): void {
        this.cancelIdle();
    }

    private applyChanges(update: ViewUpdate, syncLimitLine: number): void {
        const splice = spliceFromChanges(update.changes, update.startState.doc, update.state.doc);
        if (splice === null) return;
        this.cache.highlightEdit(this.source(), splice, syncLimitLine);
    }

    private source(): LineSource {
        return textLineSource(this.view.state.doc);
    }

    private buildDecorations(): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const doc = this.view.state.doc;
        const source = textLineSource(doc);
        let nextLine = 0;
        for (const range of this.view.visibleRanges) {
            const firstLine = Math.max(doc.lineAt(range.from).number - 1, nextLine);
            const lastLine = doc.lineAt(range.to).number - 1;
            for (let line = firstLine; line <= lastLine; line++) this.addLineDecorations(builder, source, doc, line);
            nextLine = Math.max(nextLine, lastLine + 1);
        }
        return builder.finish();
    }

    private addLineDecorations(builder: RangeSetBuilder<Decoration>, source: LineSource, doc: Text, line: number): void {
        const lineStart = doc.line(line + 1).from;
        for (const token of this.cache.tokensOfLine(source, line)) {
            builder.add(lineStart + token.from, lineStart + token.to, MARK_BY_KIND[token.kind]);
        }
    }

    private scheduleIdle(): void {
        if (this.idleHandle !== null || this.cache.isComplete) return;
        this.idleHandle = idleScheduler().request((deadline) => this.runIdle(deadline), { timeout: IDLE_TIMEOUT_MS });
    }

    private cancelIdle(): void {
        if (this.idleHandle === null) return;
        idleScheduler().cancel(this.idleHandle);
        this.idleHandle = null;
    }

    /** Mindestens ein Schritt je Aufruf, damit es auch bei abgelaufener Zeitgrenze (`didTimeout`) vorangeht */
    private runIdle(deadline: IdleDeadlineLike): void {
        this.idleHandle = null;
        const source = this.source();
        do {
            this.cache.advance(source, IDLE_CHUNK_LINES);
        } while (!this.cache.isComplete && deadline.timeRemaining() > 0);
        this.scheduleIdle();
    }
}

/** Minimaler Typ für `requestIdleCallback` (die Node-Typprüfung der Tests kennt keine DOM-Typen) */
interface IdleDeadlineLike {
    timeRemaining(): number;
}

interface IdleScheduler {
    request(callback: (deadline: IdleDeadlineLike) => void, options: { timeout: number }): number;
    cancel(handle: number): void;
}

function idleScheduler(): IdleScheduler {
    const scope = globalThis as unknown as {
        requestIdleCallback: IdleScheduler['request'];
        cancelIdleCallback: IdleScheduler['cancel'];
    };
    return { request: (callback, options) => scope.requestIdleCallback(callback, options), cancel: (handle) => scope.cancelIdleCallback(handle) };
}

function highlightPlugin<State>(syntax: LineSyntax<State>): Extension {
    return ViewPlugin.define((view) => new SyntaxHighlightPlugin(view, syntax), {
        decorations: (plugin) => plugin.decorations,
    });
}

const LATEX_HIGHLIGHTING = highlightPlugin(latexSyntax);
const BIB_HIGHLIGHTING = highlightPlugin(bibSyntax);

/** Einfärbung für LaTeX oder BibTeX; ein Sprachwechsel (Umbenennen) tauscht die Erweiterung per `Compartment` */
export function syntaxHighlighting(language: SyntaxLanguage): Extension {
    return language === 'bibtex' ? BIB_HIGHLIGHTING : LATEX_HIGHLIGHTING;
}

/** Einfärbung nach Dateiendung (`.bib` ist BibTeX, alles andere LaTeX) */
export function syntaxHighlightingForPath(path: string): Extension {
    return syntaxHighlighting(languageFromPath(path));
}
