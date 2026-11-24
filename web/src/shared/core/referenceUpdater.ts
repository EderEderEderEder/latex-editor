/**
 * Verweise anpassen nach Umbenennen/Verschieben einer Datei oder eines Ordners (`\input`, `\include`, `\subfile`,
 * `\includegraphics`, `\bibliography`, `\addbibresource`). Aufgelöst wird wie LaTeX: relativ zum Ordner der
 * Hauptdatei, bei Bildern zusätzlich über `\graphicspath`, mit der Endung, die LaTeX selbst ergänzt.
 * Rein: Eingabe sind Texte und Projektpfade (relativ zur Projektwurzel, `""` = Wurzel, `\` wird zu `/`),
 * Ausgabe sind Textänderungen in UTF-16-Offsets. Verhalten nach `ReferenceUpdater.swift`.
 */
import { isEscapedAt } from './latex/comments';
import { scannable } from './latex/masking';
import { normalizePath } from './latex/outline';

/** Eine Änderung eines Argument-Bereichs `[from, to)` im Text der Datei */
export interface ReferenceEdit {
    readonly from: number;
    readonly to: number;
    readonly insert: string;
    /** 1-basiert */
    readonly line: number;
    readonly oldText: string;
    readonly command: string;
}

export interface FileReferenceEdits {
    readonly file: string;
    readonly edits: readonly ReferenceEdit[];
    /** Je Änderung eine Zeile „Zeile 3: \input{alt} → \input{neu}“ für die Bestätigung */
    readonly summary: readonly string[];
}

export interface ReferenceChange {
    /** Alter Pfad der verschobenen Datei oder des Ordners */
    readonly moving: string;
    readonly to: string;
    readonly mainFile: string;
    /** Ordner aus `\graphicspath`, relativ zum Ordner der Hauptdatei, mit `/` am Ende */
    readonly graphicsDirectories: readonly string[];
    /** Alle Projekt-`.tex`-Dateien mit aktuellem Text (offene Dateien mit ihrem Editorstand) */
    readonly texts: Readonly<Record<string, string>>;
}

interface Candidate {
    /** Pfad relativ zum Ordner der Hauptdatei */
    readonly path: string;
    /** `\graphicspath`-Ordner, über den der Pfad entstand (`""` sonst) */
    readonly directory: string;
    /** Endung, die LaTeX ergänzt hat (nicht Teil des geschriebenen Arguments) */
    readonly impliedExtension: string | null;
}

interface Context {
    readonly base: string;
    readonly from: string;
    readonly to: string;
    readonly graphicsDirectories: readonly string[];
}

interface ArgumentPart {
    readonly text: string;
    readonly start: number;
}

const GRAPHIC_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg'];
const SEPARATOR = '/';
const CURRENT_DIRECTORY_PREFIX = './';
const PARENT_SEGMENT = '..';
const ARGUMENT_BLANKS = /[ \t]/;
const DRIVE_SEGMENT = /^[A-Za-z]:$/;
const COMMAND_PATTERN =
    /\\(include|input|subfile|includegraphics|bibliography|addbibresource)\*?(?:\s*\[[^\]]*\])?\s*\{([^}]*)\}/g;
const GRAPHICSPATH = '\\graphicspath';

// MARK: Pfade

function normalizeProjectPath(path: string): string {
    return normalizePath(path, SEPARATOR);
}

function segmentsOf(path: string): string[] {
    const normalized = normalizeProjectPath(path);
    return normalized === '' ? [] : normalized.split(SEPARATOR);
}

function isAbsoluteSegments(segments: readonly string[]): boolean {
    const first = segments[0];
    return first === '' || (first !== undefined && DRIVE_SEGMENT.test(first));
}

/** Pfad von `base` zu `path` mit `..` bei Bedarf (beide relativ zur Projektwurzel) */
export function relativePath(path: string, from: string): string {
    const target = segmentsOf(path);
    const base = segmentsOf(from);
    if (isAbsoluteSegments(target) !== isAbsoluteSegments(base)) return target.join(SEPARATOR);
    let common = 0;
    while (common < Math.min(target.length, base.length) && target[common] === base[common]) common++;
    const ups = base.slice(common).map(() => PARENT_SEGMENT);
    return [...ups, ...target.slice(common)].join(SEPARATOR);
}

/** Neuer Ort einer Datei, die selbst verschoben wurde oder in einem verschobenen Ordner liegt */
function mappedPath(path: string, from: string, to: string): string | null {
    if (path === from) return to;
    if (!path.startsWith(from + SEPARATOR)) return null;
    return normalizeProjectPath(`${to}${SEPARATOR}${path.slice(from.length + 1)}`);
}

function directoryOf(path: string): string {
    const cut = path.lastIndexOf(SEPARATOR);
    return cut === -1 ? '' : path.slice(0, cut);
}

function joinPaths(directory: string, name: string): string {
    return normalizeProjectPath(directory === '' ? name : `${directory}${SEPARATOR}${name}`);
}

// MARK: Argumente und Kandidaten

/** `\bibliography{a,b}` enthält mehrere Einträge; alle anderen Befehle genau einen */
function argumentParts(raw: string, start: number, command: string): ArgumentPart[] {
    if (command !== 'bibliography') return [{ text: raw, start }];
    const parts: ArgumentPart[] = [];
    let offset = 0;
    for (const piece of raw.split(',')) {
        const text = piece.replace(/^[ \t]+|[ \t]+$/g, '');
        if (text !== '') parts.push({ text, start: start + offset + piece.indexOf(text) });
        offset += piece.length + 1;
    }
    return parts;
}

function withGraphicExtensions(directory: string, argument: string): Candidate[] {
    const plain: Candidate = { path: directory + argument, directory, impliedExtension: null };
    return [
        plain,
        ...GRAPHIC_EXTENSIONS.map((extension) => ({
            path: `${directory}${argument}.${extension}`,
            directory,
            impliedExtension: extension,
        })),
    ];
}

function candidatesFor(command: string, argument: string, graphicsDirectories: readonly string[]): Candidate[] {
    if (command === 'include' || command === 'input' || command === 'subfile') {
        return [
            { path: `${argument}.tex`, directory: '', impliedExtension: 'tex' },
            { path: argument, directory: '', impliedExtension: null },
        ];
    }
    if (command === 'bibliography') {
        return [
            { path: `${argument}.bib`, directory: '', impliedExtension: 'bib' },
            { path: argument, directory: '', impliedExtension: null },
        ];
    }
    if (command === 'includegraphics') {
        return ['', ...graphicsDirectories].flatMap((directory) => withGraphicExtensions(directory, argument));
    }
    return [{ path: argument, directory: '', impliedExtension: null }];
}

/** Neue Schreibweise des Arguments oder `null`, wenn es nicht auf die verschobene Datei zeigt */
function rewrittenArgument(argument: string, command: string, context: Context): string | null {
    const trimmed = argument.trim();
    if (trimmed === '') return null;
    for (const candidate of candidatesFor(command, trimmed, context.graphicsDirectories)) {
        const moved = mappedPath(joinPaths(context.base, candidate.path), context.from, context.to);
        if (moved === null) continue;
        const root = joinPaths(context.base, candidate.directory);
        let text = relativePath(moved, root);
        const suffix = `.${candidate.impliedExtension ?? ''}`;
        if (candidate.impliedExtension !== null && text.endsWith(suffix)) text = text.slice(0, -suffix.length);
        const keepsCurrentDirectory = trimmed.startsWith(CURRENT_DIRECTORY_PREFIX) && !text.startsWith(PARENT_SEGMENT);
        return keepsCurrentDirectory ? CURRENT_DIRECTORY_PREFIX + text : text;
    }
    return null;
}

// MARK: Berechnen

function lineNumberAt(text: string, offset: number, known: { offset: number; line: number }): number {
    for (let index = known.offset; index < offset; index++) {
        if (text[index] === '\n') known.line++;
    }
    known.offset = offset;
    return known.line;
}

function editsInText(text: string, context: Context): ReferenceEdit[] {
    const masked = scannable(text);
    const edits: ReferenceEdit[] = [];
    const known = { offset: 0, line: 1 };
    for (const match of masked.matchAll(COMMAND_PATTERN)) {
        if (isEscapedAt(masked, match.index, 0)) continue;
        const command = match[1] ?? '';
        const argumentStart = match.index + match[0].length - 1 - (match[2] ?? '').length;
        const raw = text.slice(argumentStart, argumentStart + (match[2] ?? '').length);
        for (const part of argumentParts(raw, argumentStart, command)) {
            const insert = rewrittenArgument(part.text, command, context);
            if (insert === null || insert === part.text) continue;
            const line = lineNumberAt(text, part.start, known);
            edits.push({ from: part.start, to: part.start + part.text.length, insert, line, oldText: part.text, command });
        }
    }
    return edits;
}

function summaryLine(edit: ReferenceEdit): string {
    return `Zeile ${edit.line}: \\${edit.command}{${edit.oldText}} → \\${edit.command}{${edit.insert}}`;
}

/** Nötige Textänderungen je Datei (nur Dateien mit Änderungen, nach Pfad sortiert) */
export function computeReferenceEdits(change: ReferenceChange): FileReferenceEdits[] {
    const from = normalizeProjectPath(change.moving);
    if (from === '') return [];
    const context: Context = {
        base: directoryOf(normalizeProjectPath(change.mainFile)),
        from,
        to: normalizeProjectPath(change.to),
        graphicsDirectories: change.graphicsDirectories,
    };
    const result: FileReferenceEdits[] = [];
    for (const file of Object.keys(change.texts).sort()) {
        const edits = editsInText(change.texts[file] ?? '', context);
        if (edits.length > 0) result.push({ file, edits, summary: edits.map(summaryLine) });
    }
    return result;
}

// MARK: Anwenden

/** Ersetzt die Bereiche von hinten nach vorn, damit frühere Bereiche gültig bleiben */
export function applyReferenceEdits(text: string, edits: readonly ReferenceEdit[]): string {
    let result = text;
    for (const edit of [...edits].sort((a, b) => b.from - a.from)) {
        if (edit.to > result.length) continue;
        result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
    }
    return result;
}

// MARK: Grafikpfade

/** Ordner aus `\graphicspath{{images/}{bilder/}}`, jeweils mit `/` am Ende (Kommentare zählen nicht) */
export function graphicsDirectoriesIn(text: string): string[] {
    const masked = scannable(text);
    const command = masked.indexOf(GRAPHICSPATH);
    const open = command === -1 ? -1 : masked.indexOf('{', command + GRAPHICSPATH.length);
    if (open === -1) return [];
    const directories: string[] = [];
    let depth = 0;
    let current = '';
    for (const character of masked.slice(open)) {
        if (character === '{') {
            depth++;
            if (depth === 2) current = '';
        } else if (character === '}') {
            if (depth === 2 && current !== '') directories.push(current.endsWith(SEPARATOR) ? current : current + SEPARATOR);
            if (--depth === 0) break;
        } else if (depth === 2) {
            current += character;
        }
    }
    return directories;
}
