import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// W2-13, echte Kette ohne Stub: echter Main mit `fs.watch`, echter Preload, Datei wird außerhalb der App per Node
// geschrieben. Braucht kein TeX, aber `shared/Testdaten/HgbDemo`; gearbeitet wird nur auf einer KOPIE im Temp-Ordner.
// Nur der native Ordnerdialog wird im Main durch ein festes Ergebnis ersetzt. Wie alle Electron-Läufe außerhalb der
// Bash-Sandbox ausführen (dort scheitert `fs.watch` mit EMFILE).

const WEB_DIR = join(__dirname, '../..');
const DEMO_DIR = join(WEB_DIR, '..', 'shared', 'Testdaten', 'HgbDemo');
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const BUILD_FILE_PATTERN = /\.(aux|log|pdf|toc|out|bbl|blg|bcf|lof|lot|fls|fdb_latexmk|xml)$|\.synctex\.gz$/;
const OPEN_TIMEOUT_MS = 15_000;
const SYNC_TIMEOUT_MS = 10_000;
const EXTERNAL_LINE = '% extern geändert (W2-13)\n';
const SECOND_EXTERNAL_LINE = '% zweite externe Änderung (W2-13)\n';
const OWN_LINE = '% eigene Zeile\n';
const CHANGED_MESSAGE = 'Die Datei wurde auf der Festplatte geändert.';

interface EditorWindow {
    __editorTestApi?: { text(): string; select(anchor: number, head: number): void };
}

const enabled = existsSync(DEMO_DIR);

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
let projectDir: string;
let mainFile: string;

const editorText = (): Promise<string> => page.evaluate(() => (globalThis as unknown as EditorWindow).__editorTestApi!.text());

function copyDemoWithoutBuildFiles(target: string): void {
    cpSync(DEMO_DIR, target, { recursive: true, filter: (source) => !BUILD_FILE_PATTERN.test(source) });
}

test.skip(!enabled, 'nur mit shared/Testdaten/HgbDemo');

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-real-profile-'));
    projectDir = mkdtempSync(join(tmpdir(), 'latexeditor-real-project-'));
    copyDemoWithoutBuildFiles(projectDir);
    mainFile = join(projectDir, 'main.tex');
    const env = { ...process.env } as Record<string, string>;
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

test('unveränderter Tab zeigt eine Änderung von außerhalb still an', async () => {
    test.setTimeout(OPEN_TIMEOUT_MS + SYNC_TIMEOUT_MS);
    await page.getByRole('button', { name: 'Projekt öffnen …', exact: true }).first().click();
    await expect(page.getByText('Hauptdatei: main.tex')).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
    await page.getByRole('treeitem', { name: 'main.tex', exact: true }).dblclick();
    await expect(page.getByRole('tab', { name: 'main.tex' })).toBeVisible();
    const original = readFileSync(mainFile, 'utf8');
    await expect.poll(editorText).toBe(original.replace(/\r\n/g, '\n'));

    writeFileSync(mainFile, EXTERNAL_LINE + original);
    await expect.poll(editorText, { timeout: SYNC_TIMEOUT_MS }).toMatch(/^% extern geändert \(W2-13\)\n/);
    await expect(page.locator('.tab-dirty')).toHaveCount(0);
    await expect(page.locator('.conflict-bar')).toHaveCount(0);
});

test('geänderter Tab plus Änderung von außerhalb: Konfliktleiste, „Platten-Version laden“ übernimmt sie', async () => {
    test.setTimeout(2 * SYNC_TIMEOUT_MS);
    await page.evaluate(() => (globalThis as unknown as EditorWindow).__editorTestApi!.select(0, 0));
    await page.locator('.cm-content').focus();
    await page.keyboard.type(OWN_LINE);
    await expect(page.locator('.tab-dirty')).toHaveCount(1);

    writeFileSync(mainFile, SECOND_EXTERNAL_LINE + readFileSync(mainFile, 'utf8'));
    const bar = page.locator('.conflict-bar[role="alert"]');
    await expect(bar).toContainText(CHANGED_MESSAGE, { timeout: SYNC_TIMEOUT_MS });
    expect(await editorText()).toMatch(/^% eigene Zeile\n% extern geändert/);

    await bar.getByRole('button', { name: 'Platten-Version laden' }).click();
    await expect.poll(editorText, { timeout: SYNC_TIMEOUT_MS }).toMatch(/^% zweite externe Änderung \(W2-13\)\n/);
    await expect(bar).toHaveCount(0);
    await expect(page.locator('.tab-dirty')).toHaveCount(0);
});
