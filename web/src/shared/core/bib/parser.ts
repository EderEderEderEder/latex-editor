// Bib-Parser (Port von `BibParser` aus `Bibliography.swift` und `ProjectCatalog.bibEntries`):
// `@typ{schlüssel, feld = {wert}, feld = "wert", feld = 2024}`; verschachtelte Klammern, Kommentare außerhalb
// von Einträgen und `@comment`/`@string`/`@preamble` werden übersprungen. Reine Logik ohne DOM, Node oder
// Electron; Positionen sind UTF-16-Einheiten. Zeilenumbruch ist `\n` (ein vorangehendes `\r` stört nicht).
import { authorsShort } from './authors';
import { isWhitespaceCharacter, prefixCharacters, splitLines, trimBlanks, trimWhitespace } from './textUtils';

export interface BibField {
    readonly name: string;
    readonly value: string;
}

/** Ein Eintrag einer `.bib`-Datei mit allen Feldern in Originalreihenfolge (Typ und Feldnamen kleingeschrieben) */
export interface BibRecord {
    readonly type: string;
    readonly key: string;
    readonly fields: readonly BibField[];
}

/** Eintrag des Projektkatalogs für Vervollständigung und Listen */
export interface BibEntry {
    readonly key: string;
    readonly title: string;
    /** Kurzform: „Mustermann“, „Mustermann und Musterfrau“, „Mustermann u. a.“ */
    readonly authors: string;
    readonly year: string;
    /** Rohwert für die Suche (alle Namen), ohne Klammern */
    readonly allAuthors: string;
    /** „Mustermann 2024 · Titel“ */
    readonly summary: string;
    /** 1-basiert; Zeile des ersten Eintrags mit diesem Schlüssel, sonst 1 */
    readonly line: number;
}

const SKIPPED_TYPES: ReadonlySet<string> = new Set(['comment', 'string', 'preamble']);
const YEAR_LENGTH = 4;
const SUMMARY_SEPARATOR = ' · ';
const IDENTIFIER = /[\p{L}\p{M}\p{N}_\-:.]*/uy;
const ENTRY_START = /^\s*@[A-Za-z]+\s*[{(]\s*([^,\s]+)\s*,/gmd;
const WORD_STOPS = new Set([',', '#', '\n']);

/** Leseposition im Text; wird von den Lesefunktionen vorgeschoben */
interface Scanner {
    readonly text: string;
    index: number;
}

function skipWhitespace(scanner: Scanner): void {
    while (scanner.index < scanner.text.length && isWhitespaceCharacter(scanner.text.charAt(scanner.index))) scanner.index += 1;
}

function readIdentifier(scanner: Scanner): string {
    IDENTIFIER.lastIndex = scanner.index;
    const identifier = IDENTIFIER.exec(scanner.text)?.[0] ?? '';
    scanner.index += identifier.length;
    return identifier;
}

/** Index hinter der schließenden Klammer `closing` auf Tiefe 0 (oder Textende) */
function skipBalanced(text: string, from: number, closing: string): number {
    let depth = 0;
    for (let index = from; index < text.length; index += 1) {
        const character = text.charAt(index);
        if (character === '{') depth += 1;
        if (character === closing && depth === 0) return index + 1;
        if (character === '}') depth -= 1;
    }
    return text.length;
}

function readBracedPart(scanner: Scanner): string {
    const start = scanner.index + 1;
    const end = skipBalanced(scanner.text, start, '}');
    scanner.index = end;
    return scanner.text.slice(start, Math.max(start, end - 1));
}

function readQuotedPart(scanner: Scanner): string {
    const { text } = scanner;
    const start = scanner.index + 1;
    let end = start;
    let depth = 0;
    while (end < text.length && (text.charAt(end) !== '"' || depth > 0)) {
        if (text.charAt(end) === '{') depth += 1;
        else if (text.charAt(end) === '}') depth -= 1;
        end += 1;
    }
    scanner.index = end + 1;
    return text.slice(start, Math.min(end, text.length));
}

function readWordPart(scanner: Scanner, closing: string): string {
    const start = scanner.index;
    while (scanner.index < scanner.text.length) {
        const character = scanner.text.charAt(scanner.index);
        if (WORD_STOPS.has(character) || character === closing) break;
        scanner.index += 1;
    }
    return trimBlanks(scanner.text.slice(start, scanner.index));
}

function readValuePart(scanner: Scanner, closing: string): string {
    const character = scanner.text.charAt(scanner.index);
    if (character === '{') return readBracedPart(scanner);
    if (character === '"') return readQuotedPart(scanner);
    return readWordPart(scanner, closing);
}

/** `{…}` (verschachtelt), `"…"` oder ein Wort/eine Zahl; `#`-Verkettungen werden zusammengefügt. */
function readValue(scanner: Scanner, closing: string): string {
    let value = '';
    while (scanner.index < scanner.text.length) {
        value += readValuePart(scanner, closing);
        skipWhitespace(scanner);
        if (scanner.text.charAt(scanner.index) !== '#') break;
        scanner.index += 1;
        skipWhitespace(scanner);
    }
    return splitLines(value).map(trimBlanks).join(' ');
}

function readFields(scanner: Scanner, closing: string): BibField[] {
    const fields: BibField[] = [];
    while (scanner.index < scanner.text.length && scanner.text.charAt(scanner.index) !== closing) {
        scanner.index += 1;
        skipWhitespace(scanner);
        const name = readIdentifier(scanner);
        skipWhitespace(scanner);
        if (name.length === 0 || scanner.text.charAt(scanner.index) !== '=') continue;
        scanner.index += 1;
        skipWhitespace(scanner);
        fields.push({ name: name.toLowerCase(), value: readValue(scanner, closing) });
        skipWhitespace(scanner);
    }
    return fields;
}

function readKey(scanner: Scanner, closing: string): string {
    const start = scanner.index;
    while (scanner.index < scanner.text.length) {
        const character = scanner.text.charAt(scanner.index);
        if (character === ',' || character === closing) break;
        scanner.index += 1;
    }
    return trimWhitespace(scanner.text.slice(start, scanner.index));
}

interface EntryResult {
    readonly record: BibRecord | null;
    /** Index hinter dem Eintrag */
    readonly end: number;
}

/** Ein Eintrag ab `@`; liefert den Eintrag (oder `null`) und das Ende hinter der schließenden Klammer. */
function parseEntry(text: string, atIndex: number): EntryResult {
    const scanner: Scanner = { text, index: atIndex + 1 };
    const type = readIdentifier(scanner).toLowerCase();
    skipWhitespace(scanner);
    const opening = text.charAt(scanner.index);
    if (opening !== '{' && opening !== '(') return { record: null, end: scanner.index };
    const closing = opening === '{' ? '}' : ')';
    scanner.index += 1;
    if (SKIPPED_TYPES.has(type)) return { record: null, end: skipBalanced(text, scanner.index, closing) };
    skipWhitespace(scanner);
    const key = readKey(scanner, closing);
    const fields = readFields(scanner, closing);
    const end = scanner.index + 1;
    return { record: key.length === 0 ? null : { type, key, fields }, end };
}

/** Index hinter der Zeile, wenn bei `index` ein Kommentar (`%`) beginnt, sonst das nächste Zeichen */
function nextIndexOutsideEntry(text: string, index: number): number {
    if (text.charAt(index) !== '%') return index + 1;
    const lineEnd = text.indexOf('\n', index);
    return lineEnd < 0 ? text.length + 1 : lineEnd + 1;
}

/** Alle Einträge in Textreihenfolge; `@comment`, `@string`, `@preamble` und Einträge ohne Schlüssel entfallen. */
export function parseBib(text: string): BibRecord[] {
    const records: BibRecord[] = [];
    let index = 0;
    while (index < text.length) {
        if (text.charAt(index) !== '@') {
            index = nextIndexOutsideEntry(text, index);
            continue;
        }
        const { record, end } = parseEntry(text, index);
        if (record !== null) records.push(record);
        index = Math.max(end, index + 1);
    }
    return records;
}

/** Wert des ersten Felds mit diesem (kleingeschriebenen) Namen */
export function bibFieldValue(record: BibRecord, name: string): string | undefined {
    return record.fields.find((field) => field.name === name)?.value;
}

/** Geschweifte Klammern (Schutz der Großschreibung) entfernen */
function withoutBraces(value: string): string {
    return trimBlanks(value.replaceAll('{', '').replaceAll('}', ''));
}

/** Zeile (1-basiert) des ersten Eintrags zu jedem Schlüssel; gezählt wird ab dem Schlüssel */
function entryLines(text: string): Map<string, number> {
    const lines = new Map<string, number>();
    let line = 1;
    let scanned = 0;
    for (const match of text.matchAll(ENTRY_START)) {
        const keyRange = match.indices?.[1];
        const key = match[1];
        if (keyRange === undefined || key === undefined) continue;
        for (; scanned < keyRange[0]; scanned += 1) if (text.charAt(scanned) === '\n') line += 1;
        if (!lines.has(key)) lines.set(key, line);
    }
    return lines;
}

function summaryOf(authors: string, year: string, title: string): string {
    const head = [authors, year].filter((part) => part.length > 0).join(' ');
    return [head, title].filter((part) => part.length > 0).join(SUMMARY_SEPARATOR);
}

/** Katalogeinträge einer `.bib`-Datei: Autor kurz (author, sonst editor, sonst organization), Jahr aus date oder year */
export function catalogEntries(text: string): BibEntry[] {
    const lines = entryLines(text);
    return parseBib(text).map((record) => {
        const rawAuthors = bibFieldValue(record, 'author') ?? bibFieldValue(record, 'editor') ?? bibFieldValue(record, 'organization') ?? '';
        const year = prefixCharacters(bibFieldValue(record, 'date') ?? bibFieldValue(record, 'year') ?? '', YEAR_LENGTH);
        const title = withoutBraces(bibFieldValue(record, 'title') ?? '');
        const authors = withoutBraces(authorsShort(rawAuthors));
        return {
            key: record.key,
            title,
            authors,
            year,
            allAuthors: withoutBraces(rawAuthors),
            summary: summaryOf(authors, year, title),
            line: lines.get(record.key) ?? 1,
        };
    });
}
