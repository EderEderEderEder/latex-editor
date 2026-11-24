/**
 * Gliederung (W2-6, Vorlage `OutlineParser`/`OutlineStore`/`OutlineTree` der Swift-Version): Überschriften und Includes
 * einer Datei, Gliederung über `\input`/`\include`/`\subfile` hinweg, Include-Kette, aktueller Abschnitt, Baum.
 * Reine Logik ohne Dateizugriff: Texte kommen über eine einspeisbare Funktion `readFile`. Offsets sind UTF-16-Einheiten,
 * Zeilen 1-basiert und beziehen sich auf die jeweilige Datei.
 */
import { isEscapedAt } from './comments';
import { scannable } from './masking';

export const OUTLINE_LEVELS = ['part', 'chapter', 'section', 'subsection', 'subsubsection'] as const;
export type OutlineLevel = (typeof OUTLINE_LEVELS)[number];

export const OUTLINE_LEVEL_TITLES: Readonly<Record<OutlineLevel, string>> = {
    part: 'Teil',
    chapter: 'Kapitel',
    section: 'Abschnitt',
    subsection: 'Unterabschnitt',
    subsubsection: 'Unter-Unterabschnitt',
};

export type IncludeCommand = 'input' | 'include' | 'subfile';

export interface OutlineEntry {
    /** Eindeutig je Gliederung: Datei und Offset des Befehls */
    readonly id: string;
    readonly level: OutlineLevel;
    readonly title: string;
    readonly isStarred: boolean;
    readonly file: string;
    /** 1-basiert */
    readonly line: number;
    /** UTF-16-Offset des Backslashs im Text der Datei */
    readonly offset: number;
}

export interface HeadingItem {
    readonly kind: 'heading';
    readonly level: OutlineLevel;
    readonly title: string;
    readonly isStarred: boolean;
    readonly line: number;
    readonly offset: number;
}

export interface IncludeItem {
    readonly kind: 'include';
    readonly command: IncludeCommand;
    readonly path: string;
    readonly line: number;
    readonly offset: number;
}

export type OutlineItem = HeadingItem | IncludeItem;

/** Datei lesen: Text oder `null` (fehlt/nicht lesbar); darf auch asynchron antworten */
export type ReadFile = (path: string) => string | null | Promise<string | null>;

export interface OutlineResult {
    /** Dokumentreihenfolge über alle eingebundenen Dateien */
    readonly entries: readonly OutlineEntry[];
    /** Eingebundene Datei → erste Datei, die sie einbindet (die Hauptdatei kommt nie als Schlüssel vor) */
    readonly includingFile: Readonly<Record<string, string>>;
}

// MARK: - Zeilenscanner

const COMMAND_PATTERN = /\\(part|chapter|section|subsection|subsubsection|input|include|subfile)(?![A-Za-z@])/g;
const INCLUDE_COMMANDS: readonly string[] = ['input', 'include', 'subfile'];
/** Schutz vor einer nie geschlossenen Klammer: längere Argumente gelten als fehlerhaft */
const MAX_ARGUMENT_LENGTH = 2000;
const NEWLINE = '\n';

interface CommandArgument {
    readonly text: string;
    readonly isStarred: boolean;
    readonly end: number;
}

function skipBlanks(text: string, from: number): number {
    let cursor = from;
    while (text[cursor] === ' ' || text[cursor] === '\t') cursor++;
    return cursor;
}

/** Index der schließenden `]` (nur auf derselben Zeile) oder -1 */
function findOptionalEnd(text: string, open: number): number {
    const limit = Math.min(text.length, open + MAX_ARGUMENT_LENGTH);
    for (let index = open + 1; index < limit; index++) {
        if (text[index] === ']') return index;
        if (text[index] === NEWLINE) return -1;
    }
    return -1;
}

/** Index der passenden `}` (verschachtelt, `\{` zählt nicht) oder -1 */
function findClosingBrace(text: string, open: number): number {
    const limit = Math.min(text.length, open + MAX_ARGUMENT_LENGTH);
    let depth = 0;
    for (let index = open; index < limit; index++) {
        const character = text[index];
        if (character === '\\') index++;
        else if (character === '{') depth++;
        else if (character === '}' && --depth === 0) return index;
    }
    return -1;
}

/** Liest `*`, optionales `[...]` und `{...}` ab `from` */
function readArgument(text: string, from: number): CommandArgument | null {
    let cursor = from;
    const isStarred = text[cursor] === '*';
    if (isStarred) cursor++;
    cursor = skipBlanks(text, cursor);
    if (text[cursor] === '[') {
        const close = findOptionalEnd(text, cursor);
        if (close === -1) return null;
        cursor = skipBlanks(text, close + 1);
    }
    if (text[cursor] !== '{') return null;
    const close = findClosingBrace(text, cursor);
    if (close === -1) return null;
    return { text: text.slice(cursor + 1, close), isStarred, end: close + 1 };
}

/** Entfernt Befehlsnamen und Klammern, behält den Text; Zeilenumbrüche werden zu Leerzeichen */
export function cleanTitle(raw: string): string {
    let result = '';
    let isSkippingCommandName = false;
    for (const character of raw) {
        if (character === '\\') {
            isSkippingCommandName = true;
            continue;
        }
        if (isSkippingCommandName && /\p{L}/u.test(character)) continue;
        isSkippingCommandName = false;
        if (character === '{' || character === '}') continue;
        result += character;
    }
    return result.replace(/\s+/gu, ' ').trim();
}

/** Zeile zu aufsteigenden Offsets, ohne den Text mehrfach zu durchlaufen */
function createLineLocator(text: string): (offset: number) => number {
    let line = 1;
    let position = 0;
    return (offset) => {
        for (; position < offset; position++) {
            if (text[position] === NEWLINE) line++;
        }
        return line;
    };
}

function toItem(command: string, argument: CommandArgument, line: number, offset: number): OutlineItem {
    if (INCLUDE_COMMANDS.includes(command)) {
        return { kind: 'include', command: command as IncludeCommand, path: argument.text.trim(), line, offset };
    }
    return {
        kind: 'heading', level: command as OutlineLevel, title: cleanTitle(argument.text),
        isStarred: argument.isStarred, line, offset,
    };
}

/** Überschriften und Includes einer Datei in Textreihenfolge; Kommentare, `\verb` und Code-Umgebungen zählen nicht */
export function parseOutlineItems(text: string): OutlineItem[] {
    const masked = scannable(text);
    const lineAt = createLineLocator(text);
    const pattern = new RegExp(COMMAND_PATTERN);
    const items: OutlineItem[] = [];
    for (let match = pattern.exec(masked); match !== null; match = pattern.exec(masked)) {
        if (isEscapedAt(masked, match.index, 0)) continue;
        const argument = readArgument(masked, match.index + match[0].length);
        if (argument === null) continue;
        items.push(toItem(match[1] ?? '', argument, lineAt(match.index), match.index));
        pattern.lastIndex = argument.end;
    }
    return items;
}

// MARK: - Pfade

type Separator = '/' | '\\';
const DRIVE_OR_ROOT = /^(?:[A-Za-z]:\/|\/)/;

/** Windows-Pfade (nur `\`) behalten ihren Trenner, alles andere nutzt `/` */
function detectSeparator(path: string): Separator {
    return path.includes('\\') && !path.includes('/') ? '\\' : '/';
}

/** `.`, `..` und doppelte Trenner auflösen (rein textuell); gleicher Trenner wie `separator` */
export function normalizePath(path: string, separator: Separator = detectSeparator(path)): string {
    const unified = path.replace(/\\/g, '/');
    const prefix = DRIVE_OR_ROOT.exec(unified)?.[0] ?? '';
    const segments: string[] = [];
    for (const segment of unified.slice(prefix.length).split('/')) {
        if (segment === '' || segment === '.') continue;
        if (segment !== '..') segments.push(segment);
        else if (segments.length > 0 && segments[segments.length - 1] !== '..') segments.pop();
        else if (prefix === '') segments.push(segment);
    }
    return (prefix + segments.join('/')).replace(/\//g, separator);
}

function directoryOf(path: string): string {
    const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return cut === -1 ? '' : path.slice(0, cut);
}

/** Kandidaten für `\input{pfad}` in Prüfreihenfolge: mit `.tex` zuerst, außer die Endung steht schon da */
export function includeCandidates(argument: string, mainFile: string): string[] {
    if (argument === '') return [];
    const separator = detectSeparator(mainFile);
    const names = argument.endsWith('.tex') ? [argument] : [`${argument}.tex`, argument];
    const base = directoryOf(mainFile);
    const isAbsolute = (name: string): boolean => base === '' || DRIVE_OR_ROOT.test(name.replace(/\\/g, '/'));
    return names.map((name) => normalizePath(isAbsolute(name) ? name : `${base}/${name}`, separator));
}

// MARK: - Gliederung über Includes

interface CachedFile {
    readonly signature: string;
    readonly items: readonly OutlineItem[];
}

/** 53-Bit-Hash (cyrb53) + Länge: der Cache erkennt Änderungen, ohne den Text zu halten */
function signatureOf(text: string): string {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        h1 = Math.imul(h1 ^ code, 2654435761);
        h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return `${text.length}:${4294967296 * (2097151 & h2) + (h1 >>> 0)}`;
}

interface WalkState {
    readonly mainFile: string;
    readonly readFile: ReadFile;
    readonly visited: Set<string>;
    readonly entries: OutlineEntry[];
    readonly includingFile: Record<string, string>;
}

/** Ergebnisse je Datei werden über den Textinhalt gecacht (nicht über Datum/Größe wie in Swift) */
export class OutlineParser {
    private cache = new Map<string, CachedFile>();

    async outline(mainFile: string, readFile: ReadFile): Promise<OutlineResult> {
        const main = normalizePath(mainFile);
        const state: WalkState = { mainFile: main, readFile, visited: new Set(), entries: [], includingFile: {} };
        const text = await readFile(main);
        if (text !== null) await this.walk(state, main, text);
        this.cache = new Map([...this.cache].filter(([path]) => state.visited.has(path)));
        return { entries: state.entries, includingFile: state.includingFile };
    }

    private itemsOf(path: string, text: string): readonly OutlineItem[] {
        const signature = signatureOf(text);
        const cached = this.cache.get(path);
        if (cached?.signature === signature) return cached.items;
        const items = parseOutlineItems(text);
        this.cache.set(path, { signature, items });
        return items;
    }

    private async walk(state: WalkState, file: string, text: string): Promise<void> {
        state.visited.add(file);
        for (const item of this.itemsOf(file, text)) {
            if (item.kind === 'heading') {
                state.entries.push(entryOf(item, file));
                continue;
            }
            await this.followInclude(state, file, item);
        }
    }

    private async followInclude(state: WalkState, file: string, item: IncludeItem): Promise<void> {
        for (const candidate of includeCandidates(item.path, state.mainFile)) {
            const known = state.visited.has(candidate);
            const text = known ? '' : await state.readFile(candidate);
            if (text === null) continue;
            if (candidate !== state.mainFile && !(candidate in state.includingFile)) state.includingFile[candidate] = file;
            if (!known) await this.walk(state, candidate, text);
            return;
        }
    }
}

function entryOf(item: HeadingItem, file: string): OutlineEntry {
    const { level, title, isStarred, line, offset } = item;
    return { id: `${file}:${offset}`, level, title, isStarred, file, line, offset };
}

/** Einmalige Gliederung ohne Cache über mehrere Aufrufe */
export function outlineOf(mainFile: string, readFile: ReadFile): Promise<OutlineResult> {
    return new OutlineParser().outline(mainFile, readFile);
}

// MARK: - Include-Kette und aktueller Abschnitt

/**
 * Include-Kette von der Hauptdatei bis `file` (z. B. main.tex, einleitung.tex). Eine Datei, die nicht eingebunden ist,
 * steht allein; ohne `mainFile` reicht die Kette bis zur obersten bekannten Datei.
 */
export function includeChain(file: string, mainFile: string | null, includingFile: Readonly<Record<string, string>>): string[] {
    const target = normalizePath(file);
    const chain = [target];
    const visited = new Set(chain);
    for (let parent = includingFile[chain[0] ?? '']; parent !== undefined && !visited.has(parent); parent = includingFile[parent]) {
        chain.unshift(parent);
        visited.add(parent);
    }
    const main = mainFile === null ? null : normalizePath(mainFile);
    return main !== null && chain[0] !== main && target !== main ? [target] : chain;
}

/**
 * Abschnitt an einer Zeile: der letzte Eintrag derselben Datei bis zu dieser Zeile. Steht die Zeile vor der ersten
 * Überschrift der Datei, gilt der letzte Eintrag davor in Dokumentreihenfolge. Kommt die Datei nicht vor: `null`.
 */
export function currentEntry(entries: readonly OutlineEntry[], file: string, line: number): OutlineEntry | null {
    const target = normalizePath(file);
    let result: OutlineEntry | null = null;
    let hasSeenFile = false;
    for (const entry of entries) {
        if (entry.file === target) {
            hasSeenFile = true;
            if (entry.line <= line) result = entry;
        } else if (!hasSeenFile) {
            result = entry;
        }
    }
    return hasSeenFile ? result : null;
}

function rank(level: OutlineLevel): number {
    return OUTLINE_LEVELS.indexOf(level);
}

/** Überschriften, in denen `line` liegt, von außen nach innen (Kapitel › Abschnitt › Unterabschnitt) */
export function sectionChain(entries: readonly OutlineEntry[], file: string, line: number): OutlineEntry[] {
    const current = currentEntry(entries, file, line);
    if (current === null) return [];
    const chain = [current];
    let level = rank(current.level);
    for (let index = entries.indexOf(current) - 1; index >= 0 && level > 0; index--) {
        const entry = entries[index];
        if (entry === undefined || rank(entry.level) >= level) continue;
        chain.unshift(entry);
        level = rank(entry.level);
    }
    return chain;
}

// MARK: - Baum

export interface OutlineNode {
    readonly entry: OutlineEntry;
    readonly children: readonly OutlineNode[];
    /** Erster Eintrag einer anderen Datei als der vorige (Dateigrenze durch `\input`/`\include`) */
    readonly startsFile: boolean;
}

/**
 * Baut aus der flachen Gliederung einen Baum (part > chapter > section > …). Fehlt eine Ebene
 * (`\subsection` direkt nach `\chapter`), hängt der Eintrag am nächsthöheren vorhandenen.
 */
export function buildOutlineTree(entries: readonly OutlineEntry[]): OutlineNode[] {
    const cursor = { index: 0 };
    return buildNodes(entries, cursor, -1);
}

function buildNodes(entries: readonly OutlineEntry[], cursor: { index: number }, parentRank: number): OutlineNode[] {
    const nodes: OutlineNode[] = [];
    for (let entry = entries[cursor.index]; entry !== undefined && rank(entry.level) > parentRank; entry = entries[cursor.index]) {
        const startsFile = cursor.index === 0 || entries[cursor.index - 1]?.file !== entry.file;
        cursor.index++;
        nodes.push({ entry, children: buildNodes(entries, cursor, rank(entry.level)), startsFile });
    }
    return nodes;
}

export interface OutlineRow {
    readonly node: OutlineNode;
    /** 0-basiert */
    readonly depth: number;
    readonly parentId: string | null;
    /** `null` bei Blättern */
    readonly isExpanded: boolean | null;
    /** 1-basiert unter dem Elternknoten */
    readonly position: number;
    readonly siblingCount: number;
}

/** Sichtbare Zeilen (zugeklappte Knoten verbergen ihre Kinder) in Anzeigereihenfolge */
export function flattenOutlineTree(tree: readonly OutlineNode[], collapsedIds: ReadonlySet<string>): OutlineRow[] {
    const rows: OutlineRow[] = [];
    appendRows(rows, tree, collapsedIds, 0, null);
    return rows;
}

function appendRows(
    rows: OutlineRow[], nodes: readonly OutlineNode[], collapsedIds: ReadonlySet<string>, depth: number, parentId: string | null,
): void {
    nodes.forEach((node, index) => {
        const hasChildren = node.children.length > 0;
        const isExpanded = hasChildren ? !collapsedIds.has(node.entry.id) : null;
        rows.push({ node, depth, parentId, isExpanded, position: index + 1, siblingCount: nodes.length });
        if (isExpanded === true) appendRows(rows, node.children, collapsedIds, depth + 1, node.entry.id);
    });
}

/** Gleiche Einträge (Reihenfolge, Inhalt)? Für „nur bei Änderung setzen“ */
export function sameEntries(a: readonly OutlineEntry[], b: readonly OutlineEntry[]): boolean {
    return a.length === b.length && a.every((entry, index) => {
        const other = b[index];
        return other !== undefined && entry.id === other.id && entry.level === other.level && entry.title === other.title &&
            entry.isStarred === other.isStarred && entry.line === other.line;
    });
}

export function sameIncludingFile(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
