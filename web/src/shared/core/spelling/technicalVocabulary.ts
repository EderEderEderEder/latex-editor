/**
 * Fachwörter aus Mathematik, Informatik, Physik und angrenzenden Gebieten, die die Rechtschreibprüfung nicht kennt.
 * Die Prüfung selbst bleibt die des Systems oder Wörterbuchs; der Editor lässt nur Treffer fallen, die dieses Vokabular
 * erklärt. Port von `TechnicalVocabulary.swift` (dort ist die Wahrheit).
 *
 * Gespeichert sind Grundformen (`technicalWords.json`, aus `TechnicalWords*.swift` übernommen, Duplikate wie dort
 * belassen; Mengen entstehen in Kleinschreibung). `accepts` erkennt dazu:
 * - gebeugte Formen (Mehrzahl, Genitiv, Steigerung, Verbformen),
 * - Zusammensetzungen aus mehreren bekannten Teilen: Teile des Vokabulars oder Wörter, die die Systemprüfung selbst
 *   kennt (`Matrixberechnung`, `Eigenwertproblem`, `Quantenfouriertransformation`).
 * Längen zählen Grapheme (wie Swifts `String.count`). Reine Logik, ohne DOM und ohne Node-Importe.
 */
import technicalWords from './technicalWords.json';
import { graphemeCount, splitGraphemes } from './graphemes';

export interface TechnicalWordLists {
    readonly nouns: readonly string[];
    readonly adjectives: readonly string[];
    /** Wortstämme ohne `en`: `optimier` für `optimieren` */
    readonly verbs: readonly string[];
    readonly names: readonly string[];
}

/** Fragt die Systemprüfung nach einem ganzen Wort (Teile von Zusammensetzungen, die nicht im Vokabular stehen) */
export type IsKnownWord = (word: string) => boolean;

const MINIMUM_WORD_LENGTH = 4;
/** Jeder Teil einer Zusammensetzung hat mindestens so viele Buchstaben (sonst passte fast alles zusammen) */
const MINIMUM_PART_LENGTH = 3;
const MAXIMUM_COMPOUND_PARTS = 4;

const NOUN_ENDINGS = ['', 'e', 'en', 'n', 's', 'es', 'er', 'ern', 'ens', 'se', 'sen'];
const ADJECTIVE_ENDINGS = ['', 'e', 'en', 'er', 'es', 'em', 'keit', 'keiten', 'heit', 'heiten', 'lich', 'erweise', 'weise'];
const VERB_ENDINGS = ['', 'e', 'en', 'est', 'st', 't', 'et', 'te', 'ten', 'tet', 'end', 'ung', 'ungen', 'bar', 'er', 'ern', 'erung'];
const NAME_ENDINGS = ['', 's', 'sche', 'schen', 'scher', 'sches', 'schem', 'ian', 'ianer'];
/** Fugenelemente zwischen den Teilen einer Zusammensetzung (`Zufall|s|variable`, `Quant|en|computer`) */
const LINKING_ELEMENTS = ['', 's', 'n', 'en', 'e', 'es', 'er', 'ens'];

type Graphemes = readonly string[];

function endsWith(units: Graphemes, ending: string): boolean {
    const length = ending.length;
    return units.length >= length && units.slice(units.length - length).join('') === ending;
}

/** Wie Swifts `capitalized` für ein Wort: erster Buchstabe groß, Rest klein */
function capitalized(word: string): string {
    const [first = '', ...rest] = splitGraphemes(word);
    return first.toUpperCase() + rest.join('').toLowerCase();
}

/** Teile ohne Fugenelement: für jedes passende Fugenelement der Kopf ohne dieses */
function withoutLinkingElement(head: Graphemes): string[] {
    const candidates: string[] = [];
    for (const element of LINKING_ELEMENTS) {
        if (!endsWith(head, element) || head.length - element.length < MINIMUM_PART_LENGTH) continue;
        candidates.push(head.slice(0, head.length - element.length).join(''));
    }
    return candidates;
}

export class TechnicalVocabulary {
    private readonly nouns: ReadonlySet<string>;
    private readonly adjectives: ReadonlySet<string>;
    private readonly verbs: ReadonlySet<string>;
    private readonly names: ReadonlySet<string>;

    constructor(lists: TechnicalWordLists) {
        this.nouns = lowercased(lists.nouns);
        this.adjectives = lowercased(lists.adjectives);
        this.verbs = lowercased(lists.verbs);
        this.names = lowercased(lists.names);
    }

    /** Summe der Größen der vier Mengen (nach Kleinschreibung und Duplikatentfernung) */
    get wordCount(): number {
        return this.nouns.size + this.adjectives.size + this.verbs.size + this.names.size;
    }

    /** Erklärt das Vokabular dieses Wort? `isKnown` fragt die Systemprüfung (ohne Systemprüfung: nichts ist bekannt). */
    accepts(word: string, isKnown: IsKnownWord = () => false): boolean {
        const units = splitGraphemes(word.toLowerCase());
        if (units.length < MINIMUM_WORD_LENGTH) return false;
        return this.isInflectedEntry(units) || this.isCompound(units, 1, isKnown);
    }

    // MARK: Einzelwörter

    private isInflectedEntry(units: Graphemes): boolean {
        return matches(units, this.nouns, NOUN_ENDINGS)
            || matches(units, this.adjectives, ADJECTIVE_ENDINGS)
            || matches(units, this.verbs, VERB_ENDINGS)
            || matches(units, this.names, NAME_ENDINGS);
    }

    // MARK: Zusammensetzungen

    /**
     * Zerlegt in Teile: vorne ein Vokabelwort (mit Fugenelement) und hinten ein gebeugtes Vokabelwort, ein vom System
     * bekanntes Wort oder wieder eine Zusammensetzung – oder vorne ein vom System bekanntes Wort und hinten ein
     * Vokabelwort.
     */
    private isCompound(units: Graphemes, parts: number, isKnown: IsKnownWord): boolean {
        const length = units.length;
        if (parts >= MAXIMUM_COMPOUND_PARTS || length < 2 * MINIMUM_PART_LENGTH) return false;
        for (let split = MINIMUM_PART_LENGTH; split <= length - MINIMUM_PART_LENGTH; split++) {
            const head = units.slice(0, split);
            const tail = units.slice(split);
            if (this.isVocabularyPrefix(head) && this.isRemainder(tail, parts, isKnown)) return true;
            if (this.isInflectedEntry(tail) && this.isKnownPrefix(head, isKnown)) return true;
        }
        return false;
    }

    private isRemainder(tail: Graphemes, parts: number, isKnown: IsKnownWord): boolean {
        return this.isInflectedEntry(tail) || isKnownByChecker(tail.join(''), isKnown) || this.isCompound(tail, parts + 1, isKnown);
    }

    /** Vorderer Teil aus dem Vokabular, mit oder ohne Fugenelement (`Zufalls`, `Quanten`) */
    private isVocabularyPrefix(head: Graphemes): boolean {
        return withoutLinkingElement(head).some(
            (candidate) => this.nouns.has(candidate) || this.adjectives.has(candidate) || this.names.has(candidate),
        );
    }

    /** Vorderer Teil, den die Systemprüfung kennt (dann ohne Fugenelement, großgeschrieben) */
    private isKnownPrefix(head: Graphemes, isKnown: IsKnownWord): boolean {
        return withoutLinkingElement(head).some((candidate) => isKnownByChecker(candidate, isKnown));
    }
}

function lowercased(words: readonly string[]): ReadonlySet<string> {
    return new Set(words.map((word) => word.toLowerCase()));
}

function matches(units: Graphemes, entries: ReadonlySet<string>, endings: readonly string[]): boolean {
    return endings.some((ending) => {
        if (!endsWith(units, ending) || units.length - ending.length < MINIMUM_PART_LENGTH) return false;
        return entries.has(units.slice(0, units.length - ending.length).join(''));
    });
}

function isKnownByChecker(part: string, isKnown: IsKnownWord): boolean {
    if (graphemeCount(part) < MINIMUM_PART_LENGTH) return false;
    return isKnown(capitalized(part)) || isKnown(part);
}

let standardVocabulary: TechnicalVocabulary | undefined;

/** Das mitgelieferte Vokabular (`technicalWords.json`), beim ersten Zugriff aufgebaut */
export function getStandardVocabulary(): TechnicalVocabulary {
    standardVocabulary ??= new TechnicalVocabulary(technicalWords);
    return standardVocabulary;
}
