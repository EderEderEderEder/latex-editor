import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// W2-3: Projekt-Oberfläche mit dem Stub-Preload (`LATEXEDITOR_STUB_PRELOAD`): Startansicht, Projekt öffnen, Dateibaum
// (virtualisiert, Tastatur, Vorschau/fest), Gliederung, Namensfilter, Dateitypmenü, Teiler und `fs:changed`.
// Das Beispielprojekt kommt aus `installSampleProject` (tests/support/preloadStub.ts).

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const ROOT = '/stub/projekt';
const EXTRA_FILES = 5000;
const MAX_RENDERED_ROWS = 80;
const DRAG_DISTANCE_PX = 100;
const DEFAULT_WIDTH_PX = 260;
const MIN_WIDTH_PX = 180;
const MAX_WIDTH_PX = 480;
const LONG_FILE_NAME = 'ein-sehr-sehr-langer-dateiname-der-nie-in-die-seitenleiste-passt-und-trotzdem-nichts-verschiebt.tex';

interface StubWindow {
    api: {
        __stub: {
            installSampleProject(extraFileCount?: number): void;
            addProjectFile(relativePath: string, text: string): void;
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

const installProject = (page: Page, extraFileCount: number): Promise<void> =>
    page.evaluate((count) => (globalThis as unknown as StubWindow).api.__stub.installSampleProject(count), extraFileCount);

const addProjectFile = (page: Page, relativePath: string): Promise<void> =>
    page.evaluate((path) => (globalThis as unknown as StubWindow).api.__stub.addProjectFile(path, ''), relativePath);

const emitTreeChanged = (page: Page): Promise<void> =>
    page.evaluate(() =>
        (globalThis as unknown as StubWindow).api.__stub.emit('fs:changed', {
            paths: [], kinds: ['created'], treeChanged: true, gitChanged: false,
        }),
    );

const tree = (page: Page) => page.getByRole('tree', { name: 'Dateibaum' });
const item = (page: Page, name: string) => tree(page).getByRole('treeitem', { name, exact: true });
const widthOf = async (page: Page, selector: string): Promise<number> => (await page.locator(selector).boundingBox())?.width ?? 0;

test.describe('Projekt-Oberfläche', () => {
    test.describe.configure({ mode: 'serial' });
    let app: ElectronApplication;
    let page: Page;
    let userDataDir: string;

    test.beforeAll(async () => {
        ({ app, page, userDataDir } = await launch());
    });

    test.afterAll(async () => {
        await app.close();
        rmSync(userDataDir, { recursive: true, force: true });
    });

    test('zeigt ohne Projekt die Startansicht', async () => {
        await expect(page.getByRole('heading', { name: 'Kein Projekt geöffnet' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Projekt öffnen …', exact: true })).toBeVisible();
        await expect(page.getByRole('tree', { name: 'Dateibaum' })).toHaveCount(0);
    });

    test('öffnet das Projekt und zeigt Name, Hauptdatei und Baum ohne Build-Dateien', async () => {
        await installProject(page, EXTRA_FILES);
        await page.getByRole('button', { name: 'Projekt öffnen …', exact: true }).click();
        await expect(page.getByText('Hauptdatei: main.tex')).toBeVisible();
        const names = await tree(page).getByRole('treeitem').evaluateAll((rows) => rows.map((row) => (row.textContent ?? '').replace(/^[▸▾]/, '')));
        expect(names).toEqual(['bilder', 'kapitel', 'viele', 'literatur.bib', 'main.tex']);
    });

    test('rendert bei 5.000 Dateien in einem Ordner nur die sichtbaren Zeilen', async () => {
        await item(page, 'viele').click();
        await expect(item(page, 'datei-0001.txt')).toBeVisible();
        const rendered = await page.locator('.file-tree-row').count();
        expect(rendered).toBeLessThan(MAX_RENDERED_ROWS);
        await expect(item(page, 'datei-0001.txt')).toHaveAttribute('aria-setsize', String(EXTRA_FILES));
        await tree(page).evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
        await expect(item(page, `datei-${EXTRA_FILES}.txt`)).toBeVisible();
        expect(await page.locator('.file-tree-row').count()).toBeLessThan(MAX_RENDERED_ROWS);
        // Der Ordner liegt oben und ist bei der Virtualisierung nur im DOM, wenn er sichtbar ist
        await tree(page).evaluate((element) => element.scrollTo({ top: 0 }));
        await item(page, 'viele').click();
    });

    test('Einzelklick öffnet als Vorschau-Tab, Doppelklick als festen', async () => {
        await item(page, 'kapitel').click();
        await item(page, 'einleitung.tex').click();
        const tab = page.getByRole('tab', { name: 'einleitung.tex' });
        await expect(tab).toHaveClass(/is-preview/);
        await item(page, 'einleitung.tex').dblclick();
        await expect(tab).not.toHaveClass(/is-preview/);
        await expect(page.getByRole('navigation', { name: 'Pfad der Datei' })).toContainText('kapitel/einleitung.tex');
    });

    test('Tastatur: Pfeile klappen Ordner und wählen, Enter öffnet fest', async () => {
        await item(page, 'kapitel').click();
        await page.keyboard.press('ArrowLeft');
        await expect(item(page, 'kapitel')).toHaveAttribute('aria-expanded', 'false');
        await page.keyboard.press('ArrowRight');
        await expect(item(page, 'kapitel')).toHaveAttribute('aria-expanded', 'true');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await expect(item(page, 'fazit.tex')).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('Enter');
        await expect(page.getByRole('tab', { name: 'fazit.tex' })).not.toHaveClass(/is-preview/);
    });

    test('Gliederung zeigt Abschnitte; ein Klick springt zur Zeile', async () => {
        await page.getByRole('button', { name: 'Gliederung', exact: true }).click();
        const outline = page.getByRole('tree', { name: 'Gliederung' });
        await expect(outline.getByRole('treeitem')).toHaveCount(4);
        await outline.getByRole('treeitem', { name: /Ziel/ }).click();
        await expect(page.getByRole('tab', { name: 'einleitung.tex' })).toHaveAttribute('aria-selected', 'true');
        await expect(page.locator('.status-position')).toContainText('Zeile 3, Spalte 1');
        await page.getByRole('button', { name: 'Dateien', exact: true }).click();
        await expect(tree(page)).toBeVisible();
    });

    test('Namensfilter zeigt Treffer mit relativem Pfad und lässt sich löschen', async () => {
        const filter = page.getByRole('textbox', { name: 'Dateien filtern' });
        await filter.fill('FAZIT');
        await expect(tree(page).getByRole('treeitem')).toHaveCount(1);
        await expect(item(page, 'kapitel/fazit.tex')).toBeVisible();
        await filter.fill('gibtesnicht');
        await expect(page.getByText('Keine Treffer für „gibtesnicht“.')).toBeVisible();
        await page.getByRole('button', { name: 'Filter löschen' }).click();
        await expect(item(page, 'main.tex')).toBeVisible();
    });

    test('Dateitypmenü blendet Typen aus und zeigt Build-Dateien', async () => {
        await page.getByRole('button', { name: 'Dateitypen filtern' }).click();
        await page.getByRole('checkbox', { name: '.bib (1)' }).uncheck();
        await expect(item(page, 'literatur.bib')).toHaveCount(0);
        await page.getByRole('checkbox', { name: 'Build-Dateien zeigen' }).check();
        await expect(item(page, 'main.aux')).toBeVisible();
        await page.getByRole('button', { name: 'Alle Dateitypen zeigen' }).click();
        await expect(item(page, 'literatur.bib')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('group', { name: 'Dateitypen' })).toHaveCount(0);
    });

    test('Teiler ändert die Breite zwischen 180 und 480 Pixeln, der Editor nimmt den Rest', async () => {
        const separator = page.getByRole('separator', { name: 'Breite der Seitenleiste' });
        const box = await separator.boundingBox();
        if (box === null) throw new Error('Teiler nicht sichtbar');
        const startX = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        expect(await widthOf(page, '.sidebar-shell')).toBe(DEFAULT_WIDTH_PX);
        await page.mouse.move(startX, y);
        await page.mouse.down();
        await page.mouse.move(startX + DRAG_DISTANCE_PX, y);
        await page.mouse.up();
        expect(await widthOf(page, '.sidebar-shell')).toBe(DEFAULT_WIDTH_PX + DRAG_DISTANCE_PX);
        await separator.focus();
        await page.keyboard.press('Home');
        expect(await widthOf(page, '.sidebar-shell')).toBe(MIN_WIDTH_PX);
        await page.keyboard.press('End');
        expect(await widthOf(page, '.sidebar-shell')).toBe(MAX_WIDTH_PX);
        await separator.dblclick();
        expect(await widthOf(page, '.sidebar-shell')).toBe(DEFAULT_WIDTH_PX);
    });

    test('ein langer Dateiname ändert die Breite des Editors nicht', async () => {
        const before = await widthOf(page, '.editor-pane');
        await addProjectFile(page, LONG_FILE_NAME);
        await emitTreeChanged(page);
        await expect(page.locator('.file-tree-row', { hasText: 'ein-sehr-sehr-langer' })).toBeVisible();
        expect(await widthOf(page, '.editor-pane')).toBe(before);
    });

    test('fs:changed mit treeChanged holt den Baum neu', async () => {
        await addProjectFile(page, 'neu.tex');
        await emitTreeChanged(page);
        await expect(item(page, 'neu.tex')).toBeVisible();
    });

    test('Projektpfad bleibt Wurzel ' + ROOT, async () => {
        await expect(page.locator('.project-name')).toHaveAttribute('title', ROOT);
    });
});
