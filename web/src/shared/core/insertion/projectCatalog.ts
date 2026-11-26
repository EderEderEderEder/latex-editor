import { type BibEntry, catalogEntries } from '../bib/parser';
import type { LabelEntry } from '../latex/duplicateLabels';
import { catalogLabels } from '../latex/references';

const COMMAND = '\\graphicspath';
const DIRECTORY_DEPTH = 2;
const DIRECTORY_SEPARATOR = '/';

/** `\label{…}` je Zeile in Dokumentreihenfolge, Kommentare ausgenommen (Zeile 1-basiert) */
export function labelsInText(text: string, file = ''): LabelEntry[] {
    return catalogLabels(text, file);
}

/** Einträge einer `.bib`-Datei mit Schlüssel und Titel (ohne `{}`) */
export function bibEntriesInText(text: string): BibEntry[] {
    return catalogEntries(text);
}

/** Verzeichnisse aus `\graphicspath{{images/}{fig/}}`, jeweils mit abschließendem `/` */
export function graphicsDirectories(text: string): string[] {
    const command = text.indexOf(COMMAND);
    const open = command === -1 ? -1 : text.indexOf('{', command + COMMAND.length);
    if (open === -1) return [];
    const directories: string[] = [];
    let depth = 0;
    let current = '';
    for (const character of text.slice(open)) {
        if (character === '{') {
            depth += 1;
            if (depth === DIRECTORY_DEPTH) current = '';
        } else if (character === '}') {
            if (depth === DIRECTORY_DEPTH && current !== '') directories.push(current.endsWith(DIRECTORY_SEPARATOR) ? current : current + DIRECTORY_SEPARATOR);
            depth -= 1;
            if (depth === 0) break;
        } else if (depth === DIRECTORY_DEPTH) {
            current += character;
        }
    }
    return directories;
}
