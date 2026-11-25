import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// W2-9: Datei-Aktionen in der Oberfläche mit dem Stub-Preload. Das Beispielprojekt (`installSampleProject`) liegt in
// einem virtuellen Dateisystem, das `fs:create/rename/move/duplicate/trash/restore` wie der Main ändert.
// Ablauf: Kontextmenü → Umbenennen → Verweise anpassen → Baum zeigt den neuen Namen → Strg/⌘+Z → alles wie vorher.

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const MAIN_TEXT = '\\chapter{Einleitung}\n\\input{kapitel/einleitung}\n\\input{kapitel/fazit}\n';
const UNDO_KEY = 'ControlOrMeta+z';

interface StubWindow {
    api: {
        __stub: {
            installSampleProject(extraFileCount?: number): void;
            projectEntries(): string[];
            projectFileText(relativePath: string): string | null;
            emit(event: string, payload: unknown): void;
        };
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

/** Native Menüeinträge erreichen Playwright nicht, der Stub-Preload leitet `menu:command` des Mains nicht weiter: Befehl wie der Main auslösen */
function runMenuCommand(page: Page, commandId: string): Promise<void> {
    return page.evaluate((id) => (globalThis as unknown as StubWindow).api.__stub.emit('menu:command', { commandId: id }), commandId);
}

const entries = (page: Page): Promise<string[]> =>
    page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.projectEntries());
const fileText = (page: Page, relative: string): Promise<string | null> =>
    page.evaluate((path) => (globalThis as unknown as StubWindow).api.__stub.projectFileText(path), relative);

const tree = (page: Page) => page.getByRole('tree', { name: 'Dateibaum' });
const item = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true });
const menu = (page: Page) => page.getByRole('menu', { name: 'Dateiaktionen' });
const status = (page: Page) => page.locator('.status-message');

test.describe('Datei-Aktionen', () => {
    test.describe.configure({ mode: 'serial' });
    let app: ElectronApplication;
    let page: Page;
    let userDataDir: string;

    test.beforeAll(async () => {
        ({ app, page, userDataDir } = await launch());
        await page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.installSampleProject());
        await page.getByRole('button', { name: 'Projekt öffnen …', exact: true }).click();
        await expect(page.getByText('Hauptdatei: main.tex')).toBeVisible();
        await item(page, 'kapitel').click();
    });

    test.afterAll(async () => {
        await app.close();
        rmSync(userDataDir, { recursive: true, force: true });
    });

    test('Umbenennen über das Kontextmenü passt \\input an; Strg/⌘+Z stellt alles wieder her', async () => {
        const before = await entries(page);
        await item(page, 'einleitung.tex').click({ button: 'right' });
        await menu(page).getByRole('menuitem', { name: 'Umbenennen …' }).click();
        const dialog = page.getByRole('dialog', { name: 'Umbenennen' });
        const input = dialog.getByRole('textbox', { name: 'Name' });
        await expect(input).toHaveValue('einleitung.tex');
        await input.fill('intro');
        await input.press('Enter');
        await page.getByRole('dialog', { name: 'Verweise auf „einleitung.tex“ anpassen?' })
            .getByRole('button', { name: 'Verweise anpassen' }).click();
        await expect(item(page, 'intro.tex')).toBeVisible();
        await expect(item(page, 'einleitung.tex')).toHaveCount(0);
        expect(await fileText(page, 'main.tex')).toBe(MAIN_TEXT.replace('kapitel/einleitung', 'kapitel/intro'));

        await tree(page).focus();
        await page.keyboard.press(UNDO_KEY);
        await expect(item(page, 'einleitung.tex')).toBeVisible();
        await expect(item(page, 'intro.tex')).toHaveCount(0);
        await expect(status(page)).toHaveText('„Umbenennen“ rückgängig gemacht');
        expect(await fileText(page, 'main.tex')).toBe(MAIN_TEXT);
        expect(await entries(page)).toEqual(before);
    });

    test('Menü Datei: „Datei-Aktion wiederholen“ und „Datei-Aktion rückgängig“', async () => {
        await runMenuCommand(page, 'file.redoFileAction');
        await expect(item(page, 'intro.tex')).toBeVisible();
        expect(await fileText(page, 'main.tex')).toContain('\\input{kapitel/intro}');
        await runMenuCommand(page, 'file.undoFileAction');
        await expect(item(page, 'einleitung.tex')).toBeVisible();
        expect(await fileText(page, 'main.tex')).toBe(MAIN_TEXT);
    });

    test('F2 öffnet die Namenseingabe; belegter Name zeigt einen Fehler, Escape bricht ab', async () => {
        await item(page, 'einleitung.tex').click();
        await page.keyboard.press('F2');
        const dialog = page.getByRole('dialog', { name: 'Umbenennen' });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('textbox', { name: 'Name' }).fill('fazit');
        await expect(dialog.getByRole('alert')).toHaveText('„fazit.tex“ existiert an dieser Stelle bereits.');
        await expect(dialog.getByRole('button', { name: 'Umbenennen' })).toBeDisabled();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(item(page, 'einleitung.tex')).toBeVisible();
    });

    test('Entf legt nach Bestätigung in den Papierkorb; Rückgängig holt die Datei zurück', async () => {
        await item(page, 'fazit.tex').click();
        await page.keyboard.press('Delete');
        const dialog = page.getByRole('alertdialog', { name: '„fazit.tex“ in den Papierkorb legen?' });
        await expect(dialog).toContainText('kann dort wiederhergestellt werden');
        await dialog.getByRole('button', { name: 'In den Papierkorb' }).click();
        await expect(item(page, 'fazit.tex')).toHaveCount(0);
        expect(await entries(page)).not.toContain('kapitel/fazit.tex');
        await tree(page).focus();
        await page.keyboard.press(UNDO_KEY);
        await expect(item(page, 'fazit.tex')).toBeVisible();
        expect(await fileText(page, 'kapitel/fazit.tex')).toBe('\\section{Ergebnis}\nText\n');
    });

    test('Neue Datei über das Kontextmenü eines Ordners öffnet sie als Tab', async () => {
        await item(page, 'kapitel').click({ button: 'right' });
        await menu(page).getByRole('menuitem', { name: 'Neue Datei …' }).click();
        const dialog = page.getByRole('dialog', { name: 'Neue Datei' });
        await expect(dialog).toContainText('in kapitel');
        await dialog.getByRole('textbox', { name: 'Name' }).fill('anhang');
        await dialog.getByRole('button', { name: 'Anlegen' }).click();
        await expect(item(page, 'anhang.tex')).toBeVisible();
        await expect(page.getByRole('tab', { name: 'anhang.tex' })).toBeVisible();
        expect(await entries(page)).toContain('kapitel/anhang.tex');
    });

    test('Ziehen auf einen Ordner verschiebt und passt den Verweis an; Rückgängig verschiebt zurück', async () => {
        await item(page, 'fazit.tex').dragTo(item(page, 'bilder'));
        await page.getByRole('dialog', { name: 'Verweise auf „fazit.tex“ anpassen?' })
            .getByRole('button', { name: 'Verweise anpassen' }).click();
        await expect.poll(() => entries(page)).toContain('bilder/fazit.tex');
        expect(await fileText(page, 'main.tex')).toContain('\\input{bilder/fazit}');
        await tree(page).focus();
        await page.keyboard.press(UNDO_KEY);
        await expect.poll(() => entries(page)).toContain('kapitel/fazit.tex');
        expect(await fileText(page, 'main.tex')).toContain('\\input{kapitel/fazit}');
    });

    test('Umschalt+F10 öffnet das Kontextmenü an der Zeile, Pfeile wandern, Escape schließt', async () => {
        await item(page, 'main.tex').click();
        await page.keyboard.press('Shift+F10');
        await expect(menu(page)).toBeVisible();
        await expect(menu(page).getByRole('menuitem', { name: 'Neue Datei …' })).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(menu(page).getByRole('menuitem', { name: 'Neuer Ordner …' })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(menu(page)).toHaveCount(0);
        await expect(tree(page)).toBeFocused();
    });
});
