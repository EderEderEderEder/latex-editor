// Formatiert einen Eintrag wie das Beispiel der HgbThesis: ein Feld pro Zeile, Tabulator, `feld={wert}`
// (Port von `BibFormatter` aus `Bibliography.swift`). Reine Logik ohne DOM, Node oder Electron.
import type { BibField } from './parser';
import { trimBlanks, trimWhitespace } from './textUtils';

/** Felder, deren Werte nicht maskiert werden (biblatex liest sie wörtlich) */
const VERBATIM_FIELDS: ReadonlySet<string> = new Set(['url', 'doi', 'urldate', 'isbn', 'date', 'pages', 'langid']);
const SPECIAL_CHARACTERS: ReadonlySet<string> = new Set(['&', '%', '#', '_', '$']);
const BACKSLASH = '\\';
const FIELD_INDENT = '\t';
const FIELD_SEPARATOR = ',\n';

/** `&`, `%`, `#`, `_` und `$` maskieren, schon maskierte nicht doppelt; URL, DOI u. a. nur trimmen */
export function escapeValue(value: string, field: string): string {
    const trimmed = trimWhitespace(value);
    if (VERBATIM_FIELDS.has(field)) return trimmed;
    let result = '';
    let previous = '';
    for (const character of trimmed) {
        if (SPECIAL_CHARACTERS.has(character) && previous !== BACKSLASH) result += BACKSLASH;
        result += character;
        previous = character;
    }
    return result;
}

/**
 * `@typ{schlüssel,` + Felder + `}` mit genau einem Zeilenumbruch am Ende. Felder mit leerem Wert entfallen.
 * `escaping: false` für eingefügtes BibTeX (dort ist schon alles maskiert, `$…$` darf bleiben).
 */
export function formatEntry(type: string, key: string, fields: readonly BibField[], escaping = true): string {
    const lines = fields
        .filter((field) => trimBlanks(field.value).length > 0)
        .map((field) => `${FIELD_INDENT}${field.name}={${escaping ? escapeValue(field.value, field.name) : field.value}}`);
    return `@${type}{${key},\n${lines.join(FIELD_SEPARATOR)}\n}\n`;
}
