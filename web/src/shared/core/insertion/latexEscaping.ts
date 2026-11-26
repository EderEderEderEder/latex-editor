const REPLACEMENTS: ReadonlyMap<string, string> = new Map([
    ['\\', '\\textbackslash{}'],
    ['&', '\\&'],
    ['%', '\\%'],
    ['$', '\\$'],
    ['#', '\\#'],
    ['_', '\\_'],
    ['{', '\\{'],
    ['}', '\\}'],
    ['~', '\\textasciitilde{}'],
    ['^', '\\textasciicircum{}'],
]);
const LINE_BREAK = '\\r\\n|[\\n\\v\\f\\r\\u0085\\u2028\\u2029]';
const ESCAPABLE = new RegExp(`${LINE_BREAK}|[\\\\&%$#_{}~^]`, 'g');
const SPACE = ' ';

/** Maskiert Sonderzeichen; jeder Zeilenumbruch (`\r\n` als einer) wird zu einem Leerzeichen, damit die Zelle einzeilig bleibt */
export function escapeLatex(text: string): string {
    return text.replace(ESCAPABLE, (match) => REPLACEMENTS.get(match) ?? SPACE);
}
