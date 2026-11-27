import type { DiffLine } from './lineDiff';

/** Eine sichtbare Zeile der Diff-Ansicht: eine Diff-Zeile oder ein eingeklappter Bereich unveränderter Zeilen */
export type DiffRow =
    | { readonly kind: 'line'; readonly index: number }
    /** `start` (Index der ersten versteckten Zeile) identifiziert den Bereich beim Aufklappen */
    | { readonly kind: 'collapsed'; readonly start: number; readonly count: number };

export const CONTEXT_LINES = 3;
/** Kürzere Bereiche bleiben offen, ein „… 1 unveränderte Zeile“ wäre unnötig */
export const MINIMUM_COLLAPSED_LINES = 4;

interface ContextRun {
    readonly from: number;
    readonly to: number;
}

/**
 * Klappt unveränderte Bereiche ein, die weiter als `context` Zeilen von einer Änderung entfernt sind.
 * `expanded` enthält die Startindizes (`start`) der aufgeklappten Bereiche. Port von `DiffLayout.rows`.
 */
export function layoutDiffRows(
    lines: readonly Pick<DiffLine, 'kind'>[],
    context: number = CONTEXT_LINES,
    expanded: ReadonlySet<number> = new Set(),
): DiffRow[] {
    const rows: DiffRow[] = [];
    let index = 0;
    while (index < lines.length) {
        if (lines[index]?.kind !== 'context') {
            rows.push({ kind: 'line', index });
            index += 1;
            continue;
        }
        const from = index;
        while (lines[index]?.kind === 'context') index += 1;
        appendContextRun({ from, to: index }, lines.length, context, expanded, rows);
    }
    return rows;
}

function lineRows(from: number, to: number): DiffRow[] {
    return Array.from({ length: to - from }, (_, offset): DiffRow => ({ kind: 'line', index: from + offset }));
}

function appendContextRun(run: ContextRun, total: number, context: number, expanded: ReadonlySet<number>, rows: DiffRow[]): void {
    const keepBefore = run.from === 0 ? 0 : context;
    const keepAfter = run.to === total ? 0 : context;
    const hiddenStart = run.from + keepBefore;
    const hiddenEnd = run.to - keepAfter;
    if (hiddenEnd - hiddenStart < MINIMUM_COLLAPSED_LINES || expanded.has(hiddenStart)) {
        rows.push(...lineRows(run.from, run.to));
        return;
    }
    rows.push(...lineRows(run.from, hiddenStart));
    rows.push({ kind: 'collapsed', start: hiddenStart, count: hiddenEnd - hiddenStart });
    rows.push(...lineRows(hiddenEnd, run.to));
}
