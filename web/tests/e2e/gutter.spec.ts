import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Zeilenleiste (W1-7). Voraussetzung: Build mit Testzugang (`npm run build:e2e`). Gebraucht wird zusätzlich
// `window.__editorTestApi.setGutterMarks(marks)`, das `setGutterMarks` aus `editor/gutter.ts` auf die aktive View
// anwendet, und `insertAtStart(text)` (oder Tippen per Tastatur). Beides fehlt noch in `EditorHost.tsx`.

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const PATH = '/stub/projekt/gutter.tex';
const LINE_COUNT = 120;
const MISSING_API = 'window.__editorTestApi.setGutterMarks fehlt (siehe Kopfkommentar)';

interface GutterTestApi {
    open(path: string, text: string): void;
    activate(path: string): void;
    select(anchor: number, head: number): void;
    setGutterMarks(marks: readonly { line: number; kind: string; message?: string }[]): void;
}

type TestWindow = { __editorTestApi?: GutterTestApi };

let app: ElectronApplication;
let userDataDir: string;
let page: Page;
const pageErrors: string[] = [];

test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-e2e-'));
    const env = { ...process.env, [STUB_PRELOAD_ENV]: '1' } as Record<string, string>;
    delete env[DEV_SERVER_ENV];
    app = await electron.launch({ args: [WEB_DIR, `--user-data-dir=${userDataDir}`], env });
    page = await app.firstWindow();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.waitForSelector('.editor-host .cm-editor');
    const hasApi = await page.evaluate(
        () => typeof (globalThis as unknown as TestWindow).__editorTestApi?.setGutterMarks === 'function',
    );
    if (!hasApi) throw new Error(MISSING_API);
    const text = Array.from({ length: LINE_COUNT }, (_, index) => `Zeile ${index + 1}`).join('\n');
    await page.evaluate(
        ([path, content]) => {
            const api = (globalThis as unknown as TestWindow).__editorTestApi!;
            api.open(path!, content!);
            api.activate(path!);
        },
        [PATH, text] as const,
    );
});

test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
});

test('Zeilennummern und aktive Zeile sind sichtbar', async () => {
    await expect(page.locator('.cm-lineNumbers .cm-gutterElement', { hasText: /^1$/ })).toBeVisible();
    // `highlightActiveLineGutter` markiert die Zeile in jeder Spalte (Nummern, Marken, Einklappen): je Spalte genau eine
    await expect(page.locator('.cm-lineNumbers .cm-activeLineGutter')).toHaveCount(1);
    await expect(page.locator('.cm-activeLineGutter')).toHaveCount(await page.locator('.cm-gutter').count());
});

test('Marken erscheinen als Formen mit Tooltip und wandern beim Tippen mit', async () => {
    await page.evaluate(() =>
        (globalThis as unknown as TestWindow).__editorTestApi!.setGutterMarks([
            { line: 2, kind: 'error', message: 'Fehler A' },
            { line: 2, kind: 'warning', message: 'Warnung B' },
            { line: 3, kind: 'gitAdded' },
        ]),
    );
    await expect(page.locator('.cm-mark-shape-error')).toHaveCount(1);
    // Zeilenumbruch im CSS-String nur als Escape `\A ` (ein roher Umbruch macht den Selektor ungültig)
    await expect(page.locator('.cm-line-marks[title="Fehler A\\A Warnung B"]')).toHaveCount(1);
    await expect(page.locator('.cm-mark-git-added')).toHaveCount(1);

    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('Enter');
    const markedRow = page.locator('.cm-gutter-marks .cm-gutterElement', { has: page.locator('.cm-mark-shape-error') });
    const markedLine = page.locator('.cm-lineNumbers .cm-gutterElement', { hasText: /^3$/ });
    const markedTop = (await markedRow.boundingBox())!.y;
    expect(Math.abs(markedTop - (await markedLine.boundingBox())!.y)).toBeLessThan(2);
    expect(pageErrors).toEqual([]);
});

test('Gutter-Breite bleibt beim Scrollen gleich', async () => {
    const gutters = page.locator('.cm-gutters');
    const before = (await gutters.boundingBox())!.width;
    await page.locator('.cm-scroller').evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const after = (await gutters.boundingBox())!.width;
    expect(after).toBe(before);
});
