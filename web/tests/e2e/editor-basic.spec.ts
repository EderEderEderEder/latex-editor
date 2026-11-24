import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Editor-Rahmen (W1-12b) mit dem Stub-Preload: Öffnen, Tippen, Speichern, Suche, Zoom, Hell/Dunkel.
// `window.api.__stub` gibt es nur im Stub-Preload (`tests/support/preloadStub.ts`, `StubControl`).
// Voraussetzung: gebaute App (`npm run build`); der Test braucht den Testzugang nicht.

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const MODIFIER = 'ControlOrMeta';
const FILE_NAME = 'beispiel.tex';
// Wie der Main: Dialog-Dateien heißen im Renderer nur nach ihrer Kennung (erste Kennung des Stubs).
const FILE_TARGET = 'stub-grant-0';
const FILE_TEXT = 'Hallo Welt\n';
const DEFAULT_FONT_SIZE_PX = 13;
const ZOOMED_FONT_SIZE_PX = 14.95;
const LIGHT_BACKGROUND = 'rgb(255, 255, 255)';
const DARK_BACKGROUND = 'rgb(30, 30, 30)';

let app: ElectronApplication;
let userDataDir: string;
let page: Page;
const pageErrors: string[] = [];

interface StubCall {
    channel: string;
    args: unknown[];
}

interface StubWindow {
    api: {
        __stub: {
            calls(): StubCall[];
            clearCalls(): void;
            prepareFile(name: string, text: string): void;
            failWrites(kind: string | null, message?: string): void;
        };
    };
}

async function stubCalls(channel: string): Promise<StubCall[]> {
    const calls = await page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.calls());
    return calls.filter((call) => call.channel === channel);
}

async function computedStyle(selector: string, property: string): Promise<string> {
    return page.locator(selector).first().evaluate((element, name) => {
        const scope = globalThis as unknown as { getComputedStyle(target: unknown): { getPropertyValue(key: string): string } };
        return scope.getComputedStyle(element).getPropertyValue(name);
    }, property);
}

test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-e2e-'));
    const env = { ...process.env, [STUB_PRELOAD_ENV]: '1' } as Record<string, string>;
    delete env[DEV_SERVER_ENV];
    app = await electron.launch({ args: [WEB_DIR, `--user-data-dir=${userDataDir}`], env });
    page = await app.firstWindow();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.waitForSelector('.editor-host .cm-editor');
});

test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
});

test.describe.configure({ mode: 'serial' });

test('Strg+O öffnet die gewählte Datei: Text und Tab sind sichtbar', async () => {
    await page.evaluate(
        ([name, text]) => (globalThis as unknown as StubWindow).api.__stub.prepareFile(name!, text!),
        [FILE_NAME, FILE_TEXT],
    );
    await page.keyboard.press(`${MODIFIER}+o`);
    await expect(page.locator('.cm-content')).toContainText('Hallo Welt');
    await expect(page.getByRole('tab', { name: FILE_NAME })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.tab-dirty')).toHaveCount(0);
    await expect(page.locator('.status-file')).toHaveText(FILE_NAME);
    await expect(page.locator('.status-position')).toHaveText('Zeile 1, Spalte 1');
    await expect(page.locator('.status-format')).toHaveText('UTF-8 · LF');
});

test('Tippen setzt den Punkt am Tab, Strg+S schreibt den Text und nimmt den Punkt weg', async () => {
    await page.locator('.cm-content').focus();
    await page.keyboard.type('X');
    await expect(page.locator('.tab-dirty')).toHaveCount(1);
    await expect(page.locator('.status-position')).toHaveText('Zeile 1, Spalte 2');

    await page.keyboard.press(`${MODIFIER}+s`);
    await expect(page.locator('.tab-dirty')).toHaveCount(0);
    const writes = await stubCalls('fs:writeText');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.args.slice(0, 4)).toEqual([FILE_TARGET, `X${FILE_TEXT}`, 'utf8', 'lf']);
    await expect(page.locator('.status-message')).toContainText(`Gespeichert: ${FILE_NAME}`);
});

test('ein Konflikt beim Speichern erscheint in der Statusleiste, der Punkt bleibt', async () => {
    await page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.failWrites('conflict'));
    await page.locator('.cm-content').focus();
    await page.keyboard.type('Y');
    await page.keyboard.press(`${MODIFIER}+s`);
    await expect(page.locator('.status-message')).toContainText('außerhalb des Editors geändert');
    await expect(page.locator('.tab-dirty')).toHaveCount(1);

    await page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.failWrites(null));
    await page.keyboard.press(`${MODIFIER}+s`);
    await expect(page.locator('.tab-dirty')).toHaveCount(0);
});

test('Strg+F öffnet die deutsche Suchleiste, Escape schließt sie', async () => {
    await page.locator('.cm-content').focus();
    await page.keyboard.press(`${MODIFIER}+f`);
    const searchField = page.locator('.cm-search input[name=search]');
    await expect(searchField).toBeVisible();
    await expect(searchField).toHaveAttribute('placeholder', 'Suchen');
    await expect(page.locator('.cm-search')).toContainText('Groß-/Kleinschreibung');
    await page.keyboard.press('Escape');
    await expect(page.locator('.cm-search')).toHaveCount(0);

    // Ersetzen: Strg+H; unter macOS ⌥⌘F (⌘H ist dort „Ausblenden“), siehe `editor/search.ts`
    await page.keyboard.press(process.platform === 'darwin' ? 'Alt+Meta+f' : 'Control+h');
    await expect(page.locator('.cm-search input[name=replace]')).toBeFocused();
    await page.keyboard.press('Escape');
});

test('Zoom ändert die Schriftgröße des Editors, Strg+0 stellt sie zurück', async () => {
    await page.locator('.cm-content').focus();
    expect(parseFloat(await computedStyle('.cm-content', 'font-size'))).toBe(DEFAULT_FONT_SIZE_PX);
    await page.keyboard.press(`${MODIFIER}+=`);
    await expect.poll(async () => parseFloat(await computedStyle('.cm-content', 'font-size'))).toBeCloseTo(ZOOMED_FONT_SIZE_PX, 1);
    await page.keyboard.press(`${MODIFIER}+0`);
    await expect.poll(async () => parseFloat(await computedStyle('.cm-content', 'font-size'))).toBe(DEFAULT_FONT_SIZE_PX);
    expect((await stubCalls('settings:set')).map((call) => call.args)).toEqual([['editorZoom', 115], ['editorZoom', 100]]);
});

test('der Wechsel zwischen hell und dunkel ändert die Hintergrundfarbe ohne Neuaufbau', async () => {
    const editorElement = await page.$('.cm-editor');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => computedStyle('.cm-editor', 'background-color')).toBe(LIGHT_BACKGROUND);
    const textBefore = await page.locator('.cm-content').innerText();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => computedStyle('.cm-editor', 'background-color')).toBe(DARK_BACKGROUND);
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(() => computedStyle('.cm-editor', 'background-color')).toBe(LIGHT_BACKGROUND);
    expect(await page.locator('.cm-content').innerText()).toBe(textBefore);
    expect(await editorElement?.evaluate((element) => element.isConnected)).toBe(true);
    expect(pageErrors).toEqual([]);
});
