// Hinweise der Fehlerliste (W4-12, Vorlage `IssueListView.hints` in Swift): Doppelte Labels, ungenutzte Labels,
// ungenutzte Abkürzungen und nicht zitierte Quellen als Gruppen mit Zeilen (Name, Fundstelle, Sprungziel). Reine
// Aufbereitung des `ReferenceSnapshot`, ohne DOM.
import { relativeToProject } from './pathBarData';
import type { ReferenceSnapshot } from './referenceCheckLogic';

export type HintGroupId = 'duplicates' | 'labels' | 'acronyms' | 'sources';

export interface HintRowData {
    readonly key: string;
    readonly title: string;
    /** „Datei:Zeile“ bzw. Kurz-/Langform der Abkürzung bzw. Titel der Quelle */
    readonly detail: string;
    readonly file: string;
    readonly line: number;
}

export interface HintGroupData {
    readonly id: HintGroupId;
    readonly title: string;
    readonly rows: readonly HintRowData[];
}

export const HINT_TEXTS = {
    heading: 'Hinweise',
    filter: 'Hinweise',
    help: 'Kein Fehler beim Kompilieren: doppelte Labels (LaTeX warnt), ungenutzte Labels und Abkürzungen sowie nicht zitierte Quellen.',
    groups: {
        duplicates: 'Doppelte Labels',
        labels: 'Ungenutzte Labels',
        acronyms: 'Ungenutzte Abkürzungen',
        sources: 'Nicht zitierte Quellen',
    },
} as const;

const SEPARATORS = /[\\/]/;

function placeOf(root: string | null, file: string, line: number): string {
    return `${relativeToProject(root, file) ?? file.split(SEPARATORS).at(-1) ?? file}:${line}`;
}

function row(id: HintGroupId, title: string, detail: string, file: string, line: number): HintRowData {
    return { key: `${id}|${file}|${line}|${title}`, title, detail, file, line };
}

/** Nur nicht leere Gruppen, in der Reihenfolge der Swift-Liste */
export function hintGroupsOf(references: ReferenceSnapshot, root: string | null): HintGroupData[] {
    const groups: HintGroupData[] = [
        {
            id: 'duplicates',
            title: HINT_TEXTS.groups.duplicates,
            rows: references.duplicateLabels.map((entry) => row('duplicates', entry.label, placeOf(root, entry.file, entry.line), entry.file, entry.line)),
        },
        {
            id: 'labels',
            title: HINT_TEXTS.groups.labels,
            rows: references.unusedLabels.map((entry) => row('labels', entry.label, placeOf(root, entry.file, entry.line), entry.file, entry.line)),
        },
        {
            id: 'acronyms',
            title: HINT_TEXTS.groups.acronyms,
            rows: references.unusedAcronyms.map((entry) => row('acronyms', entry.key, entry.summary, entry.file, entry.line)),
        },
        {
            id: 'sources',
            title: HINT_TEXTS.groups.sources,
            rows: references.unusedSources.map((entry) => row('sources', entry.key, entry.title, entry.file, entry.line)),
        },
    ];
    return groups.filter((group) => group.rows.length > 0);
}
