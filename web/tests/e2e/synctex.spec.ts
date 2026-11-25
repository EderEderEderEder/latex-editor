import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// W3-5: SyncTeX-Abläufe mit dem Stub-Preload (`LATEXEDITOR_STUB_PRELOAD`) und dem Fixture-PDF `vier-seiten.pdf`.
// Der Stub hat keinen Index: `__stub.setSyncTeX` legt die Antworten fest, `__stub.emit` schickt `synctex:ready` und
// `menu:command` (native Menü-Kürzel wie Strg+J erreichen Playwright nicht). Geprüft: Strg+J scrollt zur Seite und
// wechselt aus „Editor“ nach „Geteilt“, ⌘-/Strg-Klick ins PDF öffnet die Datei an der Zeile (aus „PDF“ nach „Geteilt“),
// normaler Klick fragt nicht, Dateien außerhalb werden nicht geöffnet, „PDF folgt Cursor“ fragt nach Cursorbewegung.

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const ROOT = '/stub/projekt';
const MAIN_PDF = `${ROOT}/main.pdf`;
const CHAPTER = `${ROOT}/kapitel/einleitung.tex`;
const CONCLUSION = `${ROOT}/kapitel/fazit.tex`;
const PAGE_COUNT = 4;
const FIXTURE = readFileSync(join(__dirname, '../fixtures/vier-seiten.pdf')).toString('base64');
const SYNC_MODIFIER = 'ControlOrMeta';
const CLICK_OFFSET = { x: 60, y: 80 };

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface StubCall {
    channel: string;
    args: unknown[];
}

interface StubWindow {
    api: {
        __stub: {
            installSampleProject(): void;
            setPdf(path: string, base64: string | null): void;
            setSyncTeX(forward: { page: number; rects: Rect[] } | null, backward: { file: string; line: number } | null): void;
            emit(event: string, payload: unknown): void;
            calls(): StubCall[];
            clearCalls(): void;
        };
    };
}

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

const pane = () => page.getByRole('region', { name: 'PDF' });
const pageIndicator = () => pane().locator('.pdf-page-indicator');
const pdfPage = (pageNumber: number) => pane().locator(`.pdfViewer .page[data-page-number="${pageNumber}"]`);
const modeButton = (name: string) => page.getByRole('group', { name: 'Ansicht' }).getByRole('button', { name, exact: true });
const statusMessage = () => page.locator('.status-message');
const tree = () => page.getByRole('tree', { name: 'Dateibaum' });
const lineTarget = (pageNumber: number) => ({ page: pageNumber, rects: [{ x: 72, y: 400, width: 300, height: 12 }] });

const sendCommand = (commandId: string): Promise<void> =>
    page.evaluate((id) => (globalThis as unknown as StubWindow).api.__stub.emit('menu:command', { commandId: id }), commandId);
const setSyncTeX = (forward: { page: number; rects: Rect[] } | null, backward: { file: string; line: number } | null): Promise<void> =>
    page.evaluate(([f, b]) => (globalThis as unknown as StubWindow).api.__stub.setSyncTeX(f, b), [forward, backward] as const);
const callsOf = async (channel: string): Promise<unknown[][]> =>
    (await page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.calls()))
        .filter((call) => call.channel === channel).map((call) => call.args);
const clearCalls = (): Promise<void> => page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.clearCalls());

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-e2e-'));
    const env = { ...process.env, [STUB_PRELOAD_ENV]: '1' } as Record<string, string>;
    delete env[DEV_SERVER_ENV];
    app = await electron.launch({ args: [WEB_DIR, `--user-data-dir=${userDataDir}`], env });
    page = await app.firstWindow();
    await page.waitForSelector('.editor-host .cm-editor');
    await page.evaluate(([path, pdf]) => {
        const stub = (globalThis as unknown as StubWindow).api.__stub;
        stub.installSampleProject();
        stub.setPdf(path, pdf);
    }, [MAIN_PDF, FIXTURE] as const);
    await page.getByRole('button', { name: 'Projekt öffnen …', exact: true }).click();
    await expect(pageIndicator()).toHaveText(`Seite 1 / ${PAGE_COUNT}`);
    await tree().getByRole('treeitem', { name: 'kapitel', exact: true }).click();
    await tree().getByRole('treeitem', { name: 'einleitung.tex', exact: true }).dblclick();
    await expect(page.getByRole('tab', { name: 'einleitung.tex' })).toHaveAttribute('aria-selected', 'true');
});

test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
});

test('Strg+J ohne SyncTeX-Daten: freundliche Meldung, PDF bleibt stehen', async () => {
    await sendCommand('view.synctexForward');
    await expect(statusMessage()).toContainText('Keine SyncTeX-Daten');
    await expect(pageIndicator()).toHaveText(`Seite 1 / ${PAGE_COUNT}`);
});

test('Strg+J fragt mit Datei und Cursorzeile und scrollt zur Seite, ohne Markierung', async () => {
    await page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.emit('synctex:ready', { pdfMtime: 1 }));
    await setSyncTeX(lineTarget(3), null);
    await clearCalls();
    await sendCommand('view.synctexForward');
    await expect(pageIndicator()).toHaveText(`Seite 3 / ${PAGE_COUNT}`);
    expect(await callsOf('synctex:forward')).toEqual([[CHAPTER, 1]]);
    await expect(pane().locator('.highlight, .synctex-highlight')).toHaveCount(0);
});

test('Strg+J im Modus „Editor“ wechselt nach „Geteilt“', async () => {
    await sendCommand('view.mode.editor');
    await expect(modeButton('Editor')).toHaveAttribute('aria-pressed', 'true');
    await setSyncTeX(lineTarget(2), null);
    await sendCommand('view.synctexForward');
    await expect(modeButton('Geteilt')).toHaveAttribute('aria-pressed', 'true');
    await expect(pageIndicator()).toHaveText(`Seite 2 / ${PAGE_COUNT}`);
});

test('normaler Klick ins PDF fragt nicht nach der Quelle', async () => {
    await clearCalls();
    await pdfPage(2).click({ position: CLICK_OFFSET });
    expect(await callsOf('synctex:backward')).toEqual([]);
});

test('⌘-/Strg-Klick ins PDF öffnet die Datei an der Zeile; aus „PDF“ nach „Geteilt“', async () => {
    await setSyncTeX(null, { file: CONCLUSION, line: 2 });
    await sendCommand('view.mode.pdf');
    await expect(modeButton('PDF')).toHaveAttribute('aria-pressed', 'true');
    await clearCalls();
    await pdfPage(2).click({ position: CLICK_OFFSET, modifiers: [SYNC_MODIFIER] });
    await expect(page.getByRole('tab', { name: 'fazit.tex' })).toHaveAttribute('aria-selected', 'true');
    await expect(modeButton('Geteilt')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.status-position')).toHaveText(/^Zeile 2, Spalte/);
    const [args] = await callsOf('synctex:backward');
    expect(args?.[0]).toBe(2);
    expect(Number(args?.[1])).toBeGreaterThan(0);
    expect(Number(args?.[2])).toBeGreaterThan(0);
});

test('Quelle außerhalb des Projekts wird nicht geöffnet, nur gemeldet', async () => {
    await setSyncTeX(null, { file: '/anderswo/fremd.tex', line: 1 });
    const tabCount = await page.getByRole('tab').count();
    await pdfPage(2).click({ position: CLICK_OFFSET, modifiers: [SYNC_MODIFIER] });
    await expect(statusMessage()).toContainText('fremd.tex');
    await expect(page.getByRole('tab')).toHaveCount(tabCount);
});

test('PDF folgt Cursor: Schalter im Menü, nach einer Cursorbewegung springt das PDF mit', async () => {
    await sendCommand('view.toggleFollowCursor');
    await expect(statusMessage()).toHaveText('PDF folgt dem Cursor.');
    await setSyncTeX(lineTarget(4), null);
    await clearCalls();
    await page.locator('.cm-content').click();
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await callsOf('synctex:forward')).length).toBeGreaterThan(0);
    await expect(pageIndicator()).toHaveText(`Seite 4 / ${PAGE_COUNT}`);
    await sendCommand('view.toggleFollowCursor');
    await expect(statusMessage()).toHaveText('PDF folgt dem Cursor nicht mehr.');
});
