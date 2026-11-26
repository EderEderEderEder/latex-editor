// Umgehung für einen nspell-Fehler (gemessen in Spike S8): nspell legt gleich geschriebene Einträge zusammen und
// vereinigt ihre Flags. igerman98 führt viele Wörter doppelt, einmal normal und einmal als Teil von Zusammensetzungen
// mit ONLYINCOMPOUND (`gehen/DIVXW` und `gehen/Sozm`). Nach dem Zusammenlegen gilt `gehen` als „nur in
// Zusammensetzungen“ und wird abgelehnt. Da nspell ohnehin keine COMPOUNDBEGIN/-END-Regeln kann, sind diese
// Einträge für nspell nutzlos: sie werden vor dem Laden entfernt.

const AFFIX_FLAG_PATTERN = /^ONLYINCOMPOUND\s+(\S)/m;
const LINE_BREAK = '\n';
const FLAG_SEPARATOR = '/';

function onlyInCompoundFlag(aff: string): string | null {
    return AFFIX_FLAG_PATTERN.exec(aff)?.[1] ?? null;
}

function flagsOf(line: string): string {
    const separator = line.indexOf(FLAG_SEPARATOR);
    if (separator < 0) return '';
    return line.slice(separator + 1).split(/\s/)[0] ?? '';
}

/** `.dic` ohne Einträge mit ONLYINCOMPOUND-Flag; erste Zeile (Anzahl) bleibt stehen, nspell liest sie nicht genau */
export function withoutCompoundOnlyEntries(aff: string, dic: string): { dic: string; removed: number } {
    const flag = onlyInCompoundFlag(aff);
    if (flag === null) return { dic, removed: 0 };
    const [count = '', ...entries] = dic.split(LINE_BREAK);
    const kept = entries.filter((line) => !flagsOf(line).includes(flag));
    return { dic: [count, ...kept].join(LINE_BREAK), removed: entries.length - kept.length };
}
