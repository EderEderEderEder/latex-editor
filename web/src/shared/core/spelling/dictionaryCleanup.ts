// Umgehung eines nspell-Fehlers (Spike S8, `spikes/spell/src/dictionaryFix.ts`): nspell 2.1.5 legt gleich geschriebene
// Einträge zusammen und vereinigt ihre Flags. igerman98 führt viele Wörter doppelt, einmal normal und einmal als Teil von
// Zusammensetzungen mit ONLYINCOMPOUND (`gehen/DIVXW` und `gehen/Sozm`). Nach dem Zusammenlegen gilt `gehen` als „nur in
// Zusammensetzungen“ und wird abgelehnt (auch `stehen`, `prüfen`, `zählen`). nspell kann COMPOUNDBEGIN/-END ohnehin
// nicht (die Zerlegung macht `SpellChecker`), also werden diese Einträge vor dem Laden entfernt; Laden wird dadurch schneller.

const ONLY_IN_COMPOUND_PATTERN = /^ONLYINCOMPOUND\s+(\S+)/m;
const LINE_BREAK = '\n';
const FLAG_SEPARATOR = '/';
const WHITESPACE = /\s/;

export interface CleanedDictionary {
    readonly dictionary: string;
    readonly removedEntries: number;
}

function onlyInCompoundFlag(affix: string): string | null {
    return ONLY_IN_COMPOUND_PATTERN.exec(affix)?.[1] ?? null;
}

function flagsOf(line: string): string {
    const separator = line.indexOf(FLAG_SEPARATOR);
    if (separator < 0) return '';
    return line.slice(separator + 1).split(WHITESPACE)[0] ?? '';
}

/** `.dic` ohne Einträge mit ONLYINCOMPOUND-Flag; die erste Zeile (Anzahl) bleibt, nspell liest sie nicht genau */
export function withoutCompoundOnlyEntries(affix: string, dictionary: string): CleanedDictionary {
    const flag = onlyInCompoundFlag(affix);
    if (flag === null) return { dictionary, removedEntries: 0 };
    const [count = '', ...entries] = dictionary.split(LINE_BREAK);
    const kept = entries.filter((line) => !flagsOf(line).includes(flag));
    return { dictionary: [count, ...kept].join(LINE_BREAK), removedEntries: entries.length - kept.length };
}
