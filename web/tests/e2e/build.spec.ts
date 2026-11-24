import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// W2-12: Build-Oberfläche mit dem Stub-Preload (`LATEXEDITOR_STUB_PRELOAD`): Kompilieren, Statuswechsel, Meldungsliste mit
// Badge, Sprung zur Zeile, Marken in Text und Zeilenleiste, Strg+B und Abbrechen, Fehler beim Speichern vor dem Build.
// Der Stub spielt `build:status` und `build:finished` ab (`setBuildResult`, `holdBuilds`, `finishBuild`).
// Voraussetzung: Build mit Testzugang (`npm run build:e2e`).

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const ROOT = '/stub/projekt';
const MAIN = `${ROOT}/main.tex`;
const CHAPTER = `${ROOT}/kapitel/einleitung.tex`;
const CHAPTER_ERROR_LINE = 3;
const MAIN_WARNING_LINE = 2;
const FALSE_ERROR_MESSAGE = 'Undefined control sequence.';
const TOOLS = { latexmk: '/stub/bin/latexmk', git: null, synctexRef: null, distro: 'texlive', problems: [] };
const REPORT = [
    { severity: 'error', message: FALSE_ERROR_MESSAGE, file: CHAPTER, line: CHAPTER_ERROR_LINE },
    { severity: 'warning', message: 'Reference `fig:fehlt` undefined.', file: MAIN, line: MAIN_WARNING_LINE },
    { severity: 'warning', message: 'latexmk meldet ein Problem ohne Datei.', file: null, line: null },
];

interface StubWindow {
    api: {
        __stub: {
            installSampleProject(extraFileCount?: number): void;
            setTools(tools: unknown): void;
            setBuildResult(report: unknown[], options?: { ok?: boolean; durationMs?: number }): void;
            holdBuilds(hold: boolean): void;
            finishBuild(): void;
            failWrites(kind: string | null, message?: string): void;
            calls(): { channel: string; args: unknown[] }[];
            clearCalls(): void;
        };
    };
}

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
const pageErrors: string[] = [];

const finishBuild = (): Promise<void> => page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.finishBuild());
const clearCalls = (): Promise<void> => page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.clearCalls());
const failWrites = (kind: string | null): Promise<void> =>
    page.evaluate((value) => (globalThis as unknown as StubWindow).api.__stub.failWrites(value, 'Platte voll'), kind);
const buildCalls = async (): Promise<{ channel: string; args: unknown[] }[]> =>
    (await page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.calls())).filter((call) => call.channel === 'build:start');

const toolbar = () => page.getByRole('toolbar', { name: 'Kompilieren' });
const compileButton = () => toolbar().getByRole('button', { name: 'Kompilieren', exact: true });
const cancelButton = () => toolbar().getByRole('button', { name: 'Abbrechen', exact: true });
const buildStatus = () => toolbar().getByRole('status');
const issuesTab = () => page.locator('.sidebar-tab', { hasText: 'Meldungen' });
const issueList = () => page.getByRole('listbox', { name: 'Meldungen' });
const issueRow = (text: string) => issueList().getByRole('option').filter({ hasText: text });

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-e2e-'));
    const env = { ...process.env, [STUB_PRELOAD_ENV]: '1' } as Record<string, string>;
    delete env[DEV_SERVER_ENV];
    app = await electron.launch({ args: [WEB_DIR, `--user-data-dir=${userDataDir}`], env });
    page = await app.firstWindow();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.waitForSelector('.editor-host .cm-editor');
    await page.evaluate(
        ([tools, report]) => {
            const control = (globalThis as unknown as StubWindow).api.__stub;
            control.installSampleProject();
            control.setTools(tools);
            control.setBuildResult(report as unknown[]);
            control.holdBuilds(true);
        },
        [TOOLS, REPORT] as const,
    );
});

test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
});

test('ohne Projekt ist Kompilieren deaktiviert und erklärt es', async () => {
    await expect(compileButton()).toBeDisabled();
    await expect(buildStatus()).toHaveText('Keine Hauptdatei');
});

test('Kompilieren (latexmk wird beim Klick neu gesucht): Status wechselt, der Knopf wird zu Abbrechen, am Ende stehen Fehler und Badge', async () => {
    await page.getByRole('button', { name: 'Projekt öffnen …', exact: true }).click();
    await expect(page.getByText('Hauptdatei: main.tex')).toBeVisible();
    await page.getByRole('treeitem', { name: 'main.tex', exact: true }).dblclick();
    // Der Stub kannte beim Start noch kein latexmk; der Klick sucht neu und startet dann
    await expect(buildStatus()).toHaveText('latexmk nicht gefunden');
    await compileButton().click();
    await expect(buildStatus()).toHaveText('Kompiliert …');
    await expect(cancelButton()).toBeVisible();
    expect(await buildCalls()).toHaveLength(1);
    expect((await buildCalls())[0]!.args).toEqual([MAIN, { engine: 'pdflatex' }]);

    await finishBuild();
    await expect(buildStatus()).toHaveText('1 Fehler');
    await expect(compileButton()).toBeVisible();
    await expect(issuesTab().locator('.sidebar-tab-badge')).toHaveAttribute('aria-label', '1 Fehler');
});

test('Meldungen: Gruppen, Prozessproblem oben, Boxen standardmäßig ausgeblendet, Filter', async () => {
    await issuesTab().click();
    await expect(issueList()).toBeVisible();
    await expect(issueList().getByRole('group').first()).toHaveAccessibleName('Kompilierlauf, 1');
    await expect(issueList().getByRole('group')).toHaveCount(3);
    await expect(issueRow(FALSE_ERROR_MESSAGE)).toContainText('Zeile 3');
    await page.getByRole('button', { name: /^Warnungen/ }).click();
    await expect(issueRow('fig:fehlt')).toHaveCount(0);
    await page.getByRole('button', { name: /^Warnungen/ }).click();
    await expect(issueRow('fig:fehlt')).toBeVisible();
});

test('Klick auf eine Meldung öffnet die Datei an der Zeile; Marke im Text und in der Zeilenleiste', async () => {
    await issueRow(FALSE_ERROR_MESSAGE).click();
    await expect(page.getByRole('tab', { name: 'einleitung.tex' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.status-position')).toContainText(`Zeile ${CHAPTER_ERROR_LINE},`);
    await expect(page.locator('.cm-build-mark-error')).toHaveCount(1);
    await expect(page.locator('.cm-build-mark-error')).toHaveAttribute('title', FALSE_ERROR_MESSAGE);
    await expect(page.locator('.cm-mark-shape-error')).toHaveCount(1);
    await expect(page.locator('.cm-line-marks[title]', { has: page.locator('.cm-mark-shape-error') })).toHaveAttribute(
        'title', FALSE_ERROR_MESSAGE,
    );
    expect(pageErrors).toEqual([]);
});

test('F8 und Umschalt+F8 springen durch die Meldungen (Fehler, dann Warnung, mit Umlauf)', async () => {
    await page.locator('.cm-content').click();
    await page.keyboard.press('F8');
    await expect(page.getByRole('tab', { name: 'main.tex' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.status-position')).toContainText(`Zeile ${MAIN_WARNING_LINE},`);
    await page.keyboard.press('Shift+F8');
    await expect(page.getByRole('tab', { name: 'einleitung.tex' })).toHaveAttribute('aria-selected', 'true');
    await expect(issueRow(FALSE_ERROR_MESSAGE)).toHaveAttribute('aria-selected', 'true');
});

test('Pfeiltasten wandern durch die Liste, Enter springt', async () => {
    await issueRow(FALSE_ERROR_MESSAGE).focus();
    await page.keyboard.press('ArrowDown');
    await expect(issueRow('fig:fehlt')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: 'main.tex' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cm-build-mark-warning')).toHaveCount(1);
});

test('Strg+B kompiliert, der Knopf zeigt Abbrechen, Abbrechen beendet mit „Abgebrochen“', async () => {
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+b');
    await expect(buildStatus()).toHaveText('Kompiliert …');
    await expect(cancelButton()).toBeVisible();
    await cancelButton().click();
    await expect(buildStatus()).toHaveText('Abgebrochen');
    await expect(compileButton()).toBeVisible();
    // Die Meldungen des Laufs davor bleiben stehen
    await expect(issuesTab().locator('.sidebar-tab-badge')).toHaveAttribute('aria-label', '1 Fehler');
});

test('Fehler beim Speichern vor dem Build: kein Build, Meldung in der Statusleiste', async () => {
    await page.locator('.cm-content').click();
    await page.keyboard.type('x');
    await failWrites('io');
    await clearCalls();
    await compileButton().click();
    await expect(page.locator('footer.status-bar [role=alert]')).toContainText('Nicht kompiliert');
    expect(await buildCalls()).toHaveLength(0);
    await failWrites(null);
    await compileButton().click();
    await expect(buildStatus()).toHaveText('Kompiliert …');
    expect(await buildCalls()).toHaveLength(1);
    await finishBuild();
    expect(pageErrors).toEqual([]);
});
