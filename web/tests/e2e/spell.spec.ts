import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Rechtschreibprüfung (W7-2) mit echtem Worker und mitgeliefertem Wörterbuch; nur der Preload ist der Stub
// (`spell:words`/`spell:addWord` im Speicher). Voraussetzung: Build mit Testzugang (`npm run build:e2e`).

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const MISSING_TEST_API = 'window.__editorTestApi fehlt: vorher npm run build:e2e';
const MODIFIER = 'ControlOrMeta';
/** Wörterbuch laden (~0,5 s im Worker) plus Entprellung 0,25 s; großzügig, aber ohne Schleifen */
const SPELL_TIMEOUT_MS = 15_000;
const ERROR_SELECTOR = '.cm-content .cm-spell-error';
const MESSAGE_SELECTOR = '.status-bar .status-message';

let app: ElectronApplication;
let userDataDir: string;
let page: Page;
let fileCounter = 0;
const pageErrors: string[] = [];

// Gleiche Form wie `EditorTestApi` in `src/renderer/editor/EditorHost.tsx`.
interface EditorTestApi {
    open(path: string, text: string): void;
    activate(path: string): void;
    text(): string;
    select(anchor: number, head: number): void;
}

interface StubCall {
    readonly channel: string;
    readonly args: readonly unknown[];
}

type TestWindow = {
    __editorTestApi?: EditorTestApi;
    api: { __stub: { emit(event: string, payload: unknown): void; calls(): StubCall[]; spellWords(): string[] } };
};

async function openFile(text: string, extension = 'tex'): Promise<void> {
    const path = `/stub/projekt/rechtschreibung-${fileCounter++}.${extension}`;
    await page.evaluate(([target, content]) => {
        const api = (globalThis as unknown as TestWindow).__editorTestApi!;
        api.open(target, content);
        api.activate(target);
        api.select(0, 0);
    }, [path, text] as const);
}

async function editorText(): Promise<string> {
    return page.evaluate(() => (globalThis as unknown as TestWindow).__editorTestApi?.text() ?? '');
}

function sendCommand(commandId: string): Promise<void> {
    return page.evaluate((id) => (globalThis as unknown as TestWindow).api.__stub.emit('menu:command', { commandId: id }), commandId);
}

async function errorTexts(): Promise<string[]> {
    return page.locator(ERROR_SELECTOR).allTextContents();
}

test.describe.configure({ mode: 'serial' });

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

test.afterEach(() => {
    expect(pageErrors).toEqual([]);
});

test('Tippfehler wird rot gepunktet unterstrichen, LaTeX-Befehl, Formel und Fachwort nicht', async () => {
    await openFile('Ein Tipfehlr im \\textbf{Satz} über die Adjazenzmatrix $x = \\alpha$ und Bachelorarbeit.');
    await expect(page.locator(ERROR_SELECTOR).first()).toBeVisible({ timeout: SPELL_TIMEOUT_MS });
    expect(await errorTexts()).toEqual(['Tipfehlr']);
    // Eigene Klasse, nicht die der Syntaxfehler oder Schreibhinweise
    await expect(page.locator('.cm-content .cm-diagnostic-error')).toHaveCount(0);
    const style = await page.locator(ERROR_SELECTOR).first().evaluate((element) => getComputedStyle(element).textDecorationStyle);
    expect(style).toBe('dotted');
});

test('BibTeX: nur Feldwerte werden geprüft', async () => {
    await openFile('Freitxt\n@book{schluesel2024,\n  title = {Ein Tipfehlr},\n}\n', 'bib');
    await expect(page.locator(ERROR_SELECTOR).first()).toBeVisible({ timeout: SPELL_TIMEOUT_MS });
    expect(await errorTexts()).toEqual(['Tipfehlr']);
});

test('Rechtsklick: Vorschlag ersetzt das Wort in einem Schritt, Rückgängig stellt es her', async () => {
    await openFile('Die Literatr ist gut.');
    const error = page.locator(ERROR_SELECTOR).first();
    await expect(error).toHaveText('Literatr', { timeout: SPELL_TIMEOUT_MS });
    await error.click({ button: 'right' });
    await expect(page.getByRole('menu', { name: 'Rechtschreibung' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Literatur', exact: true }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(await editorText()).toBe('Die Literatur ist gut.');
    await page.keyboard.press(`${MODIFIER}+z`);
    expect(await editorText()).toBe('Die Literatr ist gut.');
});

test('„Zum Wörterbuch hinzufügen“ entfernt die Unterstreichung und speichert das Wort über den Main', async () => {
    await openFile('Wir nutzen Kubectlx und Kubectlx.');
    await expect(page.locator(ERROR_SELECTOR)).toHaveCount(2, { timeout: SPELL_TIMEOUT_MS });
    await page.locator(ERROR_SELECTOR).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Zum Wörterbuch hinzufügen' }).click();
    await expect(page.locator(ERROR_SELECTOR)).toHaveCount(0);
    const stored = await page.evaluate(() => (globalThis as unknown as TestWindow).api.__stub.spellWords());
    expect(stored).toEqual(['Kubectlx']);
    // Auch in einer neuen Datei gilt das Wort, nach der nächsten Prüfung bleibt es ohne Unterstreichung
    await openFile('Kubectlx und Tipfehlr');
    await expect(page.locator(ERROR_SELECTOR)).toHaveText(['Tipfehlr'], { timeout: SPELL_TIMEOUT_MS });
});

test('„Ignorieren“ gilt in der Sitzung, ohne den Main zu fragen', async () => {
    await openFile('Ein Ignorierwortx bleibt.');
    await expect(page.locator(ERROR_SELECTOR)).toHaveText(['Ignorierwortx'], { timeout: SPELL_TIMEOUT_MS });
    const before = await page.evaluate(() => (globalThis as unknown as TestWindow).api.__stub.calls().length);
    await page.locator(ERROR_SELECTOR).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Ignorieren' }).click();
    await expect(page.locator(ERROR_SELECTOR)).toHaveCount(0);
    const calls = await page.evaluate(() => (globalThis as unknown as TestWindow).api.__stub.calls());
    expect(calls.slice(before).filter((call) => call.channel.startsWith('spell:'))).toEqual([]);
});

test('Schalter „Rechtschreibung prüfen“ aus: keine Unterstreichung; Statusleiste nennt den Zustand', async () => {
    await openFile('Noch ein Tipfehlr.');
    await expect(page.locator(ERROR_SELECTOR).first()).toBeVisible({ timeout: SPELL_TIMEOUT_MS });
    await sendCommand('edit.toggleSpellCheck');
    await expect(page.locator(ERROR_SELECTOR)).toHaveCount(0);
    await expect(page.locator(MESSAGE_SELECTOR)).toHaveText('Rechtschreibprüfung aus.');
    await openFile('Wieder ein Tipfehlr.');
    await page.waitForTimeout(1_000);
    await expect(page.locator(ERROR_SELECTOR)).toHaveCount(0);
    await sendCommand('edit.toggleSpellCheck');
    await expect(page.locator(MESSAGE_SELECTOR)).toHaveText('Rechtschreibprüfung ein.');
    await expect(page.locator(ERROR_SELECTOR).first()).toBeVisible({ timeout: SPELL_TIMEOUT_MS });
});
