/**
 * Groß-/Kleinschreibung im Fließtext: Satzanfang groß, „ZWei“ Großbuchstaben am Wortanfang. Port von
 * `Capitalization.swift` (dort ist die Wahrheit). Reine Logik auf UTF-16-Positionen; ob eine Stelle Fließtext ist
 * (keine Befehle, Mathe, Kommentare), prüft der Aufrufer.
 */
import {
    isLetterCharacter,
    isLowercaseCharacter,
    isUppercaseCharacter,
    splitGraphemes,
} from '../spelling/graphemes';
import { isMathEnvironment } from './environments';

/** Eine Ersetzung im Text (UTF-16-Bereich, Ende exklusiv) */
export interface TextCorrection {
    readonly start: number;
    readonly end: number;
    readonly replacement: string;
}

/** Abkürzungen (klein, ohne Punkt), nach deren Punkt kein neuer Satz beginnt */
export const SENTENCE_ABBREVIATIONS: ReadonlySet<string> = new Set([
    'bzw', 'vgl', 'ggf', 'usw', 'etc', 'abb', 'tab', 'kap', 'nr', 'ca', 'evtl', 'inkl', 'exkl', 'bspw', 'sog',
    'bzgl', 'insb', 'zzgl', 'mio', 'mrd', 'dr', 'prof', 'hr', 'fr', 'jh', 'jhd', 'bd', 'hrsg', 'aufl', 'ff', 'vs',
    'resp', 'al', 'zit', 'anm', 'abs', 'art', 'gem', 'lt', 'max', 'min', 'mind', 'orig', 'st', 'str', 'tel', 'ugs',
    'urspr', 'verf', 'vol', 'eg', 'ie', 'cf', 'fig', 'eq', 'sec', 'ch', 'pp', 'ed', 'eds', 'approx', 'no', 'dipl',
    'ing', 'mag', 'bsp',
]);

/** Bei Wörtern aus Großbuchstaben + „s“ (Mehrzahl von Abkürzungen: „IDs“, „PCs“) nichts ändern */
const PLURAL_SUFFIX = 's';
const MINIMUM_TWO_CAPITALS_LENGTH = 3;
/** Eine Leerzeile (zwei Zeilenumbrüche) beginnt einen neuen Absatz */
const PARAGRAPH_NEWLINES = 2;
const SINGLE_LETTER_LENGTH = 1;
const TWO_CAPITALS_PREFIX_LENGTH = 2;
const END_COMMAND = '\\end{';
const MAXIMUM_ENVIRONMENT_COMMAND_LENGTH = 40;
/** Satzende nach Klammer, Anführung oder Formel: „(siehe oben).“, „\enquote{so}.“, „$x$.“ */
const SENTENCE_CLOSERS = new Set([...')]}"\'$“”«»']);
const SENTENCE_ENDINGS = new Set(['.', '!', '?']);
const LETTER_OR_MARK = /^[\p{L}\p{M}]$/u;

/** Buchstabe im Sinn von `CharacterSet.letters` (Kategorien L und M); eine einzelne Surrogat-Einheit zählt nicht */
export function isLetterUnit(unit: string): boolean {
    return LETTER_OR_MARK.test(unit);
}

export function isWhitespaceUnit(unit: string): boolean {
    return unit === ' ' || unit === '\t' || unit === '\r' || unit === '\n';
}

/** „DIe“ → „Die“; `null`, wenn nichts zu tun ist (auch bei „IDs“, „API“, „LaTeX“) */
export function fixingTwoInitialCapitals(word: string): string | null {
    const characters = splitGraphemes(word);
    const [first = '', second = ''] = characters;
    if (characters.length < MINIMUM_TWO_CAPITALS_LENGTH || !isUppercaseCharacter(first) || !isUppercaseCharacter(second)) return null;
    const rest = characters.slice(TWO_CAPITALS_PREFIX_LENGTH);
    if (!rest.every((character) => isLetterCharacter(character) && isLowercaseCharacter(character))) return null;
    if (rest.join('') === PLURAL_SUFFIX) return null;
    return first + characters.slice(1).join('').toLowerCase();
}

export function isAllLowercase(word: string): boolean {
    if (word === '') return false;
    return splitGraphemes(word).every((character) => isLetterCharacter(character) && isLowercaseCharacter(character));
}

function capitalizeFirst(word: string): string {
    const [first = '', ...rest] = splitGraphemes(word);
    return first.toUpperCase() + rest.join('');
}

/** Buchstaben direkt vor `end`; davor steht Leerraum, eine öffnende Klammer oder der Textanfang */
export function wordRangeEndingAt(text: string, end: number): { readonly start: number; readonly end: number } | null {
    if (end <= 0 || end > text.length) return null;
    let start = end;
    while (start > 0 && isLetterUnit(text.charAt(start - 1))) start--;
    if (start >= end) return null;
    if (start > 0) {
        const before = text.charAt(start - 1);
        if (!isWhitespaceUnit(before) && before !== '(') return null;
    }
    return { start, end };
}

/** Korrektur für das Wort, das direkt vor `end` endet (gerade wurde ein Leerzeichen oder Satzzeichen getippt) */
export function correctionForWordEndingAt(text: string, end: number): TextCorrection | null {
    const range = wordRangeEndingAt(text, end);
    if (range === null) return null;
    const word = text.slice(range.start, range.end);
    const fixed = fixingTwoInitialCapitals(word);
    if (fixed !== null) return { ...range, replacement: fixed };
    if (!isAllLowercase(word) || !startsSentence(text, range.start)) return null;
    return { ...range, replacement: capitalizeFirst(word) };
}

/**
 * Beginnt bei `wordStart` ein Satz? Nach `.`, `!`, `?` (nicht nach Abkürzung, Zahl oder „…“) oder am Absatzanfang.
 * Nach einer abgesetzten Formel mit Leerzeile geht der Satz weiter, es sei denn, die Formel endet mit einem Satzzeichen.
 */
export function startsSentence(text: string, wordStart: number): boolean {
    let index = wordStart - 1;
    let newlines = 0;
    while (index >= 0) {
        const character = text.charAt(index);
        if (character === '\n') newlines++;
        else if (!isWhitespaceUnit(character)) break;
        index--;
    }
    if (newlines >= PARAGRAPH_NEWLINES) {
        const formulaStart = index >= 0 ? displayMathStart(text, index) : null;
        return formulaStart === null ? true : formulaEndsSentence(text, formulaStart);
    }
    if (index < 0) return false;
    const last = text.charAt(index);
    if (last === '!' || last === '?') return true;
    return last === '.' && isSentenceEndingPeriod(text, index);
}

/** Beginn der abgesetzten Formel (`\end{equation}`, `\]`, `$$`), die bei `last` endet; `null`, wenn dort keine endet */
function displayMathStart(text: string, last: number): number | null {
    const character = text.charAt(last);
    if (character === '}') return environmentStart(text, last);
    if (character === ']' && last > 0 && text.charAt(last - 1) === '\\') return last - 1;
    if (character === '$' && last > 0 && text.charAt(last - 1) === '$') return last - 1;
    return null;
}

/** Sucht `\end{` im Fenster der letzten Zeichen vor `last` (rückwärts); nur Mathe-Umgebungen zählen */
function environmentStart(text: string, last: number): number | null {
    const searchStart = Math.max(0, last - MAXIMUM_ENVIRONMENT_COMMAND_LENGTH);
    const latestStart = last - END_COMMAND.length;
    const found = latestStart < 0 ? -1 : text.lastIndexOf(END_COMMAND, latestStart);
    if (found < searchStart) return null;
    const name = text.slice(found + END_COMMAND.length, last);
    return isMathEnvironment(name) ? found : null;
}

function formulaEndsSentence(text: string, formulaStart: number): boolean {
    let index = formulaStart - 1;
    while (index >= 0 && isWhitespaceUnit(text.charAt(index))) index--;
    return index >= 0 && SENTENCE_ENDINGS.has(text.charAt(index));
}

function isSentenceEndingPeriod(text: string, period: number): boolean {
    if (period === 0) return false;
    const before = text.charAt(period - 1);
    if (before === '.') return false;
    let start = period;
    while (start > 0 && isLetterUnit(text.charAt(start - 1))) start--;
    const length = period - start;
    if (length === 0) return SENTENCE_CLOSERS.has(before);
    if (length === SINGLE_LETTER_LENGTH) return false;
    return !SENTENCE_ABBREVIATIONS.has(text.slice(start, period).toLowerCase());
}
