const BACKSLASH = 0x5c;
const ASCII_LIMIT = 0x80;
const BMP_LIMIT = 0xffff;
const CODE_0 = 0x30;
const CODE_9 = 0x39;
const CODE_UPPER_A = 0x41;
const CODE_UPPER_Z = 0x5a;
const CODE_LOWER_A = 0x61;
const CODE_LOWER_Z = 0x7a;
const CODE_TAB = 0x09;
const CODE_CARRIAGE_RETURN = 0x0d;
const CODE_SPACE = 0x20;

const ALPHABETIC = /^\p{Alphabetic}$/u;
const NON_ASCII_WORD = /^[\p{Mn}\p{Mc}\p{Me}\p{Nd}\p{Alphabetic}]$/u;
const WHITE_SPACE = /^\p{White_Space}$/u;

type CodePointTest = (codePoint: number) => boolean;

function isAsciiLetter(codePoint: number): boolean {
    return (codePoint >= CODE_LOWER_A && codePoint <= CODE_LOWER_Z) || (codePoint >= CODE_UPPER_A && codePoint <= CODE_UPPER_Z);
}

function isAlphabetic(codePoint: number): boolean {
    if (codePoint < ASCII_LIMIT) return isAsciiLetter(codePoint);
    return ALPHABETIC.test(String.fromCodePoint(codePoint));
}

/** Wortzeichen: ASCII-Buchstaben und Ziffern; sonst Markierungen (Mn, Mc, Me), Dezimalziffern (Nd) und Alphabetic */
function isWordCharacter(codePoint: number): boolean {
    if (codePoint < ASCII_LIMIT) return isAsciiLetter(codePoint) || (codePoint >= CODE_0 && codePoint <= CODE_9);
    return NON_ASCII_WORD.test(String.fromCodePoint(codePoint));
}

function isWhiteSpace(codePoint: number): boolean {
    if (codePoint < ASCII_LIMIT) return codePoint === CODE_SPACE || (codePoint >= CODE_TAB && codePoint <= CODE_CARRIAGE_RETURN);
    return WHITE_SPACE.test(String.fromCodePoint(codePoint));
}

function codePointAt(text: string, index: number): number {
    return text.codePointAt(index) ?? 0;
}

function unitWidth(codePoint: number): number {
    return codePoint > BMP_LIMIT ? 2 : 1;
}

/** Welche Folgezeichen zum Token gehören; `null`: das erste Zeichen ist ein Token für sich */
function continuationTest(first: number): CodePointTest | null {
    if (first === BACKSLASH) return isAlphabetic;
    if (isWordCharacter(first)) return isWordCharacter;
    if (isWhiteSpace(first)) return isWhiteSpace;
    return null;
}

function tokenEnd(text: string, start: number): number {
    const first = codePointAt(text, start);
    let index = start + unitWidth(first);
    const belongsToToken = continuationTest(first);
    if (belongsToToken === null) return index;
    while (index < text.length) {
        const codePoint = codePointAt(text, index);
        if (!belongsToToken(codePoint)) break;
        index += unitWidth(codePoint);
    }
    return index;
}

/**
 * Wörter (Buchstaben und Ziffern), LaTeX-Befehle (`\section`), Leerraum und einzelne Satzzeichen. Arbeitet über
 * Unicode-Codepoints; kombinierende Zeichen gehören zum Wort. Die Tokens ergeben zusammengesetzt wieder den Text.
 */
export function tokenize(text: string): string[] {
    const tokens: string[] = [];
    let index = 0;
    while (index < text.length) {
        const end = tokenEnd(text, index);
        tokens.push(text.slice(index, end));
        index = end;
    }
    return tokens;
}

/** Länge in Unicode-Codepoints (nicht UTF-16-Einheiten, nicht Grapheme) */
export function codePointLength(text: string): number {
    let length = 0;
    for (let index = 0; index < text.length; index += unitWidth(codePointAt(text, index))) length += 1;
    return length;
}
