// „Schnell öffnen“ (Strg+P): unscharfe Suche über Projektdateien, Gewichtung wie `QuickOpenMatcher` der Swift-Version.
// Die Zeichen der Eingabe müssen in dieser Reihenfolge im Pfad vorkommen; Treffer im Dateinamen zählen mehr.

export interface QuickOpenFile {
    /** Pfad relativ zum Projektordner mit „/“ als Trenner */
    readonly path: string;
    readonly isOpen?: boolean;
}

export const QUICK_OPEN_LIMIT = 50;

const SUBSTRING_IN_NAME = 1_000;
const PREFIX_OF_NAME = 500;
const SUBSEQUENCE_IN_NAME = 600;
const SUBSEQUENCE_IN_PATH = 300;
const OPEN_FILE_BONUS = 50;
const CONSECUTIVE_BONUS = 10;

/** Wie `localizedStandardCompare`: Zahlen im Text als Zahlen, Groß-/Kleinschreibung egal */
const pathCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'accent' });

export function fileNameOf(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}

export function folderOf(path: string): string {
    const slash = path.lastIndexOf('/');
    return slash < 0 ? '' : path.slice(0, slash);
}

export function normalizeQuery(query: string): string {
    return query.trim().toLowerCase();
}

/** Anzahl direkt aufeinanderfolgender Treffer, `null`, wenn `needle` keine Teilfolge von `text` ist */
function consecutiveRuns(needle: string, text: string): number | null {
    const wanted = Array.from(needle);
    let next = 0;
    let previousMatched = false;
    let runs = 0;
    for (const character of text) {
        if (next >= wanted.length) break;
        const matched = character === wanted[next];
        if (matched) {
            next += 1;
            if (previousMatched) runs += 1;
        }
        previousMatched = matched;
    }
    return next === wanted.length ? runs : null;
}

function scoreFile(file: QuickOpenFile, needle: string): number | null {
    const path = file.path.toLowerCase();
    const name = fileNameOf(path);
    const value = baseScore(needle, name, path);
    if (value === null) return null;
    // Kürzere Pfade zuerst
    return value + (file.isOpen === true ? OPEN_FILE_BONUS : 0) - path.length;
}

function baseScore(needle: string, name: string, path: string): number | null {
    if (name.startsWith(needle)) return SUBSTRING_IN_NAME + PREFIX_OF_NAME;
    if (name.includes(needle)) return SUBSTRING_IN_NAME;
    const nameRuns = consecutiveRuns(needle, name);
    if (nameRuns !== null) return SUBSEQUENCE_IN_NAME + nameRuns * CONSECUTIVE_BONUS;
    const pathRuns = consecutiveRuns(needle, path);
    return pathRuns === null ? null : SUBSEQUENCE_IN_PATH + pathRuns * CONSECUTIVE_BONUS;
}

function comparePaths(a: QuickOpenFile, b: QuickOpenFile): number {
    return pathCollator.compare(a.path, b.path);
}

function rankWithoutQuery(files: readonly QuickOpenFile[], limit: number): QuickOpenFile[] {
    const open = files.filter((file) => file.isOpen === true);
    const rest = files.filter((file) => file.isOpen !== true).sort(comparePaths);
    return [...open, ...rest].slice(0, limit);
}

/** Ohne Eingabe: offene Dateien zuerst (in gegebener Reihenfolge), dann alphabetisch. Die Sortierung ist stabil. */
export function rankQuickOpen(files: readonly QuickOpenFile[], query: string, limit: number = QUICK_OPEN_LIMIT): QuickOpenFile[] {
    if (limit <= 0) return [];
    const needle = normalizeQuery(query);
    if (needle === '') return rankWithoutQuery(files, limit);
    const scored: { readonly file: QuickOpenFile; readonly score: number }[] = [];
    for (const file of files) {
        const score = scoreFile(file, needle);
        if (score !== null) scored.push({ file, score });
    }
    scored.sort((a, b) => b.score - a.score || comparePaths(a.file, b.file));
    return scored.slice(0, limit).map((entry) => entry.file);
}

/**
 * UTF-16-Positionen in `text`, die zur Eingabe gehören (für die Hervorhebung): zusammenhängender Teilstring,
 * sonst die Teilfolge von links; leer, wenn nichts passt. `needle` kommt aus `normalizeQuery`.
 */
export function matchPositions(text: string, needle: string): number[] {
    if (needle === '') return [];
    const lower = text.toLowerCase();
    // Nur gleich lange Kleinschreibung erlaubt Positionen im Original
    if (lower.length !== text.length) return [];
    const start = lower.indexOf(needle);
    if (start >= 0) return Array.from({ length: needle.length }, (_, offset) => start + offset);
    return subsequencePositions(lower, needle);
}

function subsequencePositions(text: string, needle: string): number[] {
    const positions: number[] = [];
    let next = 0;
    for (let index = 0; index < text.length && next < needle.length; index += 1) {
        if (text[index] !== needle[next]) continue;
        positions.push(index);
        next += 1;
    }
    return next === needle.length ? positions : [];
}
