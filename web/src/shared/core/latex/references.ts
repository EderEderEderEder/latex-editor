/**
 * Verweise und Literatur eines Projekts: Schlüssel in `\label`, `\ref`, `\cite`, Labels und Quellen je Datei,
 * benutzte Labels und Zitate, Abkürzungen. Port von `LatexReferences.swift`, `ProjectCatalog.swift` (Labels,
 * Literatureinträge), `BibParser` und `Acronyms` (Swift). Reine Logik ohne DOM und Node; alle Positionen sind
 * UTF-16-Einheiten. Die Regeln für Kommentare, `\verb` und Code stehen in `masking.ts`.
 *
 * Regex-Unterschiede zu Swift (ICU): `\s` ist dort `White_Space` (mit U+0085, ohne U+FEFF), `\b` kennt Unicode-Wörter,
 * `^` im Mehrzeilenmodus erkennt auch `\v`, `\f`, U+0085 (und `\r\n` als eine Einheit). Wer in JavaScript
 * dasselbe will, nimmt die Bausteine `ICU_SPACE`, `ICU_NOT_WORD_BEFORE` und `ICU_LINE_START` unten.
 */
import { findCommentStart } from './comments';
import type { LabelEntry } from './duplicateLabels';
import { scannable, scanReferencesMasked } from './masking';

export { scanReferences, scanReferencesMasked } from './masking';
export type { ReferenceKind, ReferenceOccurrence } from './masking';

/** ICU-`\s` als Inhalt einer Zeichenklasse (Flag `u` nötig) */
export const ICU_SPACE = '\\t-\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
/** Ersatz für das Unicode-`\b` von ICU vor einem Wortzeichen: davor steht kein Wortzeichen */
export const ICU_NOT_WORD_BEFORE = '(?<![\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\u200c\\u200d])';
/** Ersatz für das Unicode-`\b` hinter einem Wortzeichen: danach steht kein Wortzeichen */
export const ICU_NOT_WORD_AFTER = '(?![\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\u200c\\u200d])';
/** Ersatz für `^` im Mehrzeilenmodus von ICU (Textanfang oder nach `\n`, `\v`, `\f`, U+0085, U+2028/9, `\r` ohne `\n`) */
export const ICU_LINE_START = '(?:(?<![^])|(?<=[\\n\\v\\f\\u0085\\u2028\\u2029])|(?<=\\r)(?!\\n))';

export interface TextSpan {
    readonly start: number;
    readonly end: number;
}

export interface ProjectFile {
    readonly path: string;
    readonly text: string;
}

export interface BibEntry {
    readonly key: string;
    /** Nur, wenn die Datei bekannt ist */
    readonly file?: string;
    /** 1-basierte Zeile des ersten Eintragskopfs mit diesem Schlüssel */
    readonly line: number;
}

export interface UsedReferences {
    readonly usedLabels: Set<string>;
    readonly usedCitations: Set<string>;
    readonly citesEverything: boolean;
}

/** Dateiname ohne Verzeichnis, Endung klein geschrieben (`''` ohne Endung) */
export function pathExtension(path: string): string {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export function isTexPath(path: string): boolean {
    return pathExtension(path) === 'tex';
}

export function isBibPath(path: string): boolean {
    return pathExtension(path) === 'bib';
}

// MARK: \nocite{*}

const CITE_EVERYTHING_COMMAND = '\\nocite{*}';

/** `\nocite{*}` im schon maskierten Text: alle Quellen der Literaturdatei gelten als benutzt */
export function citesEverythingMasked(masked: string): boolean {
    return masked.includes(CITE_EVERYTHING_COMMAND);
}

export function citesEverything(text: string): boolean {
    return citesEverythingMasked(scannable(text));
}

// MARK: Labels je Datei

const LABEL_OPEN = '\\label{';
const LABEL_CLOSE = '}';
const HORIZONTAL_SPACE_EDGES = /^[\t\p{Zs}]+|[\t\p{Zs}]+$/gu;

function labelsInLine(line: string, file: string, lineNumber: number): LabelEntry[] {
    const code = line.slice(0, findCommentStart(line) ?? line.length);
    const entries: LabelEntry[] = [];
    let searchStart = 0;
    for (;;) {
        const open = code.indexOf(LABEL_OPEN, searchStart);
        if (open === -1) return entries;
        const nameStart = open + LABEL_OPEN.length;
        const close = code.indexOf(LABEL_CLOSE, nameStart);
        if (close === -1) return entries;
        const label = code.slice(nameStart, close).replace(HORIZONTAL_SPACE_EDGES, '');
        if (label !== '') entries.push({ label, file, line: lineNumber });
        searchStart = close;
    }
}

/**
 * Labels einer `.tex`-Datei wie im Projektkatalog: zeilenweise, Kommentar ab dem ersten wirksamen `%` abgeschnitten,
 * jedes `\label{NAME}`. Anders als die Swift-Vorlage trennt `\r\n` Zeilen (dort bleibt es bei Zeichenketten ein Zeichen).
 */
export function catalogLabels(text: string, file: string): LabelEntry[] {
    return text.split('\n').flatMap((line, index) => labelsInLine(line, file, index + 1));
}

// MARK: Literatur

const BIB_SKIPPED_TYPES: ReadonlySet<string> = new Set(['comment', 'string', 'preamble']);
const IDENTIFIER_CHARACTER = /[\p{L}\p{N}_\-:.]/u;
const WHITESPACE_CHARACTER = /\p{White_Space}/u;
const WHITESPACE_EDGES = /^\p{White_Space}+|\p{White_Space}+$/gu;
const VALUE_WORD_STOPS = ',#\n';

/** Liest `.bib`-Text und liefert die Eintragsschlüssel in Dateireihenfolge (Port von `BibParser.parse`, nur Schlüssel) */
class BibKeyParser {
    private index = 0;

    constructor(private readonly text: string) {}

    keys(): string[] {
        const keys: string[] = [];
        while (this.index < this.text.length) {
            const start = this.index;
            if (this.text[start] !== '@') {
                this.index = this.text[start] === '%' ? this.afterLine(start) : start + 1;
                continue;
            }
            const { key, end } = this.parseEntry(start);
            if (key !== null) keys.push(key);
            this.index = Math.max(end, start + 1);
        }
        return keys;
    }

    private afterLine(position: number): number {
        const newline = this.text.indexOf('\n', position);
        return (newline === -1 ? this.text.length : newline) + 1;
    }

    private parseEntry(start: number): { key: string | null; end: number } {
        this.index = start + 1;
        const type = this.readIdentifier().toLowerCase();
        this.skipWhitespace();
        const opening = this.text[this.index];
        if (opening !== '{' && opening !== '(') return { key: null, end: this.index };
        const closing = opening === '{' ? '}' : ')';
        this.index += 1;
        if (BIB_SKIPPED_TYPES.has(type)) return { key: null, end: this.skipBalanced(this.index, closing) };
        this.skipWhitespace();
        const key = this.readKey(closing).replace(WHITESPACE_EDGES, '');
        this.skipFields(closing);
        return { key: key === '' ? null : key, end: this.index + 1 };
    }

    private readKey(closing: string): string {
        const keyStart = this.index;
        while (this.index < this.text.length && this.text[this.index] !== ',' && this.text[this.index] !== closing) this.index += 1;
        return this.text.slice(keyStart, this.index);
    }

    private skipFields(closing: string): void {
        while (this.index < this.text.length && this.text[this.index] !== closing) {
            this.index += 1;
            this.skipWhitespace();
            const name = this.readIdentifier();
            this.skipWhitespace();
            if (name === '' || this.text[this.index] !== '=') continue;
            this.index += 1;
            this.skipWhitespace();
            this.skipValue(closing);
            this.skipWhitespace();
        }
    }

    /** `{…}`, `"…"` oder ein Wort, mit `#` verkettet */
    private skipValue(closing: string): void {
        while (this.index < this.text.length) {
            const character = this.text[this.index];
            if (character === '{') this.index = this.skipBalanced(this.index + 1, '}');
            else if (character === '"') this.skipQuoted();
            else this.skipWord(closing);
            this.skipWhitespace();
            if (this.text[this.index] !== '#') return;
            this.index += 1;
            this.skipWhitespace();
        }
    }

    private skipQuoted(): void {
        let end = this.index + 1;
        let depth = 0;
        while (end < this.text.length && (this.text[end] !== '"' || depth > 0)) {
            if (this.text[end] === '{') depth += 1;
            else if (this.text[end] === '}') depth -= 1;
            end += 1;
        }
        this.index = end + 1;
    }

    private skipWord(closing: string): void {
        while (this.index < this.text.length) {
            const character = this.text[this.index] ?? '';
            if (VALUE_WORD_STOPS.includes(character) || character === closing) return;
            this.index += 1;
        }
    }

    private skipBalanced(from: number, closing: string): number {
        let depth = 0;
        let position = from;
        while (position < this.text.length) {
            const character = this.text[position];
            if (character === '{') depth += 1;
            if (character === '}' || character === closing) {
                if (depth === 0 && character === closing) return position + 1;
                if (character === '}') depth -= 1;
            }
            position += 1;
        }
        return position;
    }

    private readIdentifier(): string {
        const start = this.index;
        while (this.index < this.text.length && IDENTIFIER_CHARACTER.test(this.text[this.index] ?? '')) this.index += 1;
        return this.text.slice(start, this.index);
    }

    private skipWhitespace(): void {
        while (this.index < this.text.length && WHITESPACE_CHARACTER.test(this.text[this.index] ?? '')) this.index += 1;
    }
}

export function parseBibKeys(text: string): string[] {
    return new BibKeyParser(text).keys();
}

/** Eintragskopf `@typ{schlüssel,` am Zeilenanfang; Gruppe 2 sind die Leerzeichen hinter dem Schlüssel (für dessen Ende) */
const ENTRY_START = new RegExp(
    `${ICU_LINE_START}[${ICU_SPACE}]*@[A-Za-z]+[${ICU_SPACE}]*[{(][${ICU_SPACE}]*([^,${ICU_SPACE}]+)([${ICU_SPACE}]*),`, 'gu',
);

/** 1-basierte Zeile des ersten Eintragskopfs je Schlüssel; gezählt wird ab dem Schlüssel (`^\s*` schluckt Leerzeilen) */
function entryLines(text: string): Map<string, number> {
    const lines = new Map<string, number>();
    let line = 1;
    let scanned = 0;
    for (const match of text.matchAll(ENTRY_START)) {
        const [whole = '', key = '', trailing = ''] = match;
        const keyStart = match.index + whole.length - 1 - trailing.length - key.length;
        for (; scanned < keyStart; scanned++) {
            if (text[scanned] === '\n') line += 1;
        }
        if (!lines.has(key)) lines.set(key, line);
    }
    return lines;
}

/** Literatureinträge eines `.bib`-Textes (Duplikate bleiben); `file` setzt Datei und Zeile des Eintrags, sonst Zeile 1 */
export function bibEntries(text: string, file?: string): BibEntry[] {
    const lines = file === undefined ? new Map<string, number>() : entryLines(text);
    return parseBibKeys(text).map((key) => ({ key, ...(file === undefined ? {} : { file }), line: lines.get(key) ?? 1 }));
}

// MARK: Benutzte Verweise

/** Benutzte Labels und Zitate der `.tex`-Dateien (Definitionen und Kommentare zählen nicht) */
export function usedReferences(files: readonly ProjectFile[]): UsedReferences {
    const usedLabels = new Set<string>();
    const usedCitations = new Set<string>();
    let everything = false;
    for (const file of files) {
        if (!isTexPath(file.path)) continue;
        const masked = scannable(file.text);
        for (const occurrence of scanReferencesMasked(masked)) {
            if (occurrence.kind === 'labelUse') usedLabels.add(occurrence.key);
            else if (occurrence.kind === 'citation') usedCitations.add(occurrence.key);
        }
        if (citesEverythingMasked(masked)) everything = true;
    }
    return { usedLabels, usedCitations, citesEverything: everything };
}

// MARK: Abkürzungen und Glossar

export const ACRONYM_DEFINITION_COMMANDS: readonly string[] = [
    'newacronym', 'newglossaryentry', 'longnewglossaryentry', 'newabbreviation', 'DeclareAcronym', 'newdualentry',
];
export const ACRONYM_USE_COMMANDS: readonly string[] = [
    'ac', 'acs', 'acl', 'acf', 'acp', 'acsp', 'aclp', 'acfp', 'Ac', 'Acs', 'Acl', 'Acf', 'Acp', 'Acsp', 'Aclp', 'Acfp',
    'iac', 'Iac', 'acsingle', 'acused', 'acreset', 'acuse', 'acresetall',
    'gls', 'Gls', 'GLS', 'glspl', 'Glspl', 'GLSpl', 'glstext', 'Glstext', 'glsfirst', 'Glsfirst', 'glsdesc', 'Glsdesc',
    'glssymbol', 'glsuseri', 'glsentrytext', 'glslink',
    'acrshort', 'acrlong', 'acrfull', 'Acrshort', 'Acrlong', 'Acrfull', 'acrshortpl', 'acrlongpl', 'acrfullpl',
    'glsxtrshort', 'glsxtrlong', 'glsxtrfull',
];

export interface AcronymOccurrence extends TextSpan {
    readonly key: string;
    readonly isDefinition: boolean;
}

const ACRONYM_NAMES = [...ACRONYM_DEFINITION_COMMANDS, ...ACRONYM_USE_COMMANDS].sort((a, b) => b.length - a.length).join('|');
/** Gruppe 1 Befehl, Gruppe 2 Schlüssel, Gruppe 3 Leerzeichen hinter dem Schlüssel */
const ACRONYM_PATTERN = new RegExp(
    `\\\\(${ACRONYM_NAMES})\\*?[${ICU_SPACE}]*(?:\\[[^\\]\\n]*\\][${ICU_SPACE}]*)?\\{[${ICU_SPACE}]*([^{}${ICU_SPACE},]+)([${ICU_SPACE}]*)\\}`, 'gu',
);

/** Abkürzungen in schon maskiertem Text; der Bereich ist der Schlüssel */
export function scanAcronymsMasked(masked: string): AcronymOccurrence[] {
    return [...masked.matchAll(ACRONYM_PATTERN)].map((match) => {
        const [whole = '', command = '', key = '', trailing = ''] = match;
        const end = match.index + whole.length - 1 - trailing.length;
        return { key, start: end - key.length, end, isDefinition: ACRONYM_DEFINITION_COMMANDS.includes(command) };
    });
}

export function scanAcronyms(text: string): AcronymOccurrence[] {
    return scanAcronymsMasked(scannable(text));
}
