/**
 * Kommentare in LaTeX: `%` bis zum Zeilenende, außer bei ungerader Zahl `\` davor (`\%` ist ein Prozentzeichen,
 * `\\%` ein Zeilenumbruch und dann ein Kommentar). Die eine Regel für Tokenizer, Verweise und Prüfungen.
 * Alle Positionen sind UTF-16-Einheiten (wie `String.length`); anders als in Swift gibt es keine Character-Offsets.
 */

const PERCENT = '%';
const BACKSLASH = '\\';
const MASK_CHARACTER = ' ';

/** Beginn des Kommentars (Index des `%`) in einer Zeile, sonst `null` */
export function findCommentStart(line: string): number | null {
    let escaped = false;
    for (let index = 0; index < line.length; index++) {
        const character = line[index];
        if (character === PERCENT && !escaped) return index;
        escaped = character === BACKSLASH && !escaped;
    }
    return null;
}

/** Ungerade Anzahl `\` direkt vor `index`, ohne über `lineStart` hinaus zu zählen */
export function isEscapedAt(text: string, index: number, lineStart: number): boolean {
    let count = 0;
    for (let position = index - 1; position >= lineStart && text[position] === BACKSLASH; position--) {
        count++;
    }
    return count % 2 === 1;
}

/** Liegt `location` hinter einem wirksamen `%` der Zeile, die bei `lineStart` beginnt? (`location` selbst zählt nicht mit) */
export function isInComment(text: string, lineStart: number, location: number): boolean {
    let searchStart = lineStart;
    while (searchStart < location) {
        const found = text.indexOf(PERCENT, searchStart);
        if (found === -1 || found >= location) return false;
        if (!isEscapedAt(text, found, lineStart)) return true;
        searchStart = found + 1;
    }
    return false;
}

/** Index des ersten Zeilenumbruchs (`\n` oder `\r`) ab `from`, sonst Textende */
export function lineEndFrom(text: string, from: number): number {
    for (let index = from; index < text.length; index++) {
        const character = text[index];
        if (character === '\n' || character === '\r') return index;
    }
    return text.length;
}

function lineStartBefore(text: string, index: number): number {
    for (let position = index - 1; position >= 0; position--) {
        const character = text[position];
        if (character === '\n' || character === '\r') return position + 1;
    }
    return 0;
}

/**
 * Kommentare durch Leerzeichen ersetzt, gleiche UTF-16-Länge: Bereiche im Ergebnis gelten auch im Original.
 * Ein Kommentar endet an `\n` oder `\r` (auch bei `\r\n`).
 */
export function maskComments(text: string): string {
    const parts: string[] = [];
    let copiedUntil = 0;
    let searchStart = 0;
    while (searchStart < text.length) {
        const start = text.indexOf(PERCENT, searchStart);
        if (start === -1) break;
        if (isEscapedAt(text, start, lineStartBefore(text, start))) {
            searchStart = start + 1;
            continue;
        }
        const end = lineEndFrom(text, start);
        parts.push(text.slice(copiedUntil, start), MASK_CHARACTER.repeat(end - start));
        copiedUntil = end;
        searchStart = end;
    }
    parts.push(text.slice(copiedUntil));
    return parts.join('');
}
