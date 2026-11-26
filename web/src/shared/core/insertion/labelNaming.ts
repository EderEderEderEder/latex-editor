import { GERMAN_TRANSLITERATIONS } from './transliteration';

const MAXIMUM_WORDS = 5;
const MAXIMUM_LENGTH = 40;
const WORD_SEPARATOR = '-';
const ASCII_LETTER_OR_DIGIT = /^[A-Za-z0-9]$/;
const SEPARATOR_EDGES = /^-+|-+$/g;

/** „Ergebnisse der Messung“ → `ergebnisse-der-messung`: höchstens 5 Wörter, 40 Zeichen, nur ASCII */
export function slugOf(text: string): string {
    const words: string[] = [];
    let current = '';
    for (const character of text.normalize('NFC')) {
        const replacement = GERMAN_TRANSLITERATIONS.get(character);
        if (replacement !== undefined) {
            current += replacement.toLowerCase();
        } else if (ASCII_LETTER_OR_DIGIT.test(character)) {
            current += character.toLowerCase();
        } else if (current !== '') {
            words.push(current);
            current = '';
        }
    }
    if (current !== '') words.push(current);
    return words.slice(0, MAXIMUM_WORDS).join(WORD_SEPARATOR).slice(0, MAXIMUM_LENGTH).replace(SEPARATOR_EDGES, '');
}

/** `prefix:slug` (bei leerem Slug `fallback`), bei Kollision mit `-2`, `-3`, … */
export function uniqueLabel(prefix: string, caption: string, fallback: string, existing: ReadonlySet<string>): string {
    const slug = slugOf(caption);
    const base = `${prefix}:${slug === '' ? fallback : slug}`;
    if (!existing.has(base)) return base;
    let number = 2;
    while (existing.has(`${base}-${number}`)) number += 1;
    return `${base}-${number}`;
}
