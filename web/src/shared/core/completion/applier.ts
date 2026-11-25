/**
 * Was beim Übernehmen eines Vorschlags passiert: welcher Bereich ersetzt wird, durch was und wo der Cursor
 * danach steht (Vorlage: `CompletionApplier.swift`). Reine Logik, UTF-16-Offsets.
 */
import { lineEndFrom } from '../latex/comments';
import { DEFAULT_TEXT_EDITING_SETTINGS, ENVIRONMENT_BODIES } from '../textEditing';
import { ARGUMENT_COMMANDS, lineStartOf, rangeBetween } from './context';
import type { CompletionContext, CompletionEdit, CompletionItem, OptionTargetKind, TextRange } from './types';

const CLOSE_BRACE = '}';
const COMMA = ',';
const NEWLINE = '\n';
const CARRIAGE_RETURN = '\r';
const CLOSE_BRACKET = ']';
const EQUALS = '=';
const ARGUMENT_SCAFFOLD = '{}';
const OPEN_BRACKET = '[';
const OPTION_STOPS: ReadonlySet<string> = new Set([COMMA, NEWLINE, CLOSE_BRACKET, EQUALS]);
const LEADING_BLANKS = /^[ \t]*/;
const LEADING_SPACES = /^[\t\p{Zs}]*/u;
/** Klammern mit nur einem Wert: nach der Übernahme wird `]` ergänzt, falls es fehlt */
const SINGLE_VALUE_TARGETS: ReadonlySet<OptionTargetKind> = new Set<OptionTargetKind>([
    'floatPlacement', 'boxPosition', 'citation',
]);

/**
 * Bearbeitung für `item` im Kontext `context`. `indentUnit` rückt den Inhalt eines `\begin…\end`-Gerüsts
 * ein (Einstellung, Standard Tabulator).
 */
export function applyCompletion(
    item: CompletionItem,
    context: CompletionContext,
    text: string,
    indentUnit = DEFAULT_TEXT_EDITING_SETTINGS.indentUnit,
): CompletionEdit {
    switch (context.kind) {
        case 'command': return commandEdit(item, context.range);
        case 'option': return optionEdit(item.insertion, context.target.kind, context.range, text);
        case 'argument':
            return context.argument === 'beginEnvironment'
                ? beginEnvironmentEdit(item.insertion, context.range, text, indentUnit)
                : argumentEdit(item.insertion, context.range, text);
    }
}

function caretAt(location: number): TextRange {
    return { location, length: 0 };
}

function commandEdit(item: CompletionItem, range: TextRange): CompletionEdit {
    const offset = item.cursorOffset ?? item.insertion.length;
    const opensArgument = ARGUMENT_COMMANDS.has(item.text) && item.insertion.endsWith(ARGUMENT_SCAFFOLD);
    return {
        range,
        text: item.insertion,
        selection: caretAt(range.location + offset),
        opensFollowUp: opensArgument || item.insertion.startsWith(item.text + OPEN_BRACKET),
    };
}

// Argument

interface ArgumentExtent {
    /** Ende des Arguments (vor `}` oder `,`) */
    readonly end: number;
    /** Zeichen dahinter: `}`, `,` oder null (Zeilen- bzw. Textende) */
    readonly closer: string | null;
}

/** Das Argument reicht bis vor `}`, `,` oder Zeilenende */
function argumentExtent(range: TextRange, text: string): ArgumentExtent {
    for (let end = range.location + range.length; end < text.length; end++) {
        const character = text.charAt(end);
        if (character === CLOSE_BRACE || character === COMMA) return { end, closer: character };
        if (character === NEWLINE) return { end, closer: null };
    }
    return { end: text.length, closer: null };
}

/** Ersetzt das ganze Argument (auch hinter dem Cursor) und schließt die Klammer, falls sie fehlt; ein Komma bleibt */
function argumentEdit(value: string, range: TextRange, text: string): CompletionEdit {
    const { end, closer } = argumentExtent(range, text);
    const inserted = value + (closer === null ? CLOSE_BRACE : '');
    const caret = range.location + inserted.length + (closer === CLOSE_BRACE ? 1 : 0);
    return { range: rangeBetween(range.location, end), text: inserted, selection: caretAt(caret), opensFollowUp: false };
}

// \begin{…}

/** Wie ein Argument; steht danach nichts mehr in der Zeile, kommt das Gerüst mit `\end{…}` dazu */
function beginEnvironmentEdit(name: string, range: TextRange, text: string, indentUnit: string): CompletionEdit {
    const { end, closer } = argumentExtent(range, text);
    const afterClosing = end + (closer === CLOSE_BRACE ? 1 : 0);
    const replaced = rangeBetween(range.location, afterClosing);
    const line = lineAt(text, range.location);
    const restOfLine = text.slice(afterClosing, Math.max(afterClosing, line.end));
    const endCommand = `\\end{${name}}`;
    if (restOfLine.trim() !== '' || nextLine(text, line.end).replace(LEADING_SPACES, '').startsWith(endCommand)) {
        const inserted = name + CLOSE_BRACE;
        return { range: replaced, text: inserted, selection: caretAt(range.location + inserted.length), opensFollowUp: false };
    }
    const indent = LEADING_BLANKS.exec(text.slice(line.start, line.end))?.[0] ?? '';
    const head = name + CLOSE_BRACE + NEWLINE + indent + indentUnit + (ENVIRONMENT_BODIES.get(name) ?? '');
    const inserted = head + NEWLINE + indent + endCommand;
    return { range: replaced, text: inserted, selection: caretAt(range.location + head.length), opensFollowUp: false };
}

interface LineExtent {
    readonly start: number;
    /** Hinter dem Zeilenende (`\n`, `\r` oder `\r\n`), wie `NSString.lineRange` */
    readonly end: number;
}

function lineAt(text: string, location: number): LineExtent {
    const contentEnd = lineEndFrom(text, location);
    return { start: lineStartOf(text, location), end: contentEnd + terminatorLength(text, contentEnd) };
}

function terminatorLength(text: string, index: number): number {
    if (index >= text.length) return 0;
    return text.charAt(index) === CARRIAGE_RETURN && text.charAt(index + 1) === NEWLINE ? 2 : 1;
}

function nextLine(text: string, lineEnd: number): string {
    if (lineEnd >= text.length) return '';
    return text.slice(lineEnd, lineAt(text, lineEnd).end);
}

// Option

/**
 * Ersetzt die ganze Option. `key=` lässt den Cursor hinter `=` (ein vorhandenes `=` bleibt, statt `height==`
 * zu ergeben); bei Klammern mit nur einem Wert wird `]` ergänzt, falls es in der Zeile fehlt.
 */
function optionEdit(value: string, target: OptionTargetKind, contextRange: TextRange, text: string): CompletionEdit {
    const range = optionRange(contextRange, text);
    const rangeEnd = range.location + range.length;
    if (value.endsWith(EQUALS)) {
        const hasEquals = text.charAt(rangeEnd) === EQUALS;
        const inserted = hasEquals ? value.slice(0, -EQUALS.length) : value;
        const caret = range.location + inserted.length + (hasEquals ? EQUALS.length : 0);
        return { range, text: inserted, selection: caretAt(caret), opensFollowUp: true };
    }
    const rest = text.slice(rangeEnd, lineAt(text, rangeEnd).end);
    const closes = SINGLE_VALUE_TARGETS.has(target) && !rest.includes(CLOSE_BRACKET);
    const inserted = value + (closes ? CLOSE_BRACKET : '');
    return { range, text: inserted, selection: caretAt(range.location + inserted.length), opensFollowUp: false };
}

function optionRange(range: TextRange, text: string): TextRange {
    let end = range.location + range.length;
    while (end < text.length && !OPTION_STOPS.has(text.charAt(end))) end++;
    return rangeBetween(range.location, end);
}
