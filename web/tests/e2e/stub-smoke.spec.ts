import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RendererApi } from '../../src/shared/contract';

// Startet die gebaute App (`npm run build`, `out/`) mit dem Stub-Preload (LATEXEDITOR_STUB_PRELOAD=1):
// `window.api` antwortet mit gefälschten Daten, der Main braucht keine Fachhandler.

const WEB_DIR = join(__dirname, '../..');
const STUB_PRELOAD_ENV = 'LATEXEDITOR_STUB_PRELOAD';
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';

let app: ElectronApplication;
let userDataDir: string;
let page: Page;

test.beforeAll(async () => {
    // Eigenes userData: sonst teilt sich die Test-App die Single-Instance-Sperre mit einer laufenden App.
    userDataDir = mkdtempSync(join(tmpdir(), 'latexeditor-e2e-'));
    const env = { ...process.env, [STUB_PRELOAD_ENV]: '1' } as Record<string, string>;
    delete env[DEV_SERVER_ENV];
    app = await electron.launch({ args: [WEB_DIR, `--user-data-dir=${userDataDir}`], env });
    page = await app.firstWindow();
    await page.waitForSelector('main h1');
});

test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
});

test('das Fenster zeigt die App', async () => {
    await expect(page.locator('main h1')).toHaveText('LatexEditor');
    await expect(page.locator('main p')).toHaveText('pong');
    expect(app.windows()).toHaveLength(1);
});

test('window.api kommt aus dem Stub', async () => {
    const result = await page.evaluate(async () => {
        const api = (globalThis as unknown as { api: RendererApi }).api;
        // Der echte Main hat für `tools:detect` noch keinen Handler („nicht implementiert“); nur der Stub antwortet mit ok.
        return { ping: await api.app.ping(), detect: await api.tools.detect() };
    });
    expect(result.ping).toEqual({ ok: true, value: 'pong' });
    expect(result.detect.ok).toBe(true);
});

test('der Renderer hat weder process noch require', async () => {
    const globals = await page.evaluate(() => ({
        process: typeof (globalThis as { process?: unknown }).process,
        require: typeof (globalThis as { require?: unknown }).require,
        module: typeof (globalThis as { module?: unknown }).module,
    }));
    expect(globals).toEqual({ process: 'undefined', require: 'undefined', module: 'undefined' });
});
