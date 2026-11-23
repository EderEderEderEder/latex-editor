// Zusammenfassung mehrerer Läufe: je Kennzahl der beste (kleinste) Wert und die Spanne.
import type { RunResult, VariantName } from './measure';

type MetricReader = (run: RunResult) => number;

interface Column {
    title: string;
    read: MetricReader;
}

const COLUMNS: readonly Column[] = [
    { title: 'Öffnen ms', read: (run) => run.openMs },
    { title: 'Taste mittig Arbeit p50', read: (run) => run.keyMid.work.p50 },
    { title: 'Taste mittig Arbeit p95', read: (run) => run.keyMid.work.p95 },
    { title: 'Taste mittig Latenz p95', read: (run) => run.keyMid.latency.p95 },
    { title: 'Taste Anfang Arbeit p95', read: (run) => run.keyStart.work.p95 },
    { title: 'Taste Anfang Latenz p95', read: (run) => run.keyStart.latency.p95 },
    { title: '`$` mittig Arbeit p95', read: (run) => run.keyDollar.work.p95 },
    { title: '`$` mittig Latenz p95', read: (run) => run.keyDollar.latency.p95 },
    { title: 'Scrollen Arbeit p95', read: (run) => run.scroll.work.p95 },
    { title: 'Scrollen Rahmenabstand p95', read: (run) => run.scroll.latency.p95 },
    { title: 'Sprung Ende ms', read: (run) => run.jumpEndMs },
    { title: 'Heap MB', read: (run) => run.heapDeltaMB },
];

const VARIANT_ORDER: readonly VariantName[] = ['plain', 'stream', 'viewPlugin'];

function cell(values: number[]): string {
    const best = Math.min(...values);
    const worst = Math.max(...values);
    return `${best.toFixed(1)} (–${worst.toFixed(1)})`;
}

function groupKey(run: RunResult): string {
    return `${run.lines}|${run.variant}`;
}

function sortedGroups(results: RunResult[]): RunResult[][] {
    const groups = new Map<string, RunResult[]>();
    for (const run of results) groups.set(groupKey(run), [...(groups.get(groupKey(run)) ?? []), run]);
    return [...groups.values()].sort((left, right) => {
        const [a, b] = [left[0] as RunResult, right[0] as RunResult];
        return a.lines - b.lines || VARIANT_ORDER.indexOf(a.variant) - VARIANT_ORDER.indexOf(b.variant);
    });
}

/** Markdown-Tabelle: „bester Wert (–schlechtester Wert)“ über n Läufe. */
export function summarize(results: RunResult[]): string {
    const header = ['Variante', 'Zeilen', 'n', ...COLUMNS.map((column) => column.title)];
    const rows = [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`];
    for (const group of sortedGroups(results)) {
        const first = group[0] as RunResult;
        const cells = COLUMNS.map((column) => cell(group.map(column.read)));
        rows.push(`| ${first.variant} | ${first.lines} | ${group.length} | ${cells.join(' | ')} |`);
    }
    return rows.join('\n');
}
