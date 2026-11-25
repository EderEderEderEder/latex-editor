import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// W3-3: PDF-Ansicht mit dem Stub-Preload (`LATEXEDITOR_STUB_PRELOAD`) und dem Fixture-PDF `tests/fixtures/vier-seiten.pdf`
// (4 Seiten, Text „Seite n“ und „Fassung A“). Geprüft: Anzeige beim Öffnen des Projekts, pdf.js unter der strikten CSP
// (Worker, Standardschrift offline), Zoom-Leiste, Seitenwechsel, Neuladen nach `build:finished` behält die Seite, ein
// Lesefehler lässt die alte Ansicht stehen. Voraussetzung: Build mit Testzugang (`npm run build:e2e`).

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const MAIN_PDF = '/stub/projekt/main.pdf';
const PAGE_COUNT = 4;
const FIXTURE = readFileSync(join(__dirname, '../fixtures/vier-seiten.pdf'));
const FIXTURE_V1 = FIXTURE.toString('base64');
// Gleiche Länge: Offsets der Querverweistabelle bleiben gültig.
const FIXTURE_V2 = Buffer.from(FIXTURE.toString('latin1').replaceAll('Fassung A', 'Fassung B'), 'latin1').toString('base64');
const PERCENT_PATTERN = /^(\d+) %$/;
const INCOMPLETE_MESSAGE = 'PDF ist unvollständig';

interface StubWindow {
    api: {
        __stub: {
            installSampleProject(): void;
            setPdf(path: string, base64: string | null): void;
            failPdf(kind: string | null, message?: string): void;
            emit(event: string, payload: unknown): void;
        };
    };
}

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
const pageErrors: string[] = [];
const cspViolations: string[] = [];

const pane = () => page.getByRole('region', { name: 'PDF' });
const button = (name: string) => pane().getByRole('button', { name, exact: true });
const pageIndicator = () => pane().locator('.pdf-page-indicator');
const zoomValue = () => pane().locator('.pdf-zoom-value');
const pdfPage = (pageNumber: number) => pane().locator(`.pdfViewer .page[data-page-number="${pageNumber}"]`);

const setPdf = (base64: string): Promise<void> =>
    page.evaluate(([path, data]) => (globalThis as unknown as StubWindow).api.__stub.setPdf(path, data), [MAIN_PDF, base64] as const);
const failPdf = (kind: string | null): Promise<void> =>
    page.evaluate((value) => (globalThis as unknown as StubWindow).api.__stub.failPdf(value, 'PDF ist unvollständig'), kind);
const finishBuild = (): Promise<void> =>
    page.evaluate((path) => (globalThis as unknown as StubWindow).api.__stub.emit('build:finished', {
        ok: true, cancelled: false, report: [], pdfPath: path, durationMs: 1,
    }), MAIN_PDF);

async function zoomPercent(): Promise<number> {
    const match = PERCENT_PATTERN.exec((await zoomValue().textContent()) ?? '');
    return match === null ? Number.NaN : Number(match[1]);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-e2e-'));
    const env = { ...process.env, [STUB_PRELOAD_ENV]: '1' } as Record<string, string>;
    delete env[DEV_SERVER_ENV];
    app = await electron.launch({ args: [WEB_DIR, `--user-data-dir=${userDataDir}`], env });
    page = await app.firstWindow();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error' && message.text().includes('Content Security Policy')) cspViolations.push(message.text());
    });
    await page.waitForSelector('.editor-host .cm-editor');
    await page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.installSampleProject());
    await setPdf(FIXTURE_V1);
});

test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
});

test('ohne Projekt: leere Ansicht, Zoom-Knöpfe gesperrt', async () => {
    await expect(pane()).toContainText('Kein PDF');
    await expect(pageIndicator()).toHaveText('Seite – / –');
    await expect(button('Vergrößern')).toBeDisabled();
});

test('beim Öffnen des Projekts erscheint main.pdf mit allen Seiten, Text- und Anmerkungsebene', async () => {
    await page.getByRole('button', { name: 'Projekt öffnen …', exact: true }).click();
    await expect(pageIndicator()).toHaveText(`Seite 1 / ${PAGE_COUNT}`);
    await expect(pane().locator('.pdfViewer .page')).toHaveCount(PAGE_COUNT);
    await expect(pdfPage(1).locator('canvas')).toBeVisible();
    await expect(pdfPage(1).locator('.textLayer')).toContainText('Seite 1');
    await expect(pdfPage(1).locator('.textLayer')).toContainText('Fassung A');
    await expect(pane().locator('.pdf-empty')).toHaveCount(0);
    expect(cspViolations).toEqual([]);
});

test('Zoom: Breite ist voreingestellt, Plus/Minus ändern den Prozentwert, „Seite anpassen“ wird aktiv', async () => {
    await expect(button('Breite anpassen')).toHaveAttribute('aria-pressed', 'true');
    const fitted = await zoomPercent();
    expect(fitted).toBeGreaterThan(0);
    await button('Vergrößern').click();
    await expect.poll(zoomPercent).toBeGreaterThan(fitted);
    await expect(button('Breite anpassen')).toHaveAttribute('aria-pressed', 'false');
    const enlarged = await zoomPercent();
    await button('Verkleinern').click();
    await expect.poll(zoomPercent).toBeLessThan(enlarged);
    await button('Seite anpassen').click();
    await expect(button('Seite anpassen')).toHaveAttribute('aria-pressed', 'true');
    await button('Breite anpassen').click();
    await expect.poll(zoomPercent).toBe(fitted);
});

test('Seitenwechsel mit den Knöpfen; am Anfang ist „Vorherige Seite“ gesperrt', async () => {
    await expect(button('Vorherige Seite')).toBeDisabled();
    await button('Nächste Seite').click();
    await expect(pageIndicator()).toHaveText(`Seite 2 / ${PAGE_COUNT}`);
    await button('Nächste Seite').click();
    await expect(pageIndicator()).toHaveText(`Seite 3 / ${PAGE_COUNT}`);
    await expect(pdfPage(3).locator('.textLayer')).toContainText('Seite 3');
});

test('Neuladen nach einem Build zeigt die neue Fassung und behält Seite und Zoom', async () => {
    const zoomBefore = await zoomPercent();
    await setPdf(FIXTURE_V2);
    await finishBuild();
    await expect(pdfPage(3).locator('.textLayer')).toContainText('Fassung B');
    await expect(pageIndicator()).toHaveText(`Seite 3 / ${PAGE_COUNT}`);
    expect(await zoomPercent()).toBe(zoomBefore);
    await expect(button('Breite anpassen')).toHaveAttribute('aria-pressed', 'true');
});

test('schlägt das Neuladen fehl, bleibt die alte Ansicht und die Statusleiste meldet es', async () => {
    await failPdf('io');
    await finishBuild();
    await expect(page.locator('.status-message.is-error')).toContainText(INCOMPLETE_MESSAGE);
    await expect(page.locator('.status-message.is-error')).toContainText('alte Ansicht bleibt');
    await expect(pageIndicator()).toHaveText(`Seite 3 / ${PAGE_COUNT}`);
    await expect(pdfPage(3).locator('.textLayer')).toContainText('Fassung B');
    await failPdf(null);
    expect(pageErrors).toEqual([]);
    expect(cspViolations).toEqual([]);
});
