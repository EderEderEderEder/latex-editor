/**
 * Verweisprüfung: unbekannte Labels, Zitate und Abkürzungen, Hinweise auf ungenutzte Labels und Quellen, Prüfung
 * eines Projekts ohne Dateisystem. Port von `ReferenceChecker` und der reinen Teile von `ReferenceCheckStore` (Swift).
 * Doppelte Labels: `duplicateLabels.ts`. Reine Logik, UTF-16-Positionen.
 */
import { duplicateLabelEntries, type LabelEntry } from './duplicateLabels';
import { scannable, scanReferencesMasked } from './masking';
import {
    type BibEntry,
    bibEntries,
    catalogLabels,
    isBibPath,
    isTexPath,
    type ProjectFile,
    scanAcronymsMasked,
    type TextSpan,
    type UsedReferences,
    usedReferences,
} from './references';

export type ReferenceProblemKind = 'unknownLabel' | 'unknownCitation' | 'unknownAcronym';

/** Ein Verweis, ein Zitat oder eine Abkürzung, deren Schlüssel es im Projekt nicht gibt; der Bereich ist der Schlüssel */
export interface ReferenceProblem extends TextSpan {
    readonly kind: ReferenceProblemKind;
    readonly key: string;
    readonly message: string;
}

export function problemMessage(kind: ReferenceProblemKind, key: string): string {
    switch (kind) {
        case 'unknownLabel': return `Das Label „${key}“ ist im Projekt nicht definiert.`;
        case 'unknownCitation': return `„${key}“ steht in keiner Literaturdatei des Projekts.`;
        case 'unknownAcronym': return `Die Abkürzung „${key}“ ist im Projekt nicht definiert (\\newacronym, \\newglossaryentry …).`;
    }
}

function problem(kind: ReferenceProblemKind, key: string, span: TextSpan): ReferenceProblem {
    return { kind, key, start: span.start, end: span.end, message: problemMessage(kind, key) };
}

export interface KnownKeys {
    readonly labels: ReadonlySet<string>;
    /** `null`: Zitate nicht prüfen (keine Literaturdatei mit Einträgen im Projekt) */
    readonly citations: ReadonlySet<string> | null;
    /** `null` oder fehlend: Abkürzungen nicht prüfen */
    readonly acronyms?: ReadonlySet<string> | null;
}

function unknownAcronyms(masked: string, known: ReadonlySet<string> | null | undefined): ReferenceProblem[] {
    if (!known) return [];
    return scanAcronymsMasked(masked)
        .filter((occurrence) => !occurrence.isDefinition && !known.has(occurrence.key))
        .map((occurrence) => problem('unknownAcronym', occurrence.key, occurrence));
}

function unknownReferences(masked: string, known: KnownKeys): ReferenceProblem[] {
    const problems: ReferenceProblem[] = [];
    for (const occurrence of scanReferencesMasked(masked)) {
        if (occurrence.kind === 'labelUse' && !known.labels.has(occurrence.key)) {
            problems.push(problem('unknownLabel', occurrence.key, occurrence));
        } else if (occurrence.kind === 'citation' && known.citations && !known.citations.has(occurrence.key)) {
            problems.push(problem('unknownCitation', occurrence.key, occurrence));
        }
    }
    return problems;
}

/** Probleme in schon maskiertem Text (`scannable`): erst unbekannte Abkürzungen, dann Verweise und Zitate in Textreihenfolge */
export function referenceProblemsMasked(masked: string, known: KnownKeys): ReferenceProblem[] {
    return [...unknownAcronyms(masked, known.acronyms), ...unknownReferences(masked, known)];
}

export function referenceProblems(text: string, known: KnownKeys): ReferenceProblem[] {
    return referenceProblemsMasked(scannable(text), known);
}

/**
 * Prüfung einer Datei wie im Store (ohne Entprellung): nur `.tex`; ist der Index nicht gelesen (`knownLabels` null),
 * wird nicht geprüft.
 */
export function storeCheck(
    fileName: string,
    text: string,
    knownLabels: ReadonlySet<string> | null,
    knownCitations: ReadonlySet<string> | null,
): ReferenceProblem[] {
    if (!isTexPath(fileName) || knownLabels === null) return [];
    return referenceProblems(text, { labels: knownLabels, citations: knownCitations });
}

// MARK: Hinweise aus dem Index

/** Labels, die nirgends verwendet werden (Reihenfolge der Eingabe); leer, solange der Index nicht gelesen ist */
export function unusedLabels(labels: readonly LabelEntry[], used: Pick<UsedReferences, 'usedLabels'>, isLoaded: boolean): LabelEntry[] {
    if (!isLoaded) return [];
    return labels.filter((entry) => !used.usedLabels.has(entry.label));
}

/** Quellen, die nirgends zitiert werden; mit `\nocite{*}` gilt jede Quelle als benutzt */
export function unusedSources<Entry extends { readonly key: string }>(
    entries: readonly Entry[],
    used: Pick<UsedReferences, 'usedCitations' | 'citesEverything'>,
    isLoaded: boolean,
): Entry[] {
    if (!isLoaded || used.citesEverything) return [];
    return entries.filter((entry) => !used.usedCitations.has(entry.key));
}

/** Seitenleiste „Doppelte Labels“: leer, solange der Index nicht gelesen ist */
export function duplicateLabelList(labels: readonly LabelEntry[], isLoaded: boolean): LabelEntry[] {
    return isLoaded ? duplicateLabelEntries(labels) : [];
}

// MARK: Projekt

export interface ProjectCheckResult {
    readonly problems: ReferenceProblem[];
    readonly unusedLabels: LabelEntry[];
    readonly unusedSources: BibEntry[];
}

/** Labels des Projekts; für Dateien mit ungespeichertem Text (`openTexts`) zählt dieser statt der Platte */
function knownLabelNames(files: readonly ProjectFile[], openTexts: Readonly<Record<string, string>>): Set<string> {
    const names = new Set<string>();
    for (const file of files) {
        if (!isTexPath(file.path) || file.path in openTexts) continue;
        for (const entry of catalogLabels(file.text, file.path)) names.add(entry.label);
    }
    for (const [path, text] of Object.entries(openTexts)) {
        if (!isTexPath(path)) continue;
        for (const entry of catalogLabels(text, path)) names.add(entry.label);
    }
    return names;
}

function catalogOf(files: readonly ProjectFile[]): { labels: LabelEntry[]; sources: BibEntry[] } {
    const labels: LabelEntry[] = [];
    const sources: BibEntry[] = [];
    for (const file of files) {
        if (isTexPath(file.path)) labels.push(...catalogLabels(file.text, file.path));
        else if (isBibPath(file.path)) sources.push(...bibEntries(file.text, file.path));
    }
    return { labels, sources };
}

/**
 * Gesamtprüfung ohne Dateisystem: bekannte Labels und Zitate aus dem Katalog der Dateien, Probleme in `checkFile`
 * (ungespeicherter Text aus `openTexts` hat Vorrang), Hinweise auf ungenutzte Labels und Quellen aus den Dateien auf Platte.
 */
export function checkProject(files: readonly ProjectFile[], checkFile: string, openTexts: Readonly<Record<string, string>> = {}): ProjectCheckResult {
    const catalog = catalogOf(files);
    const used = usedReferences(files);
    const citations = catalog.sources.length === 0 ? null : new Set(catalog.sources.map((entry) => entry.key));
    const text = openTexts[checkFile] ?? files.find((file) => file.path === checkFile)?.text ?? '';
    return {
        problems: referenceProblems(text, { labels: knownLabelNames(files, openTexts), citations }),
        unusedLabels: unusedLabels(catalog.labels, used, true),
        unusedSources: unusedSources(catalog.sources, used, true),
    };
}
