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
const SYNCTEX_MENU_LABEL = 'Zur PDF-Stelle springen';
const SYNCTEX_SOURCE_LINE = 20;
const SYNCTEX_LINE_TOLERANCE = 3;
const SYNCTEX_READY_TIMEOUT_MS = 20_000;
const SYNCTEX_ATTEMPT_TIMEOUT_MS = 2_000;
const FIRST_PAGE_PATTERN = /^Seite 1 \//;
const POSITION_LINE_PATTERN = /^Zeile (\d+),/;
const SYNC_MODIFIER = 'ControlOrMeta';

const enabled = process.env[REAL_TEX_ENV] === '1' && existsSync(DEMO_DIR);

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
let projectDir: string;

/** Native Menü-Kürzel erreichen Playwright nicht: den Menüeintrag im Main auslösen (wie ein Klick ins Menü) */
async function clickMenuItem(label: string): Promise<boolean> {
    return app.evaluate(({ Menu }, wanted) => {
        const stack = [...(Menu.getApplicationMenu()?.items ?? [])];
        while (stack.length > 0) {
            const item = stack.pop()!;
            if (item.label === wanted) {
                item.click();
                return true;
            }
            stack.push(...(item.submenu?.items ?? []));
        }
        return false;
    }, label);
}

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

// W3-5: Strg+J (Menü „Zur PDF-Stelle springen“) aus `chapters/einleitung.tex`, Zeile 20 (Cursor steht nach dem Sprung
// zur Meldung dort). Der Main lädt SyncTeX nach dem Build im Hintergrund; bis dahin meldet Strg+J nur „keine Daten“,
// deshalb wird bis zur Frist wiederholt.
test('Strg+J springt im PDF auf die Seite der Cursorzeile (nicht Seite 1)', async () => {
    const indicator = page.getByRole('region', { name: /PDF/i }).locator('.pdf-page-indicator');
    await expect(page.getByText(new RegExp(`Zeile ${SYNCTEX_SOURCE_LINE}, Spalte`))).toBeVisible();
    await expect(async () => {
        expect(await clickMenuItem(SYNCTEX_MENU_LABEL)).toBe(true);
        await expect(indicator).not.toHaveText(FIRST_PAGE_PATTERN, { timeout: SYNCTEX_ATTEMPT_TIMEOUT_MS });
    }).toPass({ timeout: SYNCTEX_READY_TIMEOUT_MS });
    await expect(indicator).toHaveText(/^Seite \d+ \/ \d+$/);
});

// Nach Strg+J steht die Stelle senkrecht mittig: ⌘-/Strg-Klick in die Mitte der Ansicht führt zurück. Vorher eine
// andere Datei zeigen. Pfadform: SyncTeX nennt `/private/var/…`, das Projekt heißt `/var/…`; nur wenn der Main den
// Pfad in Projektform liefert, öffnet der Renderer die Datei (sonst „keine .tex-Datei des Projekts“).
test('⌘-/Strg-Klick ins PDF an diese Stelle öffnet einleitung.tex in der Nähe von Zeile 20', async () => {
    // main.tex ist seit dem ersten Test als Tab offen (die Seitenleiste zeigt inzwischen die Meldungen)
    await page.getByRole('tab', { name: 'main.tex' }).click();
    await expect(page.getByRole('tab', { name: 'main.tex' })).toHaveAttribute('aria-selected', 'true');
    const container = page.getByRole('region', { name: /PDF/i }).locator('.pdf-container');
    const box = await container.boundingBox();
    expect(box).not.toBeNull();
    await container.click({ position: { x: box!.width / 2, y: box!.height / 2 }, modifiers: [SYNC_MODIFIER] });
    await expect(page.getByRole('tab', { name: 'einleitung.tex' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('navigation', { name: 'Pfad der Datei' })).toContainText('chapters/einleitung.tex');
    // Die Statusleiste zeigt die Cursorposition entprellt: abfragen, bis sie stimmt (NaN zählt als „noch nicht“).
    const distanceToSource = async (): Promise<number> => {
        const position = await page.locator('.status-position').textContent();
        return Math.abs(Number(POSITION_LINE_PATTERN.exec(position ?? '')?.[1]) - SYNCTEX_SOURCE_LINE);
    };
    await expect.poll(distanceToSource).toBeLessThanOrEqual(SYNCTEX_LINE_TOLERANCE);
});
