/**
 * Text so vorbereiten, dass die Befehlssuche nur echte Befehle trifft: Kommentare, `\verb` und Code-Umgebungen
 * werden durch Leerzeichen ersetzt (gleiche UTF-16-Länge, damit Bereiche im Original gelten).
 */
import { maskComments } from './comments';
import { isCodeEnvironment } from './environments';

const BEGIN_PATTERN = /\\begin\{([A-Za-z*]+)\}/g;
/** `\verb|…|` mit beliebigem Trennzeichen (kein Buchstabe, Leerraum oder `*`) auf einer Zeile */
const VERB_PATTERN = /\\verb\*?([^A-Za-z\s*])[^\n]*?\1/gu;

function blank(text: string, start: number, end: number): string {
    return text.slice(0, start) + ' '.repeat(end - start) + text.slice(end);
}

/** `\verb`-Argumente maskieren (ein `\verb|%|` ist kein Kommentar) */
export function maskVerb(text: string): string {
    return text.replace(VERB_PATTERN, (match) => ' '.repeat(match.length));
}

/**
 * Inhalt von Code-Umgebungen maskieren (ohne `\begin{…}`/`\end{…}`); ein nicht geschlossener Block reicht
 * bis zum Textende. Treffer im Inneren einer schon maskierten Umgebung werden übersprungen.
 */
export function maskCodeEnvironments(text: string): string {
    let result = text;
    let maskedUntil = 0;
    for (const match of text.matchAll(BEGIN_PATTERN)) {
        const name = match[1] ?? '';
        if (match.index < maskedUntil || !isCodeEnvironment(name)) continue;
        const bodyStart = match.index + match[0].length;
        const end = text.indexOf(`\\end{${name}}`, bodyStart);
        const bodyEnd = end === -1 ? text.length : end;
        if (bodyEnd > bodyStart) result = blank(result, bodyStart, bodyEnd);
        maskedUntil = bodyEnd;
    }
    return result;
}

/**
 * Reihenfolge wie in Swift: erst `\verb`, dann Kommentare, dann Code-Umgebungen
 * (ein `\begin` in einem Kommentar zählt nicht).
 */
export function scannable(text: string): string {
    return maskCodeEnvironments(maskComments(maskVerb(text)));
}

export type ReferenceKind = 'labelDefinition' | 'labelUse' | 'citation';

export interface ReferenceOccurrence {
    readonly kind: ReferenceKind;
    readonly key: string;
    /** Nur der Schlüssel, ohne Befehl und Klammern (UTF-16, Ende exklusiv) */
    readonly start: number;
    readonly end: number;
}

export const LABEL_USE_COMMANDS: readonly string[] = [
    'ref', 'eqref', 'pageref', 'autoref', 'Autoref', 'cref', 'Cref', 'vref', 'Vref', 'nameref', 'labelcref', 'cpageref', 'Cpageref',
];
export const CITATION_COMMANDS: readonly string[] = [
    'cite', 'citep', 'citet', 'citealp', 'citealt', 'citeauthor', 'citeyear', 'citeyearpar', 'citetitle', 'Cite', 'Citep', 'Citet',
    'parencite', 'Parencite', 'textcite', 'Textcite', 'autocite', 'Autocite', 'smartcite', 'Smartcite', 'footcite', 'footcitetext',
    'fullcite', 'nocite', 'supercite',
];

const COMMAND_NAMES = ['label', ...LABEL_USE_COMMANDS, ...CITATION_COMMANDS].sort((a, b) => b.length - a.length).join('|');
/** Befehl, optional Stern und bis zu zwei [Optionen] (biblatex), dann {Schlüsselliste} */
const COMMAND_PATTERN = new RegExp(`\\\\(${COMMAND_NAMES})\\*?\\s*(?:\\[[^\\]\\n]*\\]\\s*){0,2}\\{([^{}]*)\\}`, 'g');
const HYPERREF_PATTERN = /\\hyperref\s*\[([^\]\n]*)\]/g;
const WHITESPACE = /[ \t\n\r]/;

/** Schlüssel einer Klammer; `\cite{a, b}` ergibt zwei, `#1` (Makroparameter) und `*` (`\nocite{*}`) fallen weg */
function keysInGroup(raw: string, groupStart: number, splitsLists: boolean, kind: ReferenceKind): ReferenceOccurrence[] {
    const result: ReferenceOccurrence[] = [];
    let offset = 0;
    for (const part of splitsLists ? raw.split(',') : [raw]) {
        const partOffset = offset;
        offset += part.length + 1;
        let start = 0;
        let end = part.length;
        while (start < end && WHITESPACE.test(part[start] ?? '')) start++;
        while (end > start && WHITESPACE.test(part[end - 1] ?? '')) end--;
        const key = part.slice(start, end);
        if (key === '' || key === '*' || key.includes('#')) continue;
        result.push({ kind, key, start: groupStart + partOffset + start, end: groupStart + partOffset + end });
    }
    return result;
}

/** Labels, Verweise und Zitate in schon maskiertem Text (`scannable`), nach Position sortiert */
export function scanReferencesMasked(masked: string): ReferenceOccurrence[] {
    const occurrences: ReferenceOccurrence[] = [];
    for (const match of masked.matchAll(COMMAND_PATTERN)) {
        const [whole = '', command = '', keys = ''] = match;
        const kind: ReferenceKind = command === 'label' ? 'labelDefinition' : LABEL_USE_COMMANDS.includes(command) ? 'labelUse' : 'citation';
        const groupStart = match.index + whole.length - 1 - keys.length;
        occurrences.push(...keysInGroup(keys, groupStart, kind !== 'labelDefinition', kind));
    }
    for (const match of masked.matchAll(HYPERREF_PATTERN)) {
        const [whole = '', option = ''] = match;
        const groupStart = match.index + whole.length - 1 - option.length;
        occurrences.push(...keysInGroup(option, groupStart, false, 'labelUse'));
    }
    return occurrences.sort((a, b) => a.start - b.start);
}

/** Wie `scanReferencesMasked`, maskiert den Text selbst (Kommentare, `\verb` und Code zählen nicht) */
export function scanReferences(text: string): ReferenceOccurrence[] {
    return scanReferencesMasked(scannable(text));
}
