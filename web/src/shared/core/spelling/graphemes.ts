/**
 * Zeichenebene wie Swifts `Character`: Grapheme (Zeichen aus Basiszeichen und Zusatzzeichen) statt UTF-16-Einheiten
 * oder Codepoints. Die Groß-/Kleinregeln folgen den Ergebnissen von `Character.isUppercase/isLowercase/isLetter`.
 * Reine Logik, ohne DOM und ohne Node-Importe.
 */

/** Unter diesem Wert bildet jede UTF-16-Einheit ein eigenes Grapheme (Ausnahme: CR LF) */
const SIMPLE_CODE_LIMIT = 0x300;
const CARRIAGE_RETURN = 0x0d;
const CASED_START = /^[\p{Lowercase}\p{Uppercase}]/u;
const ALPHABETIC_START = /^\p{Alphabetic}/u;

let segmenter: Intl.Segmenter | undefined;

function isSimple(text: string): boolean {
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        if (code >= SIMPLE_CODE_LIMIT || code === CARRIAGE_RETURN) return false;
    }
    return true;
}

/** Zerlegt in Grapheme (Zeichen im Sinn von Swift); der Normalfall (Wörter ohne Zusatzzeichen) braucht keinen Segmentierer */
export function splitGraphemes(text: string): string[] {
    if (isSimple(text)) return text.split('');
    segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (part) => part.segment);
}

/** Anzahl Grapheme (Swift: `String.count`) */
export function graphemeCount(text: string): number {
    return isSimple(text) ? text.length : splitGraphemes(text).length;
}

/** Wie `Character.isLetter`: das erste Unicode-Zeichen ist alphabetisch */
export function isLetterCharacter(character: string): boolean {
    return ALPHABETIC_START.test(character);
}

/** Wie `Character.isUppercase`: ändert sich beim Kleinschreiben, nicht beim Großschreiben (uneindeutige Zeichen mit Groß- und Kleinschreibung-Eigenschaft zählen für beides) */
export function isUppercaseCharacter(character: string): boolean {
    const changesToLower = character !== character.toLowerCase();
    const changesToUpper = character !== character.toUpperCase();
    return (changesToLower && !changesToUpper) || (!changesToLower && !changesToUpper && CASED_START.test(character));
}

/** Wie `Character.isLowercase` */
export function isLowercaseCharacter(character: string): boolean {
    const changesToLower = character !== character.toLowerCase();
    const changesToUpper = character !== character.toUpperCase();
    return (!changesToLower && changesToUpper) || (!changesToLower && !changesToUpper && CASED_START.test(character));
}
