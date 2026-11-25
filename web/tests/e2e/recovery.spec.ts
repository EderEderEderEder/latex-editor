import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// W2-14: Sicherung und Wiederherstellung ungespeicherten Texts. Mit dem Stub-Preload: Er hält die Sicherungen im
// `localStorage` des Fensters, daher findet ein zweiter Start mit demselben `--user-data-dir` sie wieder.
// „Absturz“ heißt hier: Fenster mit ungespeichertem Text schließen (der Stub-Preload fragt nicht nach); wie nach einem
// echten Absturz bleibt die Sicherung liegen, weil Beenden nichts löscht (Plan K1).

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
const MODIFIER = 'ControlOrMeta';
const FILE_NAME = 'brief.tex';
const FILE_TEXT = 'Hallo\n';
const TYPED = 'X';
const DIALOG = '.recovery-confirm';
const BACKUP_WAIT_MS = 15_000;
const TEST_TIMEOUT_MS = 90_000;

interface StubCall {
    channel: string;
    args: unknown[];
}

type DiskState = 'unchanged' | 'changed' | 'missing';

interface StubWindow {
    api: {
        __stub: {
            calls(): StubCall[];
            prepareFile(name: string, text: string): void;
            setRecoveryDiskState(state: DiskState): void;
            recoveryBackups(): { path: string; text: string }[];
        };
    };
}

interface Session {
    app: ElectronApplication;
    page: Page;
}

async function launch(userDataDir: string): Promise<Session> {
    const env = { ...process.env, [STUB_PRELOAD_ENV]: '1' } as Record<string, string>;
    delete env[DEV_SERVER_ENV];
    const app = await electron.launch({ args: [WEB_DIR, `--user-data-dir=${userDataDir}`], env });
    const page = await app.firstWindow();
    await page.waitForSelector('.editor-host .cm-editor');
    return { app, page };
}

const prepareFile = (page: Page): Promise<void> =>
    page.evaluate(
        ([name, text]) => (globalThis as unknown as StubWindow).api.__stub.prepareFile(name!, text!),
        [FILE_NAME, FILE_TEXT],
    );

const backups = (page: Page) => page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.recoveryBackups());

const calls = async (page: Page, channel: string): Promise<StubCall[]> =>
    (await page.evaluate(() => (globalThis as unknown as StubWindow).api.__stub.calls())).filter((call) => call.channel === channel);

/** Erster Lauf: Datei öffnen, tippen, auf die Sicherung warten, Fenster ohne Speichern schließen */
async function crashWithUnsavedText(userDataDir: string, diskState: DiskState = 'unchanged'): Promise<void> {
    const { app, page } = await launch(userDataDir);
    await prepareFile(page);
    await page.keyboard.press(`${MODIFIER}+o`);
    await expect(page.getByRole('tab', { name: FILE_NAME })).toBeVisible();
    await page.locator('.cm-content').focus();
    await page.keyboard.type(TYPED);
    await expect(page.locator('.tab-dirty')).toHaveCount(1);
    await expect.poll(async () => (await backups(page)).map((backup) => backup.text), { timeout: BACKUP_WAIT_MS })
        .toEqual([`${TYPED}${FILE_TEXT}`]);
    await page.evaluate((state) => (globalThis as unknown as StubWindow).api.__stub.setRecoveryDiskState(state), diskState);
    await app.close();
}

test.describe('Wiederherstellung nach Absturz (Stub-Preload)', () => {
    test.describe.configure({ mode: 'serial' });
    test.setTimeout(TEST_TIMEOUT_MS);
    let userDataDir: string;
    let session: Session | null = null;

    test.beforeEach(() => {
        userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-e2e-recovery-'));
    });

    test.afterEach(async () => {
        await session?.app.close().catch(() => undefined);
        session = null;
        rmSync(userDataDir, { recursive: true, force: true });
    });

    test('nach dem Neustart erscheint die Nachfrage; Wiederherstellen bringt den Text zurück, ungespeichert', async () => {
        await crashWithUnsavedText(userDataDir);
        session = await launch(userDataDir);
        const { page } = session;
        await prepareFile(page);
        const dialog = page.locator(DIALOG);
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('Ungespeicherte Änderungen wiederherstellen?');
        await expect(dialog).toContainText(FILE_NAME);
        await expect(dialog).not.toContainText('seitdem geändert');
        await dialog.getByRole('button', { name: 'Wiederherstellen' }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByRole('tab', { name: FILE_NAME })).toBeVisible();
        await expect(page.locator('.tab-dirty')).toHaveCount(1);
        await expect(page.locator('.cm-content')).toContainText(`${TYPED}Hallo`);
        expect(await calls(page, 'fs:writeText')).toHaveLength(0);
    });

    test('Speichern nach dem Wiederherstellen löscht die Sicherung', async () => {
        await crashWithUnsavedText(userDataDir);
        session = await launch(userDataDir);
        const { page } = session;
        await prepareFile(page);
        await page.locator(DIALOG).getByRole('button', { name: 'Wiederherstellen' }).click();
        await expect(page.locator('.tab-dirty')).toHaveCount(1);
        await page.keyboard.press(`${MODIFIER}+s`);
        await expect(page.locator('.tab-dirty')).toHaveCount(0);
        expect((await calls(page, 'fs:writeText')).map((call) => call.args[1])).toEqual([`${TYPED}${FILE_TEXT}`]);
        await expect.poll(() => backups(page), { timeout: BACKUP_WAIT_MS }).toEqual([]);
    });

    test('Verwerfen löscht die Sicherung und öffnet nichts', async () => {
        await crashWithUnsavedText(userDataDir);
        session = await launch(userDataDir);
        const { page } = session;
        await page.locator(DIALOG).getByRole('button', { name: 'Verwerfen' }).click();
        await expect(page.locator(DIALOG)).toHaveCount(0);
        await expect(page.getByRole('tab')).toHaveCount(0);
        expect(await backups(page)).toEqual([]);
    });

    test('Escape entscheidet nichts: die Sicherung bleibt erhalten', async () => {
        await crashWithUnsavedText(userDataDir);
        session = await launch(userDataDir);
        const { page } = session;
        await expect(page.locator(DIALOG)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator(DIALOG)).toHaveCount(0);
        expect((await backups(page)).map((backup) => backup.text)).toEqual([`${TYPED}${FILE_TEXT}`]);
    });

    test('hat sich die Plattendatei seit dem Sichern geändert, weist der Dialog darauf hin', async () => {
        await crashWithUnsavedText(userDataDir, 'changed');
        session = await launch(userDataDir);
        const dialog = session.page.locator(DIALOG);
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('seitdem geändert');
        await expect(dialog).toContainText('überschreibt');
    });

    test('ohne ungespeicherten Text gibt es nach dem Neustart keine Nachfrage', async () => {
        const first = await launch(userDataDir);
        await first.app.close();
        session = await launch(userDataDir);
        await expect(session.page.locator('.editor-host .cm-editor')).toBeVisible();
        await expect(session.page.locator(DIALOG)).toHaveCount(0);
    });
});
