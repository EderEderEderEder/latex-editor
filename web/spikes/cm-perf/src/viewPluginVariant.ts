// Variante B: eigenes `ViewPlugin` mit Zeilenzustands-Cache; Dekorationen nur für den
// sichtbaren Bereich, Zustände hinter dem sichtbaren Bereich im Leerlauf nachrechnen.
import { RangeSetBuilder } from '@codemirror/state';
import type { Extension, Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, PluginValue, ViewUpdate } from '@codemirror/view';
import { LineStateCache } from './lineStateCache';
import { tokenizeLine } from './tokenizer';
import type { LineToken, TokenKind } from './tokenizer';

/** Zeilen, die beim Tippen höchstens über den sichtbaren Bereich hinaus synchron nachgerechnet werden. */
const SYNC_MARGIN_LINES = 200;
const IDLE_CHUNK_LINES = 500;
const IDLE_SLICE_MS = 8;
const IDLE_TIMEOUT_MS = 200;

const MARK_BY_KIND: Record<TokenKind, Decoration> = {
    command: Decoration.mark({ class: 'cmp-command' }),
    delimiter: Decoration.mark({ class: 'cmp-delimiter' }),
    keyArgument: Decoration.mark({ class: 'cmp-key' }),
    math: Decoration.mark({ class: 'cmp-math' }),
    comment: Decoration.mark({ class: 'cmp-comment' }),
    verbatim: Decoration.mark({ class: 'cmp-verbatim' }),
};

const theme = EditorView.baseTheme({
    '.cmp-command': { color: '#1f5fbf' },
    '.cmp-delimiter': { color: '#8a5a00' },
    '.cmp-key': { color: '#6b3fa0' },
    '.cmp-math': { color: '#0b7a3e' },
    '.cmp-comment': { color: '#888888', fontStyle: 'italic' },
    '.cmp-verbatim': { color: '#a0303a' },
});

function lastVisibleLine(view: EditorView): number {
    return view.state.doc.lineAt(view.viewport.to).number;
}

class LatexHighlighter implements PluginValue {
    decorations: DecorationSet;
    private readonly cache = new LineStateCache();
    private idleHandle: number | null = null;
    private readonly lineTokens: LineToken[] = [];

    constructor(private readonly view: EditorView) {
        this.cache.ensureValid(view.state.doc, lastVisibleLine(view));
        this.decorations = this.buildDecorations();
        this.scheduleIdle();
    }

    update(update: ViewUpdate): void {
        if (!update.docChanged && !update.viewportChanged) return;
        const lastLine = lastVisibleLine(update.view);
        if (update.docChanged) {
            this.cache.applyChanges(update.changes, update.startState.doc, update.state.doc, lastLine + SYNC_MARGIN_LINES);
        }
        this.cache.ensureValid(update.state.doc, lastLine);
        this.decorations = this.buildDecorations();
        this.scheduleIdle();
    }

    destroy(): void {
        if (this.idleHandle !== null) cancelIdleCallback(this.idleHandle);
    }

    private buildDecorations(): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        const doc = this.view.state.doc;
        let lastLine = 0;
        for (const range of this.view.visibleRanges) {
            let line = Math.max(doc.lineAt(range.from).number, lastLine + 1);
            const endLine = doc.lineAt(range.to).number;
            for (; line <= endLine; line++) this.addLineDecorations(builder, doc, line);
            lastLine = endLine;
        }
        return builder.finish();
    }

    private addLineDecorations(builder: RangeSetBuilder<Decoration>, doc: Text, lineNumber: number): void {
        const line = doc.line(lineNumber);
        this.lineTokens.length = 0;
        tokenizeLine(line.text, this.cache.startStateOf(lineNumber), this.lineTokens);
        for (const token of this.lineTokens) {
            builder.add(line.from + token.from, line.from + token.to, MARK_BY_KIND[token.kind]);
        }
    }

    private scheduleIdle(): void {
        if (this.idleHandle !== null || this.cache.validLineCount >= this.view.state.doc.lines) return;
        this.idleHandle = requestIdleCallback(() => this.runIdle(), { timeout: IDLE_TIMEOUT_MS });
    }

    private runIdle(): void {
        this.idleHandle = null;
        const deadline = performance.now() + IDLE_SLICE_MS;
        const isDone = this.cache.advanceUntil(this.view.state.doc, deadline, IDLE_CHUNK_LINES);
        if (!isDone) this.scheduleIdle();
    }
}

const latexHighlighter = ViewPlugin.fromClass(LatexHighlighter, {
    decorations: (plugin) => plugin.decorations,
});

export function viewPluginExtension(): Extension {
    return [latexHighlighter, theme];
}
