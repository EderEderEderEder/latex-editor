import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JUMP_KEY, pointOfText } from '../support/editorPoints';

// W4-12 und W4-13, echte Kette ohne Stub: echter Main und Preload, Projekt ist eine KOPIE von `shared/Testdaten/HgbDemo`
// im Temp-Ordner (nie das Original). Der Index-Worker liest die Dateien über `fs:readMany`. Geprüft werden die drei
// Demo-Fälle (`fig:fehlt` rot unterstrichen, `sec:ungenutzt` und `ungenutzt2026` unter „Hinweise“), Strg-Klick (macOS
// ⌘) auf `\ref`, `\cite` und `\input` und die Aktualisierung nach einer Änderung auf der Platte. Braucht kein TeX.
// Nur der native Ordnerdialog wird im Main durch ein festes Ergebnis ersetzt. Außerhalb der Bash-Sandbox ausführen.

const WEB_DIR = join(__dirname, '../..');
const DEMO_DIR = join(WEB_DIR, '..', 'shared', 'Testdaten', 'HgbDemo');
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const BUILD_FILE_PATTERN = /\.(aux|log|pdf|toc|out|bbl|blg|bcf|lof|lot|fls|fdb_latexmk|xml)$|\.synctex\.gz$/;
const CHAPTERS = 'chapters';
const INTRO_FILE = 'einleitung.tex';
const FOUNDATIONS_FILE = 'grundlagen.tex';
const IMPLEMENTATION_FILE = 'umsetzung.tex';
const CONCLUSION_FILE = 'fazit.tex';
const BIB_FILE = 'hgbreferences.bib';
const UNDEFINED_LABEL = 'fig:fehlt';
const UNUSED_LABEL = 'sec:ungenutzt';
const UNUSED_SOURCE = 'ungenutzt2026';
const OPEN_TIMEOUT_MS = 15_000;
const INDEX_TIMEOUT_MS = 10_000;
const WATCH_TIMEOUT_MS = 15_000;

interface EditorWindow {
    __editorTestApi?: { text(): string; activePath(): string | null; selection(): { anchor: number; head: number } };
}

const enabled = existsSync(DEMO_DIR);

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
let projectDir: string;

const marks = () => page.locator('.cm-content .cm-reference-error');
const hintRow = (title: string) => page.getByRole('region', { name: 'Hinweise' }).locator('.hint-row', { hasText: title });
const tree = () => page.getByRole('tree', { name: 'Dateibaum' });

function copyDemoWithoutBuildFiles(target: string): void {
    cpSync(DEMO_DIR, target, { recursive: true, filter: (source) => !BUILD_FILE_PATTERN.test(source) });
}

/** Zeile (1-basiert) der ersten Zeile ohne Kommentar, die `needle` enthält */
function lineInCopy(relativePath: string, needle: string): number {
    const lines = readFileSync(join(projectDir, relativePath), 'utf8').split('\n');
    const index = lines.findIndex((line) => !line.trimStart().startsWith('%') && line.includes(needle));
    if (index === -1) throw new Error(`${needle} fehlt in ${relativePath}`);
    return index + 1;
}

const activePath = async (): Promise<string> =>
    ((await page.evaluate(() => (globalThis as unknown as EditorWindow).__editorTestApi!.activePath())) ?? '').replaceAll('\\', '/');

async function cursorLine(): Promise<number> {
    return page.evaluate(() => {
        const api = (globalThis as unknown as EditorWindow).__editorTestApi!;
        return api.text().slice(0, api.selection().head).split('\n').length;
    });
}

const RETRY_JUMP_MS = 1_000;
const INDEX_READY_MS = 10_000;

async function jumpClick(needle: string, offset: number): Promise<void> {
    const point = await pointOfText(page, needle, offset);
    await page.keyboard.down(JUMP_KEY);
    await page.mouse.click(point.x, point.y);
    await page.keyboard.up(JUMP_KEY);
}

async function openChapter(file: string): Promise<void> {
    const folder = tree().getByRole('treeitem', { name: CHAPTERS, exact: true });
    if ((await folder.getAttribute('aria-expanded')) !== 'true') await folder.click();
    await tree().getByRole('treeitem', { name: file, exact: true }).dblclick();
    await expect(page.getByRole('tab', { name: file })).toHaveAttribute('aria-selected', 'true');
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
    await page.getByRole('button', { name: 'Projekt öffnen …', exact: true }).first().click();
    await expect(page.getByText('Hauptdatei: main.tex')).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
});

test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
});

test('Demo: `fig:fehlt` ist rot unterstrichen; `sec:ungenutzt` und `ungenutzt2026` stehen unter „Hinweise“', async () => {
    test.setTimeout(OPEN_TIMEOUT_MS + INDEX_TIMEOUT_MS);
    await openChapter(INTRO_FILE);
    await expect(marks().filter({ hasText: UNDEFINED_LABEL })).toHaveCount(1, { timeout: INDEX_TIMEOUT_MS });
    await expect(marks().filter({ hasText: 'chap:grundlagen' })).toHaveCount(0);
    await expect(marks().filter({ hasText: 'knuth1984' })).toHaveCount(0);

    await page.locator('.sidebar-tab', { hasText: 'Meldungen' }).click();
    const unusedLine = lineInCopy(`${CHAPTERS}/${IMPLEMENTATION_FILE}`, `\\label{${UNUSED_LABEL}}`);
    await expect(hintRow(UNUSED_LABEL)).toContainText(`${CHAPTERS}/${IMPLEMENTATION_FILE}:${unusedLine}`, { timeout: INDEX_TIMEOUT_MS });
    await expect(hintRow(UNUSED_SOURCE)).toBeVisible();
    await expect(hintRow('chap:einleitung')).toHaveCount(0);
});

test('Klick auf den Hinweis `sec:ungenutzt` springt in die Datei an die Zeile des Labels', async () => {
    await hintRow(UNUSED_LABEL).click();
    await expect.poll(activePath).toMatch(new RegExp(`${CHAPTERS}/${IMPLEMENTATION_FILE}$`));
    await expect.poll(cursorLine).toBe(lineInCopy(`${CHAPTERS}/${IMPLEMENTATION_FILE}`, `\\label{${UNUSED_LABEL}}`));
});

test('Strg-Klick auf `\\ref{chap:grundlagen}` springt zur Label-Definition (Datei und Zeile)', async () => {
    await page.locator('.sidebar-tab', { hasText: 'Dateien' }).click();
    await openChapter(INTRO_FILE);
    // Das Ziel kennt erst der Projektindex im Worker: bis dahin meldet Strg-Klick nur „kein Ziel“, also wiederholen
    await expect(async () => {
        await jumpClick('\\ref{chap:grundlagen}', 8);
        await expect.poll(activePath, { timeout: RETRY_JUMP_MS }).toMatch(new RegExp(`${CHAPTERS}/${FOUNDATIONS_FILE}$`));
    }).toPass({ timeout: INDEX_READY_MS });
    await expect.poll(cursorLine).toBe(lineInCopy(`${CHAPTERS}/${FOUNDATIONS_FILE}`, '\\label{chap:grundlagen}'));
});

test('Strg-Klick auf `\\cite{knuth1984}` springt in die .bib an den Eintrag', async () => {
    await openChapter(INTRO_FILE);
    await jumpClick('\\cite{knuth1984}', 9);
    await expect.poll(activePath).toMatch(new RegExp(`${BIB_FILE}$`));
    await expect.poll(cursorLine).toBe(lineInCopy(BIB_FILE, '@book{knuth1984,'));
});

test('Strg-Klick auf `\\input{chapters/einleitung}` in main.tex öffnet die Datei', async () => {
    await tree().getByRole('treeitem', { name: 'main.tex', exact: true }).dblclick();
    await expect(page.getByRole('tab', { name: 'main.tex' })).toHaveAttribute('aria-selected', 'true');
    await jumpClick(`\\input{${CHAPTERS}/${INTRO_FILE.replace('.tex', '')}}`, 14);
    await expect.poll(activePath).toMatch(new RegExp(`${CHAPTERS}/${INTRO_FILE}$`));
});

test('eine Änderung auf der Platte (neues Label `fig:fehlt` im Fazit) nimmt die Unterstreichung weg', async () => {
    test.setTimeout(WATCH_TIMEOUT_MS + 5_000);
    await expect(marks().filter({ hasText: UNDEFINED_LABEL })).toHaveCount(1);
    appendFileSync(join(projectDir, CHAPTERS, CONCLUSION_FILE), `\n\\label{${UNDEFINED_LABEL}}\n`);
    await expect(marks().filter({ hasText: UNDEFINED_LABEL })).toHaveCount(0, { timeout: WATCH_TIMEOUT_MS });
});
