import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// W4-10, echte Kette ohne Stub: echter Main und Preload, Projekt ist eine KOPIE von `shared/Testdaten/HgbDemo` im
// Temp-Ordner (nie das Original). Geprüft wird, was nur der Main kann: ein Bild von außerhalb wird nach `images/`
// kopiert (`image:import`) und `\includegraphics` steht im Text; eine neue Quelle landet per `bib:append` in der
// `.bib` und lässt sich zurücknehmen (`bib:undo`). Braucht kein TeX. Native Dialoge werden im Main durch feste
// Ergebnisse ersetzt. Außerhalb der Bash-Sandbox ausführen.

const WEB_DIR = join(__dirname, '../..');
const DEMO_DIR = join(WEB_DIR, '..', 'shared', 'Testdaten', 'HgbDemo');
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const BUILD_FILE_PATTERN = /\.(aux|log|pdf|toc|out|bbl|blg|bcf|lof|lot|fls|fdb_latexmk|xml)$|\.synctex\.gz$/;
const CHAPTERS = 'chapters';
const CHAPTER_FILE = 'einleitung.tex';
const BIB_FILE = 'hgbreferences.bib';
const IMAGE_NAME = 'externes-bild.png';
const OPEN_TIMEOUT_MS = 15_000;
const MODIFIER = 'ControlOrMeta';
/** Mehr Rückgängig-Schritte als eingefügt wurde (danach ist der Tab wieder unverändert) */
const UNDO_STEPS = 6;
// 1×1-PNG
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

interface EditorWindow {
    __editorTestApi?: { text(): string; select(anchor: number, head: number): void };
}

const enabled = existsSync(DEMO_DIR);

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
let projectDir: string;
let externalDir: string;
let original = '';

const dialog = () => page.getByRole('dialog', { name: 'Einfügen' });
const editorText = (): Promise<string> => page.evaluate(() => (globalThis as unknown as EditorWindow).__editorTestApi!.text());

/** Löst einen Menüeintrag im Main aus (wie ein Klick ins Menü); Kürzel erreicht Playwright nicht */
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

/** Cursor ans Ende der vorderen Datei, Editor fokussiert */
async function cursorToEnd(): Promise<void> {
    const length = (await editorText()).length;
    await page.evaluate((end) => (globalThis as unknown as EditorWindow).__editorTestApi!.select(end, end), length);
    await page.locator('.cm-content').focus();
}

test.skip(!enabled, 'nur mit shared/Testdaten/HgbDemo');

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-real-profile-'));
    projectDir = mkdtempSync(join(tmpdir(), 'latexeditor-real-project-'));
    externalDir = mkdtempSync(join(tmpdir(), 'latexeditor-real-external-'));
    copyDemoWithoutBuildFiles(projectDir);
    writeFileSync(join(externalDir, IMAGE_NAME), Buffer.from(PNG_BASE64, 'base64'));
    const env = { ...process.env } as Record<string, string>;
    delete env[DEV_SERVER_ENV];
    delete env[STUB_PRELOAD_ENV];
    app = await electron.launch({ args: [WEB_DIR, `--user-data-dir=${userDataDir}`], env });
    await app.evaluate(({ dialog: nativeDialog }, directory) => {
        nativeDialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
    }, projectDir);
    page = await app.firstWindow();
    await page.getByRole('button', { name: 'Projekt öffnen …', exact: true }).first().click();
    await expect(page.getByText('Hauptdatei: main.tex')).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
    await page.getByRole('treeitem', { name: CHAPTERS, exact: true }).click();
    await page.getByRole('treeitem', { name: CHAPTER_FILE, exact: true }).dblclick();
    await expect(page.getByRole('tab', { name: CHAPTER_FILE })).toBeVisible();
    original = await editorText();
});

test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(externalDir, { recursive: true, force: true });
});

test('Bild von außerhalb: wird nach images/ kopiert, \\includegraphics steht im Text, ein Undo', async () => {
    await cursorToEnd();
    expect(await clickMenuItem('Bild …')).toBe(true);
    await expect(dialog()).toBeVisible();
    await app.evaluate(({ dialog: nativeDialog }, file) => {
        nativeDialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, join(externalDir, IMAGE_NAME));
    await dialog().getByRole('button', { name: 'Datei wählen …' }).click();
    await expect(dialog()).toContainText(`kopiert als „${IMAGE_NAME}“`);
    await dialog().getByRole('button', { name: 'Einfügen', exact: true }).click();
    await expect(dialog()).toBeHidden();

    const copy = join(projectDir, 'images', IMAGE_NAME);
    await expect.poll(() => existsSync(copy)).toBe(true);
    expect(readFileSync(copy).equals(readFileSync(join(externalDir, IMAGE_NAME)))).toBe(true);
    // HgbDemo hat `\graphicspath{{images/}}`: der Pfad im Text ist der Name ohne `images/`
    await expect.poll(editorText).toContain(`\\includegraphics[width=.75\\textwidth]{${IMAGE_NAME}}`);
    await page.keyboard.press(`${MODIFIER}+z`);
    await expect.poll(editorText).toBe(original);
});

test('Quelle: Eintrag in der .bib auf der Platte, \\cite im Text; Datei-Aktion rückgängig stellt die .bib wieder her', async () => {
    const bibPath = join(projectDir, BIB_FILE);
    const before = readFileSync(bibPath);
    await cursorToEnd();
    expect(await clickMenuItem('Quelle …')).toBe(true);
    await expect(dialog()).toBeVisible();
    await dialog().getByLabel('Autor *', { exact: true }).fill('Max Mustermann');
    await dialog().getByLabel('Titel *', { exact: true }).fill('Ein Testbuch');
    await dialog().getByLabel('Verlag *', { exact: true }).fill('Testverlag');
    await dialog().getByLabel('Jahr *', { exact: true }).fill('2025');
    await expect(dialog().getByRole('status')).toHaveText(`Neuer Eintrag in ${BIB_FILE}, Zitat an der Cursorposition`);
    await dialog().getByRole('button', { name: 'Quelle anlegen', exact: true }).click();
    await expect(dialog()).toBeHidden();

    await expect.poll(() => readFileSync(bibPath, 'utf8')).toContain('@book{Mustermann2025,');
    const after = readFileSync(bibPath);
    expect(after.subarray(0, before.length).equals(before)).toBe(true);
    await expect.poll(editorText).toContain('\\cite{Mustermann2025}');
    await expect(page.getByText(/Quelle „Mustermann2025“ in hgbreferences.bib angelegt/)).toBeVisible();

    expect(await clickMenuItem('Datei-Aktion rückgängig')).toBe(true);
    await expect.poll(() => readFileSync(bibPath).equals(before)).toBe(true);
    // Aufräumen: nichts gespeichert, der Tab ist wieder unverändert (kein Nachfragen beim Schließen)
    for (let step = 0; step < UNDO_STEPS; step++) await page.keyboard.press(`${MODIFIER}+z`);
    await expect.poll(editorText).toBe(original);
});
