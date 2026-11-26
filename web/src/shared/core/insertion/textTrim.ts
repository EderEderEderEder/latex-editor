// Zeilenumbrüche der Swift-Menge `.newlines`
const NEWLINE_EDGES = /^[\n\v\f\r\u0085\u2028\u2029]+|[\n\v\f\r\u0085\u2028\u2029]+$/g;

/** Wie Swift `.trimmingCharacters(in: .newlines)` */
export function trimNewlines(text: string): string {
    return text.replace(NEWLINE_EDGES, '');
}

/** Anzahl Zeichen nach Codepunkten (genügt für die Spaltenbreite einer Tabelle) */
export function characterCount(text: string): number {
    return Array.from(text).length;
}
