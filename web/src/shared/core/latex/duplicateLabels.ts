/**
 * Labels, die im Projekt mehr als einmal definiert sind: LaTeX warnt („multiply defined“), und jeder Verweis darauf
 * führt zu einer der beiden Stellen, je nach Reihenfolge. Port von `DuplicateLabelChecker` (Swift).
 * Dateipfade müssen vom Aufrufer schon normalisiert sein (gleiche Schreibweise für dieselbe Datei).
 */
import { scanReferencesMasked } from './masking';
import type { TextMark } from './syntaxChecker';

export interface LabelEntry {
    readonly label: string;
    readonly file: string;
    /** 1-basiert */
    readonly line: number;
}

export type DuplicateLabels = ReadonlyMap<string, readonly LabelEntry[]>;

/** Nur die mehrfach definierten Labels, mit allen Stellen (Reihenfolge wie in der Eingabe) */
export function findDuplicateLabels(labels: readonly LabelEntry[]): Map<string, LabelEntry[]> {
    const groups = new Map<string, LabelEntry[]>();
    for (const entry of labels) {
        const group = groups.get(entry.label);
        if (group) group.push(entry);
        else groups.set(entry.label, [entry]);
    }
    for (const [label, group] of groups) {
        if (group.length < 2) groups.delete(label);
    }
    return groups;
}

function compareText(first: string, second: string): number {
    if (first === second) return 0;
    return first < second ? -1 : 1;
}

/** Alle Stellen mehrfach definierter Labels als flache Liste (Seitenleiste), nach Label, Datei und Zeile sortiert */
export function duplicateLabelEntries(labels: readonly LabelEntry[]): LabelEntry[] {
    return [...findDuplicateLabels(labels).values()]
        .flat()
        .sort((a, b) => compareText(a.label, b.label) || compareText(a.file, b.file) || a.line - b.line);
}

function fileName(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}

function lineOf(lineStarts: readonly number[], location: number): number {
    let low = 0;
    let high = lineStarts.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if ((lineStarts[middle] ?? 0) <= location) low = middle + 1;
        else high = middle;
    }
    return low;
}

function computeLineStarts(text: string): number[] {
    const starts = [0];
    for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) starts.push(index + 1);
    return starts;
}

function duplicateMessage(label: string, others: readonly LabelEntry[], file: string): string {
    const [other] = others;
    if (!other) return '';
    const place = other.file === file ? `Zeile ${other.line}` : `${fileName(other.file)}, Zeile ${other.line}`;
    const more = others.length > 1 ? ` (insgesamt ${others.length + 1} Stellen)` : '';
    return `Das Label „${label}“ ist mehrfach definiert, auch in ${place}${more}. Verweise treffen nur eine der Stellen.`;
}

/** Markiert `\label{…}` dieser Datei, deren Name auch anderswo (oder weiter oben) definiert wird (Warnung auf dem Schlüssel) */
export function duplicateLabelMarks(masked: string, file: string, duplicates: DuplicateLabels): TextMark[] {
    if (duplicates.size === 0) return [];
    const occurrences = scanReferencesMasked(masked).filter((occurrence) => occurrence.kind === 'labelDefinition' && duplicates.has(occurrence.key));
    if (occurrences.length === 0) return [];
    const lineStarts = computeLineStarts(masked);
    const marks: TextMark[] = [];
    for (const occurrence of occurrences) {
        const line = lineOf(lineStarts, occurrence.start);
        const others = (duplicates.get(occurrence.key) ?? []).filter((entry) => !(entry.file === file && entry.line === line));
        if (others.length === 0) continue;
        const message = duplicateMessage(occurrence.key, others, file);
        marks.push({ severity: 'warning', start: occurrence.start, end: occurrence.end, message });
    }
    return marks;
}
