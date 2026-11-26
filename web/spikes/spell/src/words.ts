// Wörter aus LaTeX-Text mit Lage und der Angabe, ob sie in LaTeX-Syntax liegen (Wegwerfcode, Spike S8).
// Syntax wie in Swift (`EditorTextView.textView(_:didCheckTextIn:…)`): Treffer, die ein Token des Tokenizers
// überlappen (Befehl, Schlüssel-Argument, Mathe, Kommentar, Verbatim, optionales Argument), zählen nicht.
import {
    NORMAL_STATE,
    tokenizeLineWithOffset,
    type LexState,
    type SyntaxToken,
} from '../../../src/shared/core/latex/tokenizer';

export interface WordOccurrence {
    readonly word: string;
    readonly from: number;
    readonly to: number;
    /** Folgt direkt ein Punkt? Abkürzungen stehen im Wörterbuch mit Punkt (`bzw.`) */
    readonly followedByDot: boolean;
    readonly inSyntax: boolean;
}

const WORD_PATTERN = /\p{L}+/gu;
const MINIMUM_WORD_LENGTH = 2;
const LINE_BREAK = '\n';

function overlapsAny(tokens: readonly SyntaxToken[], from: number, to: number): boolean {
    return tokens.some((token) => token.location < to && token.location + token.length > from);
}

function wordsInLine(line: string, lineOffset: number, tokens: readonly SyntaxToken[]): WordOccurrence[] {
    const words: WordOccurrence[] = [];
    for (const match of line.matchAll(WORD_PATTERN)) {
        const word = match[0];
        if (word.length < MINIMUM_WORD_LENGTH) continue;
        const from = lineOffset + match.index;
        const to = from + word.length;
        const followedByDot = line[match.index + word.length] === '.';
        words.push({ word, from, to, followedByDot, inSyntax: overlapsAny(tokens, from, to) });
    }
    return words;
}

/** Alle Wörter ab `startOffset` (Lage absolut), Tokenizer-Zustand am Anfang `startState`. */
export function findWords(text: string, startOffset = 0, startState: LexState = NORMAL_STATE): WordOccurrence[] {
    const words: WordOccurrence[] = [];
    let state = startState;
    let offset = startOffset;
    for (const line of text.split(LINE_BREAK)) {
        const result = tokenizeLineWithOffset(line, offset, state);
        words.push(...wordsInLine(line, offset, result.tokens));
        state = result.state;
        offset += line.length + LINE_BREAK.length;
    }
    return words;
}
