import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Schreibhinweise, Autokorrektur und Wortzähler (W7-3). Voraussetzung: Build mit Testzugang (`npm run build:e2e`).
// Der Stub-Preload hört nicht auf den Main; Menübefehle löst der Test selbst aus (`__stub.emit`, wie `menuCommands.spec.ts`).

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const MISSING_TEST_API = 'window.__editorTestApi fehlt: vorher npm run build:e2e';
const MODIFIER = 'ControlOrMeta';
/** Entprellung 0,6 s plus Worker; großzügig, aber ohne Schleifen */
const ANALYSIS_TIMEOUT_MS = 10_000;
const HINT_SELECTOR = '.cm-content .cm-writing-hint';
const WORDS_SELECTOR = '.status-bar .status-words';
const SELECTION_WORDS_SELECTOR = '.status-bar .status-selection-words';
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

type TestWindow = {
    __editorTestApi?: EditorTestApi;
    api: { __stub: { emit(event: string, payload: unknown): void } };
};

/** Öffnet eine frische Datei mit `text`, setzt die Auswahl (Standard: Textende) */
async function openFile(text: string, anchor = text.length, head = anchor): Promise<void> {
    const path = `/stub/projekt/schreiben-${fileCounter++}.tex`;
    await page.evaluate(([target, content]) => {
        const api = (globalThis as unknown as TestWindow).__editorTestApi!;
        api.open(target, content);
        api.activate(target);
    }, [path, text] as const);
    await select(anchor, head);
}

async function select(anchor: number, head: number): Promise<void> {
    await page.evaluate((range) => (globalThis as unknown as TestWindow).__editorTestApi?.select(range.anchor, range.head), {
        anchor,
        head,
    });
}

async function editorText(): Promise<string> {
    return page.evaluate(() => (globalThis as unknown as TestWindow).__editorTestApi?.text() ?? '');
}

function sendCommand(commandId: string): Promise<void> {
    return page.evaluate((id) => (globalThis as unknown as TestWindow).api.__stub.emit('menu:command', { commandId: id }), commandId);
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

test('Schreibhinweis erscheint nach der Pause, hat einen Tooltip und verschwindet beim Beheben', async () => {
    await openFile('Das das ist doppelt.');
    const hint = page.locator(HINT_SELECTOR).first();
    await expect(hint).toBeVisible({ timeout: ANALYSIS_TIMEOUT_MS });
    expect(await hint.getAttribute('title')).toContain('zweimal');
    // Anders als Syntaxfehler (rot gestrichelt): gepunktet, eigene Klasse
    await expect(page.locator('.cm-content .cm-diagnostic-error')).toHaveCount(0);

    await select(3, 7);
    await page.keyboard.press('Backspace');
    await expect(page.locator(HINT_SELECTOR)).toHaveCount(0, { timeout: ANALYSIS_TIMEOUT_MS });
    expect(await editorText()).toBe('Das ist doppelt.');
});

test('Schalter „Schreibhinweise“ blendet die Hinweise aus und wieder ein; die Statusleiste nennt den Zustand', async () => {
    await openFile('Wieder wieder ein Fehler.');
    await expect(page.locator(HINT_SELECTOR).first()).toBeVisible({ timeout: ANALYSIS_TIMEOUT_MS });
    await sendCommand('edit.toggleWritingHints');
    await expect(page.locator(HINT_SELECTOR)).toHaveCount(0);
    await expect(page.locator(MESSAGE_SELECTOR)).toBeVisible();
    await expect(page.locator(MESSAGE_SELECTOR)).toHaveText('Schreibhinweise aus.');
    await sendCommand('edit.toggleWritingHints');
    await expect(page.locator(HINT_SELECTOR).first()).toBeVisible({ timeout: ANALYSIS_TIMEOUT_MS });
});

test('Autokorrektur: „Satz. aber “ wird „Satz. Aber “, ein Undo macht nur die Korrektur rückgängig', async () => {
    await openFile('Ein Satz. ');
    await page.keyboard.type('aber ');
    await expect.poll(editorText).toBe('Ein Satz. Aber ');
    await page.keyboard.press(`${MODIFIER}+z`);
    expect(await editorText()).toBe('Ein Satz. aber ');
});

test('Autokorrektur: nicht im Kommentar, nicht in Formeln', async () => {
    await openFile('% Ein Satz. ');
    await page.keyboard.type('aber ');
    expect(await editorText()).toBe('% Ein Satz. aber ');
    await openFile('$x$ und \\begin{equation}\na. ');
    await page.keyboard.type('b ');
    expect(await editorText()).toBe('$x$ und \\begin{equation}\na. b ');
});

test('Schalter „Großschreibung automatisch korrigieren“ aus: keine Korrektur', async () => {
    await sendCommand('edit.toggleAutoCapitalize');
    await expect(page.locator(MESSAGE_SELECTOR)).toHaveText('Automatische Korrektur der Großschreibung aus.');
    await openFile('Ein Satz. ');
    await page.keyboard.type('aber ');
    expect(await editorText()).toBe('Ein Satz. aber ');
    await sendCommand('edit.toggleAutoCapitalize');
    await expect(page.locator(MESSAGE_SELECTOR)).toHaveText('Großschreibung wird automatisch korrigiert.');
});

test('Wortzähler: Datei und Auswahl in der Statusleiste, Meldung bleibt lesbar', async () => {
    await openFile('Eins zwei drei vier fünf', 0, 9);
    await expect(page.locator(WORDS_SELECTOR)).toHaveText('5 Wörter', { timeout: ANALYSIS_TIMEOUT_MS });
    await expect(page.locator(SELECTION_WORDS_SELECTOR)).toHaveText('2 Wörter ausgewählt');
    await sendCommand('edit.toggleWritingHints');
    await expect(page.locator(MESSAGE_SELECTOR)).toBeVisible();
    const box = await page.locator(MESSAGE_SELECTOR).boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    await sendCommand('edit.toggleWritingHints');
    await select(0, 0);
    await expect(page.locator(SELECTION_WORDS_SELECTOR)).toHaveCount(0);
});

test('Wortzähler läuft auch bei ausgeschalteten Schreibhinweisen weiter', async () => {
    await sendCommand('edit.toggleWritingHints');
    await openFile('Nur drei Wörter');
    await expect(page.locator(WORDS_SELECTOR)).toHaveText('3 Wörter', { timeout: ANALYSIS_TIMEOUT_MS });
    await sendCommand('edit.toggleWritingHints');
});
