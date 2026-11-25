import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// W2-13: extern geänderte offene Dateien mit dem Stub-Preload. `changeFileExternally`/`deleteFileExternally` ändern die
// Datei im Speicher des Stubs (eigener Hash) und schicken `fs:changed` wie der Main.

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const MODIFIER = 'ControlOrMeta';
const MAIN = '/stub/projekt/main.tex';
const CURSOR = 3;
const SILENT_TEXT = '\\chapter{Einleitung extern}\n\\input{kapitel/einleitung}\n';
const FIRST_DISK_TEXT = 'Plattentext\n';
const SECOND_DISK_TEXT = 'Zweiter Plattentext\n';
const CHANGED_MESSAGE = 'Die Datei wurde auf der Festplatte geändert.';
const DELETED_MESSAGE = 'Die Datei wurde auf der Festplatte gelöscht.';

interface StubWindow {
    api: {
        __stub: {
            installSampleProject(extraFileCount?: number): void;
            changeFileExternally(path: string, text: string): void;
            deleteFileExternally(path: string): void;
            writtenText(path: string): string | null;
            recoveryBackups(): { path: string; text: string }[];
        };
    };
    __editorTestApi?: {
        text(): string;
        select(anchor: number, head: number): void;
        selection(): { anchor: number; head: number };
    };
}

async function launch(): Promise<{ app: ElectronApplication; page: Page; userDataDir: string }> {
    const userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-e2e-'));
    const env = { ...process.env, [STUB_PRELOAD_ENV]: '1' } as Record<string, string>;
    delete env[DEV_SERVER_ENV];
    const app = await electron.launch({ args: [WEB_DIR, `--user-data-dir=${userDataDir}`], env });
    const page = await app.firstWindow();
    await page.waitForSelector('.editor-host .cm-editor');
    return { app, page, userDataDir };
}

const editorText = (page: Page): Promise<string> =>
    page.evaluate(() => (globalThis as unknown as StubWindow).__editorTestApi!.text());

const selectAt = (page: Page, position: number): Promise<void> =>
    page.evaluate((at) => (globalThis as unknown as StubWindow).__editorTestApi!.select(at, at), position);

const selection = (page: Page) => page.evaluate(() => (globalThis as unknown as StubWindow).__editorTestApi!.selection());

const writtenText = (page: Page): Promise<string | null> =>
    page.evaluate((path) => (globalThis as unknown as StubWindow).api.__stub.writtenText(path), MAIN);

const changeExternally = (page: Page, text: string): Promise<void> =>
    page.evaluate(
        ([path, content]) => (globalThis as unknown as StubWindow).api.__stub.changeFileExternally(path!, content!),
        [MAIN, text],
    );

const conflictBar = (page: Page) => page.locator('.conflict-bar[role="alert"]');

async function typeAtStart(page: Page, text: string): Promise<void> {
    await selectAt(page, 0);
    await page.locator('.cm-content').focus();
    await page.keyboard.type(text);
    await expect(page.locator('.tab-dirty')).toHaveCount(1);
}

test.describe('Extern geänderte Dateien (Stub-Preload)', () => {
    test.describe.configure({ mode: 'serial' });
    let app: ElectronApplication;
    let page: Page;
    let userDataDir: string;

    test.beforeAll(async () => {
        ({ app, page, userDataDir } = await launch());
        await page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.installSampleProject(0));
        await page.getByRole('button', { name: 'Projekt öffnen …', exact: true }).click();
        await expect(page.getByText('Hauptdatei: main.tex')).toBeVisible();
        await page.getByRole('tree', { name: 'Dateibaum' }).getByRole('treeitem', { name: 'main.tex', exact: true }).dblclick();
        await expect(page.getByRole('tab', { name: 'main.tex' })).toBeVisible();
    });

    test.afterAll(async () => {
        await app.close();
        rmSync(userDataDir, { recursive: true, force: true });
    });

    test('unveränderter Tab lädt still neu, Cursor bleibt, keine Leiste', async () => {
        await selectAt(page, CURSOR);
        await changeExternally(page, SILENT_TEXT);
        await expect.poll(() => editorText(page)).toBe(SILENT_TEXT);
        expect(await selection(page)).toEqual({ anchor: CURSOR, head: CURSOR });
        await expect(page.locator('.tab-dirty')).toHaveCount(0);
        await expect(conflictBar(page)).toHaveCount(0);
    });

    test('geänderter Tab: Leiste, Speichern überschreibt nicht; „Meine Version behalten“ per Tastatur', async () => {
        await typeAtStart(page, 'X');
        await changeExternally(page, FIRST_DISK_TEXT);
        await expect(conflictBar(page)).toContainText(CHANGED_MESSAGE);
        expect(await editorText(page)).toBe(`X${SILENT_TEXT}`);

        await page.keyboard.press(`${MODIFIER}+s`);
        await expect(page.locator('.status-message')).toContainText('außerhalb des Editors geändert');
        expect(await writtenText(page)).toBe(FIRST_DISK_TEXT);

        const keep = conflictBar(page).getByRole('button', { name: 'Meine Version behalten' });
        await keep.focus();
        await page.keyboard.press('Enter');
        await expect(conflictBar(page)).toHaveCount(0);
        await expect(page.locator('.tab-dirty')).toHaveCount(1);

        await page.locator('.cm-content').focus();
        await page.keyboard.press(`${MODIFIER}+s`);
        await expect.poll(() => writtenText(page)).toBe(`X${SILENT_TEXT}`);
        await expect(page.locator('.tab-dirty')).toHaveCount(0);
    });

    test('„Platten-Version laden“: eigene Version gesichert, Platte geladen, Rückgängig holt sie zurück', async () => {
        await typeAtStart(page, 'Y');
        const ownText = await editorText(page);
        await changeExternally(page, SECOND_DISK_TEXT);
        await conflictBar(page).getByRole('button', { name: 'Platten-Version laden' }).click();
        await expect.poll(() => editorText(page)).toBe(SECOND_DISK_TEXT);
        await expect(conflictBar(page)).toHaveCount(0);
        await expect(page.locator('.tab-dirty')).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.recoveryBackups()))
            .toContainEqual({ path: MAIN, text: ownText });

        await page.locator('.cm-content').focus();
        await page.keyboard.press(`${MODIFIER}+z`);
        await expect.poll(() => editorText(page)).toBe(ownText);
        await expect(page.locator('.tab-dirty')).toHaveCount(1);
        await page.keyboard.press(`${MODIFIER}+s`);
        await expect(page.locator('.tab-dirty')).toHaveCount(0);
    });

    test('gelöschte Datei: Hinweis, Text bleibt; „Neu anlegen“ schreibt sie wieder', async () => {
        const text = await editorText(page);
        await page.evaluate((path) => (globalThis as unknown as StubWindow).api.__stub.deleteFileExternally(path), MAIN);
        await expect(conflictBar(page)).toContainText(DELETED_MESSAGE);
        await expect(page.getByRole('tab', { name: 'main.tex' })).toBeVisible();
        expect(await editorText(page)).toBe(text);

        await conflictBar(page).getByRole('button', { name: 'Neu anlegen' }).click();
        await expect(conflictBar(page)).toHaveCount(0);
        expect(await writtenText(page)).toBe(text);
    });
});
