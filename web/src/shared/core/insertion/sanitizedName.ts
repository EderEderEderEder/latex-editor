import { GERMAN_TRANSLITERATIONS } from './transliteration';

const FALLBACK_BASE = 'bild';
const REPLACEMENT = '-';
const ALLOWED_ASCII = /^[A-Za-z0-9_-]$/;
const EDGE_SEPARATORS = /^[-_]+|[-_]+$/g;

/** Erweiterung ab dem letzten Punkt; ein Punkt am Anfang oder Ende gehört zum Namen (wie `pathExtension`) */
function splitExtension(name: string): { base: string; extension: string } {
    const dot = name.lastIndexOf('.');
    if (dot <= 0 || dot === name.length - 1) return { base: name, extension: '' };
    return { base: name.slice(0, dot), extension: name.slice(dot + 1).toLowerCase() };
}

function sanitizedBase(base: string): string {
    let result = '';
    for (const character of base) {
        const replacement = GERMAN_TRANSLITERATIONS.get(character);
        if (replacement !== undefined) result += replacement;
        else if (ALLOWED_ASCII.test(character)) result += character;
        else if (!result.endsWith(REPLACEMENT)) result += REPLACEMENT;
    }
    return result.replace(EDGE_SEPARATORS, '');
}

/** Dateiname für den Bildimport: ASCII, Umlaute umgeschrieben, Erweiterung klein, leer → `bild` */
export function sanitizedName(filename: string): string {
    const lastComponent = filename.slice(filename.lastIndexOf('/') + 1).normalize('NFC');
    const { base, extension } = splitExtension(lastComponent);
    const cleaned = sanitizedBase(base) || FALLBACK_BASE;
    return extension === '' ? cleaned : `${cleaned}.${extension}`;
}
