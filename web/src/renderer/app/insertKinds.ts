// Bausteine des Einfügen-Fensters (W4-10, Vorlage `InsertionKind` in `InsertionModels.swift`): Namen, Texte und
// Eigenschaften. Reine Daten ohne DOM.

export type InsertionKind = 'table' | 'image' | 'code' | 'equation' | 'list' | 'reference' | 'citation' | 'source';

export const DEFAULT_INSERTION_KIND: InsertionKind = 'table';

/** Blöcke bekommen eigene Zeilen; Verweis und Zitat stehen im Fließtext */
export const BLOCK_KINDS: readonly InsertionKind[] = ['table', 'image', 'code', 'equation', 'list'];
export const REFERENCE_KINDS: readonly InsertionKind[] = ['reference', 'citation', 'source'];
export const ALL_INSERTION_KINDS: readonly InsertionKind[] = [...BLOCK_KINDS, ...REFERENCE_KINDS];

export const KIND_GROUP_TITLES = { blocks: 'Blöcke', references: 'Verweise und Quellen' } as const;

export const KIND_TITLES: Readonly<Record<InsertionKind, string>> = {
    table: 'Tabelle',
    image: 'Bild',
    code: 'Codeblock',
    equation: 'Gleichung',
    list: 'Aufzählung',
    // Mit Befehl, damit „Zitat“ nicht nach wörtlichem Zitat und „Verweis“ nicht nach Link klingt
    reference: 'Querverweis (\\ref)',
    citation: 'Zitieren (\\cite)',
    source: 'Quelle',
};

export const KIND_SUMMARIES: Readonly<Record<InsertionKind, string>> = {
    table: 'Raster mit Kopfzeile, Ausrichtung und Beschriftung',
    image: 'Bild aus dem Projekt oder von diesem Rechner',
    code: 'Quelltext mit Sprache und Beschriftung',
    equation: 'Formel, nummeriert oder ohne Nummer',
    list: 'Aufzählung oder nummerierte Liste',
    reference: 'Verweis auf Abbildung, Tabelle oder Kapitel',
    citation: 'Eine Quelle aus der Literaturdatei im Text zitieren',
    source: 'Neue Quelle in der Literaturdatei anlegen, auf Wunsch gleich zitieren',
};

/** Kurzzeichen vor dem Namen in der Liste (reiner Text, kein Symbolzeichensatz nötig) */
export const KIND_GLYPHS: Readonly<Record<InsertionKind, string>> = {
    table: '▦', image: '▣', code: '</>', equation: 'ƒ', list: '≡', reference: '↗', citation: '❞', source: '⌘',
};

export type LabelPrefix = 'tab' | 'fig' | 'prog' | 'eq';

const LABEL_PREFIXES: Readonly<Partial<Record<InsertionKind, LabelPrefix>>> = {
    table: 'tab', image: 'fig', code: 'prog', equation: 'eq',
};

const SELECTION_KINDS: ReadonlySet<InsertionKind> = new Set(['code', 'equation', 'list']);

export function isInsertionKind(value: string): value is InsertionKind {
    return (ALL_INSERTION_KINDS as readonly string[]).includes(value);
}

export function isBlockKind(kind: InsertionKind): boolean {
    return (BLOCK_KINDS as readonly string[]).includes(kind);
}

/** Bausteine, die markierten Text als Inhalt übernehmen (er wird dabei ersetzt) */
export function usesSelectionAsContent(kind: InsertionKind): boolean {
    return SELECTION_KINDS.has(kind);
}

export function labelPrefixOf(kind: InsertionKind): LabelPrefix | null {
    return LABEL_PREFIXES[kind] ?? null;
}
