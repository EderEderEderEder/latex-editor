/**
 * Einträge bauen, filtern und sortieren (Vorlage: `CompletionItem.swift`, `CompletionMatcher`).
 * Reihenfolge: Anfang (Groß-/Kleinschreibung passend) vor Anfang (egal) vor Wortanfang vor irgendwo enthalten
 * vor Treffer nur im Zusatztext; dann kürzer vor länger, dann Codepunktreihenfolge.
 */
import type { CompletionItem, CompletionItemInit } from './types';

export const DEFAULT_RANK_LIMIT = 50;

const SCORE_EXACT_PREFIX = 0;
const SCORE_PREFIX_IGNORING_CASE = 1;
const SCORE_WORD_START = 2;
const SCORE_CONTAINED = 3;
const SCORE_EXTRA_TEXT = 4;

const WORD_SEPARATORS: ReadonlySet<string> = new Set([':', '-', '_', '/', '.', ' ']);
const FIRST_ARGUMENT = /[{[]/;
const UPPERCASE_START = /^\p{Uppercase}/u;
const LOWERCASE_START = /^\p{Lowercase}/u;
const COMBINING_MARK = /^\p{M}$/u;

export function createCompletionItem(init: CompletionItemInit): CompletionItem {
    return {
        kind: init.kind,
        text: init.text,
        detail: init.detail ?? '',
        insertion: init.insertion ?? init.text,
        cursorOffset: init.cursorOffset ?? null,
        searchKey: init.text.toLowerCase(),
        wordStarts: wordStarts(init.text),
        length: init.text.length,
        extraSearchText: (init.searchableExtra ?? '').toLowerCase(),
    };
}

/** Befehl mit Argument-Gerüst (`section` + `{}`); der Cursor steht im ersten `{` bzw. `[` */
export function commandItem(name: string, scaffold = '', detail = ''): CompletionItem {
    const firstArgument = scaffold.search(FIRST_ARGUMENT);
    const cursorOffset = firstArgument === -1 ? null : name.length + firstArgument + 1;
    return createCompletionItem({ kind: 'command', text: name, detail, insertion: name + scaffold, cursorOffset });
}

/**
 * UTF-16-Positionen, an denen ein Wort beginnt: nach `:` `-` `_` `/` `.` Leerzeichen oder ein Großbuchstabe
 * nach einem Kleinbuchstaben. Wie Swift über Zeichen statt Codepunkte: Kombinationszeichen gehören zum
 * Zeichen davor.
 */
export function wordStarts(text: string): Set<number> {
    const starts = new Set<number>();
    let previous: string | null = null;
    let offset = 0;
    for (const character of characters(text)) {
        if (previous !== null && startsWord(previous, character)) starts.add(offset);
        previous = character;
        offset += character.length;
    }
    return starts;
}

function characters(text: string): string[] {
    const result: string[] = [];
    for (const codePoint of text) {
        const last = result.length - 1;
        if (last >= 0 && COMBINING_MARK.test(codePoint)) result[last] += codePoint;
        else result.push(codePoint);
    }
    return result;
}

function startsWord(previous: string, character: string): boolean {
    if (WORD_SEPARATORS.has(previous)) return true;
    return UPPERCASE_START.test(character) && LOWERCASE_START.test(previous);
}

interface ScoredItem {
    readonly item: CompletionItem;
    readonly score: number;
}

/** Filtert und sortiert; ohne Präfix bleiben die ersten `limit` Einträge in ihrer Reihenfolge */
export function rankItems(items: readonly CompletionItem[], prefix: string, limit = DEFAULT_RANK_LIMIT): CompletionItem[] {
    if (prefix === '') return items.slice(0, limit);
    const lowered = prefix.toLowerCase();
    const scored: ScoredItem[] = [];
    for (const item of items) {
        const score = scoreItem(item, prefix, lowered);
        if (score !== null) scored.push({ item, score });
    }
    scored.sort(compareScored);
    return scored.slice(0, limit).map((entry) => entry.item);
}

/** Ein Durchlauf über die Fundstellen im kleingeschriebenen Text; null = kein Treffer */
function scoreItem(item: CompletionItem, prefix: string, lowered: string): number | null {
    if (item.text.startsWith(prefix)) return SCORE_EXACT_PREFIX;
    let best: number | null = null;
    for (let found = item.searchKey.indexOf(lowered); found !== -1; found = item.searchKey.indexOf(lowered, found + 1)) {
        if (found === 0) return SCORE_PREFIX_IGNORING_CASE;
        if (item.wordStarts.has(found)) return SCORE_WORD_START;
        best = SCORE_CONTAINED;
    }
    if (best === null && item.extraSearchText !== '' && item.extraSearchText.includes(lowered)) return SCORE_EXTRA_TEXT;
    return best;
}

function compareScored(left: ScoredItem, right: ScoredItem): number {
    if (left.score !== right.score) return left.score - right.score;
    if (left.item.length !== right.item.length) return left.item.length - right.item.length;
    return compareCodePoints(left.item.text, right.item.text);
}

/** Codepunktreihenfolge (nicht UTF-16: `Ａ` vor `😀`) */
function compareCodePoints(left: string, right: string): number {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index++) {
        const difference = (left.codePointAt(index) ?? 0) - (right.codePointAt(index) ?? 0);
        if (difference !== 0) return difference;
    }
    return left.length - right.length;
}
