const NEWLINE = '\n';
const CARRIAGE_RETURN = '\r';

/**
 * Zeilen ohne Trenner. Ein abschließender Zeilenumbruch erzeugt keine leere letzte Zeile, `\r\n` zählt als ein
 * Umbruch (ein einzelnes `\r` am Zeilenende wird entfernt, mitten in der Zeile bleibt es). Leerer Text hat keine Zeilen.
 */
export function splitLines(text: string): string[] {
    if (text.length === 0) return [];
    const lines = text.split(NEWLINE).map((line) => (line.endsWith(CARRIAGE_RETURN) ? line.slice(0, -1) : line));
    if (text.endsWith(NEWLINE)) lines.pop();
    return lines;
}
