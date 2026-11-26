// Prüfung eines Worts in Stufen (W7-2, nach Spike S8 `checker.ts`): Hunspell-Wörterbuch (nspell) samt Benutzerwörtern,
// Fachvokabular (`TechnicalVocabulary.accepts`, wie Swift `SpellingVocabulary`) und eigene Zerlegung von
// Zusammensetzungen. Die Zerlegung ist nötig, weil nspell 2.1.5 COMPOUNDBEGIN/-MIDDLE/-END nicht kann, das deutsche
// Wörterbuch (igerman98) Zusammensetzungen aber genau so beschreibt (Spike: 0 von 30 ohne, 30 von 30 mit Zerlegung).
import type { TechnicalVocabulary } from './technicalVocabulary';

/** Der Teil von nspell, den die Prüfung braucht (Tests können eine Fälschung nehmen) */
export interface Hunspell {
    correct(word: string): boolean;
    suggest(word: string): string[];
}

export type Verdict = 'dictionary' | 'vocabulary' | 'compound' | 'unknown';

/** Höchstens so viele Vorschläge im Kontextmenü */
export const MAX_SUGGESTIONS = 6;

const MINIMUM_PART_LENGTH = 3;
const MAXIMUM_COMPOUND_PARTS = 4;
/** Fugenelemente (`Universität|s|bibliothek`, `Zeitschrift|en|aufsatz`) */
const LINKING_ELEMENTS = ['', 's', 'es', 'n', 'en', 'e', 'er'];
/** Verbstamm als Vorderteil (`Schreib|tisch` aus `schreiben`) */
const VERB_INFINITIVE_ENDING = 'en';
const CACHE_LIMIT = 50_000;
const DOT = '.';

function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function isCapitalized(word: string): boolean {
    const first = word.charAt(0);
    return first !== first.toLowerCase();
}

function decapitalize(word: string): string {
    return word.charAt(0).toLowerCase() + word.slice(1);
}

function remember<V>(cache: Map<string, V>, key: string, value: V): V {
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, value);
    return value;
}

export class SpellChecker {
    private readonly dictionaryCache = new Map<string, boolean>();
    private readonly verdictCache = new Map<string, boolean>();
    private extraWords: ReadonlySet<string> = new Set();

    constructor(
        private readonly hunspell: Hunspell,
        private readonly vocabulary: TechnicalVocabulary | null,
    ) {}

    /** Benutzerwörter und in dieser Sitzung ignorierte Wörter (ersetzt die bisherigen) */
    setExtraWords(words: Iterable<string>): void {
        this.extraWords = new Set([...words].map((word) => word.normalize('NFC')));
        this.verdictCache.clear();
    }

    /** Wörterbuch oder Zusatzwort; am Satzanfang gilt auch die großgeschriebene Form eines kleinen Zusatzworts */
    readonly isKnown = (word: string): boolean => this.isExtraWord(word) || this.isInDictionary(word);

    /** Gilt das Wort als richtig (Wörterbuch, Vokabular oder Zusammensetzung)? Mit Zwischenspeicher */
    isCorrect(rawWord: string, followedByDot = false): boolean {
        const word = rawWord.normalize('NFC');
        const key = followedByDot ? word + DOT : word;
        const cached = this.verdictCache.get(key);
        if (cached !== undefined) return cached;
        return remember(this.verdictCache, key, this.verdict(word, followedByDot) !== 'unknown');
    }

    verdict(word: string, followedByDot = false): Verdict {
        if (this.isKnown(word) || (followedByDot && this.isInDictionary(word + DOT))) return 'dictionary';
        if (this.vocabulary?.accepts(word, this.isKnown) === true) return 'vocabulary';
        if (this.isCompound(word, 1)) return 'compound';
        return 'unknown';
    }

    /** Vorschläge von nspell (teuer: 3–66 ms, nur auf Anforderung) */
    suggest(word: string): string[] {
        const normalized = word.normalize('NFC');
        return this.hunspell.suggest(normalized).filter((entry) => entry !== normalized).slice(0, MAX_SUGGESTIONS);
    }

    private isExtraWord(word: string): boolean {
        return this.extraWords.has(word) || (isCapitalized(word) && this.extraWords.has(decapitalize(word)));
    }

    private isInDictionary(word: string): boolean {
        const cached = this.dictionaryCache.get(word);
        if (cached !== undefined) return cached;
        return remember(this.dictionaryCache, word, this.hunspell.correct(word));
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

    /** Vorderteil: bekanntes Wort (groß oder klein), auch mit Fugenelement, oder Verbstamm */
    private isHead(head: string): boolean {
        return LINKING_ELEMENTS.some((element) => {
            if (!head.endsWith(element) || head.length - element.length < MINIMUM_PART_LENGTH) return false;
            const stem = head.slice(0, head.length - element.length);
            return this.isKnown(capitalize(stem)) || this.isKnown(stem.toLowerCase())
                || this.isKnown(stem.toLowerCase() + VERB_INFINITIVE_ENDING);
        });
    }
}
