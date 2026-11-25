// Autorennamen und Literaturschlüssel (Port von `BibAuthors` und `BibKey` aus `Bibliography.swift`).
// Reine Logik ohne DOM, Node oder Electron.
import { trimBlanks, trimWhitespace } from './textUtils';

const AND_SEPARATOR = ' and ';
const PERSON_SEPARATORS = /[;\r\n]/;
const FALLBACK_KEY_BASE = 'quelle';
const LETTER_SUFFIXES = 'abcdefghijklmnopqrstuvwxyz'.split('');
const SHORT_PAIR_JOINER = ' und ';
const SHORT_MANY_SUFFIX = ' u. a.';
const VALID_KEY_PATTERN = /^[A-Za-z0-9:\-_.]+$/;
const NON_ASCII_ALNUM = /[^A-Za-z0-9]/g;
const COMBINING_MARKS = /\p{M}/gu;
const TRANSLITERATION: Readonly<Record<string, string>> = {
    ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss',
};
const TRANSLITERATED_CHARACTERS = /[äöüÄÖÜß]/g;

function splitWords(text: string): string[] {
    return text.split(' ').filter((word) => word.length > 0);
}

function personName(name: string): string {
    if (name.includes(',') || name.startsWith('{')) return name;
    const parts = splitWords(name);
    const last = parts[parts.length - 1];
    if (parts.length < 2 || last === undefined) return name;
    return `${last}, ${parts.slice(0, -1).join(' ')}`;
}

/**
 * „Max Mustermann; Erika Musterfrau“ oder eine Person pro Zeile → „Mustermann, Max and Musterfrau, Erika“.
 * Vorhandenes „Nachname, Vorname“, Einträge mit „and“ und einzelne Wörter (Organisation) bleiben unverändert.
 */
export function authorsBibtex(input: string): string {
    const trimmed = trimWhitespace(input);
    if (trimmed.length === 0) return '';
    if (trimmed.toLowerCase().includes(AND_SEPARATOR)) return trimmed;
    return trimmed
        .split(PERSON_SEPARATORS)
        .map(trimBlanks)
        .filter((person) => person.length > 0)
        .map(personName)
        .join(AND_SEPARATOR);
}

/** Nachname der ersten Person, für Schlüssel und Anzeige */
export function firstLastName(authors: string): string {
    const first = trimBlanks(authors.split(AND_SEPARATOR)[0] ?? '');
    const cleaned = first.replaceAll('{', '').replaceAll('}', '');
    const commaIndex = cleaned.indexOf(',');
    if (commaIndex >= 0) return trimBlanks(cleaned.slice(0, commaIndex));
    const words = splitWords(cleaned);
    return words[words.length - 1] ?? cleaned;
}

/** Kurzform für Listen: „Mustermann“, „Mustermann und Musterfrau“, „Mustermann u. a.“ */
export function authorsShort(authors: string): string {
    const people = authors.split(AND_SEPARATOR).filter((person) => trimBlanks(person).length > 0);
    const [first, second] = people;
    if (first === undefined) return '';
    const name = firstLastName(first);
    if (people.length === 1) return name;
    if (people.length === 2 && second !== undefined) return name + SHORT_PAIR_JOINER + firstLastName(second);
    return name + SHORT_MANY_SUFFIX;
}

/** Umlaute umschreiben, Akzente entfernen, nur ASCII-Buchstaben und -Ziffern behalten */
export function asciiKeyPart(text: string): string {
    return text
        .normalize('NFC')
        .replace(TRANSLITERATED_CHARACTERS, (character) => TRANSLITERATION[character] ?? character)
        .normalize('NFD')
        .replace(COMBINING_MARKS, '')
        .replace(NON_ASCII_ALNUM, '');
}

/** Erlaubt sind ASCII-Buchstaben, Ziffern und `:-_.`; leer ist ungültig */
export function keyValid(key: string): boolean {
    return VALID_KEY_PATTERN.test(key);
}

function keyBase(authors: string, title: string): string {
    const name = firstLastName(authors);
    const source = name.length > 0 ? name : (splitWords(title)[0] ?? FALLBACK_KEY_BASE);
    const base = asciiKeyPart(source);
    return base.length > 0 ? base : FALLBACK_KEY_BASE;
}

/** „Mustermann2024“; ohne Autor das erste Wort des Titels. Eindeutig gegenüber `existing` (a, b, c …). */
export function makeKey(authors: string, title: string, year: string, existing: ReadonlySet<string>): string {
    const stem = keyBase(authors, title) + asciiKeyPart(year);
    if (!existing.has(stem)) return stem;
    const free = LETTER_SUFFIXES.map((suffix) => stem + suffix).find((candidate) => !existing.has(candidate));
    return free ?? `${stem}-${existing.size}`;
}
