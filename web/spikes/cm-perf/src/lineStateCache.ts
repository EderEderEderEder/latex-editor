// Zeilenzustands-Cache für Variante B: Endzustand je Zeile, gültig für Zeilen 1..validCount.
// Nach einer Änderung wird ab der ersten geänderten Zeile neu berechnet, bis der neue
// Endzustand mit dem alten (verschobenen) übereinstimmt (Konvergenz) oder die Grenze erreicht ist.
import type { ChangeSet, Text } from '@codemirror/state';
import { NORMAL_STATE, tokenizeLine } from './tokenizer';
import type { LexState } from './tokenizer';

const UNKNOWN_STATE: LexState = '?';
/** Ab dieser Größe kein `splice(...spread)` mehr (Stapelgrenze bei großen Einfügungen). */
const SPREAD_LIMIT = 10_000;

interface ChangedLines {
    firstLine: number;
    oldLastLine: number;
    newLastLine: number;
}

export class LineStateCache {
    private endStates: LexState[] = [];
    private validCount = 0;
    /** Zahl der seit dem Start berechneten Zeilen (zur Kontrolle der Konvergenz). */
    tokenizedLines = 0;

    get validLineCount(): number {
        return this.validCount;
    }

    startStateOf(lineNumber: number): LexState {
        return lineNumber <= 1 ? NORMAL_STATE : (this.endStates[lineNumber - 2] ?? UNKNOWN_STATE);
    }

    /** Berechnet fehlende Endzustände bis einschließlich `lastLine`. */
    ensureValid(doc: Text, lastLine: number): void {
        const target = Math.min(lastLine, doc.lines);
        while (this.validCount < target) this.computeLine(doc, this.validCount + 1);
    }

    /** Rechnet bis `deadline` (performance.now()) weiter; `true`, wenn das Dokumentende erreicht ist. */
    advanceUntil(doc: Text, deadline: number, chunkLines: number): boolean {
        while (this.validCount < doc.lines) {
            const target = Math.min(this.validCount + chunkLines, doc.lines);
            this.ensureValid(doc, target);
            if (performance.now() >= deadline) break;
        }
        return this.validCount >= doc.lines;
    }

    applyChanges(changes: ChangeSet, oldDoc: Text, newDoc: Text, limitLine: number): void {
        const changed = changedLines(changes, oldDoc, newDoc);
        if (changed === null) return;
        const removed = changed.oldLastLine - changed.firstLine + 1;
        const inserted = changed.newLastLine - changed.firstLine + 1;
        replaceRange(this.endStates, changed.firstLine - 1, removed, inserted);
        // Alte Zustände hinter der Änderung sind nur Konvergenz-Hinweise, keine gültigen Werte.
        const hintEnd = this.validCount > changed.oldLastLine ? this.validCount + inserted - removed : 0;
        if (this.validCount < changed.firstLine - 1) return;
        this.validCount = changed.firstLine - 1;
        this.reconverge(newDoc, changed.newLastLine, hintEnd, limitLine);
    }

    private reconverge(doc: Text, newLastLine: number, hintEnd: number, limitLine: number): void {
        for (let line = this.validCount + 1; line <= doc.lines; line++) {
            const hint = this.endStates[line - 1];
            const state = this.computeLine(doc, line);
            const isHintUsable = line > newLastLine && line <= hintEnd;
            if (isHintUsable && hint === state) {
                this.validCount = hintEnd;
                return;
            }
            if (line >= limitLine && line >= newLastLine) return;
        }
    }

    private computeLine(doc: Text, lineNumber: number): LexState {
        const state = tokenizeLine(doc.line(lineNumber).text, this.startStateOf(lineNumber), null);
        this.endStates[lineNumber - 1] = state;
        this.validCount = lineNumber;
        this.tokenizedLines++;
        return state;
    }
}

function changedLines(changes: ChangeSet, oldDoc: Text, newDoc: Text): ChangedLines | null {
    let fromA = Infinity;
    let toA = -1;
    let fromB = Infinity;
    let toB = -1;
    changes.iterChangedRanges((changeFromA, changeToA, changeFromB, changeToB) => {
        fromA = Math.min(fromA, changeFromA);
        toA = Math.max(toA, changeToA);
        fromB = Math.min(fromB, changeFromB);
        toB = Math.max(toB, changeToB);
    });
    if (toA < 0) return null;
    return {
        firstLine: newDoc.lineAt(fromB).number,
        oldLastLine: oldDoc.lineAt(toA).number,
        newLastLine: newDoc.lineAt(toB).number,
    };
}

function replaceRange(states: LexState[], start: number, removed: number, inserted: number): void {
    if (removed === inserted) {
        states.fill(UNKNOWN_STATE, start, start + inserted);
        return;
    }
    if (inserted < SPREAD_LIMIT) {
        states.splice(start, removed, ...new Array<LexState>(inserted).fill(UNKNOWN_STATE));
        return;
    }
    const tail = states.slice(start + removed);
    states.length = start;
    for (let index = 0; index < inserted; index++) states.push(UNKNOWN_STATE);
    for (const state of tail) states.push(state);
}
