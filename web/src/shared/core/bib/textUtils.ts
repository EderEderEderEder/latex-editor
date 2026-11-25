// Kleine Textwerkzeuge für Parser, Autoren, Formatter und SourceBuilder (Entsprechung zu Swifts
// `trimmingCharacters(in: .whitespaces)` und `.whitespacesAndNewlines`). Reine Logik, UTF-16.

/** Zeichen der Swift-Menge `.whitespaces`: Leerzeichen, Tabulator und Unicode-Zs (ohne Zeilenumbrüche) */
const BLANK_CHARACTERS = ' \\t\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000';
/** Zeilenumbrüche der Swift-Menge `.newlines` */
const NEWLINE_CHARACTERS = '\\n\\v\\f\\r\\u0085\\u2028\\u2029';

const BLANK_EDGES = new RegExp(`^[${BLANK_CHARACTERS}]+|[${BLANK_CHARACTERS}]+$`, 'g');
const WHITESPACE_EDGES = new RegExp(`^[${BLANK_CHARACTERS}${NEWLINE_CHARACTERS}]+|[${BLANK_CHARACTERS}${NEWLINE_CHARACTERS}]+$`, 'g');
const WHITESPACE_CHARACTER = new RegExp(`^[${BLANK_CHARACTERS}${NEWLINE_CHARACTERS}]$`);
const NEWLINE_SEPARATOR = /\r\n|[\n\v\f\r\u0085\u{2028}\u{2029}]/u;

/** Wie Swift `.trimmingCharacters(in: .whitespaces)`: Leerzeichen und Tabs, keine Zeilenumbrüche */
export function trimBlanks(text: string): string {
    return text.replace(BLANK_EDGES, '');
}

/** Wie Swift `.trimmingCharacters(in: .whitespacesAndNewlines)` */
export function trimWhitespace(text: string): string {
    return text.replace(WHITESPACE_EDGES, '');
}

/** Wie Swift `Character.isWhitespace` (ein UTF-16-Zeichen) */
export function isWhitespaceCharacter(character: string): boolean {
    return WHITESPACE_CHARACTER.test(character);
}

/** Wie Swift `split(whereSeparator: \.isNewline)`: leere Teile entfallen */
export function splitLines(text: string): string[] {
    return text.split(NEWLINE_SEPARATOR).filter((part) => part.length > 0);
}

/** Die ersten `count` Zeichen (nach Codepunkten, damit kein Surrogatpaar zerrissen wird) */
export function prefixCharacters(text: string, count: number): string {
    return Array.from(text).slice(0, count).join('');
}
