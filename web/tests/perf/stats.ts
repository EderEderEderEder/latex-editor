// Kennzahlen der Leistungsmessung (reine Funktionen, ohne DOM).

export interface Stats {
    readonly p50: number;
    readonly p95: number;
    readonly max: number;
}

/** Ergebnis einer Messung über mehrere Läufe: der schnellste Lauf zählt, die Streuung wird mitgeführt */
export interface Summary {
    /** Kennzahlen des schnellsten Laufs (kleinster p95) */
    readonly fastest: Stats;
    /** p95 je Lauf, in Laufreihenfolge */
    readonly p95PerRun: readonly number[];
}

const PERCENTILE_50 = 0.5;
const PERCENTILE_95 = 0.95;

function percentile(sorted: readonly number[], fraction: number): number {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
    return sorted[index] ?? Number.NaN;
}

/** Nächster Rang wie im Spike S1 */
export function toStats(values: readonly number[]): Stats {
    const sorted = [...values].sort((left, right) => left - right);
    return {
        p50: percentile(sorted, PERCENTILE_50),
        p95: percentile(sorted, PERCENTILE_95),
        max: sorted[sorted.length - 1] ?? Number.NaN,
    };
}

/** Ein Einzelwert je Lauf (Öffnen, Suche …): p50, p95 und max sind alle dieser Wert */
export function singleValueStats(value: number): Stats {
    return { p50: value, p95: value, max: value };
}

export function summarizeRuns(runs: readonly Stats[]): Summary {
    if (runs.length === 0) throw new Error('Keine Läufe zum Zusammenfassen');
    const fastest = runs.reduce((best, run) => (run.p95 < best.p95 ? run : best));
    return { fastest, p95PerRun: runs.map((run) => run.p95) };
}

export function formatMilliseconds(value: number): string {
    return value.toFixed(1);
}

export function spreadText(summary: Summary): string {
    const low = Math.min(...summary.p95PerRun);
    const high = Math.max(...summary.p95PerRun);
    return `${formatMilliseconds(low)}-${formatMilliseconds(high)}`;
}
