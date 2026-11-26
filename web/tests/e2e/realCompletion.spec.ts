import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// W4-6, echte Kette ohne Stub: echter Main und Preload, Projekt ist eine KOPIE von `shared/Testdaten/HgbDemo` im
// Temp-Ordner (nie das Original). Der Index liest die Projektdateien über `fs:readMany` im Worker; geprüft wird, dass
// `\ref{` die Labels und `\cite{` die Schlüssel aus `hgbreferences.bib` der Kopie anbietet. Braucht kein TeX.
// Nur der native Ordnerdialog wird im Main durch ein festes Ergebnis ersetzt. Außerhalb der Bash-Sandbox ausführen.

const WEB_DIR = join(__dirname, '../..');
const DEMO_DIR = join(WEB_DIR, '..', 'shared', 'Testdaten', 'HgbDemo');
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const BUILD_FILE_PATTERN = /\.(aux|log|pdf|toc|out|bbl|blg|bcf|lof|lot|fls|fdb_latexmk|xml)$|\.synctex\.gz$/;
const LABEL_PATTERN = /\\label\{([^}]+)\}/g;
const BIB_KEY_PATTERN = /^@\w+\{([^,\s]+),/gm;
const CHAPTERS = 'chapters';
const CHAPTER_FILE = 'einleitung.tex';
const BIB_FILE = 'hgbreferences.bib';
const FIGURE_PREFIX = 'fig:';
const OPEN_TIMEOUT_MS = 15_000;
const INDEX_TIMEOUT_MS = 10_000;
const RETRY_VISIBLE_MS = 500;
const TRIGGER_KEY = 'Control+Space';
const MODIFIER = 'ControlOrMeta';
/** Genug Rückgängig-Schritte für die getippten Zeilen (danach ist der Tab wieder unverändert) */
const UNDO_STEPS = 30;

interface EditorWindow {
    __editorTestApi?: { text(): string; select(anchor: number, head: number): void; isDirty(path: string): boolean; activePath(): string | null };
}

const enabled = existsSync(DEMO_DIR);

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
let projectDir: string;

const popup = () => page.locator('.cm-tooltip-autocomplete');
const option = (label: string) => popup().locator('li[role="option"]', { hasText: label }).first();
const editorText = (): Promise<string> => page.evaluate(() => (globalThis as unknown as EditorWindow).__editorTestApi!.text());

function copyDemoWithoutBuildFiles(target: string): void {
    cpSync(DEMO_DIR, target, { recursive: true, filter: (source) => !BUILD_FILE_PATTERN.test(source) });
}

/** Labels aller `.tex`-Dateien der Kopie (ohne Kommentarzeilen), wie sie der Index finden muss */
function labelsInCopy(): string[] {
    const files = [join(projectDir, 'main.tex'), ...readdirSync(join(projectDir, CHAPTERS))
        .filter((name) => name.endsWith('.tex')).map((name) => join(projectDir, CHAPTERS, name))];
    return files.flatMap((file) => readFileSync(file, 'utf8').split('\n')
        .filter((line) => !line.trimStart().startsWith('%'))
        .flatMap((line) => [...line.matchAll(LABEL_PATTERN)].map((match) => match[1] ?? '')));
}

function bibKeysInCopy(): string[] {
    return [...readFileSync(join(projectDir, BIB_FILE), 'utf8').matchAll(BIB_KEY_PATTERN)].map((match) => match[1] ?? '');
}

/** Der Index kommt aus dem Worker; bis er da ist, öffnet Strg+Leertaste die Liste erneut */
async function expectListWith(label: string): Promise<void> {
    await expect(async () => {
        if (!(await option(label).isVisible())) await page.keyboard.press(TRIGGER_KEY);
        await expect(option(label)).toBeVisible({ timeout: RETRY_VISIBLE_MS });
    }).toPass({ timeout: INDEX_TIMEOUT_MS });
}

async function typeOnNewLineAtEnd(text: string): Promise<void> {
    const length = (await editorText()).length;
    await page.evaluate((end) => (globalThis as unknown as EditorWindow).__editorTestApi!.select(end, end), length);
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.type(text);
}

test.skip(!enabled, 'nur mit shared/Testdaten/HgbDemo');

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-real-profile-'));
    projectDir = mkdtempSync(join(tmpdir(), 'latexeditor-real-project-'));
    copyDemoWithoutBuildFiles(projectDir);
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

test('in chapters/einleitung.tex bietet `\\ref{` die Labels und `\\cite{` die Schlüssel der Projektkopie an', async () => {
    test.setTimeout(OPEN_TIMEOUT_MS + 2 * INDEX_TIMEOUT_MS);
    const labels = labelsInCopy();
    const figure = labels.find((label) => label.startsWith(FIGURE_PREFIX));
    const keys = bibKeysInCopy();
    expect(figure, 'HgbDemo hat ein Label fig:…').toBeDefined();
    expect(keys.length).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Projekt öffnen …', exact: true }).first().click();
    await expect(page.getByText('Hauptdatei: main.tex')).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
    await page.getByRole('treeitem', { name: CHAPTERS, exact: true }).click();
    await page.getByRole('treeitem', { name: CHAPTER_FILE, exact: true }).dblclick();
    await expect(page.getByRole('tab', { name: CHAPTER_FILE })).toBeVisible();
    const original = await editorText();

    await typeOnNewLineAtEnd('\\ref{');
    await expectListWith(figure ?? '');
    for (const label of labels.slice(0, 3)) await expect(popup()).toContainText(label);
    await page.keyboard.press('Escape');

    await typeOnNewLineAtEnd('\\cite{');
    await expectListWith(keys[0] ?? '');
    for (const key of keys) await expect(popup()).toContainText(key);
    await page.keyboard.press('Escape');

    // Aufräumen: nichts gespeichert, der Tab ist wieder unverändert (kein Nachfragen beim Schließen)
    for (let step = 0; step < UNDO_STEPS; step++) await page.keyboard.press(`${MODIFIER}+z`);
    await expect.poll(editorText).toBe(original);
});
