import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    BUDGET_FOLD_SCAN_FRAME_MS,
    BUDGET_KEYSTROKE_DOLLAR_P95_MS,
    BUDGET_KEYSTROKE_ENTER_P95_MS,
    BUDGET_KEYSTROKE_MIDDLE_P95_MS,
    BUDGET_KEYSTROKE_START_P95_MS,
    BUDGET_OPEN_MS,
    BUDGET_SCROLL_FRAME_P95_MS,
    BUDGET_SEARCH_FIRST_HIT_MS,
} from './budgets';
import { runOnce } from './measureRun';
import type { RunMeasurements } from './measureRun';
import { formatMilliseconds, spreadText, summarizeRuns } from './stats';
import type { Stats, Summary } from './stats';

// Leistungsbudgets (W1-13) des fertigen Editors bei 10.000 Zeilen: fünf Läufe mit frischem Electron und dem Stub-Preload,
// je Messung zählt der schnellste Lauf. Voraussetzung: `npm run build:e2e`. Aufruf: `node scripts/test-run.mjs --perf`.

const DEFAULT_RUN_COUNT = 5;
/** Nur zum Entwickeln der Messung: `PERF_RUN_COUNT=1`; für Zahlen, die zählen, immer die fünf Läufe */
const RUN_COUNT = Number(process.env.PERF_RUN_COUNT ?? DEFAULT_RUN_COUNT);
const RESULT_DIR = join(__dirname, '../../.test-logs');
const RESULT_FILE = 'perf-result.json';
const LOG_PREFIX = '[perf]';

const runs: RunMeasurements[] = [];

interface Measurement {
    readonly title: string;
    readonly budgetMs: number;
    readonly pick: (run: RunMeasurements) => Stats;
}

/** Kennzahl, die gegen das Budget geht, ist immer der p95 (bei Einzelwerten der Wert selbst) */
const MEASUREMENTS: readonly Measurement[] = [
    { title: 'Öffnen (Dokument setzen bis erster Rahmen)', budgetMs: BUDGET_OPEN_MS, pick: (run) => run.open },
    { title: 'Tastendruck mittig', budgetMs: BUDGET_KEYSTROKE_MIDDLE_P95_MS, pick: (run) => run.keystrokeMiddle.work },
    { title: 'Tippen am Anfang', budgetMs: BUDGET_KEYSTROKE_START_P95_MS, pick: (run) => run.keystrokeStart.work },
    { title: '$ tippen (öffnet Mathe über viele Zeilen)', budgetMs: BUDGET_KEYSTROKE_DOLLAR_P95_MS, pick: (run) => run.keystrokeDollar.work },
    { title: 'Enter einfügen (Zeilen verschieben)', budgetMs: BUDGET_KEYSTROKE_ENTER_P95_MS, pick: (run) => run.keystrokeEnter.work },
    { title: 'Scrollen (Rahmenzeit)', budgetMs: BUDGET_SCROLL_FRAME_P95_MS, pick: (run) => run.scrollFrame },
    { title: 'Suchen in der Datei (bis erster Treffer)', budgetMs: BUDGET_SEARCH_FIRST_HIT_MS, pick: (run) => run.searchFirstHit },
    { title: 'Einklapp-Scan nach Änderung (bis Folgerahmung)', budgetMs: BUDGET_FOLD_SCAN_FRAME_MS, pick: (run) => run.foldScanFrame },
];

function summaryOf(measurement: Measurement): Summary {
    return summarizeRuns(runs.map(measurement.pick));
}

function logTable(): void {
    console.log(`${LOG_PREFIX} schnellster von ${runs.length} Läufen (p50 / p95 des schnellsten Laufs), Streuung der p95, Budget, in ms`);
    for (const measurement of MEASUREMENTS) {
        const summary = summaryOf(measurement);
        const { p50, p95 } = summary.fastest;
        console.log(
            `${LOG_PREFIX} ${measurement.title}: ${formatMilliseconds(p50)} / ${formatMilliseconds(p95)}` +
                `  Streuung ${spreadText(summary)}  Budget ${measurement.budgetMs}`,
        );
    }
}

function logExtras(): void {
    const fastestStall = Math.min(...runs.map((run) => run.foldScanStall.p95));
    const fastestKeyLatency = Math.min(...runs.map((run) => run.keystrokeMiddle.latency.p95));
    const fastestGap = Math.min(...runs.map((run) => run.scrollGap.p95));
    console.log(`${LOG_PREFIX} Zusatz: Scan-Aufgabe ${formatMilliseconds(fastestStall)}, Taste mittig bis Paint p95 ${formatMilliseconds(fastestKeyLatency)}, Scroll-Rahmenabstand p95 ${formatMilliseconds(fastestGap)}`);
    console.log(`${LOG_PREFIX} Meldungen der Diagnose im Sichtbereich je Lauf: ${runs.map((run) => run.diagnosticMarks).join(', ')}`);
}

// Ein einziger Test: Schlägt ein Test fehl, startet Playwright den Worker neu und würde die Messung wiederholen.
// `expect.soft` meldet alle überschrittenen Budgets zusammen.
test('Leistungsbudgets bei 10.000 Zeilen', async () => {
    for (let index = 0; index < RUN_COUNT; index++) {
        runs.push(await runOnce());
        console.log(`${LOG_PREFIX} Lauf ${index + 1}/${RUN_COUNT} fertig`);
    }
    mkdirSync(RESULT_DIR, { recursive: true });
    writeFileSync(join(RESULT_DIR, RESULT_FILE), JSON.stringify(runs, null, 2));
    logTable();
    logExtras();
    expect.soft(runs.every((run) => run.diagnosticMarks > 0), 'Diagnose liefert keine Meldung: der Worker läuft nicht').toBe(true);
    for (const measurement of MEASUREMENTS) {
        const { p95 } = summaryOf(measurement).fastest;
        expect.soft(p95, `${measurement.title}: ${formatMilliseconds(p95)} ms, Budget ${measurement.budgetMs} ms`).toBeLessThanOrEqual(measurement.budgetMs);
    }
});
