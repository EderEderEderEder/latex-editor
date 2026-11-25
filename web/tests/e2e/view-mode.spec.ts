import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// W3-4: Arbeitsbereich Editor / Geteilt / PDF mit Stub-Preload. Geprüft: Editor und PDF bleiben in jedem Modus
// eingehängt (Auswahl, Seite, Zoom bleiben), Teiler per Tastatur, Maus und Doppelklick, Menübefehl.
// Voraussetzung: Build mit Testzugang (`npm run build:e2e`).

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const MAIN_PDF = '/stub/projekt/main.pdf';
const FILE_PATH = '/stub/projekt/main.tex';
const FILE_TEXT = 'Erste Zeile\nZweite Zeile\nDritte Zeile';
const SELECTION = { anchor: 3, head: 9 };
const PAGE_COUNT = 4;
const HANDLE_WIDTH = 14;
const KEY_STEP_PX = 16;
const DRAG_DISTANCE_PX = 80;
const EDITOR_MIN_WIDTH = 180;
const FIXTURE = readFileSync(join(__dirname, '../fixtures/vier-seiten.pdf')).toString('base64');

interface StubWindow {
    api: { __stub: { installSampleProject(): void; setPdf(path: string, base64: string | null): void; emit(event: string, payload: unknown): void } };
}
interface EditorTestApi {
    open(path: string, text: string): void;
    selection(): { anchor: number; head: number };
    select(anchor: number, head: number): void;
    text(): string;
}
type TestWindow = { __editorTestApi?: EditorTestApi };

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

const editorPane = () => page.getByRole('region', { name: 'Editor', exact: true });
const pdfPane = () => page.getByRole('region', { name: 'PDF', exact: true });
const handle = () => page.getByRole('separator', { name: 'Teiler zwischen Editor und PDF' });
const modeButton = (name: string) => page.getByRole('group', { name: 'Ansicht' }).getByRole('button', { name, exact: true });
const pageIndicator = () => pdfPane().locator('.pdf-page-indicator');
const zoomValue = () => pdfPane().locator('.pdf-zoom-value');

const sendCommand = (commandId: string): Promise<void> =>
    page.evaluate((id) => (globalThis as unknown as StubWindow).api.__stub.emit('menu:command', { commandId: id }), commandId);
const editorSelection = (): Promise<{ anchor: number; head: number } | undefined> =>
    page.evaluate(() => (globalThis as unknown as TestWindow).__editorTestApi?.selection());
const editorWidth = async (): Promise<number> => (await editorPane().boundingBox())?.width ?? 0;
const handleValue = async (): Promise<number> => Number(await handle().getAttribute('aria-valuenow'));

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-e2e-'));
    const env = { ...process.env, [STUB_PRELOAD_ENV]: '1' } as Record<string, string>;
    delete env[DEV_SERVER_ENV];
    app = await electron.launch({ args: [WEB_DIR, `--user-data-dir=${userDataDir}`], env });
    page = await app.firstWindow();
    await page.waitForSelector('.editor-host .cm-editor');
    await page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.installSampleProject());
    await page.evaluate(([path, data]) => (globalThis as unknown as StubWindow).api.__stub.setPdf(path, data), [MAIN_PDF, FIXTURE] as const);
    await page.getByRole('button', { name: 'Projekt öffnen …', exact: true }).click();
    await expect(pageIndicator()).toHaveText(`Seite 1 / ${PAGE_COUNT}`);
    await page.evaluate(([path, text]) => (globalThis as unknown as TestWindow).__editorTestApi?.open(path, text), [FILE_PATH, FILE_TEXT] as const);
    await page.evaluate((range) => (globalThis as unknown as TestWindow).__editorTestApi?.select(range.anchor, range.head), SELECTION);
});

test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
});

test('Standard ist „Geteilt“: beide Seiten sichtbar, Teiler 14 px breit', async () => {
    await expect(modeButton('Geteilt')).toHaveAttribute('aria-pressed', 'true');
    await expect(editorPane()).toBeVisible();
    await expect(pdfPane()).toBeVisible();
    expect((await handle().boundingBox())?.width).toBe(HANDLE_WIDTH);
});

test('Moduswechsel behält Auswahl, PDF-Seite und Zoom; nichts wird neu aufgebaut', async () => {
    await pdfPane().getByRole('button', { name: 'Nächste Seite', exact: true }).click();
    await pdfPane().getByRole('button', { name: 'Vergrößern', exact: true }).click();
    await expect(pageIndicator()).toHaveText(`Seite 2 / ${PAGE_COUNT}`);
    const zoomBefore = await zoomValue().textContent();
    const viewerBefore = await pdfPane().locator('.pdfViewer').elementHandle();
    const editorBefore = await page.locator('.editor-host .cm-editor').elementHandle();

    await modeButton('Editor').click();
    await expect(pdfPane()).toBeHidden();
    await expect(editorPane()).toBeVisible();
    await modeButton('PDF').click();
    await expect(editorPane()).toBeHidden();
    await expect(pdfPane()).toBeVisible();
    await modeButton('Geteilt').click();
    await expect(editorPane()).toBeVisible();

    expect(await editorSelection()).toEqual(SELECTION);
    await expect(pageIndicator()).toHaveText(`Seite 2 / ${PAGE_COUNT}`);
    expect(await zoomValue().textContent()).toBe(zoomBefore);
    expect(await viewerBefore?.evaluate((node) => node.isConnected)).toBe(true);
    expect(await editorBefore?.evaluate((node) => node.isConnected)).toBe(true);
});

test('Modusschalter: Editor und PDF füllen die ganze Breite', async () => {
    const body = (await page.locator('.workspace-body').boundingBox())?.width ?? 0;
    await modeButton('Editor').click();
    expect(Math.abs(((await editorPane().boundingBox())?.width ?? 0) - body)).toBeLessThan(2);
    await modeButton('PDF').click();
    expect(Math.abs(((await pdfPane().boundingBox())?.width ?? 0) - body)).toBeLessThan(2);
    await modeButton('Geteilt').click();
});

test('Teiler per Tastatur: Pfeile ändern den Wert um einen Schritt, Pos1 klemmt auf die Mindestbreite', async () => {
    await handle().focus();
    const before = await handleValue();
    await page.keyboard.press('ArrowRight');
    await expect.poll(handleValue).toBe(before + KEY_STEP_PX);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(handleValue).toBe(before - KEY_STEP_PX);
    await page.keyboard.press('Home');
    await expect.poll(handleValue).toBe(EDITOR_MIN_WIDTH);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(handleValue).toBe(EDITOR_MIN_WIDTH);
});

test('Teiler per Maus verschieben, Doppelklick setzt auf die Mitte zurück; Auswahl bleibt', async () => {
    await handle().dblclick();
    await expect.poll(handleValue).toBeGreaterThan(EDITOR_MIN_WIDTH);
    const middle = await handleValue();
    const box = await handle().boundingBox();
    if (box === null) throw new Error('Teiler nicht sichtbar');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + DRAG_DISTANCE_PX, y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(handleValue).toBe(middle + DRAG_DISTANCE_PX);
    expect(Math.abs((await editorWidth()) - (middle + DRAG_DISTANCE_PX))).toBeLessThan(2);
    await handle().dblclick();
    await expect.poll(handleValue).toBe(middle);
    expect(await editorSelection()).toEqual(SELECTION);
});

test('Menübefehle view.mode.* wechseln den Modus', async () => {
    await sendCommand('view.mode.pdf');
    await expect(modeButton('PDF')).toHaveAttribute('aria-pressed', 'true');
    await expect(editorPane()).toBeHidden();
    await sendCommand('view.mode.editor');
    await expect(modeButton('Editor')).toHaveAttribute('aria-pressed', 'true');
    await expect(pdfPane()).toBeHidden();
    await sendCommand('view.mode.split');
    await expect(editorPane()).toBeVisible();
    await expect(pdfPane()).toBeVisible();
    expect(await editorSelection()).toEqual(SELECTION);
});
