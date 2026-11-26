/**
 * Abkürzungen und Glossar mit Kurz- und Langform (`\newacronym{api}{API}{…}`, `\DeclareAcronym{api}{…}`,
 * `\newglossaryentry{…}`) und die Prüfung ihrer Verwendungen. Port von `Acronyms.definitions` (Swift, `Renaming.swift`).
 * Das Finden der Befehle (`scanAcronyms`) liegt in `references.ts`. Reine Logik, UTF-16-Positionen.
 */
import { scannable } from './masking';
import { problemMessage, type ReferenceProblem } from './referenceCheck';
import { ICU_SPACE, scanAcronymsMasked } from './references';

/** Eine Abkürzung oder ein Glossareintrag eines Textes */
export interface AcronymEntry {
    readonly key: string;
    readonly short: string;
    readonly long: string;
    /** 1-basiert */
    readonly line: number;
    /** „API – Application Programming Interface“ für Listen */
    readonly summary: string;
}

/** Inhalt einer Gruppe wird auf diese Länge (UTF-16) gekürzt */
const MAXIMUM_VALUE_LENGTH = 200;
/** Ein Backslash schützt das nächste Zeichen (beide werden übersprungen) */
const ESCAPE_LENGTH = 2;
const SUMMARY_SEPARATOR = ' – ';
const SPACE_RUN = new RegExp(`[${ICU_SPACE}]+`, 'u');
const EDGE_SPACE = new RegExp(`^[${ICU_SPACE}]+|[${ICU_SPACE}]+$`, 'gu');
/** Zwischen Schlüssel und Gruppen sind diese Zeichen erlaubt */
const GROUP_GAP = new Set([' ', '\t', '\n']);

function trimmed(text: string): string {
    return text.replace(EDGE_SPACE, '');
}

/** Ohne äußere Klammern, Zeilenumbrüche und mehrfache Leerzeichen */
function clean(value: string): string {
    let result = trimmed(value);
    while (result.startsWith('{') && result.endsWith('}') && result.length >= 2) result = result.slice(1, -1);
    return result.split(SPACE_RUN).filter((part) => part !== '').join(' ');
}

interface Group {
    readonly content: string;
    /** Position hinter der schließenden Klammer */
    readonly next: number;
}

/** Inhalt der nächsten `{…}`-Gruppe (Leerraum davor ist erlaubt) oder `null` */
function groupAt(text: string, from: number): Group | null {
    let index = from;
    while (index < text.length && GROUP_GAP.has(text.charAt(index))) index++;
    if (text.charAt(index) !== '{') return null;
    let depth = 0;
    let end = index;
    while (end < text.length) {
        const unit = text.charAt(end);
        if (unit === '\\') {
            end += ESCAPE_LENGTH;
            continue;
        }
        if (unit === '{') depth++;
        else if (unit === '}' && --depth === 0) break;
        end++;
    }
    if (end >= text.length) return null;
    return { content: text.slice(index + 1, index + 1 + Math.min(end - index - 1, MAXIMUM_VALUE_LENGTH)), next: end + 1 };
}

/** Bei Kommas auf Klammertiefe 0 teilen */
function splitTopLevel(text: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const character of text) {
        if (character === '{') depth++;
        else if (character === '}') depth--;
        if (character === ',' && depth === 0) {
            parts.push(current);
            current = '';
        } else {
            current += character;
        }
    }
    parts.push(current);
    return parts;
}

/** `name = API, description = Programmierschnittstelle`; `short`/`long` bei `\DeclareAcronym` */
function keyValues(text: string): { short: string; long: string } {
    const values = new Map<string, string>();
    for (const part of splitTopLevel(text)) {
        const equals = part.indexOf('=');
        if (equals === -1) continue;
        values.set(trimmed(part.slice(0, equals)).toLowerCase(), clean(part.slice(equals + 1)));
    }
    return {
        short: values.get('short') ?? values.get('name') ?? '',
        long: values.get('long') ?? values.get('description') ?? '',
    };
}

/** Die beiden Gruppen hinter dem Schlüssel (`{key}` ist schon gelesen; `keyEnd` ist das Ende des Schlüssels) */
function details(masked: string, keyEnd: number): { short: string; long: string } {
    const close = masked.indexOf('}', keyEnd);
    const cursor = close === -1 ? masked.length : close + 1;
    const first = groupAt(masked, cursor);
    if (first === null) return { short: '', long: '' };
    if (first.content.includes('=')) return keyValues(first.content);
    const second = groupAt(masked, first.next);
    return { short: clean(first.content), long: second === null ? '' : clean(second.content) };
}

function lineOf(masked: string, location: number): number {
    let line = 1;
    for (let index = masked.indexOf('\n'); index !== -1 && index < location; index = masked.indexOf('\n', index + 1)) line++;
    return line;
}

/** Die Definitionen eines Textes (Kommentare, `\verb` und Code zählen nicht) mit Kurzform und Langform, in Textreihenfolge */
export function acronymDefinitions(text: string): AcronymEntry[] {
    const masked = scannable(text);
    return scanAcronymsMasked(masked)
        .filter((occurrence) => occurrence.isDefinition)
        .map((occurrence) => {
            const { short, long } = details(masked, occurrence.end);
            const summary = [short, long].filter((part) => part !== '').join(SUMMARY_SEPARATOR);
            return { key: occurrence.key, short, long, line: lineOf(masked, occurrence.start), summary };
        });
}

/**
 * Verwendungen ohne Definition im Projekt (`known`: alle Schlüssel des Projekts); `known === null`: nicht prüfen.
 * Der Bereich eines Problems ist der Schlüssel.
 */
export function acronymProblems(text: string, known: ReadonlySet<string> | null): ReferenceProblem[] {
    if (known === null) return [];
    return scanAcronymsMasked(scannable(text))
        .filter((occurrence) => !occurrence.isDefinition && !known.has(occurrence.key))
        .map((occurrence) => ({
            kind: 'unknownAcronym' as const, key: occurrence.key, start: occurrence.start, end: occurrence.end,
            message: problemMessage('unknownAcronym', occurrence.key),
        }));
}
