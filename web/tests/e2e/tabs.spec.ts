import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// W2-4: Tab-Leiste (Reihenfolge per Ziehen und Tastatur, Vorschau → fest, Mittelklick), Nachfrage beim Schließen
// eines ungespeicherten Tabs und Tab-Gedächtnis je Projekt. Alles mit dem Stub-Preload (`LATEXEDITOR_STUB_PRELOAD`);
// Vorschau-Tabs und das Gedächtnis brauchen den Testzugang (`npm run build:e2e`).

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const MODIFIER = 'ControlOrMeta';
const STUB_ROOT = '/stub/projekt';
const MISSING_TEST_API = 'Testzugang fehlt: vorher `npm run build:e2e` ausführen';
const DIALOG = '.tab-close-confirm';
const FILES = ['a.tex', 'b.tex', 'c.tex'] as const;

interface StubCall {
    channel: string;
    args: unknown[];
}

interface MemoryEntry {
    path: string;
    isPreview: boolean;
    anchor: number;
    head: number;
    scrollTop: number;
}

interface Memory {
    version: 1;
    tabs: MemoryEntry[];
    active: string | null;
}

interface StubWindow {
    api: {
        __stub: {
            calls(): StubCall[];
            clearCalls(): void;
            prepareFile(name: string, text: string): void;
            setTabMemory(memory: Memory | null): void;
            tabMemory(): Memory | null;
        };
    };
    __editorTestApi?: { open(path: string, text: string, eol?: string, asPreview?: boolean): void };
    __tabMemoryTestApi?: { start(root: string): Promise<{ opened: number; skipped: number }>; flush(): Promise<void> };
}

async function launch(): Promise<{ app: ElectronApplication; page: Page; userDataDir: string }> {
    const userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-e2e-'));
    const env = { ...process.env, [STUB_PRELOAD_ENV]: '1' } as Record<string, string>;
    delete env[DEV_SERVER_ENV];
    const app = await electron.launch({ args: [WEB_DIR, `--user-data-dir=${userDataDir}`], env });
    const page = await app.firstWindow();
    await page.waitForSelector('.editor-host .cm-editor');
    const hasTestApi = await page.evaluate(() => (globalThis as unknown as StubWindow).__editorTestApi !== undefined);
    if (!hasTestApi) throw new Error(MISSING_TEST_API);
    return { app, page, userDataDir };
}

const tabTitles = (page: Page): Promise<string[]> => page.getByRole('tab').allTextContents();

async function prepare(page: Page, name: string, text: string): Promise<void> {
    await page.evaluate(([n, t]) => (globalThis as unknown as StubWindow).api.__stub.prepareFile(n!, t!), [name, text]);
}

async function openPicked(page: Page, names: readonly string[]): Promise<void> {
    for (const name of names) await prepare(page, name, `Inhalt ${name}\n`);
    await page.keyboard.press(`${MODIFIER}+o`);
    await expect(page.getByRole('tab')).toHaveCount(names.length);
}

test.describe('Tab-Leiste und Schließen', () => {
    test.describe.configure({ mode: 'serial' });
    let app: ElectronApplication;
    let page: Page;
    let userDataDir: string;

    test.beforeAll(async () => {
        ({ app, page, userDataDir } = await launch());
        await openPicked(page, FILES);
    });

    test.afterAll(async () => {
        await app?.close();
        rmSync(userDataDir, { recursive: true, force: true });
    });

    test('Tab-Leiste hat Rolle tablist, Tabs sind tab, der letzte geöffnete ist ausgewählt', async () => {
        await expect(page.getByRole('tablist', { name: 'Geöffnete Dateien' })).toBeVisible();
        expect(await tabTitles(page)).toEqual([...FILES]);
        await expect(page.getByRole('tab', { name: 'c.tex' })).toHaveAttribute('aria-selected', 'true');
    });

    test('Reihenfolge per Ziehen: c vor a', async () => {
        await page.getByRole('tab', { name: 'c.tex' }).dragTo(page.getByRole('tab', { name: 'a.tex' }));
        expect(await tabTitles(page)).toEqual(['c.tex', 'a.tex', 'b.tex']);
        await expect(page.getByRole('tab', { name: 'c.tex' })).toHaveAttribute('aria-selected', 'true');
    });

    test('Strg+Tab und Strg+Umschalt+Tab wechseln den Tab', async () => {
        await page.keyboard.press('Control+Tab');
        await expect(page.getByRole('tab', { name: 'a.tex' })).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('Control+Shift+Tab');
        await expect(page.getByRole('tab', { name: 'c.tex' })).toHaveAttribute('aria-selected', 'true');
    });

    test('Pfeiltasten in der Leiste wechseln den Tab und nehmen den Fokus mit', async () => {
        await page.getByRole('tab', { name: 'c.tex' }).focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.getByRole('tab', { name: 'a.tex' })).toBeFocused();
        await expect(page.getByRole('tab', { name: 'a.tex' })).toHaveAttribute('aria-selected', 'true');
    });

    test('ein ungespeicherter Tab fragt beim Schließen: Abbrechen behält ihn, Nicht speichern schließt ihn', async () => {
        await page.getByRole('tab', { name: 'a.tex' }).click();
        await page.locator('.cm-content').focus();
        await page.keyboard.type('X');
        await expect(page.locator('.tab-dirty')).toHaveCount(1);
        await page.getByRole('button', { name: '„a.tex“ schließen' }).click();
        const dialog = page.locator(DIALOG);
        await expect(dialog).toContainText('„a.tex“ hat ungespeicherte Änderungen');
        await dialog.getByRole('button', { name: 'Abbrechen' }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByRole('tab', { name: 'a.tex' })).toBeVisible();

        await page.getByRole('button', { name: '„a.tex“ schließen' }).click();
        await dialog.getByRole('button', { name: 'Nicht speichern' }).click();
        await expect(page.getByRole('tab', { name: 'a.tex' })).toHaveCount(0);
    });

    test('Speichern in der Nachfrage schreibt die Datei und schließt den Tab; Escape bricht ab', async () => {
        await page.getByRole('tab', { name: 'b.tex' }).click();
        await page.locator('.cm-content').focus();
        await page.keyboard.type('Y');
        await page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.clearCalls());
        await page.getByRole('button', { name: '„b.tex“ schließen' }).click();
        await page.keyboard.press('Escape');
        await expect(page.locator(DIALOG)).toHaveCount(0);
        await expect(page.getByRole('tab', { name: 'b.tex' })).toBeVisible();

        await page.getByRole('button', { name: '„b.tex“ schließen' }).click();
        await page.locator(DIALOG).getByRole('button', { name: 'Speichern', exact: true }).click();
        await expect(page.getByRole('tab', { name: 'b.tex' })).toHaveCount(0);
        const calls = await page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.calls());
        expect(calls.filter((call) => call.channel === 'fs:writeText').map((call) => call.args[1])).toEqual(['YInhalt b.tex\n']);
    });

    test('ein gespeicherter Tab schließt ohne Nachfrage', async () => {
        await page.getByRole('button', { name: '„c.tex“ schließen' }).click();
        await expect(page.getByRole('tab')).toHaveCount(0);
        await expect(page.locator(DIALOG)).toHaveCount(0);
    });
});

test.describe('Vorschau-Tab', () => {
    test.describe.configure({ mode: 'serial' });
    let app: ElectronApplication;
    let page: Page;
    let userDataDir: string;

    const openPreview = (path: string): Promise<void> =>
        page.evaluate((p) => (globalThis as unknown as StubWindow).__editorTestApi!.open(p, 'Text\n', 'lf', true), path);

    test.beforeAll(async () => {
        ({ app, page, userDataDir } = await launch());
    });

    test.afterAll(async () => {
        await app?.close();
        rmSync(userDataDir, { recursive: true, force: true });
    });

    test('ein Vorschau-Tab ist kursiv und wird vom nächsten ersetzt', async () => {
        await openPreview('/stub/projekt/eins.tex');
        await expect(page.getByRole('tab', { name: 'eins.tex' })).toHaveClass(/is-preview/);
        await openPreview('/stub/projekt/zwei.tex');
        expect(await tabTitles(page)).toEqual(['zwei.tex']);
    });

    test('Doppelklick macht den Vorschau-Tab fest, der nächste Vorschau-Tab ersetzt ihn nicht', async () => {
        await page.getByRole('tab', { name: 'zwei.tex' }).dblclick();
        await expect(page.getByRole('tab', { name: 'zwei.tex' })).not.toHaveClass(/is-preview/);
        await openPreview('/stub/projekt/drei.tex');
        expect(await tabTitles(page)).toEqual(['zwei.tex', 'drei.tex']);
    });

    test('Mittelklick schließt den Tab', async () => {
        await page.getByRole('tab', { name: 'drei.tex' }).click({ button: 'middle' });
        expect(await tabTitles(page)).toEqual(['zwei.tex']);
    });
});

test.describe('Tab-Gedächtnis (Stub)', () => {
    test.describe.configure({ mode: 'serial' });
    let app: ElectronApplication;
    let page: Page;
    let userDataDir: string;

    const remembered: Memory = {
        version: 1,
        tabs: [
            { path: 'kapitel/eins.tex', isPreview: false, anchor: 2, head: 4, scrollTop: 0 },
            { path: 'refs.bib', isPreview: true, anchor: 0, head: 0, scrollTop: 0 },
        ],
        active: 'kapitel/eins.tex',
    };

    test.beforeAll(async () => {
        ({ app, page, userDataDir } = await launch());
        await prepare(page, 'kapitel/eins.tex', 'Kapitel eins\n');
        await prepare(page, 'refs.bib', '@book{x}\n');
        await page.evaluate((memory) => (globalThis as unknown as StubWindow).api.__stub.setTabMemory(memory), remembered);
    });

    test.afterAll(async () => {
        await app?.close();
        rmSync(userDataDir, { recursive: true, force: true });
    });

    test('stellt Tabs, Vorschau, aktiven Tab und Auswahl beim Öffnen des Projekts wieder her', async () => {
        const result = await page.evaluate((root) => (globalThis as unknown as StubWindow).__tabMemoryTestApi!.start(root), STUB_ROOT);
        expect(result).toEqual({ opened: 2, skipped: 0 });
        expect(await tabTitles(page)).toEqual(['eins.tex', 'refs.bib']);
        await expect(page.getByRole('tab', { name: 'refs.bib' })).toHaveClass(/is-preview/);
        await expect(page.getByRole('tab', { name: 'eins.tex' })).toHaveAttribute('aria-selected', 'true');
        const selection = await page.evaluate(() => (globalThis as unknown as { __editorTestApi: { selection(): unknown } }).__editorTestApi.selection());
        expect(selection).toEqual({ anchor: 2, head: 4 });
    });

    test('speichert Änderungen der Tabs im Gedächtnis (flush)', async () => {
        await page.getByRole('tab', { name: 'refs.bib' }).dblclick();
        await page.evaluate(() => (globalThis as unknown as StubWindow).__tabMemoryTestApi!.flush());
        const saved = await page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.tabMemory());
        expect(saved?.tabs.map((tab) => [tab.path, tab.isPreview])).toEqual([['kapitel/eins.tex', false], ['refs.bib', false]]);
        expect(saved?.active).toBe('refs.bib');
    });
});
