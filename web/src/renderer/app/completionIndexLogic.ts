/**
 * Projektindex der Vervollständigung (Vorlage: `CompletionIndex.swift`): läuft im Worker
 * (`workers/completionIndex.worker.ts`), nie im UI-Thread. Hält je Datei das Ergebnis des letzten Lesens und rechnet
 * nur geänderte Dateien neu; meldet einen neuen Index nur, wenn sich wirklich etwas geändert hat.
 * Reine Logik ohne DOM und ohne Node; Pfade mit `/` oder `\`.
 */
import { catalogEntries, type BibEntry as BibCatalogEntry } from '../../shared/core/bib/parser';
import { definedCommands, definedEnvironments } from '../../shared/core/completion/definitions';
import type { PackageOptions } from '../../shared/core/completion/catalog';
import { scanOptions } from '../../shared/core/completion/options';
import { scannable } from '../../shared/core/latex/masking';
import { acronymDefinitions as acronymEntriesOf } from '../../shared/core/latex/acronyms';
import { catalogLabels, scanAcronymsMasked } from '../../shared/core/latex/references';
import { graphicsDirectoriesIn } from '../../shared/core/referenceUpdater';
import {
    buildReferenceSnapshot,
    EMPTY_REFERENCES,
    NO_USES,
    usesOfMasked,
    type ReferenceFileData,
    type ReferenceSnapshot,
} from './referenceCheckLogic';

export interface LabelItem {
    readonly label: string;
    /** Anzeigename der Datei (mit Endung) */
    readonly file: string;
    /** 1-basiert */
    readonly line: number;
}

export interface CitationItem {
    readonly key: string;
    /** „Mustermann 2024 · Titel“ */
    readonly summary: string;
    /** Autoren, Titel und Jahr für die Suche */
    readonly searchText: string;
}

export interface AcronymItem {
    readonly key: string;
    /** „API – Application Programming Interface“ */
    readonly summary: string;
}

/** Was die Vervollständigung aus dem Projekt kennt (strukturiert klonbar, geht vom Worker an den Renderer) */
export interface CompletionIndexSnapshot {
    readonly labels: readonly LabelItem[];
    readonly citations: readonly CitationItem[];
    readonly acronyms: readonly AcronymItem[];
    /** Eigene Befehle aus `.tex`, `.cls`, `.sty` (ohne `\`) */
    readonly commands: readonly string[];
    /** Im Projekt definierte oder benutzte Umgebungen */
    readonly environments: readonly string[];
    /** Klassen-/Paketname (Dateiname ohne Endung) → Optionen */
    readonly packageOptions: readonly (readonly [string, PackageOptions])[];
    /** Für `\input`/`\include`: relativ zur Hauptdatei, ohne `.tex` */
    readonly inputPaths: readonly string[];
    /** Für `\includegraphics`: relativ zum Projekt bzw. zu einem `\graphicspath`-Ordner */
    readonly graphicsPaths: readonly string[];
}

export const EMPTY_COMPLETION_INDEX: CompletionIndexSnapshot = {
    labels: [], citations: [], acronyms: [], commands: [], environments: [], packageOptions: [], inputPaths: [], graphicsPaths: [],
};

/** Dateien des Projektbaums (ohne Build-Dateien), Wurzel und Hauptdatei */
export interface ProjectFiles {
    readonly root: string;
    readonly mainFile: string | null;
    readonly files: readonly string[];
}

export interface SourceFile {
    readonly path: string;
    readonly name: string;
    readonly text: string;
}

export interface CompletionIndexUpdate {
    readonly kind: 'update';
    readonly version: number;
    /** Alles vergessen (Projektwechsel, neuer Worker) */
    readonly reset: boolean;
    /** Fehlt: Projekt unverändert; `null`: kein Projekt */
    readonly project?: ProjectFiles | null;
    readonly changed: readonly SourceFile[];
    readonly removed: readonly string[];
}

export type CompletionIndexResponse =
    /**
     * `index` ist `null`, wenn sich seit der letzten Antwort nichts geändert hat; ebenso `references` (W4-12, Ergebnis
     * der Verweisprüfung; fehlt bei älteren Absendern)
     */
    | {
        readonly kind: 'index';
        readonly version: number;
        readonly index: CompletionIndexSnapshot | null;
        readonly references?: ReferenceSnapshot | null;
    }
    | { readonly kind: 'error'; readonly version: number; readonly message: string };

export type SourceKind = 'tex' | 'bib' | 'style';

const SOURCE_KINDS: ReadonlyMap<string, SourceKind> = new Map([['tex', 'tex'], ['bib', 'bib'], ['cls', 'style'], ['sty', 'style']]);
/** Wie Swift `FileKind.image` */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'pdf', 'tif', 'tiff']);
const TEX_EXTENSION = '.tex';
const SEPARATOR = '/';
const BACKSLASHES = /\\/g;
const TRAILING_SEPARATORS = /\/+$/;

function extensionOf(name: string): string {
    const dot = name.lastIndexOf('.');
    const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
    return dot > slash + 1 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Art einer Quelldatei nach der Endung, sonst `null` (Bilder, PDF, Sonstiges) */
export function sourceKindOf(name: string): SourceKind | null {
    return SOURCE_KINDS.get(extensionOf(name)) ?? null;
}

function normalizedPath(path: string): string {
    return path.replace(BACKSLASHES, SEPARATOR);
}

/** Pfad relativ zu `base` (mit `/`), `null` außerhalb */
export function relativeWithin(base: string, path: string): string | null {
    const prefix = normalizedPath(base).replace(TRAILING_SEPARATORS, '') + SEPARATOR;
    const normalized = normalizedPath(path);
    return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null;
}

function directoryOf(path: string): string {
    const normalized = normalizedPath(path);
    return normalized.slice(0, Math.max(0, normalized.lastIndexOf(SEPARATOR)));
}

function byName(left: string, right: string): number {
    return left.localeCompare(right, undefined, { numeric: true });
}

// ---------- Abkürzungen (Port von `Acronyms.definitions`) ----------

interface AcronymParts {
    readonly short: string;
    readonly long: string;
}

interface TextGroup {
    readonly content: string;
    /** Hinter der schließenden Klammer */
    readonly end: number;
}

const NO_PARTS: AcronymParts = { short: '', long: '' };
const MAXIMUM_ACRONYM_VALUE_LENGTH = 200;
const GROUP_LEADING_BLANKS: ReadonlySet<string> = new Set([' ', '\t', '\n']);
const SUMMARY_SEPARATOR = ' – ';
const INNER_WHITESPACE = /\s+/;

/** Inhalt der nächsten `{…}`-Gruppe ab `from` (Leerraum davor erlaubt) */
function groupAt(text: string, from: number): TextGroup | null {
    let index = from;
    while (index < text.length && GROUP_LEADING_BLANKS.has(text.charAt(index))) index++;
    if (text.charAt(index) !== '{') return null;
    let depth = 0;
    let end = index;
    for (; end < text.length; end++) {
        const character = text.charAt(end);
        if (character === '\\') {
            end++;
            continue;
        }
        if (character === '{') depth++;
        else if (character === '}' && --depth === 0) break;
    }
    if (end >= text.length) return null;
    const length = Math.min(end - index - 1, MAXIMUM_ACRONYM_VALUE_LENGTH);
    return { content: text.slice(index + 1, index + 1 + length), end: end + 1 };
}

/** Ohne äußere Klammern, Zeilenumbrüche und mehrfache Leerzeichen */
function cleanValue(value: string): string {
    let result = value.trim();
    while (result.length >= 2 && result.startsWith('{') && result.endsWith('}')) result = result.slice(1, -1);
    return result.split(INNER_WHITESPACE).filter((part) => part !== '').join(' ');
}

function topLevelParts(text: string): string[] {
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

/** `name = API, description = …` bzw. `short`/`long` bei `\DeclareAcronym` */
function keyValueParts(text: string): AcronymParts {
    const values = new Map<string, string>();
    for (const part of topLevelParts(text)) {
        const equals = part.indexOf('=');
        if (equals !== -1) values.set(part.slice(0, equals).trim().toLowerCase(), cleanValue(part.slice(equals + 1)));
    }
    return { short: values.get('short') ?? values.get('name') ?? '', long: values.get('long') ?? values.get('description') ?? '' };
}

function acronymParts(masked: string, keyEnd: number): AcronymParts {
    const closing = masked.indexOf('}', keyEnd);
    const first = closing === -1 ? null : groupAt(masked, closing + 1);
    if (first === null) return NO_PARTS;
    if (first.content.includes('=')) return keyValueParts(first.content);
    const second = groupAt(masked, first.end);
    return { short: cleanValue(first.content), long: second === null ? '' : cleanValue(second.content) };
}

/** Abkürzungen und Glossareinträge mit Kurz- und Langform (`\newacronym`, `\DeclareAcronym`, `\newglossaryentry` …) */
export function acronymDefinitions(text: string): AcronymItem[] {
    const masked = scannable(text);
    return scanAcronymsMasked(masked)
        .filter((occurrence) => occurrence.isDefinition)
        .map((occurrence) => {
            const { short, long } = acronymParts(masked, occurrence.end);
            return { key: occurrence.key, summary: [short, long].filter((part) => part !== '').join(SUMMARY_SEPARATOR) };
        });
}

// ---------- Eine Datei ----------

interface ParsedFile {
    readonly path: string;
    readonly kind: SourceKind;
    readonly source: SourceFile;
    readonly labels: readonly LabelItem[];
    readonly citations: readonly CitationItem[];
    readonly acronyms: readonly AcronymItem[];
    readonly commands: readonly string[];
    readonly environments: readonly string[];
    readonly graphicsDirectories: readonly string[];
    /** Was die Verweisprüfung braucht (W4-12) */
    readonly references: ReferenceFileData;
    /** Vergleichswert der abgeleiteten Daten (ohne Text): gleich = Index unverändert */
    readonly signature: string;
    /** Dasselbe für die Verweisprüfung: Verwendungen mit Position ändern sie bei fast jeder Eingabe */
    readonly referenceSignature: string;
}

type ParsedParts = Omit<ParsedFile, 'path' | 'kind' | 'source' | 'signature' | 'references' | 'referenceSignature'>;

const NO_PARTS_OF_FILE: ParsedParts = {
    labels: [], citations: [], acronyms: [], commands: [], environments: [], graphicsDirectories: [],
};

function citationsOf(entries: readonly BibCatalogEntry[]): CitationItem[] {
    return entries.map((entry) => ({
        key: entry.key, summary: entry.summary, searchText: [entry.allAuthors, entry.title, entry.year].join(' '),
    }));
}

function partsOf(file: SourceFile, kind: SourceKind, entries: readonly BibCatalogEntry[]): ParsedParts {
    if (kind === 'bib') return { ...NO_PARTS_OF_FILE, citations: citationsOf(entries) };
    const definitions = { commands: [...definedCommands(file.text)], environments: [...definedEnvironments(file.text)] };
    if (kind === 'style') return { ...NO_PARTS_OF_FILE, ...definitions };
    return {
        ...NO_PARTS_OF_FILE,
        ...definitions,
        labels: catalogLabels(file.text, file.name),
        acronyms: acronymDefinitions(file.text),
        graphicsDirectories: graphicsDirectoriesIn(file.text),
    };
}

function signatureOf(parts: ParsedParts, styleText: string): string {
    return JSON.stringify([parts, styleText]);
}

/** Eine neue Datei ohne Einträge ändert den Index nicht */
const EMPTY_SIGNATURE = signatureOf(NO_PARTS_OF_FILE, '');

const NO_REFERENCE_DATA: ReferenceFileData = { path: '', isTex: false, labels: [], sources: [], acronyms: [], uses: NO_USES };

function referenceDataOf(file: SourceFile, kind: SourceKind, entries: readonly BibCatalogEntry[]): ReferenceFileData {
    const base = { ...NO_REFERENCE_DATA, path: file.path };
    if (kind === 'bib') {
        return { ...base, sources: entries.map((entry) => ({ key: entry.key, file: file.path, line: entry.line, title: entry.title })) };
    }
    if (kind !== 'tex') return base;
    return {
        ...base,
        isTex: true,
        labels: catalogLabels(file.text, file.path),
        acronyms: acronymEntriesOf(file.text).map(({ key, line, summary }) => ({ key, file: file.path, line, summary })),
        uses: usesOfMasked(scannable(file.text)),
    };
}

function referenceSignatureOf(data: ReferenceFileData, graphicsDirectories: readonly string[]): string {
    const { path: _path, ...rest } = data;
    return JSON.stringify([rest, graphicsDirectories]);
}

/** Eine neue Datei ohne Verweise ändert die Verweisprüfung nicht */
const EMPTY_REFERENCE_SIGNATURE = referenceSignatureOf(NO_REFERENCE_DATA, []);

function parseFile(file: SourceFile, kind: SourceKind): ParsedFile {
    const entries = kind === 'bib' ? catalogEntries(file.text) : [];
    const parts = partsOf(file, kind, entries);
    // Klassen und Pakete liefern auch Optionen: dort zählt jede Textänderung
    const signature = signatureOf(parts, kind === 'style' ? file.text : '');
    const references = referenceDataOf(file, kind, entries);
    const referenceSignature = referenceSignatureOf(references, parts.graphicsDirectories);
    return { ...parts, path: file.path, kind, source: file, signature, references, referenceSignature };
}

// ---------- Projekt ----------

function sameProject(left: ProjectFiles | null, right: ProjectFiles | null): boolean {
    if (left === null || right === null) return left === right;
    if (left.root !== right.root || left.mainFile !== right.mainFile || left.files.length !== right.files.length) return false;
    return left.files.every((file, index) => file === right.files[index]);
}

function inputPathsOf(project: ProjectFiles | null): string[] {
    if (project === null) return [];
    const base = project.mainFile === null ? project.root : directoryOf(project.mainFile);
    return project.files
        .filter((file) => file !== project.mainFile && sourceKindOf(file) === 'tex')
        .flatMap((file) => {
            const relative = relativeWithin(base, file);
            return relative === null ? [] : [relative.slice(0, -TEX_EXTENSION.length)];
        })
        .sort();
}

function graphicsPathOf(relative: string, directories: readonly string[]): string {
    const directory = directories.find((candidate) => relative.startsWith(candidate));
    return directory === undefined ? relative : relative.slice(directory.length);
}

function graphicsPathsOf(project: ProjectFiles | null, directories: readonly string[]): string[] {
    if (project === null) return [];
    return project.files
        .filter((file) => IMAGE_EXTENSIONS.has(extensionOf(file)))
        .flatMap((file) => {
            const relative = relativeWithin(project.root, file);
            return relative === null ? [] : [graphicsPathOf(relative, directories)];
        })
        .sort();
}

function sortedUnion(lists: readonly (readonly string[])[]): string[] {
    return [...new Set(lists.flat())].sort();
}

function firstPerKey<T extends { readonly key: string }>(items: readonly T[]): T[] {
    const seen = new Set<string>();
    return items.filter((item) => {
        if (seen.has(item.key)) return false;
        seen.add(item.key);
        return true;
    });
}

// ---------- Index ----------

/** Zustand im Worker: je Datei das letzte Ergebnis, dazu Projekt und Paketoptionen */
export class CompletionIndexBuilder {
    private readonly files = new Map<string, ParsedFile>();
    private project: ProjectFiles | null = null;
    private options: readonly (readonly [string, PackageOptions])[] = [];
    private optionsStale = false;
    private referencesDirty = true;

    /** Wendet eine Aktualisierung an; `null`, wenn sich der Index dadurch nicht ändert */
    apply(update: CompletionIndexUpdate): CompletionIndexSnapshot | null {
        let changed = update.reset;
        if (update.reset) {
            this.clear();
            this.referencesDirty = true;
        }
        if (update.project !== undefined && !sameProject(this.project, update.project)) {
            this.project = update.project;
            this.referencesDirty = true;
            changed = true;
        }
        for (const path of update.removed) changed = this.remove(path) || changed;
        for (const file of update.changed) changed = this.store(file) || changed;
        return changed ? this.snapshot() : null;
    }

    private clear(): void {
        this.files.clear();
        this.project = null;
        this.options = [];
        this.optionsStale = false;
    }

    private remove(path: string): boolean {
        const previous = this.files.get(path);
        if (previous === undefined) return false;
        this.files.delete(path);
        if (previous.kind === 'style') this.optionsStale = true;
        if (previous.referenceSignature !== EMPTY_REFERENCE_SIGNATURE) this.referencesDirty = true;
        return true;
    }

    /** `true`, wenn sich die abgeleiteten Daten der Datei geändert haben */
    private store(file: SourceFile): boolean {
        const kind = sourceKindOf(file.name);
        if (kind === null) return this.remove(file.path);
        const previous = this.files.get(file.path);
        if (previous !== undefined && previous.kind === kind && previous.source.text === file.text) return false;
        const parsed = parseFile(file, kind);
        this.files.set(file.path, parsed);
        if (kind === 'style' || previous?.kind === 'style') this.optionsStale = true;
        if ((previous?.referenceSignature ?? EMPTY_REFERENCE_SIGNATURE) !== parsed.referenceSignature) this.referencesDirty = true;
        return (previous?.signature ?? EMPTY_SIGNATURE) !== parsed.signature;
    }

    /**
     * Ergebnis der Verweisprüfung (W4-12), `null`, wenn es sich seit dem letzten Aufruf nicht geändert hat. Ohne Projekt
     * ist nichts „geladen“: dann wird nichts geprüft.
     */
    takeReferences(): ReferenceSnapshot | null {
        if (!this.referencesDirty) return null;
        this.referencesDirty = false;
        if (this.project === null) return EMPTY_REFERENCES;
        const parsed = [...this.files.values()].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
        return buildReferenceSnapshot(parsed.map((file) => file.references), sortedUnion(parsed.map((file) => file.graphicsDirectories)));
    }

    private packageOptions(parsed: readonly ParsedFile[]): readonly (readonly [string, PackageOptions])[] {
        if (!this.optionsStale) return this.options;
        const styles = parsed.filter((file) => file.kind === 'style').map((file) => ({ name: file.source.name, text: file.source.text }));
        this.options = [...scanOptions(styles)];
        this.optionsStale = false;
        return this.options;
    }

    private snapshot(): CompletionIndexSnapshot {
        const parsed = [...this.files.values()].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
        return {
            labels: parsed.flatMap((file) => file.labels).sort((left, right) => byName(left.label, right.label)),
            citations: firstPerKey(parsed.flatMap((file) => file.citations)),
            acronyms: parsed.flatMap((file) => file.acronyms).sort((left, right) => byName(left.key, right.key)),
            commands: sortedUnion(parsed.map((file) => file.commands)),
            environments: sortedUnion(parsed.map((file) => file.environments)),
            packageOptions: this.packageOptions(parsed),
            inputPaths: inputPathsOf(this.project),
            graphicsPaths: graphicsPathsOf(this.project, sortedUnion(parsed.map((file) => file.graphicsDirectories))),
        };
    }
}

/** Eine Anfrage des Clients beantworten (Fehler als Antwort `error`, der Worker läuft weiter) */
export function handleCompletionIndexRequest(builder: CompletionIndexBuilder, update: CompletionIndexUpdate): CompletionIndexResponse {
    try {
        const index = builder.apply(update);
        return { kind: 'index', version: update.version, index, references: builder.takeReferences() };
    } catch (error) {
        return { kind: 'error', version: update.version, message: error instanceof Error ? error.message : String(error) };
    }
}
