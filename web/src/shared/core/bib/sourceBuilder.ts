// Neue Quelle: Zieldatei, Anhängen und Eintrag aus Formular oder eingefügtem BibTeX (Port von `BibliographyFile`
// und `SourceBuilder` aus `Bibliography.swift`). Reine Textlogik ohne Dateisystem: Dateinamen und das heutige
// Datum kommen als Eingabe. Kein DOM, kein Node, keine Electron-APIs.
import { authorsBibtex, keyValid, makeKey } from './authors';
import { formatEntry } from './formatter';
import { type BibField, bibFieldValue, parseBib } from './parser';
import { requiresAuthor, sourceFields, type SourceTypeName } from './sourceTypes';
import { prefixCharacters, trimBlanks, trimWhitespace } from './textUtils';

export type SourceMode = 'form' | 'bibtex';
export type SourceLanguage = 'german' | 'english' | 'none';

export interface SourceSettings {
    readonly mode: SourceMode;
    readonly type: SourceTypeName;
    readonly authors: string;
    readonly values: Readonly<Record<string, string>>;
    readonly language: SourceLanguage;
    readonly bibtex: string;
    readonly keyOverride: string;
}

export type SourceProblem =
    | { readonly kind: 'missingFields'; readonly fields: readonly string[] }
    | { readonly kind: 'noBibtexEntry' };

export type SourceResult =
    | { readonly ok: true; readonly key: string; readonly entry: string }
    | { readonly ok: false; readonly problem: SourceProblem };

export interface BibTargetInput {
    /** Text der Hauptdatei; `null`, wenn es keine gibt */
    readonly mainText: string | null;
    /** Dateipfade des Projekts relativ zum Ordner der Hauptdatei (`/` als Trenner) */
    readonly projectFiles: readonly string[];
}

export const DEFAULT_SOURCE_SETTINGS: SourceSettings = {
    mode: 'form',
    type: 'book',
    authors: '',
    values: {},
    language: 'german',
    bibtex: '',
    keyOverride: '',
};

const LANGUAGE_IDS: Readonly<Record<SourceLanguage, string>> = { german: 'ngerman', english: 'english', none: '' };
const BIB_RESOURCE_COMMANDS = /\\(?:addbibresource|AddBibFile|bibliography)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
const BIB_EXTENSION = '.bib';
const AUTHOR_TITLE = 'Autor';
const YEAR_LENGTH = 4;
const BLANK_LINES_BEFORE_ENTRY = 2;
const MISSING_FIELDS_PREFIX = 'Bitte noch ausfüllen: ';
const NO_BIBTEX_ENTRY_MESSAGE = 'Kein BibTeX-Eintrag erkannt (er beginnt mit @book{…, @article{… usw.).';

/** `./` und `x/../` auflösen, damit `lit/../a.bib` und `a.bib` dieselbe Datei sind */
function normalizeRelativePath(path: string): string {
    const segments: string[] = [];
    for (const segment of path.split('/')) {
        if (segment === '' || segment === '.') continue;
        if (segment === '..' && segments.length > 0 && segments[segments.length - 1] !== '..') segments.pop();
        else segments.push(segment);
    }
    return segments.join('/');
}

function referencedBibNames(mainText: string): string[] {
    const names: string[] = [];
    for (const match of mainText.matchAll(BIB_RESOURCE_COMMANDS)) {
        for (const part of (match[1] ?? '').split(',')) {
            const trimmed = trimBlanks(part);
            if (part.length > 0) names.push(trimmed.endsWith(BIB_EXTENSION) ? trimmed : trimmed + BIB_EXTENSION);
        }
    }
    return names;
}

/**
 * Die Literaturdatei, in die neue Quellen kommen: die zuerst eingebundene der Hauptdatei
 * (`\addbibresource`, `\AddBibFile`, `\bibliography{a,b}`), die im Projekt vorkommt, sonst die erste `.bib` im Projekt.
 */
export function bibTarget({ mainText, projectFiles }: BibTargetInput): string | null {
    if (mainText !== null) {
        const known = new Map(projectFiles.map((file) => [normalizeRelativePath(file), file]));
        for (const name of referencedBibNames(mainText)) {
            const file = known.get(normalizeRelativePath(name));
            if (file !== undefined) return file;
        }
    }
    return projectFiles.find((file) => file.toLowerCase().endsWith(BIB_EXTENSION)) ?? null;
}

function trailingNewlineCount(text: string): number {
    let count = 0;
    while (count < text.length && text.charAt(text.length - 1 - count) === '\n') count += 1;
    return count;
}

/** Text, der ans Ende der Datei kommt: genau eine Leerzeile Abstand zum Vorherigen */
export function appendix(entry: string, existing: string): string {
    if (existing.length === 0) return entry;
    const separatorCount = Math.max(0, BLANK_LINES_BEFORE_ENTRY - trailingNewlineCount(existing));
    return '\n'.repeat(separatorCount) + entry;
}

/** Meldungstext zu einem Problem (deutsch) */
export function sourceProblemMessage(problem: SourceProblem): string {
    if (problem.kind === 'noBibtexEntry') return NO_BIBTEX_ENTRY_MESSAGE;
    return MISSING_FIELDS_PREFIX + problem.fields.join(', ');
}

function chosenKey(override: string, authors: string, title: string, date: string, existing: ReadonlySet<string>): string {
    const trimmed = trimBlanks(override);
    if (keyValid(trimmed) && !existing.has(trimmed)) return trimmed;
    return makeKey(authors, title, prefixCharacters(date, YEAR_LENGTH), existing);
}

function trimmedValues(settings: SourceSettings, today: string): Record<string, string> {
    const values: Record<string, string> = {};
    for (const [name, value] of Object.entries(settings.values)) values[name] = trimWhitespace(value);
    if (settings.type === 'online' && (values.urldate ?? '') === '') values.urldate = today;
    return values;
}

function missingFieldTitles(settings: SourceSettings, authors: string, values: Record<string, string>): string[] {
    const missing = sourceFields(settings.type)
        .filter((field) => field.isRequired && (values[field.name] ?? '') === '')
        .map((field) => field.title);
    if (requiresAuthor(settings.type) && authors.length === 0) missing.unshift(AUTHOR_TITLE);
    return missing;
}

function buildFormEntry(settings: SourceSettings, existing: ReadonlySet<string>, today: string): SourceResult {
    const authors = authorsBibtex(settings.authors);
    const values = trimmedValues(settings, today);
    const missing = missingFieldTitles(settings, authors, values);
    if (missing.length > 0) return { ok: false, problem: { kind: 'missingFields', fields: missing } };
    const key = chosenKey(settings.keyOverride, authors, values.title ?? '', values.date ?? '', existing);
    const fields: BibField[] = [
        { name: 'author', value: authors },
        ...sourceFields(settings.type).map((field) => ({ name: field.name, value: values[field.name] ?? '' })),
        { name: 'langid', value: LANGUAGE_IDS[settings.language] },
    ];
    return { ok: true, key, entry: formatEntry(settings.type, key, fields, true) };
}

function buildBibtexEntry(settings: SourceSettings, existing: ReadonlySet<string>): SourceResult {
    const record = parseBib(settings.bibtex)[0];
    if (record === undefined) return { ok: false, problem: { kind: 'noBibtexEntry' } };
    const proposed = settings.keyOverride.length === 0 ? record.key : settings.keyOverride;
    const date = bibFieldValue(record, 'date') ?? bibFieldValue(record, 'year') ?? '';
    const key = keyValid(proposed) && !existing.has(proposed)
        ? proposed
        : makeKey(bibFieldValue(record, 'author') ?? '', bibFieldValue(record, 'title') ?? '', date, existing);
    return { ok: true, key, entry: formatEntry(record.type, key, record.fields, false) };
}

/**
 * Baut aus dem Formular oder eingefügtem BibTeX den Eintrag für die Literaturdatei oder nennt, was fehlt.
 * Fehlende Einstellungen haben die Standardwerte; `today` ist `JJJJ-MM-TT` (Abrufdatum bei Webseiten).
 */
export function buildSource(settings: Partial<SourceSettings>, existingKeys: readonly string[], today: string): SourceResult {
    const complete: SourceSettings = { ...DEFAULT_SOURCE_SETTINGS, ...settings };
    const existing = new Set(existingKeys);
    return complete.mode === 'form' ? buildFormEntry(complete, existing, today) : buildBibtexEntry(complete, existing);
}
