/**
 * Fundstellen und Verwendungen eines Labels, einer Quelle, Abkürzung, eines Befehls oder einer Umgebung.
 * Port von `Renamer.occurrences`, `BibKeys`, `CommandNames`, `EnvironmentNames` und `UsageFinder` (Swift).
 * Reine Logik, UTF-16-Positionen; Zeilentrenner ist `\n`. Kommentare, `\verb` und Code zählen nie (`masking.ts`).
 */
import { type BibLexState, INITIAL_BIB_STATE, tokenizeBibLine } from '../bib/tokenizer';
import { scannable } from './masking';
import {
    ICU_NOT_WORD_AFTER,
    ICU_NOT_WORD_BEFORE,
    ICU_SPACE,
    isBibPath,
    scanAcronyms,
    scanReferences,
    type TextSpan,
} from './references';

export type UsageKind = 'label' | 'citation' | 'acronym' | 'command' | 'environment';

export interface UsageSubject {
    readonly kind: UsageKind;
    /** Ohne `\` (Befehle) und ohne Klammern */
    readonly name: string;
}

export interface UsageEntry {
    readonly file: string;
    /** 1-basiert */
    readonly line: number;
    /** Die Zeile ohne Einrückung, bei langen Zeilen ein Ausschnitt um den Treffer */
    readonly excerpt: string;
    readonly isDefinition: boolean;
    /** Stelle des Treffers im Auszug, zum Hervorheben */
    readonly matchInExcerpt: TextSpan | null;
    /** Laufende Nummer der Stelle in der Zeile */
    readonly index: number;
    readonly id: string;
}

export const MAXIMUM_EXCERPT_LENGTH = 140;
const LEADING_CONTEXT = 40;
const ELLIPSIS = '…';
const BACKSLASH = '\\';

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bySpanStart(first: TextSpan, second: TextSpan): number {
    return first.start - second.start;
}

// MARK: .bib

/** Schlüssel des Eintragskopfs: Gruppe 1 Typ, 2 Schlüssel, 3 Leerzeichen hinter dem Schlüssel */
const BIB_ENTRY_HEADER = new RegExp(
    `@([A-Za-z]+)[${ICU_SPACE}]*[{(][${ICU_SPACE}]*([^${ICU_SPACE},{}()"#%=]+)([${ICU_SPACE}]*),`, 'gu',
);
/** Gruppe 1 ist der Inhalt der Klammer oder der Anführungszeichen (`\b` von ICU als Lookbehind) */
const BIB_CROSS_REFERENCE = new RegExp(
    `${ICU_NOT_WORD_BEFORE}(?:crossref|xref|xdata|related)[${ICU_SPACE}]*=[${ICU_SPACE}]*[{"]([^{}"]*)[}"]`, 'giu',
);
const BIB_TYPES_WITHOUT_KEY: ReadonlySet<string> = new Set(['comment', 'string', 'preamble']);
const LIST_SEPARATOR = ',';
const LIST_WHITESPACE = new Set([' ', '\t', '\r', '\n']);

function bibCommentSpans(text: string): TextSpan[] {
    const spans: TextSpan[] = [];
    let state: BibLexState = INITIAL_BIB_STATE;
    let offset = 0;
    for (const line of text.split('\n')) {
        const result = tokenizeBibLine(line, offset, state);
        for (const token of result.tokens) {
            if (token.kind === 'comment') spans.push({ start: token.from, end: token.to });
        }
        state = result.state;
        offset += line.length + 1;
    }
    return spans;
}

/** Binärsuche in nach Position sortierten, überlappungsfreien Bereichen */
function overlapsAny(spans: readonly TextSpan[], range: TextSpan): boolean {
    let low = 0;
    let high = spans.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if ((spans[middle]?.end ?? 0) <= range.start) low = middle + 1;
        else high = middle;
    }
    const candidate = spans[low];
    return candidate !== undefined && candidate.start < range.end;
}

/** Kommagetrennte Einträge ohne Leerraum; `group` ist der Bereich zwischen den Klammern */
function listItems(text: string, group: TextSpan): TextSpan[] {
    const items: TextSpan[] = [];
    let start = group.start;
    while (start <= group.end) {
        let stop = start;
        while (stop < group.end && text[stop] !== LIST_SEPARATOR) stop++;
        let first = start;
        let last = stop;
        while (first < last && LIST_WHITESPACE.has(text[first] ?? '')) first++;
        while (last > first && LIST_WHITESPACE.has(text[last - 1] ?? '')) last--;
        if (last > first) items.push({ start: first, end: last });
        start = stop + 1;
    }
    return items;
}

function bibHeaderKeys(text: string, key: string): TextSpan[] {
    const spans: TextSpan[] = [];
    for (const match of text.matchAll(BIB_ENTRY_HEADER)) {
        const [whole = '', type = '', name = '', trailing = ''] = match;
        if (BIB_TYPES_WITHOUT_KEY.has(type.toLowerCase()) || name !== key) continue;
        const end = match.index + whole.length - 1 - trailing.length;
        spans.push({ start: end - name.length, end });
    }
    return spans;
}

function bibCrossReferences(text: string, key: string): TextSpan[] {
    const spans: TextSpan[] = [];
    for (const match of text.matchAll(BIB_CROSS_REFERENCE)) {
        const [whole = '', group = ''] = match;
        const end = match.index + whole.length - 1;
        for (const item of listItems(text, { start: end - group.length, end })) {
            if (text.slice(item.start, item.end) === key) spans.push(item);
        }
    }
    return spans;
}

/** Eintragsschlüssel und Querverweise (`crossref`, `xref`, `xdata`, `related`) mit diesem Namen; Kommentare zählen nicht */
export function bibKeyOccurrences(text: string, key: string): TextSpan[] {
    const comments = bibCommentSpans(text);
    return [...bibHeaderKeys(text, key), ...bibCrossReferences(text, key)]
        .filter((span) => !overlapsAny(comments, span))
        .sort(bySpanStart);
}

// MARK: Befehle und Umgebungen

/** Ein `\` beginnt einen Befehl, wenn davor eine gerade Zahl von `\` steht (`\\` ist ein Zeilenumbruch) */
function startsCommand(text: string, index: number): boolean {
    let count = 0;
    for (let position = index - 1; position >= 0 && text[position] === BACKSLASH; position--) count++;
    return count % 2 === 0;
}

/** Jedes `\name` (Definition und Aufrufe), nicht `\namefoo`, nicht `\\name`; der Bereich ist der Name ohne `\` */
export function commandOccurrences(text: string, name: string): TextSpan[] {
    const masked = scannable(text);
    const pattern = new RegExp(`\\\\${escapeRegExp(name)}(?![A-Za-z@])`, 'gu');
    const spans: TextSpan[] = [];
    for (const match of masked.matchAll(pattern)) {
        if (startsCommand(masked, match.index)) spans.push({ start: match.index + 1, end: match.index + match[0].length });
    }
    return spans;
}

const ENVIRONMENT_DEFINITION_COMMANDS: readonly string[] = [
    'newenvironment', 'renewenvironment', 'NewDocumentEnvironment', 'RenewDocumentEnvironment', 'lstnewenvironment', 'newtheorem',
];
/** Gruppe 1 `begin` oder `end`, Gruppe 2 Name; der Name steht direkt vor der schließenden Klammer */
const BEGIN_END_PATTERN = new RegExp(`\\\\(begin|end)[${ICU_SPACE}]*\\{([A-Za-z]+\\*?)\\}`, 'gu');
const ENVIRONMENT_DEFINITION_PATTERN = new RegExp(
    `\\\\(?:${ENVIRONMENT_DEFINITION_COMMANDS.join('|')})\\*?[${ICU_SPACE}]*\\{([A-Za-z]+\\*?)\\}`, 'gu',
);

function nameBeforeClosingBrace(match: RegExpMatchArray, name: string): TextSpan {
    const end = (match.index ?? 0) + match[0].length - 1;
    return { start: end - name.length, end };
}

/** `\begin{name}`, `\end{name}` und Definitionen (`\newenvironment{name}` …); der Bereich ist der Name */
export function environmentOccurrences(text: string, name: string): TextSpan[] {
    const masked = scannable(text);
    const spans: TextSpan[] = [];
    for (const match of masked.matchAll(BEGIN_END_PATTERN)) spans.push(nameBeforeClosingBrace(match, match[2] ?? ''));
    for (const match of masked.matchAll(ENVIRONMENT_DEFINITION_PATTERN)) spans.push(nameBeforeClosingBrace(match, match[1] ?? ''));
    return spans.filter((span) => masked.slice(span.start, span.end) === name).sort(bySpanStart);
}

// MARK: Fundstellen

/** Alle Fundstellen des Namens, nach Anfang sortiert; in `.bib` nur Quellen, in `.tex` je Art (Swift: `Renamer.occurrences`) */
export function usageOccurrences(subject: UsageSubject, text: string, isBibliography: boolean): TextSpan[] {
    if (isBibliography) return subject.kind === 'citation' ? bibKeyOccurrences(text, subject.name) : [];
    switch (subject.kind) {
        case 'label':
            return scanReferences(text).filter((hit) => hit.kind !== 'citation' && hit.key === subject.name);
        case 'citation':
            return scanReferences(text).filter((hit) => hit.kind === 'citation' && hit.key === subject.name);
        case 'acronym':
            return scanAcronyms(text).filter((hit) => hit.key === subject.name);
        case 'command':
            return commandOccurrences(text, subject.name);
        case 'environment':
            return environmentOccurrences(text, subject.name);
    }
}

/** Wo der Name definiert wird, soweit der Scanner es unterscheiden kann (Label, Abkürzung, Eintrag in der `.bib`) */
function definitionStarts(subject: UsageSubject, text: string, isBibliography: boolean): Set<number> {
    switch (subject.kind) {
        case 'label':
            return new Set(scanReferences(text).filter((hit) => hit.kind === 'labelDefinition' && hit.key === subject.name).map((hit) => hit.start));
        case 'acronym':
            return new Set(scanAcronyms(text).filter((hit) => hit.isDefinition && hit.key === subject.name).map((hit) => hit.start));
        case 'citation':
            return isBibliography ? new Set(bibKeyOccurrences(text, subject.name).map((hit) => hit.start)) : new Set();
        case 'command':
        case 'environment':
            return new Set();
    }
}

const COMMAND_DEFINITION_LINE = new RegExp(
    `\\\\(?:re)?newcommand|\\\\providecommand|\\\\DeclareRobustCommand|\\\\(?:New|Renew|Provide|Declare)DocumentCommand|\\\\[gex]?def${ICU_NOT_WORD_AFTER}`, 'u',
);
const ENVIRONMENT_DEFINITION_LINE = /\\(?:re)?newenvironment|\\(?:New|Renew|Provide)DocumentEnvironment|\\NewEnviron/u;

function isDefinitionLine(line: string, kind: UsageKind): boolean {
    if (kind === 'command') return COMMAND_DEFINITION_LINE.test(line);
    if (kind === 'environment') return ENVIRONMENT_DEFINITION_LINE.test(line);
    return false;
}

// MARK: Zeilen und Auszüge

function computeLineStarts(text: string): number[] {
    const starts = [0];
    for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) starts.push(index + 1);
    return starts;
}

/** 0-basierte Zeile, in der `offset` liegt (ein `\n` gehört zur Zeile, die es beendet) */
function lineIndexOf(lineStarts: readonly number[], offset: number): number {
    let low = 0;
    let high = lineStarts.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if ((lineStarts[middle] ?? 0) <= offset) low = middle + 1;
        else high = middle;
    }
    return low - 1;
}

function isIndent(character: string | undefined): boolean {
    return character === ' ' || character === '\t';
}

/** Die Zeile ohne Einrückung; ist sie lang, ein Ausschnitt von 140 Zeichen, der 40 Zeichen vor dem Treffer beginnt */
function excerptOf(text: string, lineStart: number, lineEnd: number, match: TextSpan): { excerpt: string; match: TextSpan | null } {
    let start = lineStart;
    while (start < lineEnd && isIndent(text[start])) start++;
    let shownStart = start;
    let shownEnd = Math.min(lineEnd, start + MAXIMUM_EXCERPT_LENGTH);
    if (match.end > shownEnd) {
        shownStart = Math.max(start, match.start - LEADING_CONTEXT);
        shownEnd = Math.min(lineEnd, shownStart + MAXIMUM_EXCERPT_LENGTH);
    }
    const cutFront = shownStart > start;
    const excerpt = (cutFront ? ELLIPSIS : '') + text.slice(shownStart, shownEnd) + (shownEnd < lineEnd ? ELLIPSIS : '');
    const localStart = match.start - shownStart + (cutFront ? ELLIPSIS.length : 0);
    const local = { start: localStart, end: localStart + (match.end - match.start) };
    const isInside = local.start >= 0 && local.end <= excerpt.length;
    return { excerpt, match: isInside ? local : null };
}

/** Verwendungen eines Namens in einem Text, nach Position sortiert (Grundlage der Liste „Verwendungen anzeigen“) */
export function findUsages(subject: UsageSubject, text: string, path: string): UsageEntry[] {
    const isBibliography = isBibPath(path);
    const ranges = usageOccurrences(subject, text, isBibliography);
    if (ranges.length === 0) return [];
    const lineStarts = computeLineStarts(text);
    const definitions = definitionStarts(subject, text, isBibliography);
    const perLine = new Map<number, number>();
    return [...ranges].sort(bySpanStart).map((range) => {
        const line = lineIndexOf(lineStarts, range.start);
        const index = perLine.get(line) ?? 0;
        perLine.set(line, index + 1);
        const lineEnd = line + 1 < lineStarts.length ? (lineStarts[line + 1] ?? text.length) - 1 : text.length;
        const { excerpt, match } = excerptOf(text, lineStarts[line] ?? 0, lineEnd, range);
        const isDefinition = definitions.has(range.start) || isDefinitionLine(excerpt, subject.kind);
        return { file: path, line: line + 1, excerpt, isDefinition, matchInExcerpt: match, index, id: `${path}:${line + 1}:${index}` };
    });
}
