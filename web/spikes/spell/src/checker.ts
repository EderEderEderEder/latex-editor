// Prüfung eines Worts in Stufen (Wegwerfcode, Spike S8): Hunspell-Wörterbuch (nspell), Fachvokabular
// (`TechnicalVocabulary.accepts`, wie Swift `SpellingVocabulary`), eigene Zerlegung von Zusammensetzungen.
// Die eigene Zerlegung ist nötig, weil nspell 2.1.5 COMPOUNDBEGIN/-MIDDLE/-END nicht kann, das deutsche
// Wörterbuch (igerman98) Zusammensetzungen aber genau so beschreibt.
import type { TechnicalVocabulary } from '../../../src/shared/core/spelling/technicalVocabulary';

export interface Hunspell {
    correct(word: string): boolean;
    suggest(word: string): string[];
}

export type Verdict = 'dictionary' | 'vocabulary' | 'compound' | 'unknown';

export interface CheckOptions {
    readonly vocabulary: TechnicalVocabulary | null;
    readonly splitCompounds: boolean;
}

const MINIMUM_PART_LENGTH = 3;
const MAXIMUM_COMPOUND_PARTS = 4;
/** Fugenelemente (`Universität|s|bibliothek`, `Zeitschrift|en|aufsatz`) */
const LINKING_ELEMENTS = ['', 's', 'es', 'n', 'en', 'e', 'er'];
/** Verbstamm als Vorderteil (`Schreib|tisch` aus `schreiben`) */
const VERB_INFINITIVE_ENDING = 'en';
const CACHE_LIMIT = 50_000;

function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function isCapitalized(word: string): boolean {
    const first = word.charAt(0);
    return first !== first.toLowerCase();
}

export class SpellChecker {
    private readonly cache = new Map<string, boolean>();

    constructor(private readonly hunspell: Hunspell, private readonly options: CheckOptions) {}

    readonly isKnown = (word: string): boolean => {
        const cached = this.cache.get(word);
        if (cached !== undefined) return cached;
        if (this.cache.size >= CACHE_LIMIT) this.cache.clear();
        const known = this.hunspell.correct(word);
        this.cache.set(word, known);
        return known;
    };

    verdict(word: string, followedByDot = false): Verdict {
        if (this.isKnown(word) || (followedByDot && this.isKnown(`${word}.`))) return 'dictionary';
        if (this.options.vocabulary?.accepts(word, this.isKnown) === true) return 'vocabulary';
        if (this.options.splitCompounds && this.isCompound(word, 1)) return 'compound';
        return 'unknown';
    }

    private isCompound(word: string, parts: number): boolean {
        if (parts >= MAXIMUM_COMPOUND_PARTS || word.length < 2 * MINIMUM_PART_LENGTH) return false;
        const capitalized = isCapitalized(word);
        for (let split = MINIMUM_PART_LENGTH; split <= word.length - MINIMUM_PART_LENGTH; split++) {
            if (!this.isHead(word.slice(0, split))) continue;
            const rawTail = word.slice(split);
            const tail = capitalized ? capitalize(rawTail) : rawTail;
            if (this.isKnown(tail) || this.isCompound(tail, parts + 1)) return true;
        }
        return false;
    }

    /** Vorderteil: bekanntes Wort (groß oder klein), auch ohne Fugenelement, oder Verbstamm */
    private isHead(head: string): boolean {
        return LINKING_ELEMENTS.some((element) => {
            if (!head.endsWith(element) || head.length - element.length < MINIMUM_PART_LENGTH) return false;
            const stem = head.slice(0, head.length - element.length);
            return this.isKnownInAnyCase(stem) || this.isKnown(`${stem.toLowerCase()}${VERB_INFINITIVE_ENDING}`);
        });
    }

    private isKnownInAnyCase(part: string): boolean {
        return this.isKnown(capitalize(part)) || this.isKnown(part.toLowerCase());
    }
}
