import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

// W2-9 echt (ohne Stub): echter Main (`fsOps`, Papierkorb-Ablage, Dateiüberwachung), echter Preload, echtes latexmk auf
// einer KOPIE von shared/Testdaten/HgbDemo. `chapters/einleitung.tex` umbenennen → `\input` in main.tex angepasst →
// kompilieren ohne Fehler → Rückgängig → alle Quelldateien byte-gleich wie vorher. Nur der Ordnerdialog wird im Main
// ersetzt. Läuft nur mit LATEXEDITOR_REAL_TEX=1 (und installiertem TeX); das Original wird nie verändert.

const WEB_DIR = join(__dirname, '../..');
const DEMO_DIR = join(WEB_DIR, '..', 'shared', 'Testdaten', 'HgbDemo');
const REAL_TEX_ENV = 'LATEXEDITOR_REAL_TEX';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const TEX_PATHS = ['/Library/TeX/texbin', '/usr/local/bin', '/usr/bin'];
const OPEN_TIMEOUT_MS = 15_000;
const BUILD_TIMEOUT_MS = 180_000;
const BUILD_FILE_PATTERN = /\.(aux|log|pdf|toc|out|bbl|blg|bcf|lof|lot|fls|fdb_latexmk|xml)$|\.synctex\.gz$/;
const OLD_INPUT = '\\input{chapters/einleitung}';
const NEW_INPUT = '\\input{chapters/intro}';
const UNDO_KEY = 'ControlOrMeta+z';

const enabled = process.env[REAL_TEX_ENV] === '1' && existsSync(DEMO_DIR);

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
let projectDir: string;
/** Quelldateien der Kopie vor dem Umbenennen (relativer Pfad → Bytes) */
let sources: Map<string, Buffer>;

function copyDemoWithoutBuildFiles(target: string): void {
    cpSync(DEMO_DIR, target, { recursive: true, filter: (source) => !BUILD_FILE_PATTERN.test(source) });
}

function readSources(directory: string, base = directory, result = new Map<string, Buffer>()): Map<string, Buffer> {
    for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) readSources(path, base, result);
        else if (!BUILD_FILE_PATTERN.test(name)) result.set(relative(base, path), readFileSync(path));
    }
    return result;
}

const tree = (target: Page) => target.getByRole('tree', { name: 'Dateibaum' });
const item = (target: Page, name: string) => tree(target).getByRole('treeitem', { name, exact: true });
const mainText = (): string => readFileSync(join(projectDir, 'main.tex'), 'utf8');

test.skip(!enabled, `nur mit ${REAL_TEX_ENV}=1, installiertem TeX und shared/Testdaten/HgbDemo`);

test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-real-profile-'));
    projectDir = mkdtempSync(join(tmpdir(), 'latexeditor-real-project-'));
    copyDemoWithoutBuildFiles(projectDir);
    sources = readSources(projectDir);
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

test('chapters/einleitung.tex umbenennen passt \\input in main.tex an', async () => {
    await page.getByRole('button', { name: 'Projekt öffnen …', exact: true }).first().click();
    await expect(page.getByText('Hauptdatei: main.tex')).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
    expect(mainText()).toContain(OLD_INPUT);
    await item(page, 'chapters').click();
    await item(page, 'einleitung.tex').click({ button: 'right' });
    await page.getByRole('menu', { name: 'Dateiaktionen' }).getByRole('menuitem', { name: 'Umbenennen …' }).click();
    const input = page.getByRole('dialog', { name: 'Umbenennen' }).getByRole('textbox', { name: 'Name' });
    await input.fill('intro');
    await input.press('Enter');
    await page.getByRole('dialog', { name: 'Verweise auf „einleitung.tex“ anpassen?' })
        .getByRole('button', { name: 'Verweise anpassen' }).click();
    await expect(item(page, 'intro.tex')).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
    expect(existsSync(join(projectDir, 'chapters', 'intro.tex'))).toBe(true);
    expect(existsSync(join(projectDir, 'chapters', 'einleitung.tex'))).toBe(false);
    await expect.poll(mainText).toContain(NEW_INPUT);
    // Nur der Verweis ändert sich, sonst nichts an main.tex
    expect(mainText()).toBe(sources.get('main.tex')!.toString('utf8').replace(OLD_INPUT, NEW_INPUT));
});

test('das Projekt kompiliert nach dem Umbenennen ohne Fehler', async () => {
    test.setTimeout(BUILD_TIMEOUT_MS + OPEN_TIMEOUT_MS);
    await page.getByRole('button', { name: /Kompilieren/ }).first().click();
    await expect(page.getByText(/Fertig in .* s/)).toBeVisible({ timeout: BUILD_TIMEOUT_MS });
    await page.getByRole('button', { name: /Meldungen/ }).first().click();
    await expect(page.getByText('Fehler 0')).toBeVisible();
});

test('Rückgängig stellt Name und Verweis her; alle Quelldateien sind byte-gleich', async () => {
    await page.getByRole('button', { name: 'Dateien', exact: true }).click();
    await item(page, 'intro.tex').click();
    await tree(page).focus();
    await page.keyboard.press(UNDO_KEY);
    await expect(item(page, 'einleitung.tex')).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
    await expect(item(page, 'intro.tex')).toHaveCount(0);
    await expect.poll(mainText).toContain(OLD_INPUT);
    expect(existsSync(join(projectDir, 'chapters', 'intro.tex'))).toBe(false);
    const after = readSources(projectDir);
    // Der Build legt weitere Hilfsdateien an; verglichen werden die Quellen (gleiche `.tex`-Dateien, gleiche Bytes)
    const texFiles = (map: Map<string, Buffer>): string[] => [...map.keys()].filter((path) => path.endsWith('.tex')).sort();
    expect(texFiles(after)).toEqual(texFiles(sources));
    for (const [path, bytes] of sources) expect(after.get(path)?.equals(bytes), path).toBe(true);
});
