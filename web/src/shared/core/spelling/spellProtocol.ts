// Nachrichten zwischen Renderer (`app/spellClient.ts`) und Rechtschreib-Worker (`workers/spell.worker.ts`), W7-2.
// Text geht nur an den Worker im selben Renderer-Prozess, nie an den Main und nie ins Netz.
import type { SyntaxLanguage } from '../language';
import type { SpellStartState } from './wordScanner';

/** Wörterbuchdateien (`index.aff`, `index.dic`, UTF-8) als Bytes; der Renderer übergibt sie ohne Kopie */
export interface SpellLoadRequest {
    readonly kind: 'load';
    readonly affix: ArrayBuffer;
    readonly dictionary: ArrayBuffer;
}

/** Benutzerwörter und ignorierte Wörter der Sitzung (ersetzt die bisherigen) */
export interface SpellWordsRequest {
    readonly kind: 'words';
    readonly words: readonly string[];
}

/** Zeilen ab `offset` (absolut), Tokenizer-Zustand am Anfang `startState` */
export interface SpellCheckRequest {
    readonly kind: 'check';
    readonly id: number;
    readonly language: SyntaxLanguage;
    readonly text: string;
    readonly offset: number;
    readonly startState: SpellStartState;
}

export interface SpellSuggestRequest {
    readonly kind: 'suggest';
    readonly id: number;
    readonly word: string;
}

export type SpellRequest = SpellLoadRequest | SpellWordsRequest | SpellCheckRequest | SpellSuggestRequest;

/** Unbekanntes Wort: `[from, to)` absolut im Dokument */
export type SpellRange = readonly [from: number, to: number];

export type SpellResponse =
    | { readonly kind: 'ready'; readonly buildMs: number; readonly removedEntries: number }
    | { readonly kind: 'check'; readonly id: number; readonly errors: readonly SpellRange[]; readonly words: number }
    | { readonly kind: 'suggest'; readonly id: number; readonly suggestions: readonly string[] }
    /** `fatal`: Wörterbuch nicht ladbar, die Prüfung bleibt in dieser Sitzung aus; `id` fehlt bei `load` */
    | { readonly kind: 'failed'; readonly id: number | null; readonly message: string; readonly fatal: boolean };
