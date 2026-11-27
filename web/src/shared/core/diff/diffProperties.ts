import { diffLineText, type DiffLine } from './lineDiff';
import type { EditScript } from './editScript';

/** Aus den Diff-Zeilen wiederhergestellte Texte (Zeilen ohne Trenner) */
export interface ReconstructedLines {
    readonly old: string[];
    readonly new: string[];
}

export function reconstructFromDiff(lines: readonly DiffLine[]): ReconstructedLines {
    return {
        old: lines.filter((line) => line.kind !== 'added').map(diffLineText),
        new: lines.filter((line) => line.kind !== 'removed').map(diffLineText),
    };
}

/**
 * Wendet ein Bearbeitungsskript auf die alten Elemente an: entfernte fallen weg, eingefügte kommen aus `next`.
 * Bei einem gültigen Skript ergibt das genau `next`.
 */
export function applyEditScript(old: readonly string[], next: readonly string[], script: EditScript): string[] {
    const result: string[] = [];
    let i = 0;
    let j = 0;
    while (i < old.length || j < next.length) {
        if (i < old.length && script.removed[i]) {
            i += 1;
        } else if (j < next.length && script.inserted[j]) {
            result.push(next[j] as string);
            j += 1;
        } else {
            result.push(old[i] ?? '');
            i += 1;
            j += 1;
        }
    }
    return result;
}
