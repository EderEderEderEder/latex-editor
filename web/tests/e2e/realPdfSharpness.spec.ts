import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Echte Kette: Nach dem Kompilieren muss die PDF-Seite mit voller Bildschirmauflösung gezeichnet sein (kein Hochskalieren
// per CSS = unscharf). Läuft bei mehreren Skalierungen, weil Windows oft 125/150 % nutzt (`--force-device-scale-factor`).
// Nur mit LATEXEDITOR_REAL_TEX=1; die Demo-Kopie liegt in einem Temp-Ordner, das Original wird nie verändert.

const WEB_DIR = join(__dirname, '../..');
const DEMO_DIR = join(WEB_DIR, '..', 'shared', 'Testdaten', 'HgbDemo');
const REAL_TEX_ENV = 'LATEXEDITOR_REAL_TEX';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const TEX_PATHS = ['/Library/TeX/texbin', '/usr/local/bin', '/usr/bin'];
const BUILD_FILE_PATTERN = /\.(aux|log|pdf|toc|out|bbl|blg|bcf|lof|lot|fls|fdb_latexmk|xml)$|\.synctex\.gz$/;
const OPEN_TIMEOUT_MS = 15_000;
const BUILD_TIMEOUT_MS = 180_000;
const SETTLE_MS = 2_500;
const DEVICE_SCALES = ['1', '1.25', '1.5', '2'];
/** pdf.js rundet die Canvas-Größe; weniger als dieser Anteil der Sollauflösung gilt als unscharf */
const MIN_SHARP_RATIO = 0.97;

const enabled = process.env[REAL_TEX_ENV] === '1' && existsSync(DEMO_DIR);
test.skip(!enabled, `nur mit ${REAL_TEX_ENV}=1, installiertem TeX und shared/Testdaten/HgbDemo`);

interface CanvasStats {
    readonly dpr: number;
    readonly pixelWidth: number;
    readonly cssWidth: number;
}

async function launchWithScale(scale: string, userDataDir: string, projectDir: string): Promise<{ app: ElectronApplication; page: Page }> {
    const env = { ...process.env, PATH: [...TEX_PATHS, process.env.PATH ?? ''].join(':') } as Record<string, string>;
    delete env[DEV_SERVER_ENV];
    delete env[STUB_PRELOAD_ENV];
    const args = [WEB_DIR, `--user-data-dir=${userDataDir}`, `--force-device-scale-factor=${scale}`];
    const app = await electron.launch({ args, env });
    await app.evaluate(({ dialog }, directory) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    }, projectDir);
    return { app, page: await app.firstWindow() };
}

async function compileDemo(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Projekt öffnen …', exact: true }).first().click();
    await expect(page.getByText('Hauptdatei: main.tex')).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
    await page.getByRole('treeitem', { name: 'main.tex', exact: true }).dblclick();
    await page.getByRole('button', { name: /Kompilieren/ }).first().click();
    await expect(page.getByText(/Fertig in .* s/)).toBeVisible({ timeout: BUILD_TIMEOUT_MS });
    await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
    await page.waitForTimeout(SETTLE_MS);
}

/** Alle gezeichneten Seiten (Canvas mit Inhalt), nicht nur die erste */
function allCanvasStats(page: Page): Promise<CanvasStats[]> {
    return page.evaluate(() =>
        [...document.querySelectorAll<HTMLCanvasElement>('.pdfViewer .page canvas')]
            .filter((canvas) => canvas.width > 0)
            .map((canvas) => ({ dpr: window.devicePixelRatio, pixelWidth: canvas.width, cssWidth: canvas.getBoundingClientRect().width })),
    );
}

function expectSharp(stats: readonly CanvasStats[], scale: string): void {
    expect(stats.length).toBeGreaterThan(0);
    for (const entry of stats) {
        expect(entry.dpr).toBeCloseTo(Number(scale), 2);
        expect(entry.pixelWidth / (entry.cssWidth * entry.dpr), JSON.stringify(entry)).toBeGreaterThanOrEqual(MIN_SHARP_RATIO);
    }
}

/** Ändert die offene Datei, speichert (kompiliert beim Speichern) und wartet, bis ein NEUER Build fertig ist */
async function rebuildAfterEdit(page: Page): Promise<void> {
    const status = page.getByRole('status').filter({ hasText: /Fertig in/ });
    const before = await status.first().textContent();
    await page.locator('.cm-content').click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
    await page.keyboard.type('\n% Änderung\n');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
    await expect.poll(async () => (await status.first().textContent()) !== before, { timeout: BUILD_TIMEOUT_MS }).toBe(true);
    await page.waitForTimeout(SETTLE_MS);
}

for (const scale of DEVICE_SCALES) {
    test(`PDF scharf nach erstem und nach erneutem Kompilieren bei Skalierung ${scale}`, async () => {
        test.setTimeout(2 * BUILD_TIMEOUT_MS + OPEN_TIMEOUT_MS + 2 * SETTLE_MS);
        const userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-sharp-profile-'));
        const projectDir = mkdtempSync(join(tmpdir(), 'latexeditor-sharp-project-'));
        cpSync(DEMO_DIR, projectDir, { recursive: true, filter: (source) => !BUILD_FILE_PATTERN.test(source) });
        const { app, page } = await launchWithScale(scale, userDataDir, projectDir);
        try {
            await compileDemo(page);
            expectSharp(await allCanvasStats(page), scale);
            await rebuildAfterEdit(page);
            expectSharp(await allCanvasStats(page), scale);
        } finally {
            await app.close();
            rmSync(userDataDir, { recursive: true, force: true });
            rmSync(projectDir, { recursive: true, force: true });
        }
    });
}
