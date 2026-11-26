// Autokorrektur der Großschreibung beim Tippen (W7-3, Vorbild: `LatexTextView.swift`, `Capitalization.swift`).
// Auslöser wie in Swift: Ein Wort ist fertig, wenn Leerzeichen, `, . ; : ! ?`, `)` oder Enter getippt wurde. Dann wird
// das Wort davor korrigiert: Satzanfang groß („aber“ → „Aber“) und „DIe“ → „Die“. Nur im Fließtext von LaTeX-Dateien
// (nicht in Kommentaren, Formeln, Befehlen, Code), nie bei Einfügen, Ersetzen einer Auswahl oder IME-Komposition.
//
// Die Korrektur ist eine eigene Transaktion kurz nach dem Tippen und ein eigener Undo-Schritt (`isolateHistory`):
// Strg+Z macht nur die Korrektur rückgängig, nicht das getippte Zeichen. Der Cursor bleibt, wo er ist.
import { isolateHistory } from '@codemirror/commands';
import { Transaction } from '@codemirror/state';
import type { Extension, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { languageFromPath } from '../../shared/core/language';
import { correctionForWordEndingAt } from '../../shared/core/latex/capitalization';
import type { TextCorrection } from '../../shared/core/latex/capitalization';
import { NORMAL_STATE, tokenizeLineWithOffset } from '../../shared/core/latex/tokenizer';
import type { LexState } from '../../shared/core/latex/tokenizer';
import { useSettingsStore } from '../stores/settings';
import type { FeatureContext } from './extensions';
import { isImeActive } from './typing';
import type { CommandTarget } from './typing';

/** Nach diesen Zeichen ist ein Wort fertig getippt (wie `wordTerminators` in Swift) */
const WORD_TERMINATORS: ReadonlySet<string> = new Set([' ', ',', '.', ';', ':', '!', '?', ')']);
const NEWLINE = '\n';
/** Reines Tippen; Enter kommt als `input.newline` (`typing.ts`) oder, vom CodeMirror-Standardbefehl, als `input` */
const TYPED_EVENT = 'input.type';
const NEWLINE_EVENTS: ReadonlySet<string> = new Set(['input.newline', 'input']);
/** `userEvent` der Korrektur selbst (löst keine neue Korrektur aus) */
export const AUTOCORRECT_EVENT = 'input.autocorrect';
/** So viel Text vor dem Wort genügt, um Satzanfang, Abkürzung und abgesetzte Formel zu erkennen */
const LOOKBACK_CHARS = 1_000;

// ---------- Auslöser ----------

function userEventOf(tr: Transaction): string | undefined {
    return tr.annotation(Transaction.userEvent);
}

interface Insertion {
    readonly position: number;
    readonly text: Text;
}

/** Die eine reine Einfügung der Transaktion (kein Ersetzen einer Auswahl); `null` bei mehreren oder anderen Änderungen */
function singleInsertion(tr: Transaction): Insertion | null {
    let count = 0;
    let insertion: Insertion | null = null;
    tr.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
        count += 1;
        if (fromA === toA) insertion = { position: fromB, text: inserted };
    });
    return count === 1 ? insertion : null;
}

function endsWord(event: string, inserted: Text): boolean {
    if (event === TYPED_EVENT) return inserted.length === 1 && WORD_TERMINATORS.has(inserted.sliceString(0));
    return NEWLINE_EVENTS.has(event) && inserted.sliceString(0, 1) === NEWLINE;
}

/** Position, an der in dieser Transaktion ein Wort geendet hat (Anfang des getippten Zeichens), sonst `null` */
export function wordEndOf(tr: Transaction): number | null {
    const event = userEventOf(tr);
    if (!tr.docChanged || event === undefined) return null;
    const insertion = singleInsertion(tr);
    if (insertion === null || !endsWord(event, insertion.text)) return null;
    return insertion.position;
}

// ---------- Korrektur ----------

/**
 * Liegt die Stelle im Fließtext? Der Zustand am Zeilenanfang folgt aus allen Zeilen davor (Formeln und Code laufen über
 * Zeilen); das ist linear im Text und darum nur für die seltene Prüfung eines echten Korrekturfalls gedacht.
 */
export function isProseRange(doc: Text, start: number, end: number): boolean {
    const target = doc.lineAt(start);
    let state: LexState = NORMAL_STATE;
    for (let number = 1; number < target.number; number++) {
        state = tokenizeLineWithOffset(doc.line(number).text, 0, state).state;
    }
    const { tokens } = tokenizeLineWithOffset(target.text, target.from, state);
    return !tokens.some((token) => token.location < end && token.location + token.length > start);
}

/**
 * Korrektur für das Wort, das bei `wordEnd` endet; dort muss noch das Zeichen stehen, das es beendet hat (bis dahin kann
 * weitergetippt worden sein).
 */
export function autoCorrectionAt(doc: Text, wordEnd: number): TextCorrection | null {
    if (wordEnd >= doc.length) return null;
    const next = doc.sliceString(wordEnd, wordEnd + 1);
    if (next !== NEWLINE && !WORD_TERMINATORS.has(next)) return null;
    const windowStart = Math.max(0, wordEnd - LOOKBACK_CHARS);
    const local = correctionForWordEndingAt(doc.sliceString(windowStart, wordEnd), wordEnd - windowStart);
    if (local === null) return null;
    const correction = { ...local, start: local.start + windowStart, end: local.end + windowStart };
    return isProseRange(doc, correction.start, correction.end) ? correction : null;
}

/**
 * Wendet die Korrektur als eigene Transaktion an, wenn der Text seit dem Tippen unverändert ist (`doc` ist derselbe)
 * und keine IME-Komposition läuft. Liefert, ob korrigiert wurde.
 */
export function correctWordEndingAt(target: CommandTarget, doc: Text, wordEnd: number): boolean {
    if (target.state.doc !== doc || target.state.readOnly || isImeActive(target)) return false;
    const correction = autoCorrectionAt(doc, wordEnd);
    if (correction === null) return false;
    target.dispatch(target.state.update({
        changes: { from: correction.start, to: correction.end, insert: correction.replacement },
        userEvent: AUTOCORRECT_EVENT,
        annotations: isolateHistory.of('full'),
    }));
    return true;
}

// ---------- Anbindung ----------

export interface AutoCapitalizeDeps {
    /** Schalter `autoCapitalize` (Standard an wie Swift) */
    isEnabled(): boolean;
    /**
     * Führt die Korrektur nach dem laufenden Update aus: Aus einem Update-Hörer darf nicht gesendet werden, und die
     * getippte Änderung muss ein eigener Verlaufsschritt bleiben. Standard: Mikroaufgabe, also vor der nächsten Taste.
     */
    schedule(task: () => void): void;
}

const appDeps: AutoCapitalizeDeps = {
    isEnabled: () => useSettingsStore.getState().values.autoCapitalize,
    schedule: (task) => queueMicrotask(task),
};

/** Beobachtet die Transaktionen eines Views und plant bei Bedarf die Korrektur; ohne DOM testbar */
export function observeTyping(transactions: readonly Transaction[], target: CommandTarget, deps: AutoCapitalizeDeps): void {
    const [only] = transactions;
    if (transactions.length !== 1 || only === undefined) return;
    const wordEnd = wordEndOf(only);
    if (wordEnd === null || !deps.isEnabled()) return;
    const doc = only.newDoc;
    deps.schedule(() => void correctWordEndingAt(target, doc, wordEnd));
}

/** Haken aus `extensions.ts`; nur für LaTeX-Dateien (in `.bib` sind Titel absichtlich so geschrieben, wie sie sind) */
export function autoCapitalizeExtension(context: FeatureContext, deps: AutoCapitalizeDeps = appDeps): Extension {
    if (languageFromPath(context.name ?? context.path) !== 'latex') return [];
    return EditorView.updateListener.of((update) => observeTyping(update.transactions, update.view, deps));
}
