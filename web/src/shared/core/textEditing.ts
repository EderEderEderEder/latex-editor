/**
 * Bearbeitungsbefehle des Editors als reine Logik auf Text und Auswahl (Port von `TextEditing.swift`):
 * Klammern, Zeilenumbruch mit Einrückung, Kommentar, Einrücken, Zeilen verschieben, Formatierung.
 * Kein DOM, kein Node, kein CodeMirror: jede Funktion liefert eine Bearbeitung, die der Editor als einen
 * Undo-Schritt anwendet, oder `null` für „normal tippen“.
 *
 * Alle Offsets sind UTF-16-Einheiten. Der Text kennt nur `\n` als Zeilenende (CodeMirror normalisiert so);
 * `from <= to` in jeder Auswahl.
 */

import { isEscapedAt } from './latex/comments';

export interface Selection {
    readonly from: number;
    readonly to: number;
}

export interface Replacement {
    readonly from: number;
    readonly to: number;
    readonly insert: string;
}

export interface TextEdit {
    /** Ersetzungen in Offsets des Ausgangstexts (aufsteigend, ohne Überlappung) */
    readonly changes: readonly Replacement[];
    /** Auswahl in Offsets des Texts nach der Bearbeitung */
    readonly selection: Selection;
}

export interface TextEditingSettings {
    /** Einheit für Einrücken und Enter: Tabulator oder Leerzeichen */
    readonly indentUnit: string;
    /** „Klammern automatisch schließen“; aus: `typed` und `deleteBackward` liefern immer `null` */
    readonly autoPairBrackets: boolean;
}

export const COMMENT_PREFIX = '% ';
export const TAB_UNIT = '\t';
export const DEFAULT_TEXT_EDITING_SETTINGS: TextEditingSettings = { indentUnit: TAB_UNIT, autoPairBrackets: true };

/** Befehle der Formatierungsbefehle (Fett, Hervorheben, Schreibmaschine) für `wrap` */
export const FORMAT_COMMANDS = { bold: 'textbf', emphasis: 'emph', monospace: 'texttt' } as const;

export const ENVIRONMENT_BODIES: ReadonlyMap<string, string> = new Map([
    ['itemize', '\\item '],
    ['enumerate', '\\item '],
    ['description', '\\item '],
]);

const NEWLINE = '\n';
const LIST_ITEM = '\\item';
const PAIRS: ReadonlyMap<string, string> = new Map([['{', '}'], ['[', ']'], ['(', ')'], ['$', '$']]);
const CLOSERS: ReadonlySet<string> = new Set(['}', ']', ')', '$']);
/** Vor diesen Zeichen (oder am Zeilenende) schließt eine Klammer automatisch */
const CLOSE_BEFORE = /^[\s).,;:\]}]$/;
const BEGIN_PATTERN = /\\begin\{([^}]+)\}(?:\[[^\]]*\]|\{[^}]*\})*$/;
/** So weit wird nach einem passenden `\end` gesucht, bevor eins ergänzt wird */
const END_SEARCH_LENGTH = 50_000;
/** Ein Ausrücken entfernt einen Tabulator oder bis zu so vielen Leerzeichen (bei Tabulator-Einrückung vier) */
const SPACES_PER_TAB = 4;
const LEADING_BLANK = /^[ \t]*/;
const LEADING_SPACES = /^ */;

export function isAutoPair(text: string): boolean {
    return text.length === 2 && PAIRS.get(text.charAt(0)) === text.charAt(1);
}

/** Wendet eine Bearbeitung an (Ersetzungen von hinten nach vorn); Auswahl wie in `edit.selection` */
export function applyEdit(text: string, edit: TextEdit): { readonly text: string; readonly selection: Selection } {
    let result = text;
    for (const change of [...edit.changes].reverse()) {
        result = result.slice(0, change.from) + change.insert + result.slice(change.to);
    }
    return { text: result, selection: edit.selection };
}

// MARK: Hilfen

function caretAt(offset: number): Selection {
    return { from: offset, to: offset };
}

function singleEdit(from: number, to: number, insert: string, selection: Selection): TextEdit {
    return { changes: [{ from, to, insert }], selection };
}

function lineStartOf(text: string, index: number): number {
    return index === 0 ? 0 : text.lastIndexOf(NEWLINE, index - 1) + 1;
}

function lineEndExcludingNewline(text: string, from: number): number {
    const found = text.indexOf(NEWLINE, from);
    return found === -1 ? text.length : found;
}

function lineEndIncludingNewline(text: string, from: number): number {
    const end = lineEndExcludingNewline(text, from);
    return end < text.length ? end + 1 : end;
}

function isBlank(line: string): boolean {
    return line.trim() === '';
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function leadingBlankLength(line: string): number {
    return (LEADING_BLANK.exec(line)?.[0] ?? '').length;
}

// MARK: Klammern

/**
 * Beim Tippen einer Klammer: Auswahl umschließen, Paar einfügen oder schließende Klammer überspringen.
 * `null`: normal tippen (auch bei ausgeschaltetem automatischem Schließen).
 */
export function typed(
    character: string,
    text: string,
    selection: Selection,
    settings: TextEditingSettings = DEFAULT_TEXT_EDITING_SETTINGS,
): TextEdit | null {
    if (!settings.autoPairBrackets) return null;
    const closer = PAIRS.get(character);
    if (selection.to > selection.from) {
        return closer === undefined ? null : surroundSelection(character, closer, text, selection);
    }
    return typedAtCursor(character, closer, text, selection.from);
}

function surroundSelection(opener: string, closer: string, text: string, selection: Selection): TextEdit {
    const inner = text.slice(selection.from, selection.to);
    return singleEdit(selection.from, selection.to, opener + inner + closer, {
        from: selection.from + 1,
        to: selection.to + 1,
    });
}

function typedAtCursor(character: string, closer: string | undefined, text: string, cursor: number): TextEdit | null {
    const next = text.charAt(cursor);
    const escaped = isEscapedAt(text, cursor, 0);
    if (CLOSERS.has(character) && next === character && !escaped) {
        return singleEdit(cursor, cursor, '', caretAt(cursor + 1));
    }
    if (closer === undefined || escaped || !(next === '' || CLOSE_BEFORE.test(next))) return null;
    if (character === '$' && isClosingDollar(text, cursor)) return null;
    return singleEdit(cursor, cursor, character + closer, caretAt(cursor + 1));
}

/** Steht schon eine ungerade Anzahl `$` in der Zeile davor, schließt dieses `$` die Formel. */
function isClosingDollar(text: string, cursor: number): boolean {
    const lineStart = lineStartOf(text, cursor);
    let count = 0;
    for (let index = lineStart; index < cursor; index++) {
        if (text.charAt(index) === '$' && !isEscapedAt(text, index, lineStart)) count++;
    }
    return count % 2 === 1;
}

/** Rückschritt zwischen einem leeren Paar (`{|}`) löscht beide Zeichen. */
export function deleteBackward(
    text: string,
    selection: Selection,
    settings: TextEditingSettings = DEFAULT_TEXT_EDITING_SETTINGS,
): TextEdit | null {
    const cursor = selection.from;
    if (!settings.autoPairBrackets || selection.to > cursor || cursor === 0 || cursor >= text.length) return null;
    if (PAIRS.get(text.charAt(cursor - 1)) !== text.charAt(cursor) || isEscapedAt(text, cursor - 1, 0)) return null;
    return singleEdit(cursor - 1, cursor + 1, '', caretAt(cursor - 1));
}

// MARK: Zeilenumbruch

/**
 * Enter: Einrückung der Zeile übernehmen; nach `\begin{x}` das passende `\end{x}` ergänzen;
 * in Listen mit `\item` weitermachen, ein leeres `\item` beendet die Liste.
 */
export function newline(
    text: string,
    selection: Selection,
    settings: TextEditingSettings = DEFAULT_TEXT_EDITING_SETTINGS,
): TextEdit {
    const lineStart = lineStartOf(text, selection.from);
    const prefix = text.slice(lineStart, selection.from);
    const indent = prefix.slice(0, leadingBlankLength(prefix));
    const rest = text.slice(selection.to, lineEndExcludingNewline(text, selection.to));
    const trimmed = prefix.trim();
    const restIsBlank = isBlank(rest);
    const environment = restIsBlank ? openedEnvironment(trimmed) : null;
    if (environment !== null && !isClosed(environment, text, selection.to)) {
        const head = NEWLINE + indent + settings.indentUnit + (ENVIRONMENT_BODIES.get(environment) ?? '');
        return replaceSelection(selection, head + NEWLINE + indent + `\\end{${environment}}`, head);
    }
    if (trimmed === LIST_ITEM && restIsBlank && selection.to === selection.from) {
        // Leerer Punkt: Liste beenden (der Punkt verschwindet, die Einrückung bleibt)
        return singleEdit(lineStart, selection.from, indent, caretAt(lineStart + indent.length));
    }
    const continues = trimmed.startsWith(`${LIST_ITEM} `) || trimmed.startsWith(`${LIST_ITEM}[`);
    const inserted = NEWLINE + indent + (continues ? `${LIST_ITEM} ` : '');
    return replaceSelection(selection, inserted, inserted);
}

function replaceSelection(selection: Selection, insert: string, beforeCaret: string): TextEdit {
    return singleEdit(selection.from, selection.to, insert, caretAt(selection.from + beforeCaret.length));
}

/** Endet die Zeile mit `\begin{x}` (und Argumenten), liefert `x`. */
export function openedEnvironment(line: string): string | null {
    return BEGIN_PATTERN.exec(line)?.[1] ?? null;
}

/** Gibt es nach `location` schon das passende `\end{x}` (mit Verschachtelung derselben Umgebung)? */
export function isClosed(environment: string, text: string, location: number): boolean {
    const searched = text.slice(location, location + END_SEARCH_LENGTH);
    const pattern = new RegExp(`\\\\(begin|end)\\{${escapeRegExp(environment)}\\}`, 'g');
    let depth = 1;
    for (const match of searched.matchAll(pattern)) {
        depth += match[1] === 'begin' ? 1 : -1;
        if (depth === 0) return true;
    }
    return false;
}

// MARK: Zeilen

/**
 * Ganze Zeilen der Auswahl (inklusive Zeilenumbruch); eine Auswahl, die genau am Zeilenanfang endet,
 * nimmt diese Zeile nicht mehr mit.
 */
export function lineBlock(text: string, selection: Selection): Selection {
    const endsAfterNewline =
        selection.to > selection.from && selection.to <= text.length && text.charAt(selection.to - 1) === NEWLINE;
    const to = endsAfterNewline ? selection.to - 1 : selection.to;
    return { from: lineStartOf(text, selection.from), to: lineEndIncludingNewline(text, to) };
}

function blockLines(text: string, block: Selection): string[] {
    return text.slice(block.from, block.to).split(NEWLINE);
}

/** Alle nicht leeren Zeilen auskommentiert → Kommentar entfernen, sonst `% ` bei der kleinsten Einrückung. */
export function toggleComment(text: string, selection: Selection): TextEdit {
    const block = lineBlock(text, selection);
    const lines = blockLines(text, block);
    const content = lines.filter((line) => !isBlank(line));
    const commented = content.length > 0 && content.every((line) => line.trim().startsWith('%'));
    const column = content.length === 0 ? 0 : Math.min(...content.map(leadingBlankLength));
    const changed = lines.map((line) => {
        if (isBlank(line)) return line;
        if (commented) return uncommented(line);
        return line.slice(0, column) + COMMENT_PREFIX + line.slice(column);
    });
    return blockEdit(text, block, changed, selection);
}

function uncommented(line: string): string {
    const percent = line.indexOf('%');
    if (percent === -1) return line;
    const afterPercent = line.slice(percent + 1);
    return line.slice(0, percent) + (afterPercent.startsWith(' ') ? afterPercent.slice(1) : afterPercent);
}

/** Tab mit Auswahl: eine Einrückung (Tabulator oder Leerzeichen) vor jede nicht leere Zeile. */
export function indent(
    text: string,
    selection: Selection,
    settings: TextEditingSettings = DEFAULT_TEXT_EDITING_SETTINGS,
): TextEdit {
    const block = lineBlock(text, selection);
    const changed = blockLines(text, block).map((line) => (isBlank(line) ? line : settings.indentUnit + line));
    return blockEdit(text, block, changed, selection);
}

/** ⇧Tab: einen Tabulator oder bis zu einer Einrückung an Leerzeichen am Zeilenanfang entfernen. */
export function outdent(
    text: string,
    selection: Selection,
    settings: TextEditingSettings = DEFAULT_TEXT_EDITING_SETTINGS,
): TextEdit {
    const spacesPerIndent = settings.indentUnit === TAB_UNIT ? SPACES_PER_TAB : settings.indentUnit.length;
    const block = lineBlock(text, selection);
    const changed = blockLines(text, block).map((line) => {
        if (line.startsWith(TAB_UNIT)) return line.slice(1);
        const spaces = (LEADING_SPACES.exec(line)?.[0] ?? '').length;
        return line.slice(Math.min(spacesPerIndent, spaces));
    });
    return blockEdit(text, block, changed, selection);
}

/** Tab-Taste: mit mehrzeiliger Auswahl Zeilen einrücken, sonst die Einheit einfügen (ersetzt die Auswahl). */
export function insertTab(
    text: string,
    selection: Selection,
    settings: TextEditingSettings = DEFAULT_TEXT_EDITING_SETTINGS,
): TextEdit {
    if (text.slice(selection.from, selection.to).includes(NEWLINE)) return indent(text, selection, settings);
    return replaceSelection(selection, settings.indentUnit, settings.indentUnit);
}

/**
 * Ersetzt die Zeilen. Mit Auswahl ist danach der ganze Block markiert; ohne bleibt der Cursor an seiner
 * Stelle in der Zeile (verschoben um das, was vor ihm eingefügt oder entfernt wurde).
 */
function blockEdit(text: string, block: Selection, lines: readonly string[], original: Selection): TextEdit {
    const replacement = lines.join(NEWLINE);
    if (original.to > original.from) {
        const trailing = replacement.endsWith(NEWLINE) ? 1 : 0;
        const end = block.from + replacement.length - trailing;
        return singleEdit(block.from, block.to, replacement, { from: block.from, to: end });
    }
    const oldLine = text.slice(block.from, lineEndExcludingNewline(text, block.from));
    const newLine = lines[0] ?? '';
    const column = original.from - block.from;
    const changeColumn = commonPrefixLength(oldLine, newLine);
    const newColumn = column >= changeColumn ? Math.max(changeColumn, column + newLine.length - oldLine.length) : column;
    return singleEdit(block.from, block.to, replacement, caretAt(block.from + newColumn));
}

function commonPrefixLength(first: string, second: string): number {
    const limit = Math.min(first.length, second.length);
    let length = 0;
    while (length < limit && first.charAt(length) === second.charAt(length)) length++;
    return length;
}

/** Die Zeilen der Auswahl mit der Zeile darüber bzw. darunter tauschen. `null` am Anfang/Ende. */
export function moveLines(up: boolean, text: string, selection: Selection): TextEdit | null {
    const block = lineBlock(text, selection);
    if (up) {
        if (block.from === 0) return null;
        const previous = { from: lineStartOf(text, block.from - 1), to: block.from };
        const shift = previous.to - previous.from;
        return swapped(text, previous, block, { from: selection.from - shift, to: selection.to - shift });
    }
    if (block.to >= text.length) return null;
    const next = { from: block.to, to: lineEndIncludingNewline(text, block.to) };
    const nextCore = text.slice(next.from, next.to).endsWith(NEWLINE) ? next.to - next.from - 1 : next.to - next.from;
    const shift = nextCore + 1;
    return swapped(text, block, next, { from: selection.from + shift, to: selection.to + shift });
}

/** Zwei aufeinanderfolgende Zeilenblöcke tauschen; der Zeilenumbruch am Ende bleibt, wo er war. */
function swapped(text: string, upper: Selection, lower: Selection, selection: Selection): TextEdit {
    const upperText = text.slice(upper.from, upper.to);
    const lowerText = text.slice(lower.from, lower.to);
    const upperCore = upperText.endsWith(NEWLINE) ? upperText.slice(0, -1) : upperText;
    const lowerEndsWithNewline = lowerText.endsWith(NEWLINE);
    const lowerCore = lowerEndsWithNewline ? lowerText.slice(0, -1) : lowerText;
    const replacement = lowerCore + NEWLINE + upperCore + (lowerEndsWithNewline ? NEWLINE : '');
    return singleEdit(upper.from, lower.to, replacement, selection);
}

/** Die Zeilen der Auswahl darunter verdoppeln; die Auswahl wandert mit. */
export function duplicateLines(text: string, selection: Selection): TextEdit {
    const block = lineBlock(text, selection);
    const blockText = text.slice(block.from, block.to);
    const hasNewline = blockText.endsWith(NEWLINE);
    const inserted = hasNewline ? blockText : NEWLINE + blockText;
    const shift = blockText.length + (hasNewline ? 0 : 1);
    return singleEdit(block.to, block.to, inserted, { from: selection.from + shift, to: selection.to + shift });
}

/** Die Zeilen der Auswahl löschen. */
export function deleteLines(text: string, selection: Selection): TextEdit {
    let { from, to } = lineBlock(text, selection);
    // Letzte Zeile ohne Umbruch: den Umbruch davor mitnehmen, sonst bleibt eine leere Zeile.
    if (!text.slice(from, to).endsWith(NEWLINE) && from > 0) from--;
    const caret = Math.min(from, Math.max(0, text.length - (to - from)));
    return singleEdit(from, to, '', caretAt(caret));
}

// MARK: Formatierung

/**
 * Auswahl in `\befehl{…}` setzen (bzw. wieder herausnehmen, wenn sie schon darin steht).
 * Ohne Auswahl entsteht `\befehl{}` mit dem Cursor dazwischen.
 */
export function wrap(command: string, text: string, selection: Selection): TextEdit {
    const opening = `\\${command}{`;
    const inner = text.slice(selection.from, selection.to);
    const outerFrom = selection.from - opening.length;
    const isWrapped =
        outerFrom >= 0 && selection.to < text.length &&
        text.slice(outerFrom, selection.from) === opening && text.charAt(selection.to) === '}';
    if (isWrapped) {
        return singleEdit(outerFrom, selection.to + 1, inner, { from: outerFrom, to: outerFrom + inner.length });
    }
    const from = selection.from + opening.length;
    return singleEdit(selection.from, selection.to, `${opening}${inner}}`, { from, to: from + inner.length });
}
