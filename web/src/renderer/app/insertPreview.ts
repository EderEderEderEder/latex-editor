// Einfügen-Fenster (W4-10): Vorschau-Zeilen mit Einfärbung wie im Editor. Die Zeilen kommen aus `insertionLines`
// (Ausschnitt um die Cursorstelle mit den neuen Zeilen); gefärbt wird mit denselben Tokenizern wie der Editor, die
// Farben liefern die Variablen `--editor-syntax-<art>`. Reine Logik ohne DOM.
import { INITIAL_BIB_STATE, tokenizeBibLine } from '../../shared/core/bib/tokenizer';
import type { BibLexState } from '../../shared/core/bib/tokenizer';
import type { InsertionLine } from '../../shared/core/insertion';
import { NORMAL_STATE, tokenizeLine } from '../../shared/core/latex/tokenizer';
import type { LexState } from '../../shared/core/latex/tokenizer';

export type PreviewLanguage = 'latex' | 'bibtex';

/** Ein Stück einer Zeile; `kind` nennt die Token-Art für die Farbe, `null` ist normaler Text */
export interface PreviewSegment {
    readonly text: string;
    readonly kind: string | null;
}

export interface PreviewRow {
    readonly number: number;
    readonly segments: readonly PreviewSegment[];
    readonly text: string;
    readonly isNew: boolean;
}

interface Span {
    readonly kind: string;
    readonly location: number;
    readonly length: number;
}

/** Zerlegt eine Zeile in Stücke; Spannen, die vor dem schon Gesetzten beginnen, werden gekürzt oder übersprungen */
export function segmentsOf(text: string, spans: readonly Span[]): PreviewSegment[] {
    const segments: PreviewSegment[] = [];
    let position = 0;
    for (const span of [...spans].sort((left, right) => left.location - right.location)) {
        const start = Math.max(span.location, position);
        const end = Math.min(span.location + span.length, text.length);
        if (end <= start) continue;
        if (start > position) segments.push({ text: text.slice(position, start), kind: null });
        segments.push({ text: text.slice(start, end), kind: span.kind });
        position = end;
    }
    if (position < text.length) segments.push({ text: text.slice(position), kind: null });
    return segments;
}

function latexSpans(lines: readonly InsertionLine[]): Span[][] {
    let state: LexState = NORMAL_STATE;
    return lines.map((line) => {
        const result = tokenizeLine(line.text, state);
        state = result.state;
        return result.tokens;
    });
}

function bibSpans(lines: readonly InsertionLine[]): Span[][] {
    let state: BibLexState = INITIAL_BIB_STATE;
    return lines.map((line) => {
        const result = tokenizeBibLine(line.text, 0, state);
        state = result.state;
        return result.tokens.map((token) => ({ kind: token.kind, location: token.from, length: token.to - token.from }));
    });
}

export function previewRows(lines: readonly InsertionLine[], language: PreviewLanguage): PreviewRow[] {
    const spans = language === 'bibtex' ? bibSpans(lines) : latexSpans(lines);
    return lines.map((line, index) => ({
        number: line.number,
        text: line.text,
        isNew: line.isNew,
        segments: segmentsOf(line.text, spans[index] ?? []),
    }));
}

/** Index der ersten neuen Zeile (dorthin scrollt die Vorschau), sonst `null` */
export function firstNewRowIndex(rows: readonly PreviewRow[]): number | null {
    const index = rows.findIndex((row) => row.isNew);
    return index < 0 ? null : index;
}
