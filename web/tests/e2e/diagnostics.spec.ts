import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Diagnose im Editor (W1-9c): Meldung des Syntaxprüfers als gestrichelte Unterstreichung mit Tooltip, wandert beim
// Tippen mit, gehört zur Sitzung. Voraussetzung: Build mit Testzugang
// (`RENDERER_VITE_EDITOR_TEST_API=1 npm run build`); `window.__editorTestApi` fehlt im normalen Build.

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const BROKEN_PATH = '/stub/projekt/kaputt.tex';
const CLEAN_PATH = '/stub/projekt/sauber.tex';
const BROKEN_TEXT = 'Anfang\n\\textbf{nicht geschlossen\nEnde';
const CLEAN_TEXT = 'Alles in Ordnung \\textbf{fett}.';
/** Entprellung 0,6 s plus Worker; großzügig, aber ohne Schleifen */
const ANALYSIS_TIMEOUT_MS = 10_000;
const ERROR_SELECTOR = '.cm-content .cm-diagnostic-error';
const MISSING_TEST_API = 'window.__editorTestApi fehlt: vorher RENDERER_VITE_EDITOR_TEST_API=1 npm run build';

let app: ElectronApplication;
let userDataDir: string;
let page: Page;
const pageErrors: string[] = [];

// Gleiche Form wie `EditorTestApi` in `src/renderer/editor/EditorHost.tsx`.
interface EditorTestApi {
    open(path: string, text: string): void;
    activate(path: string): void;
    select(anchor: number, head: number): void;
}

type TestWindow = { __editorTestApi?: EditorTestApi };

async function activate(path: string): Promise<void> {
    await page.evaluate((target) => (globalThis as unknown as TestWindow).__editorTestApi?.activate(target), path);
}

async function select(anchor: number, head: number): Promise<void> {
    await page.evaluate((range) => (globalThis as unknown as TestWindow).__editorTestApi?.select(range.anchor, range.head), {
        anchor,
        head,
    });
}

test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-e2e-'));
    const env = { ...process.env, [STUB_PRELOAD_ENV]: '1' } as Record<string, string>;
    delete env[DEV_SERVER_ENV];
    app = await electron.launch({ args: [WEB_DIR, `--user-data-dir=${userDataDir}`], env });
    page = await app.firstWindow();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.waitForSelector('.editor-host .cm-editor');
    const hasApi = await page.evaluate(() => (globalThis as unknown as TestWindow).__editorTestApi !== undefined);
    if (!hasApi) throw new Error(MISSING_TEST_API);
    await page.evaluate(
        ([brokenPath, brokenText, cleanPath, cleanText]) => {
            const api = (globalThis as unknown as TestWindow).__editorTestApi!;
            api.open(brokenPath, brokenText);
            api.open(cleanPath, cleanText);
        },
        [BROKEN_PATH, BROKEN_TEXT, CLEAN_PATH, CLEAN_TEXT] as const,
    );
});

test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
});

test('Fehler erscheint gestrichelt mit Tooltip, saubere Datei bleibt ohne Meldung', async () => {
    await activate(BROKEN_PATH);
    const mark = page.locator(ERROR_SELECTOR).first();
    await expect(mark).toBeVisible({ timeout: ANALYSIS_TIMEOUT_MS });
    expect(await mark.getAttribute('title')).toBeTruthy();
    // Die Funktion läuft im Renderer; ohne DOM-Typen in der Node-Typprüfung daher über `globalThis`.
    const decorationStyle = await mark.evaluate((element) => {
        const { getComputedStyle } = globalThis as unknown as {
            getComputedStyle(target: unknown): { textDecorationStyle: string };
        };
        return getComputedStyle(element).textDecorationStyle;
    });
    expect(decorationStyle).toBe('dashed');

    await activate(CLEAN_PATH);
    await expect(page.locator('.cm-content')).toContainText('Alles in Ordnung');
    await page.waitForTimeout(ANALYSIS_TIMEOUT_MS / 10);
    await expect(page.locator(ERROR_SELECTOR)).toHaveCount(0);
    expect(pageErrors).toEqual([]);
});

test('Meldung wandert beim Tippen mit und bleibt nach dem Sitzungswechsel', async () => {
    await activate(BROKEN_PATH);
    const mark = page.locator(ERROR_SELECTOR).first();
    await expect(mark).toBeVisible({ timeout: ANALYSIS_TIMEOUT_MS });
    const markedText = await mark.textContent();

    await select(0, 0);
    await page.keyboard.type('XYZ');
    await expect(page.locator(ERROR_SELECTOR).first()).toHaveText(markedText ?? '');

    await activate(CLEAN_PATH);
    await activate(BROKEN_PATH);
    await expect(page.locator(ERROR_SELECTOR).first()).toBeVisible({ timeout: ANALYSIS_TIMEOUT_MS });
    expect(pageErrors).toEqual([]);
});
