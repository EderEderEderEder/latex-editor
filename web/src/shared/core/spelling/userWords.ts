// Regeln für das Benutzerwörterbuch (W7-2, „Zum Wörterbuch hinzufügen“): feste Obergrenzen und erlaubte Zeichen.
// Main (Prüfung, Speicherung in `userData`) und Renderer (Eintrag nur anbieten, wenn erlaubt) teilen sie.

export const MAX_USER_WORDS = 5000;
export const MAX_USER_WORD_LENGTH = 64;

/** Buchstaben, dazu Bindestrich und Apostroph im Wortinneren; keine Leerzeichen, Ziffern oder Steuerzeichen */
const USER_WORD_PATTERN = /^[\p{L}\p{M}](?:[\p{L}\p{M}'’-]*[\p{L}\p{M}])?$/u;

export function isValidUserWord(word: unknown): word is string {
    return typeof word === 'string' && word.length <= MAX_USER_WORD_LENGTH && USER_WORD_PATTERN.test(word);
}

/** Gültige Wörter in NFC, ohne Doppelte, in der gegebenen Reihenfolge, höchstens `MAX_USER_WORDS` */
export function normalizeUserWords(words: readonly unknown[]): string[] {
    const unique = new Set<string>();
    for (const word of words) {
        if (unique.size >= MAX_USER_WORDS) break;
        if (isValidUserWord(word)) unique.add(word.normalize('NFC'));
    }
    return [...unique];
}
