import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Echte Kette ohne Stub: echter Main, echter Preload, echtes latexmk auf einer KOPIE von shared/Testdaten/HgbDemo.
// Nur der native Ordnerdialog wird im Main durch ein festes Ergebnis ersetzt. Läuft nur mit LATEXEDITOR_REAL_TEX=1
// (und installiertem TeX); die Demo-Kopie liegt in einem Temp-Ordner, das Original wird nie verändert.

const WEB_DIR = join(__dirname, '../..');
const DEMO_DIR = join(WEB_DIR, '..', 'shared', 'Testdaten', 'HgbDemo');
const REAL_TEX_ENV = 'LATEXEDITOR_REAL_TEX';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const TEX_PATHS = ['/Library/TeX/texbin', '/usr/local/bin', '/usr/bin'];
const OPEN_TIMEOUT_MS = 15_000;
const BUILD_TIMEOUT_MS = 180_000;
const BUILD_FILE_PATTERN = /\.(aux|log|pdf|toc|out|bbl|blg|bcf|lof|lot|fls|fdb_latexmk|xml)$|\.synctex\.gz$/;

const enabled = process.env[REAL_TEX_ENV] === '1' && existsSync(DEMO_DIR);

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
let projectDir: string;

function copyDemoWithoutBuildFiles(target: string): void {
    cpSync(DEMO_DIR, target, { recursive: true, filter: (source) => !BUILD_FILE_PATTERN.test(source) });
}

test.skip(!enabled, `nur mit ${REAL_TEX_ENV}=1, installiertem TeX und shared/Testdaten/HgbDemo`);

test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-real-profile-'));
    projectDir = mkdtempSync(join(tmpdir(), 'latexeditor-real-project-'));
    copyDemoWithoutBuildFiles(projectDir);
    const env = { ...process.env, PATH: [...TEX_PATHS, process.env.PATH ?? ''].join(':') } as Record<string, string>;
    delete env[DEV_SERVER_ENV];
    delete env[STUB_PRELOAD_ENV];
    app = await electron.launch({ args: [WEB_DIR, `--user-data-dir=${userDataDir}`], env });
    await app.evaluate(({ dialog }, directory) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    }, projectDir);
    page = await app.firstWindow();
});

test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
});

test('Projekt öffnen, kompilieren und Meldungen mit Datei und Zeile sehen', async () => {
    test.setTimeout(BUILD_TIMEOUT_MS + OPEN_TIMEOUT_MS);
    await page.getByRole('button', { name: 'Projekt öffnen …', exact: true }).first().click();
    await expect(page.getByText('Hauptdatei: main.tex')).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
    await page.getByRole('treeitem', { name: 'main.tex', exact: true }).dblclick();

    await page.getByRole('button', { name: /Kompilieren/ }).first().click();
    await expect(page.getByText(/Fertig in .* s/)).toBeVisible({ timeout: BUILD_TIMEOUT_MS });
    expect(readdirSync(projectDir)).toContain('main.pdf');

    await page.getByRole('button', { name: /Meldungen/ }).first().click();
    await expect(page.getByText('Fehler 0')).toBeVisible();
    const undefinedReference = page.getByText(/Reference `fig:fehlt' on\s+page \d+ undefined/);
    await expect(undefinedReference).toBeVisible();
    await expect(undefinedReference.locator('xpath=..')).toContainText('Zeile 20');
});

test('Klick auf die Meldung springt in die Datei an die Zeile', async () => {
    await page.getByText(/Reference `fig:fehlt' on\s+page \d+ undefined/).click();
    await expect(page.getByText('einleitung.tex').first()).toBeVisible();
    await expect(page.getByText(/Zeile 20, Spalte/)).toBeVisible();
});

test('Nach dem Kompilieren zeigt die PDF-Ansicht die Seiten der echten Ausgabe', async () => {
    const pane = page.getByRole('region', { name: /PDF/i });
    await expect(pane.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
    await expect(pane.locator('.pdfViewer .page .textLayer').first()).toBeAttached();
    const pageCount = await pane.locator('.pdfViewer .page').count();
    expect(pageCount).toBeGreaterThan(3);
});
