// Auswertung (Node): pdf.js-Ergebnis je Variante gegen die PDFKit-Referenz und die erwarteten Wörter aus marks.json.
import { wordsOf } from "./matcher.mjs";
import type { TestMark } from "./prepare.mjs";
import type { MarkOutput, PageTiming, Segment, VariantRun } from "./types.mjs";

/** Wortgenau: Anfang und Ende höchstens so weit von PDFKit entfernt (pt), unter einem halben Wortabstand bei 11 pt */
export const STRICT_TOLERANCE = 1.5;
/** Sichtbar noch am richtigen Wort (etwa ein halbes Zeichen) */
export const LOOSE_TOLERANCE = 3;
const LINE_CENTER_TOLERANCE = 4;

export type Verdict = "wortgenau" | "visuell" | "Rückfall wie Swift" | "daneben";

export interface MarkEvaluation {
    id: string;
    category: string;
    referenceTrusted: boolean;
    referencePrecision: string;
    precision: string;
    textMatches: boolean;
    sameLineCount: boolean;
    startDelta: number;
    endDelta: number;
    verdict: Verdict;
    reason: string;
}

function sameWords(text: string, expected: string): boolean {
    return wordsOf(text).join(" ") === wordsOf(expected).join(" ");
}

function centerY(segment: Segment): number {
    return segment.rect.y + segment.rect.height / 2;
}

function linesAlign(mine: Segment[], reference: Segment[]): boolean {
    return mine.length === reference.length && mine.every((segment, index) => {
        const other = reference[index];
        return other !== undefined && other.page === segment.page && Math.abs(centerY(other) - centerY(segment)) <= LINE_CENTER_TOLERANCE;
    });
}

function edgeDeltas(mine: Segment[], reference: Segment[]): { start: number; end: number } {
    const [first, otherFirst] = [mine[0], reference[0]];
    const [last, otherLast] = [mine[mine.length - 1], reference[reference.length - 1]];
    if (!first || !otherFirst || !last || !otherLast) return { start: Infinity, end: Infinity };
    const right = (segment: Segment): number => segment.rect.x + segment.rect.width;
    return { start: Math.abs(first.rect.x - otherFirst.rect.x), end: Math.abs(right(last) - right(otherLast)) };
}

function verdictOf(evaluation: Omit<MarkEvaluation, "verdict" | "reason">): { verdict: Verdict; reason: string } {
    if (evaluation.referencePrecision !== "words") {
        const same = evaluation.precision !== "words";
        return { verdict: same ? "Rückfall wie Swift" : "daneben", reason: same ? "" : "pdf.js fand Wörter, PDFKit nicht" };
    }
    if (evaluation.precision !== "words") return { verdict: "daneben", reason: "Wörter nicht gefunden" };
    if (!evaluation.textMatches) return { verdict: "daneben", reason: "falscher Text überdeckt" };
    if (!evaluation.sameLineCount) return { verdict: "daneben", reason: "Zeilen weichen ab" };
    const worst = Math.max(evaluation.startDelta, evaluation.endDelta);
    if (worst <= STRICT_TOLERANCE) return { verdict: "wortgenau", reason: "" };
    if (worst <= LOOSE_TOLERANCE) return { verdict: "visuell", reason: `Rand ${worst.toFixed(1)} pt daneben` };
    return { verdict: "daneben", reason: `Rand ${worst.toFixed(1)} pt daneben` };
}

export function evaluate(mark: TestMark, output: MarkOutput, reference: MarkOutput): MarkEvaluation {
    const deltas = edgeDeltas(output.segments, reference.segments);
    const base = {
        id: mark.id,
        category: mark.category,
        referenceTrusted: reference.precision !== "words" || sameWords(reference.text, mark.text),
        referencePrecision: reference.precision,
        precision: output.precision,
        textMatches: sameWords(output.text, mark.text),
        sameLineCount: linesAlign(output.segments, reference.segments),
        startDelta: deltas.start,
        endDelta: deltas.end,
    };
    return { ...base, ...verdictOf(base) };
}

export interface TimingSummary {
    /** je Seite der schnellste Lauf, darüber Mittel und Maximum (ms) */
    meanPerPage: number;
    maxPerPage: number;
    textContentMean: number;
    /** Gesamtzeit aller Seiten je Wiederholung: schnellster und langsamster Lauf (ms) */
    fastestTotal: number;
    slowestTotal: number;
    resolveFastest: number;
}

function fastestPerPage(runs: PageTiming[][]): number[] {
    const first = runs[0] ?? [];
    return first.map((_, index) => Math.min(...runs.map((timings) => {
        const timing = timings[index];
        return timing ? timing.textContentMs + timing.geometryMs : Infinity;
    })));
}

export function summarizeTimings(run: VariantRun): TimingSummary {
    const perPage = fastestPerPage(run.timings);
    const totals = run.timings.map((timings) => timings.reduce((sum, timing) => sum + timing.textContentMs + timing.geometryMs, 0));
    const first = run.timings[0] ?? [];
    const textContent = first.map((_, index) => Math.min(...run.timings.map((timings) => timings[index]?.textContentMs ?? Infinity)));
    const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
    return {
        meanPerPage: mean(perPage),
        maxPerPage: Math.max(...perPage),
        textContentMean: mean(textContent),
        fastestTotal: Math.min(...totals),
        slowestTotal: Math.max(...totals),
        resolveFastest: Math.min(...run.resolveMs),
    };
}
