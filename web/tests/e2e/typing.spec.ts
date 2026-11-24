import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Tippen im echten Editor (W1-10b): echte Tastatureingaben über `page.keyboard`.
// Voraussetzung: Build mit Testzugang (`npm run build:e2e`, siehe `session.spec.ts`).

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const MISSING_TEST_API = 'window.__editorTestApi fehlt: vorher npm run build:e2e';
const MODIFIER = 'ControlOrMeta';

let app: ElectronApplication;
let userDataDir: string;
let page: Page;
let fileCounter = 0;
const pageErrors: string[] = [];

// Gleiche Form wie `EditorTestApi` in `src/renderer/editor/EditorHost.tsx`.
interface EditorTestApi {
    open(path: string, text: string): void;
    activate(path: string): void;
    text(): string;
    selection(): { anchor: number; head: number };
    select(anchor: number, head: number): void;
}

type TestWindow = { __editorTestApi?: EditorTestApi };

/** Öffnet eine frische Datei mit `text`, setzt die Auswahl (Standard: Textende) und fokussiert den Editor */
async function openFile(text: string, anchor = text.length, head = anchor): Promise<void> {
    const path = `/stub/projekt/tippen-${fileCounter++}.tex`;
    await page.evaluate(([target, content]) => {
        const api = (globalThis as unknown as TestWindow).__editorTestApi!;
        api.open(target, content);
        api.activate(target);
    }, [path, text] as const);
    await page.evaluate((range) => (globalThis as unknown as TestWindow).__editorTestApi?.select(range.anchor, range.head), {
        anchor,
        head,
    });
}

async function editorText(): Promise<string> {
    return page.evaluate(() => (globalThis as unknown as TestWindow).__editorTestApi?.text() ?? '');
}

async function editorSelection(): Promise<{ anchor: number; head: number } | undefined> {
    return page.evaluate(() => (globalThis as unknown as TestWindow).__editorTestApi?.selection());
}

test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-e2e-'));
    const env = { ...process.env, [STUB_PRELOAD_ENV]: '1' } as Record<string, string>;
    delete env[DEV_SERVER_ENV];
    app = await electron.launch({ args: [WEB_DIR, `--user-data-dir=${userDataDir}`], env });
    page = await app.firstWindow();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.waitForSelector('.editor-host .cm-editor');
    const hasApi = await page.evaluate(() => (globalThis as unknown as TestWindow).__editorTestApi !== undefined);
    if (!hasApi) throw new Error(MISSING_TEST_API);
});

test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
});

test.afterEach(() => {
    expect(pageErrors).toEqual([]);
});

test('Klammern: schließen, überspringen, paarweise löschen, ein Undo-Schritt', async () => {
    await openFile('');
    await page.keyboard.type('\\emph{');
    expect(await editorText()).toBe('\\emph{}');
    await page.keyboard.type('x}');
    expect(await editorText()).toBe('\\emph{x}');
    await page.keyboard.type(' \\ref{');
    expect(await editorText()).toBe('\\emph{x} \\ref{}');
    await page.keyboard.press('Backspace');
    expect(await editorText()).toBe('\\emph{x} \\ref');
    await page.keyboard.press(`${MODIFIER}+z`);
    expect(await editorText()).toBe('\\emph{x} \\ref{}');
});

test('Klammer mit Auswahl umschließt, AltGr-Zeichen und normale Zeichen bleiben unberührt', async () => {
    await openFile('ein Wort hier', 4, 8);
    await page.keyboard.type('(');
    expect(await editorText()).toBe('ein (Wort) hier');
    expect(await editorSelection()).toEqual({ anchor: 5, head: 9 });
    await page.keyboard.type('x');
    expect(await editorText()).toBe('ein (x) hier');
});

test('Enter ergänzt \\end und \\item; ein Undo nimmt den ganzen Enter zurück', async () => {
    await openFile('\\begin{itemize}');
    await page.keyboard.press('Enter');
    expect(await editorText()).toBe('\\begin{itemize}\n\t\\item \n\\end{itemize}');
    await page.keyboard.type('Eins');
    await page.keyboard.press('Enter');
    expect(await editorText()).toBe('\\begin{itemize}\n\t\\item Eins\n\t\\item \n\\end{itemize}');
    await page.keyboard.press('Enter');
    expect(await editorText()).toBe('\\begin{itemize}\n\t\\item Eins\n\t\n\\end{itemize}');
    await page.keyboard.press(`${MODIFIER}+z`);
    expect(await editorText()).toBe('\\begin{itemize}\n\t\\item Eins\n\t\\item \n\\end{itemize}');
});

test('Tab fügt einen Tabulator ein, mit Auswahl rückt er Zeilen ein, Shift+Tab rückt aus', async () => {
    await openFile('a\nb', 0, 3);
    await page.keyboard.press('Tab');
    expect(await editorText()).toBe('\ta\n\tb');
    await page.keyboard.press('Shift+Tab');
    expect(await editorText()).toBe('a\nb');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Tab');
    expect(await editorText()).toBe('a\nb\t');
});

test('Kommentar umschalten mit Strg+/', async () => {
    await openFile('erste\nzweite', 0, 12);
    await page.keyboard.press(`${MODIFIER}+/`);
    expect(await editorText()).toBe('% erste\n% zweite');
    await page.keyboard.press(`${MODIFIER}+/`);
    expect(await editorText()).toBe('erste\nzweite');
    await page.keyboard.press(`${MODIFIER}+z`);
    expect(await editorText()).toBe('% erste\n% zweite');
});

test('Zeilen verschieben, doppeln und löschen', async () => {
    await openFile('eins\nzwei\ndrei', 5, 5);
    await page.keyboard.press('Alt+ArrowUp');
    expect(await editorText()).toBe('zwei\neins\ndrei');
    await page.keyboard.press('Alt+ArrowDown');
    expect(await editorText()).toBe('eins\nzwei\ndrei');
    await page.keyboard.press('Shift+Alt+ArrowDown');
    expect(await editorText()).toBe('eins\nzwei\nzwei\ndrei');
    await page.keyboard.press(`${MODIFIER}+Shift+k`);
    expect(await editorText()).toBe('eins\nzwei\ndrei');
});

test('Fett, Kursiv und Schreibmaschine; Strg+B bleibt frei', async () => {
    await openFile('Wort', 0, 4);
    await page.keyboard.press(`${MODIFIER}+Shift+b`);
    expect(await editorText()).toBe('\\textbf{Wort}');
    await page.keyboard.press(`${MODIFIER}+Shift+b`);
    expect(await editorText()).toBe('Wort');
    await page.keyboard.press(`${MODIFIER}+i`);
    expect(await editorText()).toBe('\\emph{Wort}');
    await page.keyboard.press(`${MODIFIER}+z`);
    await page.keyboard.press(`${MODIFIER}+Shift+m`);
    expect(await editorText()).toBe('\\texttt{Wort}');
    await page.keyboard.press(`${MODIFIER}+b`);
    expect(await editorText()).toBe('\\texttt{Wort}');
});

test('Einfügen aus der Zwischenablage greift nicht ein', async () => {
    await openFile('');
    await app.evaluate(({ clipboard }) => clipboard.writeText('{'));
    await page.keyboard.press(`${MODIFIER}+v`);
    expect(await editorText()).toBe('{');
});

test('IME-Komposition (CDP): kein Eingriff, Ergebnis unverändert', async () => {
    await openFile('');
    const session = await app.context().newCDPSession(page);
    await session.send('Input.imeSetComposition', { text: '{', selectionStart: 1, selectionEnd: 1 });
    // Während der Komposition: keine schließende Klammer
    await expect.poll(editorText).toBe('{');
    // `insertText` bestätigt die Komposition; das Ergebnis bleibt unverändert
    await session.send('Input.insertText', { text: '{' });
    await expect.poll(editorText).toBe('{');
    // Danach ist die Komposition vorbei: Enter wirkt wieder normal (ein echtes IME schluckt das bestätigende
    // Enter selbst, das lässt sich per CDP nicht nachstellen)
    await page.keyboard.press('Enter');
    expect(await editorText()).toBe('{\n');
    await session.detach();
});
