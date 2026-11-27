import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// W4-10: Einfügen-Fenster im echten Renderer mit dem Stub-Preload. Das Beispielprojekt bekommt Labels, ein Bild und
// eine `.bib`; `image:import` und `bib:append` des Stubs sind feste Antworten, geprüft werden ihre Aufrufe.
// Der Befehl kommt wie aus dem Menü (`menu:command`); die Menü-Kürzel selbst erreicht Playwright nicht (Handtest).
// Voraussetzung: Build mit Testzugang (`npm run build:e2e`).

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const MISSING_TEST_API = 'window.__editorTestApi fehlt: vorher npm run build:e2e';
const ROOT = '/stub/projekt';
const MODIFIER = 'ControlOrMeta';
const LABEL_FILE = 'kapitel/verweise.tex';
const LABEL_TEXT = '\\section{Verweise}\n\\label{fig:ablauf}\n\\label{tab:messwerte}\n';
const IMAGE_FILE = 'bilder/logo.png';
const OPEN_TIMEOUT_MS = 10_000;
/** Schon vergebene Labels stehen im Dokument selbst (der Projektindex im Worker kommt ohne Gewähr rechtzeitig) */
const TABLE_LABELS = '\\label{tab:messwerte}\n\\label{tab:messwerte-2}\n';
const NEEDS_TEX_TEXT = 'Zum Einfügen muss eine .tex-Datei geöffnet sein.';

interface EditorTestApi {
    open(path: string, text: string): void;
    activate(path: string): void;
    text(): string;
    select(anchor: number, head: number): void;
}

interface StubCall {
    readonly channel: string;
    readonly args: readonly unknown[];
}

interface StubWindow {
    __editorTestApi?: EditorTestApi;
    api: {
        __stub: {
            installSampleProject(extraFileCount?: number): void;
            addProjectFile(relativePath: string, text: string): void;
            prepareFile(name: string, text: string): void;
            emit(event: string, payload: unknown): void;
            calls(): StubCall[];
            clearCalls(): void;
        };
    };
}

let app: ElectronApplication;
let userDataDir: string;
let page: Page;
let fileCounter = 0;
const pageErrors: string[] = [];

const dialog = (): Locator => page.getByRole('dialog', { name: 'Einfügen' });
const insertButton = (): Locator => dialog().getByRole('button', { name: /^(Einfügen|Quelle anlegen)$/ });
const newRows = (): Locator => dialog().locator('.insert-preview-row.is-new');
const editorText = (): Promise<string> => page.evaluate(() => (globalThis as unknown as StubWindow).__editorTestApi?.text() ?? '');
const stubCalls = (channel: string): Promise<StubCall[]> =>
    page.evaluate((wanted) => (globalThis as unknown as StubWindow).api.__stub.calls().filter((call) => call.channel === wanted), channel);

/** Frische `.tex`-Datei im Projekt mit `text`, Cursor an `cursor` (Standard: Ende), Editor fokussiert */
async function openFile(text: string, cursor = text.length): Promise<void> {
    const path = `${ROOT}/kapitel/einfuegen-${fileCounter++}.tex`;
    await page.evaluate(([target, content, position]) => {
        const api = (globalThis as unknown as StubWindow).__editorTestApi!;
        api.open(target as string, content as string);
        api.activate(target as string);
        api.select(position as number, position as number);
    }, [path, text, cursor] as const);
    await page.locator('.cm-content').focus();
}

function sendCommand(commandId: string): Promise<void> {
    return page.evaluate((id) => (globalThis as unknown as StubWindow).api.__stub.emit('menu:command', { commandId: id }), commandId);
}

async function openDialog(commandId: string): Promise<void> {
    await sendCommand(commandId);
    await expect(dialog()).toBeVisible();
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
    await page.evaluate(([labelFile, labelText]) => {
        const stub = (globalThis as unknown as StubWindow).api.__stub;
        stub.installSampleProject();
        stub.addProjectFile(labelFile as string, labelText as string);
    }, [LABEL_FILE, LABEL_TEXT] as const);
    await page.getByRole('button', { name: 'Projekt öffnen …', exact: true }).first().click();
    await expect(page.getByText('Hauptdatei: main.tex')).toBeVisible({ timeout: OPEN_TIMEOUT_MS });
});

test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
});

test.afterEach(() => {
    expect(pageErrors).toEqual([]);
});

test('ohne geöffnete .tex-Datei: Fenster öffnet, Blocker steht in der Fußzeile, Einfügen gesperrt, Esc schließt', async () => {
    await page.getByRole('button', { name: 'Einfügen …' }).click();
    await expect(dialog()).toBeVisible();
    await expect(dialog().getByRole('status')).toHaveText(NEEDS_TEX_TEXT);
    await expect(insertButton()).toBeDisabled();
    await expect(dialog().getByRole('option', { name: 'Tabelle', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog()).toBeHidden();
});

test('Gleichung: Vorschau zeigt die neuen Zeilen, Einfügen setzt sie, ein Undo nimmt alles zurück', async () => {
    await openFile('Anfang\nEnde\n', 'Anfang\n'.length);
    await openDialog('insert.equation');
    await expect(dialog().getByRole('option', { name: 'Gleichung', exact: true })).toHaveAttribute('aria-selected', 'true');
    await dialog().getByLabel('Formel', { exact: true }).fill('E = mc^2');
    await expect(newRows()).toHaveCount(3);
    await expect(newRows().nth(1)).toContainText('E = mc^2');
    await expect(dialog().locator('.insert-preview-row').first()).toContainText('Anfang');
    await expect(dialog().getByRole('status')).toContainText(/Einfügen in einfuegen-\d+\.tex, Zeile 2/);
    await insertButton().click();
    await expect(dialog()).toBeHidden();
    const expected = 'Anfang\n\\begin{equation}\n\tE = mc^2\n\\end{equation}\nEnde\n';
    await expect.poll(editorText).toBe(expected);
    await expect(page.locator('.cm-content')).toBeFocused();
    await page.keyboard.press(`${MODIFIER}+z`);
    await expect.poll(editorText).toBe('Anfang\nEnde\n');
});

test('markierter Text wird Inhalt der Gleichung und dabei ersetzt', async () => {
    await openFile('a FORMEL b');
    await page.evaluate(() => (globalThis as unknown as StubWindow).__editorTestApi!.select(2, 8));
    await openDialog('insert.equation');
    await expect(dialog().getByLabel('Formel', { exact: true })).toHaveValue('FORMEL');
    await insertButton().click();
    await expect.poll(editorText).toBe('a \n\\begin{equation}\n\tFORMEL\n\\end{equation}\n b');
    // Nach dem Einfügen gehört der Fokus dem Editor, sonst wirkt Strg+Z nicht
    await expect(dialog()).toBeHidden();
    await expect(page.locator('.cm-content')).toBeFocused();
    await page.keyboard.press(`${MODIFIER}+z`);
    await expect.poll(editorText).toBe('a FORMEL b');
});

test('Tabellenraster: Größe, Zellen, Ausrichtung, Excel-Text, Label ist eindeutig; ein Undo', async () => {
    await openFile(TABLE_LABELS, 0);
    await openDialog('insert.table');
    await dialog().getByLabel('Zeilen', { exact: true }).fill('2');
    await dialog().getByLabel('Spalten', { exact: true }).fill('2');
    await dialog().getByLabel('Zeile 1, Spalte 1', { exact: true }).fill('Name');
    await dialog().getByLabel('Zeile 2, Spalte 2', { exact: true }).fill('5 %');
    await dialog().getByLabel('Ausrichtung Spalte 2', { exact: true }).selectOption('right');
    await dialog().getByLabel('Text', { exact: true }).fill('Messwerte');
    await expect(dialog().locator('.insert-preview-lines')).toContainText('\\label{tab:messwerte-3}');
    await expect(dialog().locator('.insert-preview-lines')).toContainText('5 \\%');

    await dialog().getByLabel('Zellen aus Excel oder Numbers einfügen').fill('A\tB\tC\n1\t2\t3');
    await expect(dialog().getByLabel('Spalten', { exact: true })).toHaveValue('3');
    await expect(dialog().getByLabel('Zeile 2, Spalte 3', { exact: true })).toHaveValue('3');
    await insertButton().click();
    await expect(dialog()).toBeHidden();
    const text = await editorText();
    expect(text).toContain('\\begin{tabular}{@{}lrl@{}}');
    expect(text).toContain('A & B & C \\\\');
    expect(text).toContain('\\caption{Messwerte}\n\t\\label{tab:messwerte-3}');
    await page.keyboard.press(`${MODIFIER}+z`);
    await expect.poll(editorText).toBe(TABLE_LABELS);
});

test('Esc bricht ab: nichts wird eingefügt, der Editor bekommt den Fokus zurück', async () => {
    await openFile('unverändert');
    await openDialog('insert.list');
    await dialog().getByLabel('1.', { exact: true }).fill('Punkt');
    await page.keyboard.press('Escape');
    await expect(dialog()).toBeHidden();
    await expect.poll(editorText).toBe('unverändert');
    await expect(page.locator('.cm-content')).toBeFocused();
});

test('Pfeiltasten wechseln den Baustein in der Liste', async () => {
    await openFile('x');
    await openDialog('insert.table');
    await dialog().getByRole('option', { name: 'Tabelle', exact: true }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(dialog().getByRole('option', { name: 'Bild', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(dialog().getByRole('option', { name: 'Bild', exact: true })).toBeFocused();
    await page.keyboard.press('End');
    await expect(dialog().getByRole('option', { name: 'Quelle', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog()).toBeHidden();
});

test('Querverweis nennt die Labels des Projekts, Einfügen im Fließtext', async () => {
    await openFile('Siehe  .\n\\label{fig:ablauf}\n', 'Siehe '.length);
    await openDialog('insert.reference');
    await expect(dialog().getByLabel('Label', { exact: true })).toContainText('fig:ablauf');
    await dialog().getByLabel('Label', { exact: true }).selectOption('fig:ablauf');
    await expect(newRows()).toHaveCount(1);
    await insertButton().click();
    await expect.poll(editorText).toBe('Siehe Abbildung~\\ref{fig:ablauf} .\n\\label{fig:ablauf}\n');
});

test('Bild aus dem Projekt: keine Kopie, Pfad im Text', async () => {
    await openFile('');
    await openDialog('insert.image');
    await expect(insertButton()).toBeDisabled();
    await dialog().getByLabel('Aus dem Projekt', { exact: true }).selectOption({ label: IMAGE_FILE });
    await expect(dialog().locator('.insert-preview-lines')).toContainText(`{${IMAGE_FILE}}`);
    await insertButton().click();
    await expect.poll(editorText).toContain(`\\includegraphics[width=.75\\textwidth]{${IMAGE_FILE}}`);
    expect(await stubCalls('image:import')).toHaveLength(0);
});

test('Bild per Dateidialog: wird nach images/ kopiert (image:import), \\includegraphics folgt dem Ergebnis', async () => {
    await page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.prepareFile('foto.png', 'x'));
    await openFile('');
    await openDialog('insert.image');
    await dialog().getByRole('button', { name: 'Datei wählen …' }).click();
    await expect(dialog()).toContainText('Wird beim Einfügen nach „images/“ kopiert als „foto.png“.');
    await insertButton().click();
    await expect(dialog()).toBeHidden();
    await expect.poll(editorText).toContain('\\includegraphics[width=.75\\textwidth]{images/bild.png}');
    const [call] = await stubCalls('image:import');
    expect(call?.args[1]).toBe(`${ROOT}/images`);
});

test('Quelle: Formular, bib:append mit dem Eintrag, danach \\cite an der Cursorposition', async () => {
    await openFile('Beleg: ');
    await openDialog('insert.source');
    await expect(insertButton()).toBeDisabled();
    await expect(dialog().getByRole('status')).toContainText('Bitte noch ausfüllen');
    await dialog().getByLabel('Autor *', { exact: true }).fill('Max Mustermann');
    await dialog().getByLabel('Titel *', { exact: true }).fill('Ein Buch');
    await dialog().getByLabel('Verlag *', { exact: true }).fill('Verlag');
    await dialog().getByLabel('Jahr *', { exact: true }).fill('2024');
    await expect(dialog().getByRole('status')).toHaveText('Neuer Eintrag in literatur.bib, Zitat an der Cursorposition');
    await expect(dialog().locator('.insert-preview-lines')).toContainText('@book{Mustermann2024,');
    await insertButton().click();
    await expect(dialog()).toBeHidden();
    await expect.poll(editorText).toBe('Beleg: \\cite{Mustermann2024}');
    const [call] = await stubCalls('bib:append');
    expect(call?.args[0]).toBe(`${ROOT}/literatur.bib`);
    expect(String(call?.args[1])).toContain('@book{Mustermann2024,');
    await expect(page.getByText(/Quelle „Mustermann2024“ in literatur.bib angelegt/)).toBeVisible();
});
