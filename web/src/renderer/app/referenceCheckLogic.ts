/**
 * Verweisprüfung und Hinweise aus dem Projektindex (W4-12, Vorlage `ReferenceCheckStore.swift`): Je Datei merkt sich der
 * Index im Worker nur die Definitionen (Labels, Quellen, Abkürzungen) und die Verwendungen mit Position; hieraus
 * entsteht der `ReferenceSnapshot` mit den Problemen je Datei (undefinierte `\ref`/`\cite`/Abkürzungen) und den Hinweisen
 * (ungenutzte Labels, Quellen, Abkürzungen, doppelte Labels). Reine Logik ohne DOM; sie läuft im Worker
 * (`completionIndexLogic.ts`), nie im UI-Thread.
 */
import { duplicateLabelEntries, type LabelEntry } from '../../shared/core/latex/duplicateLabels';
import { scanReferencesMasked } from '../../shared/core/latex/masking';
import { problemMessage, unusedLabels, unusedSources, type ReferenceProblem } from '../../shared/core/latex/referenceCheck';
import { citesEverythingMasked, scanAcronymsMasked } from '../../shared/core/latex/references';

/** `\glsaddall`: alle Abkürzungen gelten als benutzt (Swift `Acronyms.useAllCommand`) */
const USE_ALL_ACRONYMS_COMMAND = '\\glsaddall';

export interface KeyUse {
    readonly key: string;
    /** Nur der Schlüssel, UTF-16, Ende exklusiv */
    readonly start: number;
    readonly end: number;
}

/** Verwendungen einer `.tex`-Datei (ohne Definitionen) */
export interface FileUses {
    readonly labels: readonly KeyUse[];
    readonly citations: readonly KeyUse[];
    readonly acronyms: readonly KeyUse[];
    readonly citesEverything: boolean;
    readonly usesAllAcronyms: boolean;
}

export interface SourceDefinition {
    readonly key: string;
    /** Pfad der `.bib`-Datei */
    readonly file: string;
    /** 1-basiert */
    readonly line: number;
    readonly title: string;
}

export interface AcronymDefinition {
    readonly key: string;
    readonly file: string;
    readonly line: number;
    /** „API – Application Programming Interface“ */
    readonly summary: string;
}

export interface FileProblems {
    readonly file: string;
    readonly problems: readonly ReferenceProblem[];
}

/** Ergebnis der Verweisprüfung des ganzen Projekts (strukturiert klonbar, geht vom Worker an den Renderer) */
export interface ReferenceSnapshot {
    /** Ein Projekt ist offen und gelesen; sonst wird nichts geprüft und nichts gemeldet */
    readonly loaded: boolean;
    /** Alle Definitionen (zum Springen), Labels nach Datei und Zeile */
    readonly labels: readonly LabelEntry[];
    readonly sources: readonly SourceDefinition[];
    readonly acronyms: readonly AcronymDefinition[];
    readonly unusedLabels: readonly LabelEntry[];
    readonly unusedSources: readonly SourceDefinition[];
    readonly unusedAcronyms: readonly AcronymDefinition[];
    readonly duplicateLabels: readonly LabelEntry[];
    /** Nur Dateien mit Problemen */
    readonly problems: readonly FileProblems[];
    /** Ordner aus `\graphicspath` (mit `/` am Ende), für das Suchen von Bildern beim Strg-Klick */
    readonly graphicsDirectories: readonly string[];
}

export const EMPTY_REFERENCES: ReferenceSnapshot = {
    loaded: false,
    labels: [],
    sources: [],
    acronyms: [],
    unusedLabels: [],
    unusedSources: [],
    unusedAcronyms: [],
    duplicateLabels: [],
    problems: [],
    graphicsDirectories: [],
};

export const NO_USES: FileUses = { labels: [], citations: [], acronyms: [], citesEverything: false, usesAllAcronyms: false };

/** Verwendungen in schon maskiertem Text (`scannable`) */
export function usesOfMasked(masked: string): FileUses {
    const labels: KeyUse[] = [];
    const citations: KeyUse[] = [];
    for (const occurrence of scanReferencesMasked(masked)) {
        if (occurrence.kind === 'labelUse') labels.push(occurrence);
        else if (occurrence.kind === 'citation') citations.push(occurrence);
    }
    return {
        labels,
        citations,
        acronyms: scanAcronymsMasked(masked).filter((occurrence) => !occurrence.isDefinition),
        citesEverything: citesEverythingMasked(masked),
        usesAllAcronyms: masked.includes(USE_ALL_ACRONYMS_COMMAND),
    };
}

/** Was der Index je Datei für die Prüfung festhält */
export interface ReferenceFileData {
    readonly path: string;
    readonly isTex: boolean;
    readonly labels: readonly LabelEntry[];
    readonly sources: readonly SourceDefinition[];
    readonly acronyms: readonly AcronymDefinition[];
    readonly uses: FileUses;
}

interface KnownKeys {
    readonly labels: ReadonlySet<string>;
    /** `null`: Zitate nicht prüfen (kein Eintrag im Projekt) */
    readonly citations: ReadonlySet<string> | null;
    /** `null`: Abkürzungen nicht prüfen (keine Definition im Projekt) */
    readonly acronyms: ReadonlySet<string> | null;
}

function problem(kind: ReferenceProblem['kind'], use: KeyUse): ReferenceProblem {
    return { kind, key: use.key, start: use.start, end: use.end, message: problemMessage(kind, use.key) };
}

/** Wie `referenceProblemsMasked`: erst unbekannte Abkürzungen, dann Verweise und Zitate in Textreihenfolge */
function problemsOf(uses: FileUses, known: KnownKeys): ReferenceProblem[] {
    const acronyms = known.acronyms === null ? [] : uses.acronyms.filter((use) => !known.acronyms?.has(use.key));
    const references: ReferenceProblem[] = [
        ...uses.labels.filter((use) => !known.labels.has(use.key)).map((use) => problem('unknownLabel', use)),
        ...(known.citations === null ? [] : uses.citations.filter((use) => !known.citations?.has(use.key))
            .map((use) => problem('unknownCitation', use))),
    ];
    references.sort((first, second) => first.start - second.start);
    return [...acronyms.map((use) => problem('unknownAcronym', use)), ...references];
}

function byFileAndLine<T extends { readonly file: string; readonly line: number }>(items: T[]): T[] {
    return items.sort((first, second) =>
        (first.file < second.file ? -1 : first.file > second.file ? 1 : 0) || first.line - second.line);
}

function usedKeys(files: readonly ReferenceFileData[], pick: (uses: FileUses) => readonly KeyUse[]): Set<string> {
    return new Set(files.flatMap((file) => pick(file.uses).map((use) => use.key)));
}

function knownKeysOf(
    labels: readonly LabelEntry[], sources: readonly SourceDefinition[], acronyms: readonly AcronymDefinition[],
): KnownKeys {
    return {
        labels: new Set(labels.map((entry) => entry.label)),
        citations: sources.length === 0 ? null : new Set(sources.map((entry) => entry.key)),
        acronyms: acronyms.length === 0 ? null : new Set(acronyms.map((entry) => entry.key)),
    };
}

/** Gesamtergebnis aus den Dateien des Projekts; `loaded` nur mit offenem Projekt */
export function buildReferenceSnapshot(
    files: readonly ReferenceFileData[], graphicsDirectories: readonly string[],
): ReferenceSnapshot {
    const labels = byFileAndLine(files.flatMap((file) => file.labels));
    const sources = files.flatMap((file) => file.sources);
    const acronyms = files.flatMap((file) => file.acronyms);
    const texFiles = files.filter((file) => file.isTex);
    const usedLabels = usedKeys(texFiles, (uses) => uses.labels);
    const usedCitations = usedKeys(texFiles, (uses) => uses.citations);
    const usedAcronyms = usedKeys(texFiles, (uses) => uses.acronyms);
    const known = knownKeysOf(labels, sources, acronyms);
    const citesEverything = texFiles.some((file) => file.uses.citesEverything);
    const usesAllAcronyms = texFiles.some((file) => file.uses.usesAllAcronyms);
    return {
        loaded: true,
        labels,
        sources,
        acronyms,
        unusedLabels: unusedLabels(labels, { usedLabels }, true),
        unusedSources: unusedSources(sources, { usedCitations, citesEverything }, true),
        unusedAcronyms: usesAllAcronyms ? [] : acronyms.filter((entry) => !usedAcronyms.has(entry.key)),
        duplicateLabels: duplicateLabelEntries(labels),
        problems: texFiles
            .map((file) => ({ file: file.path, problems: problemsOf(file.uses, known) }))
            .filter((entry) => entry.problems.length > 0),
        graphicsDirectories,
    };
}
