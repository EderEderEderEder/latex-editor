/**
 * Strg-Klick-Ziele (⌘-Klick auf macOS): Wohin ein Klick auf eine Textstelle führt. Port von `JumpTargetFinder`
 * (Swift): `\ref` & Co. → Label, `\cite` & Co. → Literatureintrag, `\gls`/`\ac` → Abkürzung, `\input`/`\include`/
 * `\subfile` → Datei. Zusätzlich (nicht in Swift, dort nur Bildvorschau beim Überfahren): `\includegraphics`,
 * `\bibliography`, `\addbibresource` → Datei. `\label{…}` selbst ist kein Ziel.
 *
 * Vorrang wie in Swift: Verweis oder Zitat, dann Abkürzung, dann Dateipfad. Untersucht wird nur die Zeile der
 * Klickstelle (Kommentare, `\verb` und Code der Zeile zählen nicht); ein Index am Rand des Schlüssels zählt noch dazu.
 * Reine Logik ohne DOM und Node, Positionen sind UTF-16-Einheiten.
 */
import { scannable } from './latex/masking';
import { scanAcronyms, scanReferences } from './latex/references';

/** Längere Zeilen werden nicht untersucht (die Maus über minifiziertem Text soll nichts verlangsamen) */
export const MAXIMUM_JUMP_LINE_LENGTH = 20_000;

export type JumpFileCommand = 'input' | 'include' | 'subfile' | 'includegraphics' | 'bibliography' | 'addbibresource';

export interface JumpFileTarget {
    readonly kind: 'file';
    /** Pfad so, wie er im Text steht (ohne umgebenden Leerraum) */
    readonly path: string;
    readonly command: JumpFileCommand;
}

export type JumpTarget =
    | { readonly kind: 'label' | 'citation' | 'acronym'; readonly key: string }
    | JumpFileTarget;

/** Ziel samt Bereich des Schlüssels bzw. Pfads im untersuchten Text */
export interface JumpHit {
    readonly target: JumpTarget;
    readonly start: number;
    readonly end: number;
}

const LINE_BREAK = '\n';
/** Gruppe 1 Befehl, Gruppe 2 die Klammer mit Pfad bzw. Pfadliste */
const FILE_PATTERN = /\\(input|include|subfile|includegraphics|bibliography|addbibresource)\*?\s*(?:\[[^\]\n]*\]\s*)?\{([^{}]*)\}/g;
const LIST_COMMANDS: ReadonlySet<string> = new Set(['bibliography']);
const LIST_SEPARATOR = ',';
const HORIZONTAL_EDGES = /^[ \t]+|[ \t]+$/g;

function contains(hit: { readonly start: number; readonly end: number }, column: number): boolean {
    return column >= hit.start && column <= hit.end;
}

function referenceHit(line: string, column: number): JumpHit | null {
    const found = scanReferences(line).find((occurrence) => contains(occurrence, column));
    if (found === undefined || found.kind === 'labelDefinition') return null;
    const kind = found.kind === 'labelUse' ? 'label' : 'citation';
    return { target: { kind, key: found.key }, start: found.start, end: found.end };
}

function acronymHit(line: string, column: number): JumpHit | null {
    const found = scanAcronyms(line).find((occurrence) => !occurrence.isDefinition && contains(occurrence, column));
    if (found === undefined) return null;
    return { target: { kind: 'acronym', key: found.key }, start: found.start, end: found.end };
}

/** Teile einer Pfadliste (`\bibliography{a, b}`) mit Anfang im Text; leere Teile fallen weg */
function pathParts(group: string, groupStart: number, splitsList: boolean): { path: string; start: number; end: number }[] {
    const parts: { path: string; start: number; end: number }[] = [];
    let offset = 0;
    for (const raw of splitsList ? group.split(LIST_SEPARATOR) : [group]) {
        const leading = raw.length - raw.replace(/^[ \t]+/, '').length;
        const path = raw.replace(HORIZONTAL_EDGES, '');
        if (path !== '') parts.push({ path, start: groupStart + offset + leading, end: groupStart + offset + leading + path.length });
        offset += raw.length + LIST_SEPARATOR.length;
    }
    return parts;
}

function fileHit(line: string, column: number): JumpHit | null {
    const masked = scannable(line);
    for (const match of masked.matchAll(FILE_PATTERN)) {
        const [whole = '', command = '', group = ''] = match;
        const groupStart = match.index + whole.length - 1 - group.length;
        if (column < groupStart || column > groupStart + group.length) continue;
        const part = pathParts(group, groupStart, LIST_COMMANDS.has(command)).find((candidate) => contains(candidate, column));
        if (part === undefined) return null;
        return { target: { kind: 'file', path: part.path, command: command as JumpFileCommand }, start: part.start, end: part.end };
    }
    return null;
}

/** Ziel in einer Zeile (ohne Zeilenumbruch) an der Spalte; `null` ohne Ziel oder bei zu langer Zeile */
export function jumpTargetInLine(line: string, column: number): JumpHit | null {
    if (column < 0 || column > line.length || line.length > MAXIMUM_JUMP_LINE_LENGTH) return null;
    return referenceHit(line, column) ?? acronymHit(line, column) ?? fileHit(line, column);
}

/**
 * Ziel an einer Textstelle; Bereich in Positionen des ganzen Textes. Ein Zeilenumbruch gehört zu seiner Zeile,
 * die Stelle hinter dem Text zur letzten.
 */
export function jumpTargetAt(text: string, location: number): JumpHit | null {
    if (text.length === 0 || location < 0 || location > text.length) return null;
    const probe = Math.min(location, text.length - 1);
    const lineStart = text.lastIndexOf(LINE_BREAK, probe - 1) + 1;
    const lineEnd = text.indexOf(LINE_BREAK, probe);
    const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    const hit = jumpTargetInLine(line, location - lineStart);
    return hit === null ? null : { target: hit.target, start: hit.start + lineStart, end: hit.end + lineStart };
}

// ---------- Dateien finden ----------

/** Endungen, die `\includegraphics` durchprobiert (wie `GraphicsResolver` in Swift) */
export const GRAPHICS_EXTENSIONS: readonly string[] = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'tif', 'tiff', 'eps'];
const TEX_SUFFIX = '.tex';
const BIB_SUFFIX = '.bib';
const SEPARATOR = '/';
const CURRENT_DIRECTORY = '.';
const PARENT_DIRECTORY = '..';
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:\/)/;
const FILE_EXTENSION = /\.[A-Za-z0-9]+$/;

/** Wo gesucht wird: Ordner (Hauptdatei zuerst) und die `\graphicspath`-Ordner mit `/` am Ende */
export interface FileLookup {
    readonly bases: readonly string[];
    readonly graphicsDirectories: readonly string[];
}

/** `base` + `relative` mit `/`, `.` und `..` aufgelöst; die Wurzel (leer, `C:`) bleibt stehen */
export function joinNormalized(base: string, relative: string): string {
    const segments: string[] = [];
    const parts = `${base}${SEPARATOR}${relative}`.split(SEPARATOR);
    parts.forEach((part, index) => {
        if (part === CURRENT_DIRECTORY || (part === '' && index > 0)) return;
        if (part === PARENT_DIRECTORY && segments.length > 1) segments.pop();
        else if (part !== PARENT_DIRECTORY) segments.push(part);
    });
    return segments.join(SEPARATOR);
}

function withSuffixes(path: string, command: JumpFileCommand): string[] {
    switch (command) {
        case 'input':
        case 'include':
        case 'subfile':
            return [path, `${path}${TEX_SUFFIX}`];
        case 'bibliography':
        case 'addbibresource':
            return path.endsWith(BIB_SUFFIX) ? [path] : [`${path}${BIB_SUFFIX}`, path];
        case 'includegraphics':
            return [...(FILE_EXTENSION.test(path) ? [path] : []), ...GRAPHICS_EXTENSIONS.map((extension) => `${path}.${extension}`)];
    }
}

/**
 * Mögliche Dateien zu einem Pfad im Text, in der Reihenfolge, in der sie gelten (je Ordner mit und ohne Endung;
 * Bilder zusätzlich in den `\graphicspath`-Ordnern). Alle Pfade mit `/`; ob es sie gibt, prüft der Aufrufer.
 */
export function fileCandidates(target: JumpFileTarget, lookup: FileLookup): string[] {
    const path = target.path.replaceAll('\\', SEPARATOR);
    if (ABSOLUTE_PATH.test(path)) return withSuffixes(path, target.command);
    const prefixes = target.command === 'includegraphics' ? ['', ...lookup.graphicsDirectories] : [''];
    const candidates = lookup.bases.flatMap((base) => prefixes.flatMap((prefix) =>
        withSuffixes(joinNormalized(base, `${prefix}${path}`), target.command)));
    return [...new Set(candidates)];
}
