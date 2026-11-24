import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as probe from './pageProbe';
import type { FoldScanSample, KeySample } from './pageProbe';
import { SEARCH_TARGET, findLandmarks, generateSyntheticDocument } from './syntheticDocument';
import type { DocumentLandmarks } from './syntheticDocument';
import { singleValueStats, toStats } from './stats';
import type { Stats } from './stats';

// Ein Lauf = ein frisches Electron mit dem Stub-Preload (Muster der E2E-Tests) und alle Messungen nacheinander.

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const MODIFIER = 'ControlOrMeta';
const DOCUMENT_PATH = '/stub/projekt/messung.tex';
const MISSING_TEST_API = 'window.__editorTestApi fehlt: vorher npm run build:e2e';
const KEYSTROKE_COUNT = 100;
const KEY_GAP_MS = 40;
const WARMUP_KEYS = 2;
const SETTLE_AFTER_OPEN_MS = 2_500;
const SETTLE_AFTER_JUMP_MS = 400;
const SCROLL_FRAMES = 120;
const SCROLL_STEP_PX = 400;
const SEARCH_TIMEOUT_MS = 5_000;
const FOLD_SPIN_AFTER_MS = 150;
const FOLD_TIMEOUT_MS = 4_000;
const FOLD_INSERT = '\\section{Neu}\nz\n';
const MARKS_CHECK_TIMEOUT_MS = 6_000;
const MARKS_POLL_MS = 250;
/** Ohne Bildratenbegrenzung misst „bis zum nächsten Rahmen“ die Arbeit statt des Wartens auf den Rahmentakt (wie im Spike S1) */
const CHROMIUM_SWITCHES = [
    '--disable-frame-rate-limit',
    '--disable-gpu-vsync',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
];

export interface KeyStats {
    readonly work: Stats;
    readonly latency: Stats;
}

export interface RunMeasurements {
    readonly open: Stats;
    readonly keystrokeMiddle: KeyStats;
    readonly keystrokeStart: KeyStats;
    readonly keystrokeDollar: KeyStats;
    readonly keystrokeEnter: KeyStats;
    readonly scrollFrame: Stats;
    readonly scrollGap: Stats;
    readonly searchFirstHit: Stats;
    readonly foldScanFrame: Stats;
    readonly foldScanStall: Stats;
    readonly diagnosticMarks: number;
}

interface Session {
    readonly app: ElectronApplication;
    readonly page: Page;
    readonly userDataDir: string;
    readonly landmarks: DocumentLandmarks;
}

async function launch(): Promise<Pick<Session, 'app' | 'page' | 'userDataDir'>> {
    const userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-perf-'));
    const env = { ...process.env, [STUB_PRELOAD_ENV]: '1' } as Record<string, string>;
    delete env[DEV_SERVER_ENV];
    const app = await electron.launch({ args: [...CHROMIUM_SWITCHES, WEB_DIR, `--user-data-dir=${userDataDir}`], env });
    const page = await app.firstWindow();
    await page.waitForSelector('.editor-host .cm-editor');
    const hasApi = await page.evaluate(() => (globalThis as unknown as { __editorTestApi?: unknown }).__editorTestApi !== undefined);
    if (!hasApi) throw new Error(MISSING_TEST_API);
    await page.evaluate(probe.installHelpers);
    return { app, page, userDataDir };
}

async function selectRange(page: Page, offset: number): Promise<void> {
    await page.evaluate(
        (position) => (globalThis as unknown as { __editorTestApi: { select(a: number, h: number): void } }).__editorTestApi.select(position, position),
        offset,
    );
}

function toKeyStats(samples: readonly KeySample[]): KeyStats {
    if (samples.length !== KEYSTROKE_COUNT) throw new Error(`${samples.length} statt ${KEYSTROKE_COUNT} Tastenmessungen`);
    return { work: toStats(samples.map((s) => s.work)), latency: toStats(samples.map((s) => s.latency)) };
}

/** Erste Tasten holen den Cursor in den Sichtbereich (Sprung); sie zählen nicht mit */
async function warmUp(page: Page, key: string, undoKey: string): Promise<void> {
    for (let index = 0; index < WARMUP_KEYS; index++) {
        await page.keyboard.press(key);
        await page.waitForTimeout(KEY_GAP_MS);
    }
    for (let index = 0; index < WARMUP_KEYS; index++) await page.keyboard.press(undoKey);
    await page.waitForTimeout(SETTLE_AFTER_JUMP_MS);
    await page.evaluate(probe.takeKeySamples);
}

async function typeKeys(page: Page, keyFor: (index: number) => string): Promise<KeyStats> {
    for (let index = 0; index < KEYSTROKE_COUNT; index++) {
        await page.keyboard.press(keyFor(index));
        await page.waitForTimeout(KEY_GAP_MS);
    }
    await page.waitForTimeout(KEY_GAP_MS);
    return toKeyStats(await page.evaluate(probe.takeKeySamples));
}

async function measureKey(page: Page, offset: number, key: string, undoKey: string): Promise<KeyStats> {
    await selectRange(page, offset);
    await warmUp(page, key, undoKey);
    return typeKeys(page, () => key);
}

/** `$` und wieder löschen im Wechsel: jedes `$` öffnet bzw. schließt Mathe bis zum Absatzende */
async function measureDollar(page: Page, lineStart: number): Promise<KeyStats> {
    await selectRange(page, lineStart);
    await warmUp(page, '$', 'Backspace');
    return typeKeys(page, (index) => (index % 2 === 0 ? '$' : 'Backspace'));
}

async function measureSearch(page: Page): Promise<number> {
    await page.keyboard.press(`${MODIFIER}+f`);
    await page.keyboard.type(SEARCH_TARGET);
    await page.evaluate(probe.armSearch);
    const hit = page.evaluate(probe.awaitSearchHit, SEARCH_TIMEOUT_MS);
    await page.keyboard.press('Enter');
    const result = await hit;
    if (result.ms < 0) throw new Error('Suche: kein Treffer gefunden');
    await page.keyboard.press('Escape');
    return result.ms;
}

async function waitForDiagnosticMarks(page: Page): Promise<number> {
    const deadline = Date.now() + MARKS_CHECK_TIMEOUT_MS;
    let count = 0;
    while (Date.now() < deadline && count === 0) {
        count = await page.evaluate(probe.countVisibleDiagnostics);
        if (count === 0) await page.waitForTimeout(MARKS_POLL_MS);
    }
    return count;
}

async function measureFoldScan(page: Page): Promise<FoldScanSample> {
    await page.evaluate(probe.installSpinLoop);
    const started = await page.evaluate(probe.startFoldScan, { insert: FOLD_INSERT, spinAfterMs: FOLD_SPIN_AFTER_MS, timeoutMs: FOLD_TIMEOUT_MS });
    const sample = started ? await page.evaluate(probe.awaitFoldScan) : null;
    if (sample === null) throw new Error('Einklapp-Scan: keine neue Marke innerhalb der Frist');
    return sample;
}

async function measureAll(session: Session, text: string): Promise<RunMeasurements> {
    const { page, landmarks } = session;
    const open = await page.evaluate(probe.measureOpen, { path: DOCUMENT_PATH, text });
    await page.waitForTimeout(SETTLE_AFTER_OPEN_MS);
    const diagnosticMarks = await waitForDiagnosticMarks(page);
    await page.evaluate(probe.installKeyProbe);
    const keystrokeMiddle = await measureKey(page, landmarks.middleProseOffset, 'x', 'Backspace');
    const keystrokeDollar = await measureDollar(page, landmarks.middleProseLineStart);
    const keystrokeEnter = await measureKey(page, landmarks.middleProseOffset, 'Enter', 'Backspace');
    const keystrokeStart = await measureKey(page, 0, 'x', 'Backspace');
    const scroll = await page.evaluate(probe.measureScroll, { frames: SCROLL_FRAMES, stepPx: SCROLL_STEP_PX });
    await selectRange(page, 0);
    const searchMs = await measureSearch(page);
    const fold = await measureFoldScan(page);
    return {
        open: singleValueStats(open),
        keystrokeMiddle,
        keystrokeStart,
        keystrokeDollar,
        keystrokeEnter,
        scrollFrame: toStats(scroll.work),
        scrollGap: toStats(scroll.gap),
        searchFirstHit: singleValueStats(searchMs),
        foldScanFrame: singleValueStats(fold.frameMs),
        foldScanStall: singleValueStats(fold.stallMs),
        diagnosticMarks,
    };
}

/** Startet Electron, misst alles einmal und räumt auf (eigene Instanz, kein Eingriff in andere Prozesse) */
export async function runOnce(): Promise<RunMeasurements> {
    const text = generateSyntheticDocument();
    const started = await launch();
    const session: Session = { ...started, landmarks: findLandmarks(text) };
    try {
        return await measureAll(session, text);
    } finally {
        await session.app.close();
        rmSync(session.userDataDir, { recursive: true, force: true });
    }
}
