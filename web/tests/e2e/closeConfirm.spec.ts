import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// K1: Schließen des Fensters mit ungespeichertem Text fragt nach (Speichern / Nicht speichern / Abbrechen).
// Teil 1 mit dem Stub-Preload: Er hört nicht auf den Main, daher löst der Test `app:closeRequested` selbst aus
// (`__stub.emit`) und prüft `app:confirmClose` in den aufgezeichneten Aufrufen.
// Teil 2 mit dem echten Preload und echtem Main: Fenster schließen und `app.quit()` (wie ⌘Q) laufen durch den
// `CloseGuard`; die Datei kommt über den Testzugang (`npm run build:e2e`) ohne Dialog in den Editor.

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const MODIFIER = 'ControlOrMeta';
const FILE_NAME = 'brief.tex';
const FILE_TEXT = 'Hallo\n';
const REAL_PATH = '/e2e/schliessen/kapitel.tex';
const MISSING_TEST_API = 'Testzugang fehlt: vorher `npm run build:e2e` ausführen';
const DIALOG = '.close-confirm';

interface StubCall {
    channel: string;
    args: unknown[];
}

interface StubWindow {
    api: {
        __stub: {
            calls(): StubCall[];
            clearCalls(): void;
            prepareFile(name: string, text: string): void;
            emit(event: string, payload: unknown): void;
        };
    };
}

type TestWindow = { __editorTestApi?: { open(path: string, text: string): void } };

async function launch(stubPreload: boolean): Promise<{ app: ElectronApplication; page: Page; userDataDir: string }> {
    const userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-e2e-'));
    const env = { ...process.env } as Record<string, string>;
    delete env[DEV_SERVER_ENV];
    if (stubPreload) env[STUB_PRELOAD_ENV] = '1';
    else delete env[STUB_PRELOAD_ENV];
    const app = await electron.launch({ args: [WEB_DIR, `--user-data-dir=${userDataDir}`], env });
    const page = await app.firstWindow();
    await page.waitForSelector('.editor-host .cm-editor');
    return { app, page, userDataDir };
}

async function typeInEditor(page: Page, text: string): Promise<void> {
    await page.locator('.cm-content').focus();
    await page.keyboard.type(text);
    await expect(page.locator('.tab-dirty')).toHaveCount(1);
}

test.describe('mit Stub-Preload (Ablauf im Renderer)', () => {
    test.describe.configure({ mode: 'serial' });
    let app: ElectronApplication;
    let page: Page;
    let userDataDir: string;

    const calls = async (channel: string): Promise<StubCall[]> =>
        (await page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.calls())).filter((call) => call.channel === channel);
    const requestClose = (): Promise<void> =>
        page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.emit('app:closeRequested', null));

    test.beforeAll(async () => {
        ({ app, page, userDataDir } = await launch(true));
        await page.evaluate(
            ([name, text]) => (globalThis as unknown as StubWindow).api.__stub.prepareFile(name!, text!),
            [FILE_NAME, FILE_TEXT],
        );
        await page.keyboard.press(`${MODIFIER}+o`);
        await expect(page.getByRole('tab', { name: FILE_NAME })).toBeVisible();
    });

    test.afterAll(async () => {
        await app?.close();
        rmSync(userDataDir, { recursive: true, force: true });
    });

    test('ohne Ungespeichertes wird sofort bestätigt, keine Nachfrage', async () => {
        await requestClose();
        await expect.poll(async () => (await calls('app:confirmClose')).length).toBe(1);
        await expect(page.locator(DIALOG)).toHaveCount(0);
    });

    test('mit Ungespeichertem erscheint die Nachfrage mit dem Dateinamen; Abbrechen hält offen', async () => {
        await page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.clearCalls());
        await typeInEditor(page, 'X');
        await requestClose();
        const dialog = page.locator(DIALOG);
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('Ungespeicherte Änderungen');
        await expect(dialog).toContainText(`Geändert: ${FILE_NAME}`);
        await dialog.getByRole('button', { name: 'Abbrechen' }).click();
        await expect(dialog).toHaveCount(0);
        expect(await calls('app:confirmClose')).toHaveLength(0);
        await expect(page.locator('.tab-dirty')).toHaveCount(1);
    });

    test('Escape wirkt wie Abbrechen', async () => {
        await requestClose();
        await expect(page.locator(DIALOG)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator(DIALOG)).toHaveCount(0);
        expect(await calls('app:confirmClose')).toHaveLength(0);
    });

    test('Speichern schreibt die Datei und bestätigt dann das Schließen', async () => {
        await requestClose();
        await page.locator(DIALOG).getByRole('button', { name: 'Speichern', exact: true }).click();
        await expect.poll(async () => (await calls('app:confirmClose')).length).toBe(1);
        expect((await calls('fs:writeText')).map((call) => call.args[1])).toEqual([`X${FILE_TEXT}`]);
        await expect(page.locator('.tab-dirty')).toHaveCount(0);
    });

    test('Nicht speichern bestätigt ohne zu schreiben', async () => {
        await page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.clearCalls());
        await typeInEditor(page, 'Y');
        await requestClose();
        await page.locator(DIALOG).getByRole('button', { name: 'Nicht speichern' }).click();
        await expect.poll(async () => (await calls('app:confirmClose')).length).toBe(1);
        expect(await calls('fs:writeText')).toHaveLength(0);
    });
});

test.describe('mit echtem Preload (Fenster schließen und Beenden über den Main)', () => {
    test.describe.configure({ mode: 'serial' });
    let app: ElectronApplication;
    let page: Page;
    let userDataDir: string;
    let exited = false;

    const windowCount = (): Promise<number> => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);

    test.beforeAll(async () => {
        ({ app, page, userDataDir } = await launch(false));
        app.on('close', () => (exited = true));
        const hasApi = await page.evaluate(() => (globalThis as unknown as TestWindow).__editorTestApi !== undefined);
        if (!hasApi) throw new Error(MISSING_TEST_API);
        await page.evaluate(
            ([path, text]) => (globalThis as unknown as TestWindow).__editorTestApi!.open(path!, text!),
            [REAL_PATH, FILE_TEXT],
        );
        await typeInEditor(page, 'Z');
    });

    test.afterAll(async () => {
        if (!exited) await app?.close();
        rmSync(userDataDir, { recursive: true, force: true });
    });

    test('Fenster schließen fragt nach; Abbrechen lässt das Fenster offen', async () => {
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
        const dialog = page.locator(DIALOG);
        await expect(dialog).toContainText('Geändert: kapitel.tex');
        await dialog.getByRole('button', { name: 'Abbrechen' }).click();
        await expect(dialog).toHaveCount(0);
        expect(await windowCount()).toBe(1);
    });

    test('Beenden (wie ⌘Q) fragt ebenfalls nach; Abbrechen beendet nicht', async () => {
        await app.evaluate(({ app: electronApp }) => electronApp.quit());
        const dialog = page.locator(DIALOG);
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Abbrechen' }).click();
        await expect(dialog).toHaveCount(0);
        expect(await windowCount()).toBe(1);
        expect(exited).toBe(false);
    });

    test('Nicht speichern schließt das Fenster und beendet die App', async () => {
        const closed = app.waitForEvent('close');
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
        await page.locator(DIALOG).getByRole('button', { name: 'Nicht speichern' }).click();
        await closed;
        expect(exited).toBe(true);
    });
});
