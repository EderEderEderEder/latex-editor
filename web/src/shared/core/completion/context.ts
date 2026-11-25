/**
 * Kontext der Vervollständigung aus der aktuellen Zeile bis zum Cursor (Vorlage: `CompletionContext.swift`).
 * Läuft bei jedem Tastendruck: liest nur rückwärts ab dem Cursor, nie vor dem Zeilenanfang und höchstens
 * `MAXIMUM_LOOK_BEHIND` Zeichen weit; die Kommentarprüfung (ganze Zeile bis zum Cursor) nur bei einem Treffer.
 * Verbatim/Code erkennt diese Funktion nicht; das filtert die Editor-Anbindung (wie der Swift-Controller).
 */
import { isInComment, lineEndFrom } from '../latex/comments';
import catalog from './catalog.json';
import type {
    ArgumentContext,
    ArgumentKind,
    CommandContext,
    CompletionContext,
    OptionContext,
    OptionTarget,
    OptionTargetKind,
    TextRange,
} from './types';

export const MAXIMUM_LOOK_BEHIND = 300;

const BACKSLASH = '\\';
const OPEN_BRACE = '{';
const CLOSE_BRACE = '}';
const OPEN_BRACKET = '[';
const CLOSE_BRACKET = ']';
const COMMA = ',';
const STAR = '*';
const EQUALS = '=';
const BEGIN_COMMAND = 'begin';
const ASCII_LETTER = /^[A-Za-z]$/;
const BLANK = /^[ \t]$/;
const LINE_BREAK = /^[\n\r]$/;
/** Wie Swift `.whitespaces`: Tabulator und Unicode-Leerzeichen (Zs), keine Zeilenumbrüche */
const EDGE_BLANKS = /^[\t\p{Zs}]+|[\t\p{Zs}]+$/gu;

const FLOAT_ENVIRONMENTS: ReadonlySet<string> = new Set([
    'figure', 'figure*', 'table', 'table*', 'program', 'algorithm', 'listing',
]);
const BOX_ENVIRONMENTS: ReadonlySet<string> = new Set(['tabular', 'tabular*', 'minipage', 'array']);
/** Argumente, die eine Liste mit Kommas sein dürfen (`\cite{a,b}`, `\cref{a,b}`) */
const LIST_KINDS: ReadonlySet<ArgumentKind> = new Set<ArgumentKind>(['citation', 'label']);

function buildArgumentCommands(): ReadonlyMap<string, ArgumentKind> {
    const commands = new Map<string, ArgumentKind>();
    for (const [kind, names] of Object.entries(catalog.argumentCommands)) {
        for (const name of names) commands.set(name, kind as ArgumentKind);
    }
    return commands;
}

/** Befehl → Art seines Arguments (`ref` → label, `cite` → citation …), aus `catalog.json` */
export const ARGUMENT_COMMANDS: ReadonlyMap<string, ArgumentKind> = buildArgumentCommands();

export function rangeBetween(start: number, end: number): TextRange {
    return { location: start, length: end - start };
}

/** Anfang der Zeile, in der `location` steht (hinter dem letzten `\n`/`\r` davor, sonst 0) */
export function lineStartOf(text: string, location: number): number {
    for (let index = location - 1; index >= 0; index--) {
        if (LINE_BREAK.test(text.charAt(index))) return index + 1;
    }
    return 0;
}

/** Erkennt Befehl, Argument oder Option am Cursor; `lineStart` ist der Anfang der Cursorzeile */
export function detectContext(text: string, cursor: number, lineStart: number): CompletionContext | null {
    if (cursor <= lineStart || cursor > text.length) return null;
    const start = Math.max(lineStart, cursor - MAXIMUM_LOOK_BEHIND);
    const detected = commandContext(text, cursor, start)
        ?? argumentContext(text, cursor, start)
        ?? optionContext(text, cursor, start);
    if (detected === null || isInComment(text, lineStart, cursor)) return null;
    return detected;
}

// Befehl

function commandContext(text: string, cursor: number, start: number): CommandContext | null {
    let wordStart = cursor;
    while (wordStart > start && isAsciiLetter(text.charAt(wordStart - 1))) wordStart--;
    if (wordStart <= start || text.charAt(wordStart - 1) !== BACKSLASH) return null;
    if (!isUnescapedBackslash(text, wordStart - 1, start)) return null;
    return { kind: 'command', prefix: text.slice(wordStart, cursor), range: rangeBetween(wordStart, cursor) };
}

// Argument

interface Separator {
    /** Index des `{` bzw. `,` (oder `[` bei Optionen) */
    readonly separator: number;
    /** Anfang des Arguments bzw. der Option direkt dahinter */
    readonly contentStart: number;
}

function argumentContext(text: string, cursor: number, start: number): ArgumentContext | null {
    const found = argumentStart(text, cursor, start);
    if (found === null) return null;
    const isList = text.charAt(found.separator) === COMMA;
    const brace = isList ? openingBrace(text, found.separator, start) : found.separator;
    if (brace === null) return null;
    const name = commandName(text, brace, start);
    const kind = name === null ? undefined : ARGUMENT_COMMANDS.get(name);
    if (kind === undefined || (isList && !LIST_KINDS.has(kind))) return null;
    const location = skipBlanks(text, found.contentStart, cursor);
    return {
        kind: 'argument',
        argument: kind,
        prefix: text.slice(location, cursor),
        range: rangeBetween(location, cursor),
    };
}

/**
 * Rückwärts das `{` oder `,`, hinter dem das aktuelle Argument beginnt. Ein Argument ist ein Wort; Leerraum
 * ist nur direkt nach `{` oder `,` erlaubt, so endet die Suche in Fließtext schon am Wortanfang.
 */
function argumentStart(text: string, cursor: number, start: number): Separator | null {
    let index = cursor;
    while (index > start && !isBlank(text.charAt(index - 1))) {
        const character = text.charAt(index - 1);
        if (character === OPEN_BRACE || character === COMMA) return { separator: index - 1, contentStart: index };
        if (character === CLOSE_BRACE || character === BACKSLASH) return null;
        index--;
    }
    while (index > start && isBlank(text.charAt(index - 1))) index--;
    if (index <= start) return null;
    const character = text.charAt(index - 1);
    if (character !== OPEN_BRACE && character !== COMMA) return null;
    return { separator: index - 1, contentStart: index };
}

function openingBrace(text: string, before: number, start: number): number | null {
    for (let position = before; position > start; position--) {
        const character = text.charAt(position - 1);
        if (character === OPEN_BRACE) return position - 1;
        if (character === CLOSE_BRACE || character === BACKSLASH) return null;
    }
    return null;
}

/** Name des Befehls vor `{` bzw. `[`; optionale Argumente `[…]` und `*` dazwischen werden übersprungen */
function commandName(text: string, brace: number, start: number): string | null {
    const afterOptions = skipOptionGroups(text, brace, start);
    if (afterOptions === null) return null;
    let index = afterOptions;
    if (index > start && text.charAt(index - 1) === STAR) index--;
    const nameEnd = index;
    while (index > start && isAsciiLetter(text.charAt(index - 1))) index--;
    if (index >= nameEnd || index <= start || text.charAt(index - 1) !== BACKSLASH) return null;
    if (!isUnescapedBackslash(text, index - 1, start)) return null;
    return text.slice(index, nameEnd);
}

/** Überspringt `[…]`-Gruppen direkt vor `index`; null, wenn ein `]` kein `[` davor hat */
function skipOptionGroups(text: string, index: number, start: number): number | null {
    let position = index;
    while (position > start && text.charAt(position - 1) === CLOSE_BRACKET) {
        const open = previousOpenBracket(text, position - 1, start);
        if (open === null) return null;
        position = open;
    }
    return position;
}

function previousOpenBracket(text: string, before: number, start: number): number | null {
    for (let position = before; position > start; position--) {
        if (text.charAt(position - 1) === OPEN_BRACKET) return position - 1;
    }
    return null;
}

// Option

function optionContext(text: string, cursor: number, start: number): OptionContext | null {
    const found = optionStart(text, cursor, start);
    if (found === null) return null;
    const bracket = text.charAt(found.separator) === COMMA
        ? previousOpenBracket(text, found.separator, start)
        : found.separator;
    if (bracket === null) return null;
    const target = optionTarget(text, bracket, cursor, start);
    if (target === null) return null;
    return optionToken(text, skipBlanks(text, found.contentStart, cursor), cursor, target);
}

/** Rückwärts bis `[` oder `,`; Werte dürfen `\` enthalten (`0.8\textwidth`), aber keine Klammern */
function optionStart(text: string, cursor: number, start: number): Separator | null {
    for (let index = cursor; index > start; index--) {
        const character = text.charAt(index - 1);
        if (character === OPEN_BRACKET || character === COMMA) return { separator: index - 1, contentStart: index };
        if (character === CLOSE_BRACKET || character === OPEN_BRACE || character === CLOSE_BRACE) return null;
    }
    return null;
}

function optionToken(text: string, location: number, cursor: number, target: OptionTarget): OptionContext {
    const token = text.slice(location, cursor);
    const equals = token.indexOf(EQUALS);
    if (equals === -1) {
        return { kind: 'option', target, key: null, prefix: token, range: rangeBetween(location, cursor) };
    }
    const valueStart = location + equals + 1;
    return {
        kind: 'option',
        target,
        key: trimBlanks(token.slice(0, equals)),
        prefix: text.slice(valueStart, cursor),
        range: rangeBetween(valueStart, cursor),
    };
}

/** Wem gehört die Klammer: Befehl (`\includegraphics[`, `\cite[…][`) oder Umgebung (`\begin{figure}[`) */
function optionTarget(text: string, bracket: number, cursor: number, start: number): OptionTarget | null {
    const index = skipOptionGroups(text, bracket, start);
    if (index === null) return null;
    if (index > start && text.charAt(index - 1) === CLOSE_BRACE) {
        const environment = environmentName(text, index - 1, start);
        return environment === null ? null : environmentTarget(environment);
    }
    const name = commandName(text, index, start);
    if (name === null) return null;
    return commandTarget(name, text, cursor);
}

function commandTarget(name: string, text: string, cursor: number): OptionTarget | null {
    switch (name) {
        case 'includegraphics': return target('graphics');
        case 'documentclass': return target('documentClass', nameAfterOptions(text, cursor));
        case 'usepackage':
        case 'RequirePackage': return target('package', nameAfterOptions(text, cursor));
        default: return ARGUMENT_COMMANDS.get(name) === 'citation' ? target('citation') : null;
    }
}

function environmentTarget(name: string): OptionTarget | null {
    if (FLOAT_ENVIRONMENTS.has(name)) return target('floatPlacement');
    return BOX_ENVIRONMENTS.has(name) ? target('boxPosition') : null;
}

function target(kind: OptionTargetKind, name = ''): OptionTarget {
    return { kind, name };
}

/** `\begin{name}` direkt vor der Klammer */
function environmentName(text: string, closing: number, start: number): string | null {
    let open = closing;
    while (open > start && text.charAt(open - 1) !== OPEN_BRACE) open--;
    if (open <= start || commandName(text, open - 1, start) !== BEGIN_COMMAND) return null;
    return text.slice(open, closing);
}

/** Name aus `…]{name}` hinter dem Cursor in derselben Zeile (Paket, Klasse), sonst leer */
function nameAfterOptions(text: string, cursor: number): string {
    const rest = text.slice(cursor, lineEndFrom(text, cursor));
    const close = rest.indexOf(CLOSE_BRACKET);
    if (close === -1) return '';
    let open = close + 1;
    while (rest.charAt(open) === ' ') open++;
    if (rest.charAt(open) !== OPEN_BRACE) return '';
    const end = rest.indexOf(CLOSE_BRACE, open);
    return end === -1 ? '' : trimBlanks(rest.slice(open + 1, end));
}

// Hilfen

/** Ein `\` ist ein Befehlsanfang, wenn die Folge `\` bis einschließlich `index` ungerade lang ist (`\\sec` ist Umbruch + Text) */
function isUnescapedBackslash(text: string, index: number, start: number): boolean {
    let count = 0;
    for (let position = index; position >= start && text.charAt(position) === BACKSLASH; position--) count++;
    return count % 2 === 1;
}

function skipBlanks(text: string, from: number, end: number): number {
    let location = from;
    while (location < end && isBlank(text.charAt(location))) location++;
    return location;
}

function trimBlanks(value: string): string {
    return value.replace(EDGE_BLANKS, '');
}

function isAsciiLetter(character: string): boolean {
    return ASCII_LETTER.test(character);
}

function isBlank(character: string): boolean {
    return BLANK.test(character);
}
