import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Sitzungstausch im einen EditorView (W1-6). Voraussetzung: Build mit Testzugang
// (`RENDERER_VITE_EDITOR_TEST_API=1 npm run build`); im normalen Build und im Paket fehlt `window.__editorTestApi`.

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const LONG_PATH = '/stub/projekt/lang.tex';
const SHORT_PATH = '/stub/projekt/kurz.tex';
const LONG_LINE_COUNT = 5_000;
const SHORT_TEXT = 'kurz';
const MISSING_TEST_API = 'window.__editorTestApi fehlt: vorher RENDERER_VITE_EDITOR_TEST_API=1 npm run build';

let app: ElectronApplication;
let userDataDir: string;
let page: Page;
const pageErrors: string[] = [];

// Gleiche Form wie `EditorTestApi` in `src/renderer/editor/EditorHost.tsx` (die .tsx-Datei gehört nicht zur Node-Typprüfung).
interface EditorTestApi {
    open(path: string, text: string): void;
    activate(path: string): void;
    text(): string;
    selection(): { anchor: number; head: number };
    select(anchor: number, head: number): void;
    isDirty(path: string): boolean;
}

type TestWindow = { __editorTestApi?: EditorTestApi };

function longText(): string {
    return Array.from({ length: LONG_LINE_COUNT }, (_, index) => `\\section{Abschnitt ${index}}`).join('\n');
}

// Je Aufruf ein eigenes `evaluate` (die Funktion wird serialisiert; `new Function` verbietet die CSP).
async function activate(path: string): Promise<void> {
    await page.evaluate((target) => (globalThis as unknown as TestWindow).__editorTestApi?.activate(target), path);
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

async function selection(): Promise<{ anchor: number; head: number } | undefined> {
    return page.evaluate(() => (globalThis as unknown as TestWindow).__editorTestApi?.selection());
}

async function isDirty(path: string): Promise<boolean | undefined> {
    return page.evaluate((target) => (globalThis as unknown as TestWindow).__editorTestApi?.isDirty(target), path);
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
        ([longPath, longContent, shortPath, shortContent]) => {
            const api = (globalThis as unknown as TestWindow).__editorTestApi!;
            api.open(longPath, longContent);
            api.open(shortPath, shortContent);
        },
        [LONG_PATH, longText(), SHORT_PATH, SHORT_TEXT] as const,
    );
});

test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
});

test('lange → kurze Datei wechseln ohne Fehler, die View bleibt dieselbe', async () => {
    const editorElement = await page.$('.cm-editor');
    await activate(LONG_PATH);
    const end = (await visibleText()).length;
    await select(end, end);
    await activate(SHORT_PATH);
    expect(await visibleText()).toBe(SHORT_TEXT);
    expect(await selection()).toEqual({ anchor: 0, head: 0 });
    await expect(page.locator('.cm-content')).toHaveText(SHORT_TEXT);
    expect(await page.$$('.cm-editor')).toHaveLength(1);
    expect(await editorElement?.evaluate((element) => element.isConnected)).toBe(true);
    expect(pageErrors).toEqual([]);
});

test('Undo gilt je Datei', async () => {
    await activate(LONG_PATH);
    await select(0, 0);
    await page.keyboard.type('A');
    await activate(SHORT_PATH);
    await select(0, 0);
    await page.keyboard.type('B');
    expect(await visibleText()).toBe(`B${SHORT_TEXT}`);
    expect(await isDirty(LONG_PATH)).toBe(true);

    await page.keyboard.press('ControlOrMeta+z');
    expect(await visibleText()).toBe(SHORT_TEXT);
    expect(await isDirty(SHORT_PATH)).toBe(false);
    await page.keyboard.press('ControlOrMeta+z');
    expect(await visibleText()).toBe(SHORT_TEXT);

    await activate(LONG_PATH);
    await page.locator('.cm-content').focus();
    expect((await visibleText()).startsWith('A\\section')).toBe(true);
    await page.keyboard.press('ControlOrMeta+z');
    expect((await visibleText()).startsWith('\\section{Abschnitt 0}')).toBe(true);
    expect(await isDirty(LONG_PATH)).toBe(false);
    expect(pageErrors).toEqual([]);
});

test('Auswahl bleibt je Sitzung erhalten', async () => {
    await activate(LONG_PATH);
    await select(120, 145);
    await activate(SHORT_PATH);
    await select(1, 3);
    await activate(LONG_PATH);
    expect(await selection()).toEqual({ anchor: 120, head: 145 });
    await activate(SHORT_PATH);
    expect(await selection()).toEqual({ anchor: 1, head: 3 });
    expect(pageErrors).toEqual([]);
});
