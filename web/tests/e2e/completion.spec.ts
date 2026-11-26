import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// W4-6: Vervollständigung im echten Editor mit dem Stub-Preload (Swift-Vorlage: `CompletionEditorTests`). Das
// Beispielprojekt (`installSampleProject`) bekommt eine Datei mit Labels und eine `.bib`-Datei; der Index liest sie
// über `fs:readMany` im Worker. Echte Tastatureingaben über `page.keyboard`.
// Voraussetzung: Build mit Testzugang (`npm run build:e2e`).

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const MISSING_TEST_API = 'window.__editorTestApi fehlt: vorher npm run build:e2e';
const ROOT = '/stub/projekt';
const MODIFIER = 'ControlOrMeta';
const TRIGGER_KEY = 'Control+Space';
const LABEL_FILE = 'kapitel/verweise.tex';
const LABEL_TEXT = '\\section{Verweise}\n\\label{fig:ablauf}\n\\label{tab:werte}\n';
const BIB_FILE = 'quellen.bib';
const BIB_TEXT = '@book{knuth1984,\n  author = {Donald E. Knuth},\n  title = {The TeXbook},\n  year = 1984\n}\n';
/** Länger als die Sperre gegen versehentliches Übernehmen (`ACCEPT_GUARD_MS` in `editor/completion.ts`) */
const ACCEPT_WAIT_MS = 150;
/** So lange müsste ein automatisches Popup spätestens erscheinen (Verzögerung 50 ms plus Rahmen) */
const NO_POPUP_WAIT_MS = 400;
const INDEX_TIMEOUT_MS = 5_000;
const RETRY_VISIBLE_MS = 500;

interface EditorTestApi {
    open(path: string, text: string): void;
    activate(path: string): void;
    text(): string;
    select(anchor: number, head: number): void;
}

interface StubWindow {
    __editorTestApi?: EditorTestApi;
    api: {
        __stub: {
            installSampleProject(extraFileCount?: number): void;
            addProjectFile(relativePath: string, text: string): void;
            emit(event: string, payload: unknown): void;
        };
    };
}

let app: ElectronApplication;
let userDataDir: string;
let page: Page;
let fileCounter = 0;
const pageErrors: string[] = [];

const popup = (): ReturnType<Page['locator']> => page.locator('.cm-tooltip-autocomplete');
/** Erster Eintrag, der `label` enthält (`\section` passt auch auf `\section*`) */
const option = (label: string) => popup().locator('li[role="option"]', { hasText: label }).first();

async function editorText(): Promise<string> {
    return page.evaluate(() => (globalThis as unknown as StubWindow).__editorTestApi?.text() ?? '');
}

/** Frische Datei im Projekt mit `text`, Cursor am Ende, Editor fokussiert */
async function openFile(text = ''): Promise<void> {
    const path = `${ROOT}/kapitel/vervollstaendigen-${fileCounter++}.tex`;
    await page.evaluate(([target, content]) => {
        const api = (globalThis as unknown as StubWindow).__editorTestApi!;
        api.open(target, content);
        api.activate(target);
        api.select(content.length, content.length);
    }, [path, text] as const);
    await page.locator('.cm-content').focus();
}

/** Der Index kommt aus dem Worker; bis er da ist, öffnet Strg+Leertaste die Liste erneut */
async function expectListWith(label: string): Promise<void> {
    await expect(async () => {
        if (!(await option(label).isVisible())) await page.keyboard.press(TRIGGER_KEY);
        await expect(option(label)).toBeVisible({ timeout: RETRY_VISIBLE_MS });
    }).toPass({ timeout: INDEX_TIMEOUT_MS });
}

async function accept(key = 'Enter'): Promise<void> {
    await page.waitForTimeout(ACCEPT_WAIT_MS);
    await page.keyboard.press(key);
}

function sendCommand(commandId: string): Promise<void> {
    return page.evaluate((id) => (globalThis as unknown as StubWindow).api.__stub.emit('menu:command', { commandId: id }), commandId);
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
    await page.evaluate(([labelFile, labelText, bibFile, bibText]) => {
        const stub = (globalThis as unknown as StubWindow).api.__stub;
        stub.installSampleProject();
        stub.addProjectFile(labelFile, labelText);
        stub.addProjectFile(bibFile, bibText);
    }, [LABEL_FILE, LABEL_TEXT, BIB_FILE, BIB_TEXT] as const);
    await page.getByRole('button', { name: 'Projekt öffnen …', exact: true }).first().click();
    await expect(page.getByText('Hauptdatei: main.tex')).toBeVisible();
});

test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
});

test.afterEach(() => {
    expect(pageErrors).toEqual([]);
});

test('`\\te` zeigt `\\textbf`; Enter fügt den Befehl mit Gerüst ein, Cursor in der Klammer', async () => {
    await openFile();
    await page.keyboard.type('\\te');
    await expect(option('\\textbf')).toBeVisible();
    await expect(popup().getByRole('listbox')).toBeVisible();
    await page.keyboard.type('xtbf');
    await expect(popup().locator('li[role="option"]').first()).toContainText('\\textbf');
    await accept();
    expect(await editorText()).toBe('\\textbf{}');
    await expect(popup()).toHaveCount(0);
    await page.keyboard.type('fett');
    expect(await editorText()).toBe('\\textbf{fett}');
});

test('`\\ref{` listet die Labels des Projekts; Weitertippen filtert, Enter übernimmt als ein Undo-Schritt', async () => {
    await openFile('Siehe ');
    await page.keyboard.type('\\ref{');
    await expectListWith('fig:ablauf');
    await expect(option('tab:werte')).toBeVisible();
    await expect(option('fig:ablauf')).toContainText('verweise.tex:2');
    await page.keyboard.type('abl');
    await expect(popup().locator('li[role="option"]')).toHaveCount(1);
    await accept();
    expect(await editorText()).toBe('Siehe \\ref{fig:ablauf}');
    await page.keyboard.press(`${MODIFIER}+z`);
    expect(await editorText()).toBe('Siehe \\ref{abl}');
});

test('`\\cite{` listet die Zitierschlüssel mit Autor, Jahr und Titel', async () => {
    await openFile();
    await page.keyboard.type('\\cite{');
    await expectListWith('knuth1984');
    await expect(option('knuth1984')).toContainText('Knuth 1984 · The TeXbook');
    await page.keyboard.type('knu');
    await expect(popup().locator('li[role="option"]')).toHaveCount(1);
    await accept('Tab');
    expect(await editorText()).toBe('\\cite{knuth1984}');
});

test('`\\begin{itemize` + Übernahme erzeugt `\\end{itemize}`; `\\beg` + Tab öffnet gleich die Umgebungen', async () => {
    await openFile();
    await page.keyboard.type('\\begin{itemize');
    await expect(option('itemize')).toBeVisible();
    await accept();
    expect(await editorText()).toBe('\\begin{itemize}\n\t\\item \n\\end{itemize}');

    await openFile();
    await page.keyboard.type('\\beg');
    await expect(option('\\begin')).toBeVisible();
    await accept('Tab');
    expect(await editorText()).toBe('\\begin{}');
    await expect(option('enumerate')).toBeVisible();
    await page.keyboard.type('enum');
    await accept();
    expect(await editorText()).toBe('\\begin{enumerate}\n\t\\item \n\\end{enumerate}');
});

test('Pfeile wählen, Esc schließt ohne Änderung', async () => {
    await openFile();
    await page.keyboard.type('\\sec');
    await expect(option('\\section')).toBeVisible();
    const options = popup().locator('li[role="option"]');
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    // CodeMirror ignoriert Tasten kurz nach dem Erscheinen der Liste (`interactionDelay`)
    await page.waitForTimeout(ACCEPT_WAIT_MS);
    await page.keyboard.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowUp');
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(popup()).toHaveCount(0);
    expect(await editorText()).toBe('\\sec');
});

test('in einer Kommentarzeile und in Verbatim erscheint kein Popup, auch nicht mit Strg+Leertaste', async () => {
    await openFile('% Kommentar ');
    await page.keyboard.type('\\ref{');
    await page.waitForTimeout(NO_POPUP_WAIT_MS);
    await page.keyboard.press(TRIGGER_KEY);
    await page.waitForTimeout(NO_POPUP_WAIT_MS);
    await expect(popup()).toHaveCount(0);

    await openFile('\\begin{verbatim}\n');
    await page.keyboard.type('\\te');
    await page.waitForTimeout(NO_POPUP_WAIT_MS);
    await expect(popup()).toHaveCount(0);
});

test('Schalter aus: kein automatisches Popup, Strg+Leertaste öffnet die Liste trotzdem', async () => {
    await sendCommand('edit.toggleAutoComplete');
    await expect(page.getByText('Automatische Vervollständigung aus', { exact: false })).toBeVisible();
    try {
        await openFile();
        await page.keyboard.type('\\te');
        await page.waitForTimeout(NO_POPUP_WAIT_MS);
        await expect(popup()).toHaveCount(0);
        await page.keyboard.press(TRIGGER_KEY);
        await expect(option('\\textbf')).toBeVisible();
        await page.keyboard.press('Escape');
    } finally {
        await sendCommand('edit.toggleAutoComplete');
    }
    await expect(page.getByText('Automatische Vervollständigung ein.')).toBeVisible();
});
