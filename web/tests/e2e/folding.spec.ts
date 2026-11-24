import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Einklappen im echten Fenster (W1-8b). Voraussetzung wie `session.spec.ts`: Build mit Testzugang
// (`npm run build:e2e`); im normalen Build und im Paket fehlt `window.__editorTestApi`.

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const FOLD_PATH = '/stub/projekt/falten.tex';
/** Wie `tests/unit/folding.test.ts`: Kopfzeile endet bei 14, Ausgeblendetes bis 27, nächste Überschrift bei 28 */
const CHAPTERS = '\\chapter{Eins}\nerste\nzweite\n\\chapter{Zwei}\nletzte\n';
const HEADER_END = 14;
const INSIDE_FOLD = 17;
const NEXT_HEADING = 28;
const LINE_COUNT = 6;
const FOLDED_LINE_COUNT = 4;
const REGION_COUNT = 2;
const ADDED_SECTION = '\\section{Neu}\nz\n';
const IS_MAC = process.platform === 'darwin';
const MISSING_TEST_API = 'window.__editorTestApi fehlt: vorher npm run build:e2e';

const MARKERS = '.cm-fold-gutter .cm-fold-marker';
const PLACEHOLDERS = '.cm-fold-placeholder';

let app: ElectronApplication;
let userDataDir: string;
let page: Page;
const pageErrors: string[] = [];

// Gleiche Form wie `EditorTestApi` in `src/renderer/editor/EditorHost.tsx` (die .tsx-Datei gehört nicht zur Node-Typprüfung).
interface EditorTestApi {
    open(path: string, text: string): void;
    activate(path: string): void;
    close(path: string): void;
    text(): string;
    selection(): { anchor: number; head: number };
    select(anchor: number, head: number): void;
    isDirty(path: string): boolean;
}

type TestWindow = { __editorTestApi?: EditorTestApi };

async function openFresh(): Promise<void> {
    await page.evaluate(
        ([path, text]) => {
            const api = (globalThis as unknown as TestWindow).__editorTestApi!;
            api.close(path);
            api.open(path, text);
            api.activate(path);
        },
        [FOLD_PATH, CHAPTERS] as const,
    );
    // Erster Scan nach dem Anzeigen läuft sofort (Zeitgeber 0), danach stehen die Pfeile
    await expect(page.locator(MARKERS)).toHaveCount(REGION_COUNT);
}

async function select(anchor: number, head: number): Promise<void> {
    await page.evaluate((range) => (globalThis as unknown as TestWindow).__editorTestApi?.select(range.anchor, range.head), {
        anchor,
        head,
    });
}

async function visibleText(): Promise<string> {
    return page.evaluate(() => (globalThis as unknown as TestWindow).__editorTestApi?.text() ?? '');
}

async function head(): Promise<number | undefined> {
    return page.evaluate(() => (globalThis as unknown as TestWindow).__editorTestApi?.selection().head);
}

async function isDirty(): Promise<boolean | undefined> {
    return page.evaluate((path) => (globalThis as unknown as TestWindow).__editorTestApi?.isDirty(path), FOLD_PATH);
}

async function foldFirstChapter(): Promise<void> {
    await page.locator('.cm-gutters').hover();
    await page.locator(MARKERS).first().click();
    await expect(page.locator(PLACEHOLDERS)).toHaveCount(1);
}

/** Tastenkürzel aus `FOLD_KEYS` (macOS wie Swift, sonst Akkord Strg+K …) */
async function pressFoldAll(): Promise<void> {
    if (IS_MAC) {
        await page.keyboard.press('Shift+Meta+Alt+ArrowLeft');
        return;
    }
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Control+0');
}

async function pressUnfoldAll(): Promise<void> {
    if (IS_MAC) {
        await page.keyboard.press('Shift+Meta+Alt+ArrowRight');
        return;
    }
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Control+j');
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
});

test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
});

test.beforeEach(openFresh);

test('Pfeil klappt zu, „⋯“ klappt auf; Text und „geändert“ bleiben', async () => {
    await expect(page.locator('.cm-line')).toHaveCount(LINE_COUNT);
    await foldFirstChapter();
    await expect(page.locator('.cm-line')).toHaveCount(FOLDED_LINE_COUNT);
    expect(await visibleText()).toBe(CHAPTERS);
    expect(await isDirty()).toBe(false);

    await page.locator(PLACEHOLDERS).click();
    await expect(page.locator(PLACEHOLDERS)).toHaveCount(0);
    await expect(page.locator('.cm-line')).toHaveCount(LINE_COUNT);
    expect(pageErrors).toEqual([]);
});

test('Tastenkürzel: alles zu, alles auf', async () => {
    await select(0, 0);
    await pressFoldAll();
    await expect(page.locator(PLACEHOLDERS)).toHaveCount(REGION_COUNT);
    await pressUnfoldAll();
    await expect(page.locator(PLACEHOLDERS)).toHaveCount(0);
    expect(await visibleText()).toBe(CHAPTERS);
    expect(pageErrors).toEqual([]);
});

test('Cursor: Pfeil rechts springt über den Bereich, Sprung hinein klappt auf', async () => {
    await foldFirstChapter();
    await select(HEADER_END, HEADER_END);
    await page.keyboard.press('ArrowRight');
    expect(await head()).toBe(NEXT_HEADING);
    await expect(page.locator(PLACEHOLDERS)).toHaveCount(1);

    await select(INSIDE_FOLD, INSIDE_FOLD);
    await expect(page.locator(PLACEHOLDERS)).toHaveCount(0);
    expect(pageErrors).toEqual([]);
});

test('Tippen davor verschiebt den Bereich, Tippen hinter der Kopfzeile lässt ihn zu', async () => {
    await foldFirstChapter();
    await select(0, 0);
    await page.keyboard.type('x');
    await expect(page.locator(PLACEHOLDERS)).toHaveCount(1);
    await select(HEADER_END + 1, HEADER_END + 1);
    await page.keyboard.type(' y');
    await expect(page.locator(PLACEHOLDERS)).toHaveCount(1);
    expect((await visibleText()).startsWith('x\\chapter{Eins} y\nerste')).toBe(true);
    expect(pageErrors).toEqual([]);
});

test('neue Überschrift: nach dem entprellten Scan erscheint ein Pfeil mehr', async () => {
    const end = CHAPTERS.length;
    await select(end, end);
    await page.keyboard.type(ADDED_SECTION);
    await expect(page.locator(MARKERS)).toHaveCount(REGION_COUNT + 1);
    expect(pageErrors).toEqual([]);
});
