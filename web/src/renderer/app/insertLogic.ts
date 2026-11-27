// Einfügen-Fenster (W4-10): reine Logik zwischen Einstellungen und Text (Vorlage `InsertStore.swift`): Label,
// Bildpfad, erzeugter Code, Prüfung, Blocker, Zielzeile. Kein DOM, kein Zugriff auf Stores oder IPC.
import { DEFAULT_SOURCE_SETTINGS, buildSource, sourceProblemMessage } from '../../shared/core/bib/sourceBuilder';
import type { SourceResult, SourceSettings } from '../../shared/core/bib/sourceBuilder';
import { trimBlanks, trimWhitespace } from '../../shared/core/bib/textUtils';
import {
    createCodeSettings, createEquationSettings, createImageSettings, createListSettings, createTableSettings,
    cursorLineNumber, generateCitation, generateCode, generateEquation, generateImage, generateList, generateReference,
    generateTable, graphicsReference, insertionLines, sanitizedName, uniqueLabel,
} from '../../shared/core/insertion';
import type {
    CitationSettings, CodeSettings, EquationSettings, ImageSettings, InsertionContext, InsertionLine, ListSettings,
    ReferenceSettings, TableSettings,
} from '../../shared/core/insertion';
import type { CitationItem, LabelItem } from './completionIndexLogic';
import { isBlockKind, labelPrefixOf, usesSelectionAsContent } from './insertKinds';
import type { InsertionKind, LabelPrefix } from './insertKinds';

export const INSERT_TEXTS = {
    needsTeX: 'Zum Einfügen muss eine .tex-Datei geöffnet sein.',
    citeNeedsTeX: 'Zum Zitieren muss eine .tex-Datei vorne sein. Ohne „Gleich zitieren“ wird nur die Quelle angelegt.',
    chooseImage: 'Bitte ein Bild wählen.',
    imageNeedsProject: 'Bilder lassen sich nur in einem Projekt einfügen.',
    noLabels: 'Im Projekt wurden keine Labels gefunden.',
    chooseCitation: 'Bitte mindestens einen Literatureintrag wählen.',
    noBibliography: 'Keine Literaturdatei (.bib) im Projekt gefunden.',
    defaultDestination: 'Wird an der Cursorposition eingefügt.',
} as const;

export const IMAGES_DIRECTORY = 'images';
const PLACEHOLDER_IMAGE = 'bild.png';
const POSIX_SEPARATOR = '/';
const BACKSLASH = /\\/g;
const LINE_FEED = '\n';
/** Obergrenze für übernommenen markierten Text (wie Swift) */
export const MAXIMUM_SELECTION_CHARS = 50_000;
const MAXIMUM_LIST_ITEMS = 30;
const LABEL_FALLBACKS: Readonly<Record<LabelPrefix, string>> = { tab: 'tabelle', fig: 'bild', prog: 'code', eq: 'gleichung' };

export type LabelKind = 'table' | 'image' | 'code' | 'equation';

/** Gewähltes Bild: Datei im Projekt (Pfad) oder von außen (Kennung; wird beim Einfügen nach `images/` kopiert) */
export type ImageChoice =
    | { readonly kind: 'project'; readonly path: string; readonly name: string }
    | { readonly kind: 'external'; readonly grantId: string; readonly name: string };

export interface SourceOptions {
    readonly citeAfterInsert: boolean;
    /** Seitenangabe für das Zitat, z. B. „S.~12“ */
    readonly note: string;
}

export interface InsertSettings {
    readonly table: TableSettings;
    readonly image: ImageSettings;
    readonly code: CodeSettings;
    readonly equation: EquationSettings;
    readonly list: ListSettings;
    readonly reference: ReferenceSettings;
    readonly citation: CitationSettings;
    readonly source: SourceSettings;
    readonly imageChoice: ImageChoice | null;
    /** Leer = automatisch aus der Beschriftung */
    readonly labelOverrides: Readonly<Record<LabelKind, string>>;
    readonly sourceOptions: SourceOptions;
}

export interface ProjectImage {
    readonly path: string;
    /** Pfad relativ zum Projekt mit `/` */
    readonly relative: string;
}

export interface BibliographyTarget {
    readonly path: string;
    readonly name: string;
}

/** Was das Fenster vom Projekt weiß (Labels, Schlüssel, Bilder, Literaturdatei) */
export interface InsertCatalog {
    readonly projectRoot: string | null;
    readonly labels: readonly LabelItem[];
    readonly citations: readonly CitationItem[];
    readonly images: readonly ProjectImage[];
    readonly graphicsDirectories: readonly string[];
    readonly bibliography: BibliographyTarget | null;
}

export const EMPTY_INSERT_CATALOG: InsertCatalog = {
    projectRoot: null, labels: [], citations: [], images: [], graphicsDirectories: [], bibliography: null,
};

export function createInsertSettings(): InsertSettings {
    return {
        table: createTableSettings(),
        image: createImageSettings(),
        code: createCodeSettings(),
        equation: createEquationSettings(),
        list: createListSettings(),
        reference: { label: '', withPrefix: true },
        citation: { keys: [], note: '' },
        source: DEFAULT_SOURCE_SETTINGS,
        imageChoice: null,
        labelOverrides: { table: '', image: '', code: '', equation: '' },
        sourceOptions: { citeAfterInsert: true, note: '' },
    };
}

export function toPosixPath(path: string): string {
    return path.replace(BACKSLASH, POSIX_SEPARATOR);
}

export function isInsideProject(path: string, root: string | null): boolean {
    if (root === null) return false;
    return toPosixPath(path).startsWith(toPosixPath(root).replace(/\/+$/, '') + POSIX_SEPARATOR);
}

// ---------- Markierter Text ----------

/** Markierten Text als Inhalt von Code, Gleichung und Liste übernehmen; leer lässt alles unverändert */
export function adoptSelection(settings: InsertSettings, selectedText: string): InsertSettings {
    const text = trimWhitespace(selectedText);
    if (text === '') return settings;
    const lines = text.split(LINE_FEED).filter((line) => line !== '').map(trimBlanks);
    const items = lines.slice(0, MAXIMUM_LIST_ITEMS);
    return {
        ...settings,
        code: { ...settings.code, content: text },
        equation: { ...settings.equation, content: text },
        list: items.length === 0 ? settings.list : { ...settings.list, items },
    };
}

// ---------- Label ----------

export function labelNamesOf(catalog: InsertCatalog): Set<string> {
    return new Set(catalog.labels.map((entry) => entry.label));
}

function captionOf(kind: LabelKind, settings: InsertSettings): string {
    if (kind === 'equation') return '';
    return settings[kind].caption;
}

/** Eigener Wert, sonst automatisch aus der Beschriftung (ohne Beschriftung gibt es kein Label), eindeutig im Projekt */
export function resolvedLabel(kind: LabelKind, settings: InsertSettings, existing: ReadonlySet<string>): string {
    const custom = trimBlanks(settings.labelOverrides[kind]);
    if (custom !== '') return custom;
    const caption = captionOf(kind, settings);
    const prefix = labelPrefixOf(kind);
    if (trimWhitespace(caption) === '' || prefix === null) return '';
    return uniqueLabel(prefix, caption, LABEL_FALLBACKS[prefix], existing);
}

function labelFor(kind: InsertionKind, settings: InsertSettings, catalog: InsertCatalog): string {
    if (kind !== 'table' && kind !== 'image' && kind !== 'code' && kind !== 'equation') return '';
    return resolvedLabel(kind, settings, labelNamesOf(catalog));
}

// ---------- Bild ----------

/** Pfad für `\includegraphics`, bei fremden Bildern vorab geschätzt (so wie sie nach dem Kopieren heißen werden) */
export function imageReferenceOf(settings: InsertSettings, catalog: InsertCatalog): string {
    const choice = settings.imageChoice;
    if (choice === null) return PLACEHOLDER_IMAGE;
    const root = catalog.projectRoot;
    if (root === null) return choice.name;
    const posixRoot = toPosixPath(root);
    const target = choice.kind === 'project'
        ? toPosixPath(choice.path)
        : [posixRoot, IMAGES_DIRECTORY, sanitizedName(choice.name)].join(POSIX_SEPARATOR);
    return graphicsReference(target, posixRoot, catalog.graphicsDirectories);
}

// ---------- Quelle ----------

/** Eintrag aus Formular oder BibTeX; vorhandene Schlüssel machen den neuen eindeutig */
export function sourceDraftOf(settings: InsertSettings, catalog: InsertCatalog, today: string): SourceResult {
    return buildSource(settings.source, catalog.citations.map((item) => item.key), today);
}

function citationOfDraft(settings: InsertSettings, key: string): string {
    return generateCitation({ keys: [key], note: settings.sourceOptions.note });
}

// ---------- Erzeugter Text ----------

export interface GenerateInput {
    readonly kind: InsertionKind;
    readonly settings: InsertSettings;
    readonly catalog: InsertCatalog;
    /** Fertiger Pfad für Bilder (nach dem Kopieren); fehlt: Schätzung */
    readonly imageReference?: string;
    readonly today: string;
}

function generateSource(input: GenerateInput): string {
    const draft = sourceDraftOf(input.settings, input.catalog, input.today);
    if (!draft.ok || !input.settings.sourceOptions.citeAfterInsert) return '';
    return citationOfDraft(input.settings, draft.key);
}

/** Der Text, der an die Cursorposition kommt (bei „Quelle“ nur das Zitat, der Eintrag geht in die `.bib`) */
export function generateInsertion(input: GenerateInput): string {
    const { kind, settings, catalog } = input;
    const label = labelFor(kind, settings, catalog);
    switch (kind) {
        case 'table': return generateTable(settings.table, label);
        case 'image': return generateImage(settings.image, input.imageReference ?? imageReferenceOf(settings, catalog), label);
        case 'code': return generateCode(settings.code, label);
        case 'equation': return generateEquation(settings.equation, label);
        case 'list': return generateList(settings.list);
        case 'reference': return generateReference(settings.reference);
        case 'citation': return generateCitation(settings.citation);
        case 'source': return generateSource(input);
    }
}

/** Anzeigetext der Vorschau ohne Umgebung; bei „Quelle“ der neue Eintrag, bei Problemen dessen Hinweis als Kommentar */
export function standalonePreview(input: GenerateInput): string {
    if (input.kind !== 'source') return generateInsertion(input);
    const draft = sourceDraftOf(input.settings, input.catalog, input.today);
    if (!draft.ok) return `% ${sourceProblemMessage(draft.problem)}`;
    const cite = input.settings.sourceOptions.citeAfterInsert ? `${LINE_FEED}% Im Text: ${citationOfDraft(input.settings, draft.key)}` : '';
    return draft.entry + cite;
}

/** Die Vorschau Zeile für Zeile: mit Umgebung an der künftigen Stelle (neue Zeilen markiert), sonst nur der Code */
export function previewLinesOf(input: GenerateInput, context: InsertionContext | null): InsertionLine[] {
    if (input.kind === 'source' || context === null) {
        const lines = standalonePreview(input).split(LINE_FEED);
        if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
        return lines.map((text, index) => ({ number: index + 1, text, isNew: false }));
    }
    return insertionLines(context, generateInsertion(input), isBlockKind(input.kind), usesSelectionAsContent(input.kind));
}

// ---------- Prüfung und Blocker ----------

/** Ob der Baustein mit den aktuellen Einstellungen eingefügt werden kann (Hinweistext sonst) */
export function validationMessage(input: GenerateInput): string | null {
    const { kind, settings, catalog } = input;
    switch (kind) {
        case 'image':
            if (settings.imageChoice === null) return INSERT_TEXTS.chooseImage;
            return catalog.projectRoot === null ? INSERT_TEXTS.imageNeedsProject : null;
        case 'reference': return settings.reference.label === '' ? INSERT_TEXTS.noLabels : null;
        case 'citation': return settings.citation.keys.length === 0 ? INSERT_TEXTS.chooseCitation : null;
        case 'source': return sourceValidation(input);
        default: return null;
    }
}

function sourceValidation(input: GenerateInput): string | null {
    if (input.catalog.bibliography === null) return INSERT_TEXTS.noBibliography;
    const draft = sourceDraftOf(input.settings, input.catalog, input.today);
    return draft.ok ? null : sourceProblemMessage(draft.problem);
}

/**
 * Warum der Baustein gerade nicht eingefügt werden kann, `null` wenn es geht. Eine neue Quelle braucht keine
 * `.tex`-Datei (sie kommt in die `.bib`), nur das gleichzeitige Zitieren.
 */
export function blockerOf(input: GenerateInput, canInsertIntoEditor: boolean): string | null {
    const invalid = validationMessage(input);
    if (invalid !== null) return invalid;
    if (canInsertIntoEditor) return null;
    if (input.kind !== 'source') return INSERT_TEXTS.needsTeX;
    return input.settings.sourceOptions.citeAfterInsert ? INSERT_TEXTS.citeNeedsTeX : null;
}

/** Wohin der Code geht, so konkret wie möglich (Fußzeile) */
export function destinationOf(input: GenerateInput, context: InsertionContext | null, bibliography: BibliographyTarget | null): string {
    if (input.kind === 'source' && bibliography !== null) {
        const cite = input.settings.sourceOptions.citeAfterInsert ? ', Zitat an der Cursorposition' : '';
        return `Neuer Eintrag in ${bibliography.name}${cite}`;
    }
    if (context === null) return INSERT_TEXTS.defaultDestination;
    return `Einfügen in ${context.fileName}, Zeile ${cursorLineNumber(context)}`;
}

/** Beschriftung der Hauptschaltfläche */
export function insertButtonTitle(kind: InsertionKind): string {
    return kind === 'source' ? 'Quelle anlegen' : 'Einfügen';
}
