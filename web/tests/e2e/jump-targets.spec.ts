import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JUMP_KEY, pointOfText } from '../support/editorPoints';

// W4-13: Strg-Klick-Ziele (macOS ⌘-Klick) im echten Editor mit dem Stub-Preload: Zeiger und Unterstreichung bei
// gedrückter Taste, Sprung zu Label, Quelle, Abkürzung und Datei, normale Klicks bleiben unberührt, Klick auf Text ohne
// Ziel zeigt die Stelle im PDF (hier: Meldung „Noch kein PDF“). Echte Maus und Tastatur über Playwright.
// Voraussetzung: Build mit Testzugang (`npm run build:e2e`).

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const MISSING_TEST_API = 'window.__editorTestApi fehlt: vorher npm run build:e2e';
const ROOT = '/stub/projekt';
const SOURCE_FILE = 'kapitel/ziele.tex';
const SOURCE_PATH = `${ROOT}/${SOURCE_FILE}`;
const SOURCE_TEXT = [
    '\\input{kapitel/fazit}',
    'Siehe \\ref{sec:ziel} und \\cite{knuth1984} sowie \\gls{api}.',
    'Normaler Text steht hier und \\ref{sec:fehlt} nirgends.',
    '',
].join('\n');
const DEFINITION_FILE = 'kapitel/definition.tex';
const DEFINITION_PATH = `${ROOT}/${DEFINITION_FILE}`;
const DEFINITION_TEXT = '\\section{Ziel}\n\n\\label{sec:ziel}\n\\newacronym{api}{API}{Schnittstelle}\n';
const LABEL_LINE = 3;
const ACRONYM_LINE = 4;
const BIB_PATH = `${ROOT}/quellen.bib`;
const BIB_TEXT = '@misc{vorher,\n}\n\n@book{knuth1984,\n  title = {TeX}\n}\n';
const BIB_ENTRY_LINE = 4;
const FAZIT_PATH = `${ROOT}/kapitel/fazit.tex`;
const INDEX_TIMEOUT_MS = 8_000;

interface StubWindow {
    __editorTestApi?: {
        open(path: string, text: string): void;
        activate(path: string): void;
        activePath(): string | null;
        text(): string;
        selection(): { anchor: number; head: number };
        select(anchor: number, head: number): void;
    };
    api: { __stub: { installSampleProject(): void; addProjectFile(relativePath: string, text: string): void } };
}

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
const pageErrors: string[] = [];

const target = () => page.locator('.cm-content .cm-jump-target');
const statusMessage = () => page.locator('.status-message');
const activePath = (): Promise<string | null> => page.evaluate(() => (globalThis as unknown as StubWindow).__editorTestApi!.activePath());

async function cursorLine(): Promise<number> {
    return page.evaluate(() => {
        const api = (globalThis as unknown as StubWindow).__editorTestApi!;
        return api.text().slice(0, api.selection().head).split('\n').length;
    });
}

async function cursorHead(): Promise<number> {
    return page.evaluate(() => (globalThis as unknown as StubWindow).__editorTestApi!.selection().head);
}

async function showSource(): Promise<void> {
    await page.evaluate(([path, text]) => {
        const api = (globalThis as unknown as StubWindow).__editorTestApi!;
        api.open(path, text);
        api.activate(path);
        api.select(0, 0);
    }, [SOURCE_PATH, SOURCE_TEXT] as const);
    await page.locator('.cm-content').focus();
    await expect.poll(activePath).toBe(SOURCE_PATH);
}

/** Klick mit der Sprungtaste auf das Zeichen `offset` hinter dem Anfang von `needle` */
async function jumpClick(needle: string, offset = 1): Promise<void> {
    const point = await pointOfText(page, needle, offset);
    await page.keyboard.down(JUMP_KEY);
    await page.mouse.click(point.x, point.y);
    await page.keyboard.up(JUMP_KEY);
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
    const hasApi = await page.evaluate(() => (globalThis as unknown as StubWindow).__editorTestApi !== undefined);
    if (!hasApi) throw new Error(MISSING_TEST_API);
    await page.evaluate(([files]) => {
        const stub = (globalThis as unknown as StubWindow).api.__stub;
        stub.installSampleProject();
        for (const [relative, text] of files) stub.addProjectFile(relative, text);
    }, [[[SOURCE_FILE, SOURCE_TEXT], [DEFINITION_FILE, DEFINITION_TEXT], ['quellen.bib', BIB_TEXT]]] as const);
    await page.getByRole('button', { name: 'Projekt öffnen …', exact: true }).first().click();
    await expect(page.getByText('Hauptdatei: main.tex')).toBeVisible();
    await showSource();
    // Der Index kommt aus dem Worker: Ohne Ergebnis meldet der Sprung „Kein Projekt offen“
    await expect(page.locator('.cm-reference-error')).toHaveCount(1, { timeout: INDEX_TIMEOUT_MS });
});

test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
});

test.afterEach(() => {
    expect(pageErrors).toEqual([]);
});

test('mit gedrückter Sprungtaste ist das Ziel unterstrichen und der Zeiger eine Hand; ohne Taste nicht', async () => {
    const point = await pointOfText(page, 'sec:ziel', 2);
    await page.mouse.move(point.x, point.y);
    await expect(target()).toHaveCount(0);
    await page.keyboard.down(JUMP_KEY);
    await page.mouse.move(point.x + 1, point.y);
    await expect(target()).toHaveText('sec:ziel');
    expect(await target().evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer');
    await page.keyboard.up(JUMP_KEY);
    await expect(target()).toHaveCount(0);
});

test('über Text ohne Ziel zeigt sich nichts, auch nicht mit gedrückter Taste', async () => {
    const point = await pointOfText(page, 'Normaler Text', 3);
    await page.keyboard.down(JUMP_KEY);
    await page.mouse.move(point.x, point.y);
    await page.mouse.move(point.x + 1, point.y);
    await expect(target()).toHaveCount(0);
    await page.keyboard.up(JUMP_KEY);
});

test('Taste drücken, während die Maus schon über dem Ziel ruht, zeigt das Ziel; Loslassen löscht es', async () => {
    const point = await pointOfText(page, 'knuth1984', 2);
    await page.mouse.move(point.x, point.y);
    await page.keyboard.down(JUMP_KEY);
    await expect(target()).toHaveText('knuth1984');
    await page.keyboard.up(JUMP_KEY);
    await expect(target()).toHaveCount(0);
});

test('ein normaler Klick auf `\\ref{…}` setzt nur den Cursor, springt nicht', async () => {
    const point = await pointOfText(page, 'sec:ziel', 2);
    await page.mouse.click(point.x, point.y);
    expect(await activePath()).toBe(SOURCE_PATH);
    expect(await cursorHead()).toBeGreaterThan(SOURCE_TEXT.indexOf('sec:ziel'));
    await expect(target()).toHaveCount(0);
});

test('Textauswahl per Ziehen ohne Taste bleibt unberührt', async () => {
    const from = await pointOfText(page, 'Normaler Text', 0);
    const to = await pointOfText(page, 'Normaler Text', 8);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    const selection = await page.evaluate(() => (globalThis as unknown as StubWindow).__editorTestApi!.selection());
    expect(Math.abs(selection.head - selection.anchor)).toBeGreaterThan(3);
    expect(await activePath()).toBe(SOURCE_PATH);
});

test('Strg-Klick auf `\\ref{sec:ziel}` öffnet die Label-Definition (Datei und Zeile)', async () => {
    await showSource();
    await jumpClick('sec:ziel', 2);
    await expect.poll(activePath).toBe(DEFINITION_PATH);
    await expect.poll(cursorLine).toBe(LABEL_LINE);
});

test('Strg-Klick auf `\\cite{knuth1984}` öffnet den Eintrag in der .bib', async () => {
    await showSource();
    await jumpClick('knuth1984', 3);
    await expect.poll(activePath).toBe(BIB_PATH);
    await expect.poll(cursorLine).toBe(BIB_ENTRY_LINE);
});

test('Strg-Klick auf `\\gls{api}` öffnet die Definition der Abkürzung', async () => {
    await showSource();
    await jumpClick('api}.', 1);
    await expect.poll(activePath).toBe(DEFINITION_PATH);
    await expect.poll(cursorLine).toBe(ACRONYM_LINE);
});

test('Strg-Klick auf `\\input{kapitel/fazit}` öffnet die Datei', async () => {
    await showSource();
    await jumpClick('kapitel/fazit', 4);
    await expect.poll(activePath).toBe(FAZIT_PATH);
});

test('Strg-Klick auf einen Verweis ohne Definition meldet es und springt nicht', async () => {
    await showSource();
    await jumpClick('sec:fehlt', 2);
    await expect(statusMessage()).toContainText('sec:fehlt');
    expect(await activePath()).toBe(SOURCE_PATH);
});

test('Strg-Klick auf normalen Text setzt den Cursor dorthin und zeigt die Stelle im PDF (hier: noch kein PDF)', async () => {
    await showSource();
    await jumpClick('Normaler Text', 4);
    expect(await activePath()).toBe(SOURCE_PATH);
    const head = await cursorHead();
    const start = SOURCE_TEXT.indexOf('Normaler Text');
    expect([start + 4, start + 5]).toContain(head);
    await expect(statusMessage()).toContainText('Noch kein PDF');
});
