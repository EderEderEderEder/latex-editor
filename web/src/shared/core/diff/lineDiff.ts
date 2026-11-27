/**
 * Zeilen-Diff mit Wort-Hervorhebung. Port von `LineDiff.swift`. Reine Logik: aus den Zeilen lässt sich der alte
 * bzw. neue Text exakt wiederherstellen (bis auf den abschließenden Zeilenumbruch).
 */
import { editScript } from './editScript';
import { splitLines } from './splitLines';
import { codePointLength, tokenize } from './tokenize';

export type DiffLineKind = 'context' | 'removed' | 'added';

/** Teil einer Diff-Zeile; `isChanged` markiert geänderte Wörter innerhalb einer geänderten Zeile */
export interface DiffSegment {
    readonly text: string;
    readonly isChanged: boolean;
}

export interface DiffLine {
    readonly kind: DiffLineKind;
    /** 1-basiert; `null` bei hinzugefügten Zeilen */
    readonly oldNumber: number | null;
    /** 1-basiert; `null` bei entfernten Zeilen */
    readonly newNumber: number | null;
    readonly segments: readonly DiffSegment[];
}

export interface ComputeOptions {
    /** `false` spart die Wort-Hervorhebung (z. B. für Änderungsmarken im Editor) */
    readonly highlightingWords?: boolean;
}

/** Mehr Bearbeitungsschritte rechnet Myers nicht; danach gilt der Rest als ersetzt (Speicher O(D²)) */
export const MAXIMUM_LINE_EDITS = 2000;
export const MAXIMUM_WORD_EDITS = 400;
/** Mindestanteil gemeinsamer Zeichen, damit zwei Zeilen als „dieselbe Zeile, geändert“ gelten */
export const MINIMUM_SIMILARITY = 0.3;

export function diffLineText(line: DiffLine): string {
    return line.segments.map((segment) => segment.text).join('');
}

export function computeLineDiff(oldText: string, newText: string, options: ComputeOptions = {}): DiffLine[] {
    const oldLines = splitLines(oldText);
    const newLines = splitLines(newText);
    const script = editScript(oldLines, newLines, MAXIMUM_LINE_EDITS);
    const lines = buildLines(oldLines, newLines, script.removed, script.inserted);
    if (options.highlightingWords ?? true) highlightWords(lines);
    return lines;
}

function plainLine(kind: DiffLineKind, text: string, oldNumber: number | null, newNumber: number | null): DiffLine {
    return { kind, oldNumber, newNumber, segments: [{ text, isChanged: false }] };
}

/** Entfernte Zeilen stehen vor hinzugefügten */
function buildLines(old: readonly string[], next: readonly string[], removed: readonly boolean[], inserted: readonly boolean[]): DiffLine[] {
    const lines: DiffLine[] = [];
    let i = 0;
    let j = 0;
    while (i < old.length || j < next.length) {
        if (i < old.length && removed[i]) {
            lines.push(plainLine('removed', old[i] as string, i + 1, null));
            i += 1;
        } else if (j < next.length && inserted[j]) {
            lines.push(plainLine('added', next[j] as string, null, j + 1));
            j += 1;
        } else {
            lines.push(plainLine('context', next[j] ?? '', i + 1, j + 1));
            i += 1;
            j += 1;
        }
    }
    return lines;
}

/**
 * Paart in jedem Änderungsblock die k-te entfernte mit der k-ten hinzugefügten Zeile und markiert die geänderten
 * Wörter, wenn sich die Zeilen ähnlich genug sind.
 */
function highlightWords(lines: DiffLine[]): void {
    let index = 0;
    while (index < lines.length) {
        if (lines[index]?.kind === 'context') {
            index += 1;
            continue;
        }
        const removedStart = index;
        while (lines[index]?.kind === 'removed') index += 1;
        const addedStart = index;
        while (lines[index]?.kind === 'added') index += 1;
        const pairCount = Math.min(addedStart - removedStart, index - addedStart);
        for (let offset = 0; offset < pairCount; offset += 1) {
            highlightPair(lines, removedStart + offset, addedStart + offset);
        }
    }
}

function totalLength(tokens: readonly string[]): number {
    return tokens.reduce((sum, token) => sum + codePointLength(token), 0);
}

function highlightPair(lines: DiffLine[], removedIndex: number, addedIndex: number): void {
    const oldTokens = tokenize(diffLineText(lines[removedIndex] as DiffLine));
    const newTokens = tokenize(diffLineText(lines[addedIndex] as DiffLine));
    const script = editScript(oldTokens, newTokens, MAXIMUM_WORD_EDITS);
    const common = oldTokens.reduce((sum, token, index) => sum + (script.removed[index] ? 0 : codePointLength(token)), 0);
    const longest = Math.max(totalLength(oldTokens), totalLength(newTokens));
    if (longest === 0 || common / longest < MINIMUM_SIMILARITY) return;
    lines[removedIndex] = { ...(lines[removedIndex] as DiffLine), segments: mergeSegments(oldTokens, script.removed) };
    lines[addedIndex] = { ...(lines[addedIndex] as DiffLine), segments: mergeSegments(newTokens, script.inserted) };
}

/** Fasst benachbarte Tokens gleichen Zustands zusammen */
function mergeSegments(tokens: readonly string[], changed: readonly boolean[]): DiffSegment[] {
    const segments: DiffSegment[] = [];
    let buffer = '';
    let bufferChanged = false;
    tokens.forEach((token, index) => {
        const isChanged = changed[index] === true;
        if (isChanged !== bufferChanged && buffer.length > 0) {
            segments.push({ text: buffer, isChanged: bufferChanged });
            buffer = '';
        }
        buffer += token;
        bufferChanged = isChanged;
    });
    if (buffer.length > 0) segments.push({ text: buffer, isChanged: bufferChanged });
    return segments;
}
