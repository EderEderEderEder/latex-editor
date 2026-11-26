import { trimBlanks } from '../bib/textUtils';

export interface ReferenceSettings {
    readonly label: string;
    /** „Abbildung~“, „Tabelle~“ usw. vor den Verweis setzen */
    readonly withPrefix: boolean;
}

export interface CitationSettings {
    readonly keys: readonly string[];
    readonly note: string;
}

const REFERENCE_PREFIXES: ReadonlyMap<string, string> = new Map([
    ['fig', 'Abbildung'],
    ['tab', 'Tabelle'],
    ['prog', 'Programm'],
    ['sec', 'Abschnitt'],
    ['chap', 'Kapitel'],
    ['eq', 'Gleichung'],
]);
const LABEL_SEPARATOR = ':';

/** Erster nicht leerer Teil des Labels vor dem `:` (ohne `:` das ganze Label, wie in Swift) */
function labelKind(label: string): string | undefined {
    return label.split(LABEL_SEPARATOR).find((part) => part !== '');
}

export function generateReference(settings: ReferenceSettings): string {
    if (settings.label === '') return '\\ref{}';
    const command = `\\ref{${settings.label}}`;
    const kind = labelKind(settings.label);
    const prefix = settings.withPrefix && kind !== undefined ? REFERENCE_PREFIXES.get(kind) : undefined;
    return prefix === undefined ? command : `${prefix}~${command}`;
}

export function generateCitation(settings: CitationSettings): string {
    const note = trimBlanks(settings.note);
    return `\\cite${note === '' ? '' : `[${note}]`}{${settings.keys.join(',')}}`;
}
