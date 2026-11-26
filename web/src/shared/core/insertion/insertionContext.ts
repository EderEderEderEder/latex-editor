import { adjustBlock } from './blockPlacement';
import { lineContaining, lineContentEnd, lineStartsOf } from './lineStarts';
import { clampRange, rangeEnd, type TextRange } from './textRange';

/** Zeilen vor und nach der Cursorzeile */
export const SURROUNDING_LINES = 3;
const LINE_FEED = '\n';

/** Umgebung der Cursorposition für die Vorschau „an Ort und Stelle“: ganze Zeilen um den Cursor */
export interface InsertionContext {
    readonly fileName: string;
    readonly excerpt: string;
    /** Auswahl bzw. Cursor, bezogen auf `excerpt` */
    readonly selection: TextRange;
    /** 1-basiert */
    readonly firstLineNumber: number;
}

export interface InsertionLine {
    /** 1-basiert, wie im Editor */
    readonly number: number;
    readonly text: string;
    /** Gehört (ganz oder teilweise) zum eingefügten Text */
    readonly isNew: boolean;
}

export function makeInsertionContext(text: string, selection: TextRange, fileName: string): InsertionContext {
    const clamped = clampRange(selection, text.length);
    const starts = lineStartsOf(text);
    const cursorLine = lineContaining(starts, text.length, clamped.location);
    const endLine = lineContaining(starts, text.length, rangeEnd(clamped));
    const firstLine = Math.max(0, cursorLine - SURROUNDING_LINES);
    const lastLine = Math.min(starts.length - 1, endLine + SURROUNDING_LINES);
    const start = starts[firstLine]!;
    return {
        fileName,
        excerpt: text.slice(start, lineContentEnd(starts, text.length, lastLine)),
        selection: { location: clamped.location - start, length: clamped.length },
        firstLineNumber: firstLine + 1,
    };
}

/** Zeile des Cursors (1-basiert) für „Einfügen in datei.tex, Zeile 42“ */
export function cursorLineNumber(context: InsertionContext): number {
    const prefix = context.excerpt.slice(0, Math.min(context.selection.location, context.excerpt.length));
    return context.firstLineNumber + prefix.split(LINE_FEED).length - 1;
}

function isNewLine(fullStart: number, fullEnd: number, newRange: TextRange): boolean {
    const overlap = Math.min(fullEnd, rangeEnd(newRange)) - Math.max(fullStart, newRange.location);
    return newRange.length > 0 && overlap > 0 && fullStart !== rangeEnd(newRange);
}

/** Der Ausschnitt nach dem Einfügen, Zeile für Zeile; Blöcke stehen wie im Editor in eigenen Zeilen */
export function insertionLines(context: InsertionContext, code: string, isBlock: boolean, replacesSelection: boolean): InsertionLine[] {
    const original = context.excerpt;
    const { selection } = context;
    const range = replacesSelection ? selection : { location: rangeEnd(selection), length: 0 };
    const inserted = isBlock ? adjustBlock(code, original, range) : code;
    const result = original.slice(0, range.location) + inserted + original.slice(rangeEnd(range));
    const newRange = { location: range.location, length: inserted.length };
    const starts = lineStartsOf(result);
    return starts.map((start, line) => {
        const contentEnd = lineContentEnd(starts, result.length, line);
        const fullEnd = line + 1 < starts.length ? starts[line + 1]! : result.length;
        return { number: context.firstLineNumber + line, text: result.slice(start, contentEnd), isNew: isNewLine(start, fullEnd, newRange) };
    });
}
