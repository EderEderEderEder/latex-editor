import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// W4-12: undefinierte Verweise rot unterstrichen, Abschnitt „Hinweise“ in der Fehlerliste (ungenutzte Labels, Quellen,
// Abkürzungen), Sprung per Klick. Stub-Preload; der Index liest das Beispielprojekt (`installSampleProject` plus
// `addProjectFile`) über `fs:readMany` im Worker. Die drei Demo-Fälle der HgbDemo: `fig:fehlt` (undefiniert),
// `sec:ungenutzt` (ungenutzt), `ungenutzt2026` (nicht zitierte Quelle).
// Voraussetzung: Build mit Testzugang (`npm run build:e2e`).

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const MISSING_TEST_API = 'window.__editorTestApi fehlt: vorher npm run build:e2e';
const ROOT = '/stub/projekt';
const TEX_FILE = 'kapitel/verweise.tex';
const TEX_PATH = `${ROOT}/${TEX_FILE}`;
const TEX_TEXT = [
    '\\section{Abschnitt}\\label{sec:ungenutzt}',
    '\\label{sec:benutzt}',
    'Siehe \\ref{sec:benutzt} und \\ref{fig:fehlt} sowie \\cite{knuth1984}.',
    '% \\ref{kommentar:egal} \\cite{egal}',
    '',
].join('\n');
const BIB_FILE = 'quellen.bib';
const BIB_PATH = `${ROOT}/${BIB_FILE}`;
const BIB_TEXT = '@book{knuth1984,\n  title = {TeX}\n}\n\n@online{ungenutzt2026,\n  title = {Nie zitiert}\n}\n';
const BIB_UNUSED_LINE = 5;
const INDEX_TIMEOUT_MS = 8_000;
const MODIFIER = 'ControlOrMeta';
/** Genug Rückgängig-Schritte für die getippte Zeile (danach ist der Text wieder der ursprüngliche) */
const UNDO_STEPS = 30;

interface StubWindow {
    __editorTestApi?: {
        open(path: string, text: string): void;
        activate(path: string): void;
        activePath(): string | null;
        text(): string;
        selection(): { anchor: number; head: number };
        select(anchor: number, head: number): void;
    };
    api: { __stub: { installSampleProject(): void; addProjectFile(relativePath: string, text: string): void } };
}

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
const pageErrors: string[] = [];

const marks = () => page.locator('.cm-content .cm-reference-error');
const hintSection = () => page.getByRole('region', { name: 'Hinweise' });
const hintGroup = (title: string) => hintSection().getByRole('group', { name: new RegExp(`^${title}`) });
const hintRow = (title: string) => hintSection().locator('.hint-row', { hasText: title });
const issuesTab = () => page.locator('.sidebar-tab', { hasText: 'Meldungen' });

/** Zeile (1-basiert) des Cursors im aktiven Editor */
async function cursorLine(): Promise<number> {
    return page.evaluate(() => {
        const api = (globalThis as unknown as StubWindow).__editorTestApi!;
        return api.text().slice(0, api.selection().head).split('\n').length;
    });
}

const activePath = (): Promise<string | null> => page.evaluate(() => (globalThis as unknown as StubWindow).__editorTestApi!.activePath());

async function openVirtualFile(path: string, text: string): Promise<void> {
    await page.evaluate(([target, content]) => {
        const api = (globalThis as unknown as StubWindow).__editorTestApi!;
        api.open(target, content);
        api.activate(target);
    }, [path, text] as const);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-e2e-'));
    const env = { ...process.env, [STUB_PRELOAD_ENV]: '1' } as Record<string, string>;
    delete env[DEV_SERVER_ENV];
    app = await electron.launch({ args: [WEB_DIR, `--user-data-dir=${userDataDir}`], env });
    page = await app.firstWindow();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.waitForSelector('.editor-host .cm-editor');
    const hasApi = await page.evaluate(() => (globalThis as unknown as StubWindow).__editorTestApi !== undefined);
    if (!hasApi) throw new Error(MISSING_TEST_API);
    await page.evaluate(([texFile, texText, bibFile, bibText]) => {
        const stub = (globalThis as unknown as StubWindow).api.__stub;
        stub.installSampleProject();
        stub.addProjectFile(texFile, texText);
        stub.addProjectFile(bibFile, bibText);
    }, [TEX_FILE, TEX_TEXT, BIB_FILE, BIB_TEXT] as const);
    await page.getByRole('button', { name: 'Projekt öffnen …', exact: true }).first().click();
    await expect(page.getByText('Hauptdatei: main.tex')).toBeVisible();
    await openVirtualFile(TEX_PATH, TEX_TEXT);
});

test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
});

test.afterEach(() => {
    expect(pageErrors).toEqual([]);
});

test('der undefinierte Verweis `fig:fehlt` ist rot gestrichelt unterstrichen, mit Meldung als Tooltip', async () => {
    await expect(marks()).toHaveCount(1, { timeout: INDEX_TIMEOUT_MS });
    await expect(marks()).toHaveText('fig:fehlt');
    await expect(marks()).toHaveAttribute('title', /fig:fehlt.*nicht definiert/);
    const style = await marks().evaluate((element) => {
        const computed = getComputedStyle(element);
        return { line: computed.textDecorationLine, style: computed.textDecorationStyle };
    });
    expect(style).toEqual({ line: 'underline', style: 'dashed' });
});

test('Kommentare, benutzte Labels und vorhandene Zitate sind nicht unterstrichen', async () => {
    await expect(marks()).toHaveCount(1);
    await expect(page.locator('.cm-content .cm-line', { hasText: 'kommentar:egal' }).locator('.cm-reference-error')).toHaveCount(0);
});

test('Hinweise: `sec:ungenutzt` und `ungenutzt2026` stehen mit Datei und Zeile unter „Hinweise“', async () => {
    await issuesTab().click();
    await expect(hintRow('sec:ungenutzt')).toBeVisible({ timeout: INDEX_TIMEOUT_MS });
    await expect(hintGroup('Ungenutzte Labels')).toContainText('sec:ungenutzt');
    await expect(hintRow('sec:ungenutzt')).toContainText(`${TEX_FILE}:1`);
    await expect(hintGroup('Nicht zitierte Quellen')).toContainText('ungenutzt2026');
    await expect(hintRow('ungenutzt2026')).toContainText('Nie zitiert');
    await expect(hintRow('sec:benutzt')).toHaveCount(0);
    await expect(hintRow('knuth1984')).toHaveCount(0);
});

test('Klick auf einen Hinweis springt zur Zeile der Quelle bzw. des Labels', async () => {
    await hintRow('ungenutzt2026').click();
    await expect.poll(activePath).toBe(BIB_PATH);
    await expect.poll(cursorLine).toBe(BIB_UNUSED_LINE);
    await openVirtualFile(TEX_PATH, TEX_TEXT);
    await hintRow('sec:ungenutzt').click();
    await expect.poll(activePath).toBe(TEX_PATH);
    await expect.poll(cursorLine).toBe(1);
});

test('der Filter „Hinweise“ blendet den Abschnitt aus und wieder ein', async () => {
    const filter = page.getByRole('button', { name: /^Hinweise \d+$/ });
    await expect(filter).toHaveAttribute('aria-pressed', 'true');
    await filter.click();
    await expect(hintSection()).toHaveCount(0);
    await filter.click();
    await expect(hintSection()).toBeVisible();
});

test('eine neue Definition im Text entfernt die Unterstreichung und den Hinweis zum Verweis; Rückgängig bringt sie zurück', async () => {
    await page.locator('.cm-content').focus();
    await page.evaluate(() => {
        const api = (globalThis as unknown as StubWindow).__editorTestApi!;
        api.select(api.text().length, api.text().length);
    });
    await page.keyboard.type('\\label{fig:fehlt}');
    await expect(marks()).toHaveCount(0, { timeout: INDEX_TIMEOUT_MS });
    await expect(hintRow('fig:fehlt')).toHaveCount(0);
    for (let step = 0; step < UNDO_STEPS; step++) await page.keyboard.press(`${MODIFIER}+z`);
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as StubWindow).__editorTestApi!.text())).toBe(TEX_TEXT);
    await expect(marks()).toHaveCount(1, { timeout: INDEX_TIMEOUT_MS });
});

test('ein Verweis, der erst beim Tippen entsteht, wird nach kurzer Pause unterstrichen (nicht pro Taste)', async () => {
    await page.evaluate(() => {
        const api = (globalThis as unknown as StubWindow).__editorTestApi!;
        api.select(api.text().length, api.text().length);
    });
    await page.keyboard.type('\\ref{noch:nie}');
    await expect(marks().filter({ hasText: 'noch:nie' })).toHaveCount(1, { timeout: INDEX_TIMEOUT_MS });
});
