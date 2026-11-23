// Zeilenzustands-Cache für die Einfärbung (W1-4, nach Spike S1 und `SyntaxHighlighter.swift`).
// Gespeichert wird der Tokenizer-Zustand am Ende jeder Zeile; der Zustand am Zeilenanfang ist der Endzustand der
// Vorzeile. Nach einer Bearbeitung wird ab der ersten geänderten Zeile neu tokenisiert, bis der neue Endzustand
// mit dem alten (verschobenen) übereinstimmt: dann ist der Rest unverändert. DOM-frei, in Vitest ohne Fenster prüfbar.
import type { ChangeSet, Text } from '@codemirror/state';
import { INITIAL_BIB_STATE, bibStatesEqual, tokenizeBibLine } from '../../shared/core/bib/tokenizer';
import type { BibLexState } from '../../shared/core/bib/tokenizer';
import type { SyntaxLanguage } from '../../shared/core/language';
import { NORMAL_STATE, statesEqual, tokenizeLine } from '../../shared/core/latex/tokenizer';
import type { LexState, TokenKind } from '../../shared/core/latex/tokenizer';

/** Token relativ zum Zeilenanfang (UTF-16), `to` exklusiv */
export interface HighlightToken {
    readonly kind: TokenKind;
    readonly from: number;
    readonly to: number;
}

export interface LineResult<State> {
    readonly tokens: readonly HighlightToken[];
    readonly state: State;
}

/** Zeilen-Tokenizer einer Sprache: Anfangszustand, Wertgleichheit der Zustände, eine Zeile zerlegen */
export interface LineSyntax<State> {
    readonly initialState: State;
    statesEqual(first: State, second: State): boolean;
    tokenizeLine(line: string, state: State): LineResult<State>;
}

/** Zeilen eines Dokuments, 0-basiert, ohne Zeilentrenner */
export interface LineSource {
    readonly lineCount: number;
    lineText(line: number): string;
}

/**
 * Wie `LineSplice` in Swift: Zeile `firstLine` ist inhaltlich geändert, danach wurden `removedLineCount` alte
 * Zeilen durch `insertedLineCount` neue ersetzt (Anzahl entfernter bzw. eingefügter Zeilenumbrüche).
 */
export interface LineSplice {
    readonly firstLine: number;
    readonly removedLineCount: number;
    readonly insertedLineCount: number;
}

export interface HighlightUpdate {
    /** Erste neu tokenisierte Zeile (0-basiert) */
    readonly firstLine: number;
    /** Zahl der neu tokenisierten Zeilen (wie `HighlightUpdate.tokenizedLineCount` in Swift) */
    readonly tokenizedLineCount: number;
    /** `true`: Endzustand stimmte wieder mit dem alten überein, der Rest ist gültig */
    readonly converged: boolean;
}

export const latexSyntax: LineSyntax<LexState> = {
    initialState: NORMAL_STATE,
    statesEqual,
    tokenizeLine(line, state) {
        const result = tokenizeLine(line, state);
        const tokens = result.tokens.map((token) => ({
            kind: token.kind,
            from: token.location,
            to: token.location + token.length,
        }));
        return { tokens, state: result.state };
    },
};

export const bibSyntax: LineSyntax<BibLexState> = {
    initialState: INITIAL_BIB_STATE,
    statesEqual: bibStatesEqual,
    tokenizeLine: (line, state) => tokenizeBibLine(line, 0, state),
};

export type AnySyntax = LineSyntax<LexState> | LineSyntax<BibLexState>;

export function syntaxFor(language: SyntaxLanguage): AnySyntax {
    return language === 'bibtex' ? bibSyntax : latexSyntax;
}

/** CodeMirror-`Text` als `LineSource` (CM zählt Zeilen ab 1) */
export function textLineSource(doc: Text): LineSource {
    return { lineCount: doc.lines, lineText: (line) => doc.line(line + 1).text };
}

/** Zeilenänderung einer CM-Transaktion; mehrere Änderungsstellen werden zu einem Bereich zusammengefasst. */
export function spliceFromChanges(changes: ChangeSet, oldDoc: Text, newDoc: Text): LineSplice | null {
    let fromA = Infinity;
    let toA = -1;
    let toB = -1;
    changes.iterChangedRanges((changeFromA, changeToA, _changeFromB, changeToB) => {
        fromA = Math.min(fromA, changeFromA);
        toA = Math.max(toA, changeToA);
        toB = Math.max(toB, changeToB);
    });
    if (toA < 0) return null;
    // Vor der ersten Änderung sind beide Texte gleich, die erste Zeile ist also in beiden dieselbe.
    const firstLine = oldDoc.lineAt(fromA).number;
    return {
        firstLine: firstLine - 1,
        removedLineCount: oldDoc.lineAt(toA).number - firstLine,
        insertedLineCount: newDoc.lineAt(toB).number - firstLine,
    };
}

/** Ab dieser Größe kein `splice(...spread)` mehr (Stapelgrenze bei großen Einfügungen) */
const SPREAD_LIMIT = 10_000;

function spliceArray<T>(items: T[], start: number, removed: number, inserted: number, filler: T): void {
    if (removed === inserted) {
        items.fill(filler, start, start + inserted);
        return;
    }
    if (inserted < SPREAD_LIMIT) {
        items.splice(start, removed, ...new Array<T>(inserted).fill(filler));
        return;
    }
    const tail = items.slice(start + removed);
    items.length = start;
    for (let index = 0; index < inserted; index++) items.push(filler);
    for (const item of tail) items.push(item);
}

/** Halboffener Zeilenbereich `[from, to)` */
interface LineRange {
    readonly from: number;
    readonly to: number;
}

const EMPTY_RANGE: LineRange = { from: 0, to: 0 };

/**
 * Endzustände je Zeile. Gültig sind die Zeilen `[0, validCount)`. Dahinter kann ein Hinweisbereich liegen: alte
 * Endzustände, die untereinander zum Text passen, deren Anfang aber noch nicht bestätigt ist. Erreicht die
 * Neuberechnung dort denselben Zustand, gilt der ganze Hinweisbereich wieder (Konvergenz).
 */
export class LineStateCache<State> {
    private readonly states: State[] = [];
    private validCount = 0;
    private hints: LineRange = EMPTY_RANGE;

    constructor(readonly syntax: LineSyntax<State>, lineCount = 1) {
        this.reset(lineCount);
    }

    get lineCount(): number {
        return this.states.length;
    }

    /** Zahl der Zeilen von oben, deren Endzustand gültig ist */
    get validLineCount(): number {
        return this.validCount;
    }

    get isComplete(): boolean {
        return this.validCount >= this.states.length;
    }

    /** Verwirft alles (neues Dokument, andere Sprache) */
    reset(lineCount: number): void {
        this.states.length = 0;
        for (let line = 0; line < lineCount; line++) this.states.push(this.syntax.initialState);
        this.validCount = 0;
        this.hints = EMPTY_RANGE;
    }

    /** Zustand am Anfang von `line` (0-basiert); nur gültig für `line <= validLineCount` */
    startStateOf(line: number): State {
        if (line <= 0) return this.syntax.initialState;
        return this.states[line - 1] ?? this.syntax.initialState;
    }

    /** Gültige Endzustände, eine je Zeile ab Zeile 0 */
    validEndStates(): readonly State[] {
        return this.states.slice(0, this.validCount);
    }

    /** Tokens einer Zeile ab dem gespeicherten Anfangszustand (Zeilen davor müssen gültig sein) */
    tokensOfLine(source: LineSource, line: number): readonly HighlightToken[] {
        return this.syntax.tokenizeLine(source.lineText(line), this.startStateOf(line)).tokens;
    }

    /** Ganzes Dokument neu einfärben; Ergebnis: Zahl der tokenisierten Zeilen */
    highlightAll(source: LineSource): number {
        this.reset(source.lineCount);
        return this.ensureValid(source, source.lineCount - 1);
    }

    /**
     * Nach einer Bearbeitung (der Cache kennt den alten Text, `source` ist der neue): Zustände verschieben, dann ab
     * `firstLine` neu tokenisieren bis zur Konvergenz, längstens bis Zeile `syncLimitLine` (0-basiert, einschließlich).
     */
    highlightEdit(source: LineSource, splice: LineSplice, syncLimitLine = Infinity): HighlightUpdate {
        this.applySplice(splice);
        const firstLine = splice.firstLine;
        if (this.validCount < firstLine) return { firstLine, tokenizedLineCount: 0, converged: false };
        let tokenizedLineCount = 0;
        while (!this.isComplete) {
            const line = this.validCount;
            tokenizedLineCount += 1;
            if (this.computeNextLine(source)) return { firstLine, tokenizedLineCount, converged: true };
            if (line >= syncLimitLine) break;
        }
        return { firstLine, tokenizedLineCount, converged: false };
    }

    /** Macht die Zeilen bis einschließlich `lastLine` gültig; Ergebnis: Zahl der tokenisierten Zeilen */
    ensureValid(source: LineSource, lastLine: number): number {
        const target = Math.min(lastLine, this.states.length - 1);
        let tokenized = 0;
        while (this.validCount <= target) {
            this.computeNextLine(source);
            tokenized += 1;
        }
        return tokenized;
    }

    /** Leerlaufarbeit: höchstens `maxLines` weitere Zeilen; Ergebnis: Zahl der tokenisierten Zeilen */
    advance(source: LineSource, maxLines: number): number {
        return this.ensureValid(source, this.validCount + maxLines - 1);
    }

    /** Tokenisiert Zeile `validCount`; `true`, wenn sie in den Hinweisbereich mündet (Konvergenz) */
    private computeNextLine(source: LineSource): boolean {
        const line = this.validCount;
        const state = this.syntax.tokenizeLine(source.lineText(line), this.startStateOf(line)).state;
        const previous = this.states[line];
        const isHint = line >= this.hints.from && line < this.hints.to;
        this.states[line] = state;
        if (isHint && previous !== undefined && this.syntax.statesEqual(state, previous)) {
            this.validCount = this.hints.to;
            this.hints = EMPTY_RANGE;
            return true;
        }
        this.validCount = line + 1;
        return false;
    }

    /** Verschiebt die Zustände wie Swift (`replaceSubrange`): Der alte Endzustand der letzten alten Zeile landet
     *  auf der letzten neuen Zeile, damit der Konvergenzvergleich dort stimmt. */
    private applySplice(splice: LineSplice): void {
        const { firstLine, removedLineCount, insertedLineCount } = splice;
        const oldLastLine = firstLine + removedLineCount;
        const delta = insertedLineCount - removedLineCount;
        const chain = this.chainAfter(oldLastLine);
        spliceArray(this.states, firstLine, removedLineCount, insertedLineCount, this.syntax.initialState);
        this.hints = chain.to > chain.from ? { from: chain.from + delta, to: chain.to + delta } : EMPTY_RANGE;
        this.validCount = Math.min(this.validCount, firstLine);
    }

    /** Alte Zustände ab `oldLastLine`, die untereinander zum Text passen: der gültige Teil, sonst die Hinweise */
    private chainAfter(oldLastLine: number): LineRange {
        if (this.validCount > oldLastLine) return { from: oldLastLine, to: this.validCount };
        const from = Math.max(this.hints.from, this.validCount, oldLastLine);
        return from < this.hints.to ? { from, to: this.hints.to } : EMPTY_RANGE;
    }
}
