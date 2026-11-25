import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// W2-16: Menübefehle im Renderer. Der Stub-Preload hört nicht auf den Main und native Menü-Kürzel erreichen
// Playwright nicht; der Test löst `menu:command` daher selbst aus (`__stub.emit`), wie der Main es täte.

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const MODIFIER = 'ControlOrMeta';
const TAB_CLOSE_DIALOG = '.tab-close-confirm';

interface StubWindow {
    api: { __stub: { prepareFile(name: string, text: string): void; emit(event: string, payload: unknown): void } };
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

function sendCommand(page: Page, commandId: string): Promise<void> {
    return page.evaluate((id) => (globalThis as unknown as StubWindow).api.__stub.emit('menu:command', { commandId: id }), commandId);
}

async function openFile(page: Page, name: string): Promise<void> {
    await page.evaluate((n) => (globalThis as unknown as StubWindow).api.__stub.prepareFile(n, 'Inhalt\n'), name);
    await page.keyboard.press(`${MODIFIER}+o`);
    await expect(page.getByRole('tab', { name })).toBeVisible();
}

test.describe('Menübefehle', () => {
    test.describe.configure({ mode: 'serial' });
    let app: ElectronApplication;
    let page: Page;
    let userDataDir: string;

    test.beforeAll(async () => {
        ({ app, page, userDataDir } = await launch());
    });

    test.afterAll(async () => {
        await app?.close();
        rmSync(userDataDir, { recursive: true, force: true });
    });

    test('Schnell öffnen (Strg+P) zeigt den Dialog, Escape schließt ihn', async () => {
        await sendCommand(page, 'edit.quickOpen');
        await expect(page.locator('dialog.quick-open')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('dialog.quick-open')).toHaveCount(0);
    });

    test('Gehe zu Zeile (Strg+G) braucht einen offenen Tab', async () => {
        await sendCommand(page, 'edit.gotoLine');
        await expect(page.locator('dialog.goto-line')).toHaveCount(0);
        await openFile(page, 'a.tex');
        await sendCommand(page, 'edit.gotoLine');
        await expect(page.locator('dialog.goto-line')).toBeVisible();
        await page.keyboard.press('Escape');
    });

    test('Tab schließen (Strg+W): ohne Änderung sofort, mit Änderung mit Nachfrage', async () => {
        await sendCommand(page, 'file.closeTab');
        await expect(page.getByRole('tab')).toHaveCount(0);
        await openFile(page, 'b.tex');
        await page.locator('.cm-content').focus();
        await page.keyboard.type('X');
        await sendCommand(page, 'file.closeTab');
        await expect(page.locator(TAB_CLOSE_DIALOG)).toBeVisible();
        await page.getByRole('button', { name: 'Abbrechen' }).click();
        await expect(page.getByRole('tab', { name: 'b.tex' })).toBeVisible();
    });
});
