// Arbeit des Rechtschreib-Workers ohne Worker-Hülle (W7-2): Wörterbuch bereinigen und laden, Text prüfen, Vorschläge.
// Die Hunspell-Fabrik (nspell) kommt von außen, damit dieses Modul ohne Abhängigkeit und in Vitest prüfbar bleibt.
import { withoutCompoundOnlyEntries } from './dictionaryCleanup';
import type { SpellCheckRequest, SpellRange, SpellRequest, SpellResponse } from './spellProtocol';
import { SpellChecker } from './spellChecker';
import type { Hunspell } from './spellChecker';
import { getStandardVocabulary } from './technicalVocabulary';
import type { TechnicalVocabulary } from './technicalVocabulary';
import { scanSpellCandidates } from './wordScanner';
import type { SpellCandidate } from './wordScanner';

export type HunspellFactory = (affix: string, dictionary: string) => Hunspell;

export const SPELL_SERVICE_TEXTS = {
    notLoaded: 'Wörterbuch noch nicht geladen',
    loadFailed: (detail: string) => `Wörterbuch nicht ladbar: ${detail}`,
} as const;

export interface CheckResult {
    readonly errors: SpellRange[];
    /** Geprüfte Wortteile (für Messungen) */
    readonly words: number;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function unknownParts(checker: SpellChecker, candidate: SpellCandidate): SpellRange[] {
    if (candidate.hyphenated && checker.isKnown(candidate.text)) return [];
    const single = candidate.parts.length === 1 && !candidate.hyphenated;
    return candidate.parts
        .filter((part) => !checker.isCorrect(part.word, single && candidate.followedByDot))
        .map((part) => [part.from, part.to] as const);
}

/** Unbekannte Wörter im Text der Anfrage (Lage absolut) */
export function checkText(checker: SpellChecker, request: Omit<SpellCheckRequest, 'kind' | 'id'>): CheckResult {
    const candidates = scanSpellCandidates(request.text, {
        language: request.language, offset: request.offset, startState: request.startState,
    });
    const errors: SpellRange[] = [];
    let words = 0;
    for (const candidate of candidates) {
        words += candidate.parts.length;
        errors.push(...unknownParts(checker, candidate));
    }
    return { errors, words };
}

export class SpellService {
    private checker: SpellChecker | null = null;
    private words: readonly string[] = [];

    constructor(
        private readonly createHunspell: HunspellFactory,
        private readonly vocabulary: TechnicalVocabulary = getStandardVocabulary(),
    ) {}

    /** Bearbeitet eine Anfrage; `null`: keine Antwort nötig */
    handle(request: SpellRequest): SpellResponse | null {
        switch (request.kind) {
            case 'load': return this.load(request.affix, request.dictionary);
            case 'words': return this.setWords(request.words);
            case 'check': return this.check(request);
            case 'suggest': return this.suggest(request.id, request.word);
        }
    }

    private load(affixBytes: ArrayBuffer, dictionaryBytes: ArrayBuffer): SpellResponse {
        const start = performance.now();
        try {
            const decoder = new TextDecoder();
            const affix = decoder.decode(affixBytes);
            const cleaned = withoutCompoundOnlyEntries(affix, decoder.decode(dictionaryBytes));
            this.checker = new SpellChecker(this.createHunspell(affix, cleaned.dictionary), this.vocabulary);
            this.checker.setExtraWords(this.words);
            return { kind: 'ready', buildMs: performance.now() - start, removedEntries: cleaned.removedEntries };
        } catch (error) {
            return { kind: 'failed', id: null, message: SPELL_SERVICE_TEXTS.loadFailed(describeError(error)), fatal: true };
        }
    }

    private setWords(words: readonly string[]): null {
        this.words = [...words];
        this.checker?.setExtraWords(this.words);
        return null;
    }

    private check(request: SpellCheckRequest): SpellResponse {
        if (this.checker === null) return this.notLoaded(request.id);
        const { errors, words } = checkText(this.checker, request);
        return { kind: 'check', id: request.id, errors, words };
    }

    private suggest(id: number, word: string): SpellResponse {
        if (this.checker === null) return this.notLoaded(id);
        return { kind: 'suggest', id, suggestions: this.checker.suggest(word) };
    }

    private notLoaded(id: number): SpellResponse {
        return { kind: 'failed', id, message: SPELL_SERVICE_TEXTS.notLoaded, fatal: false };
    }
}
