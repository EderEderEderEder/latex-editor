// Playwright-Treiber (Aufruf aus web/: node spikes/electron-check/run.mts [Läufe]). Startet die installierte
// Electron-Binärdatei je einmal für die strenge CSP-Seite und die Seite mit `latexeditor:` in connect-src.
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';
import { writeSyntheticPdf } from './genPdf.mts';

const DEFAULT_RUNS = 7;
const PDF_BYTES = 10 * 1024 * 1024;
const PDF_PAGES = 400;
const LAUNCH_TIMEOUT_MS = 60_000;
const MODIFIER_ALT = 1;
const MODIFIER_CTRL = 2;
const ALTGR_CHARS: ReadonlyArray<readonly [string, string, number]> = [
    ['{', 'Digit7', 55], ['[', 'Digit8', 56], [']', 'Digit9', 57], ['}', 'Digit0', 48],
    ['\\', 'Minus', 189], ['@', 'KeyQ', 81], ['~', 'BracketRight', 221], ['|', 'IntlBackslash', 226],
];
const PASTE_KEY = process.platform === 'darwin' ? 'Meta+V' : 'Control+V';
const EXCEL_TEXT = 'Name\tWert\tNotiz\nA\t1,5\tx y\nB\t2\t';
const EXCEL_HTML = '<table><tr><td>Name</td><td>Wert</td></tr><tr><td>A</td><td>1,5</td></tr></table>';

const spikeDirectory = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const electronPath = require('electron') as string;
const tmp = process.env.TMPDIR ?? '/tmp';
const pdfDirectory = join(tmp, 'electron-check', 'pdf');
const outsideDirectory = join(tmp, 'electron-check', 'outside');
const report: Record<string, unknown> = {};

type Evaluate = <T>(code: string) => Promise<T>;

async function altGr(page: Page, target: 'focusTextarea' | 'focusEditor', modifiers: number): Promise<string> {
    const cdp = await page.context().newCDPSession(page);
    await page.evaluate((name) => (window as any).checks[name](), target);
    for (const [char, code, vk] of ALTGR_CHARS) {
        const base = { key: char, code, windowsVirtualKeyCode: vk, modifiers };
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: char, unmodifiedText: char, ...base });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    }
    const read = target === 'focusTextarea' ? 'textareaValue' : 'editorValue';
    return page.evaluate((name) => (window as any).checks[name](), read);
}

async function altGrChecks(page: Page): Promise<Record<string, unknown>> {
    const expected = ALTGR_CHARS.map(([c]) => c).join('');
    const out: Record<string, unknown> = { expected };
    for (const [label, modifiers] of [['ctrl+alt (Windows-AltGr)', MODIFIER_CTRL | MODIFIER_ALT], ['alt (Mac-Option)', MODIFIER_ALT]] as const) {
        for (const target of ['focusTextarea', 'focusEditor'] as const) {
            await page.evaluate(() => (window as any).checks.reset());
            out[`${label} ${target}`] = await altGr(page, target, modifiers);
        }
    }
    out.keyRecordsSample = await page.evaluate(() => {
        const r = (window as any).checks.keyRecords();
        return { textarea: r.textarea.slice(-2), codemirror: r.codemirror.slice(-2) };
    });
    return out;
}

async function imeChecks(page: Page): Promise<Record<string, unknown>> {
    const cdp = await page.context().newCDPSession(page);
    const out: Record<string, unknown> = {};
    for (const target of ['focusIme', 'focusImeEditor'] as const) {
        await page.evaluate(() => (window as any).checks.reset());
        await page.evaluate((name) => (window as any).checks[name](), target);
        await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 });
        await cdp.send('Input.imeSetComposition', { text: 'にほん', selectionStart: 3, selectionEnd: 3 });
        await cdp.send('Input.insertText', { text: '日本' });
        const value = await page.evaluate((name) => (window as any).checks[name === 'focusIme' ? 'imeValue' : 'editorValue'](), target);
        out[target] = { value };
    }
    out.compositionRecords = await page.evaluate(() => (window as any).checks.compositionRecords());
    return out;
}

async function pasteCheck(app: ElectronApplication, page: Page): Promise<Record<string, unknown>> {
    await page.evaluate(() => (window as any).checks.reset());
    await page.evaluate(() => (window as any).checks.focusPaste());
    const saved = await app.evaluate(({ clipboard }) => clipboard.readText());
    await app.evaluate(({ clipboard, BrowserWindow }, [text, html]) => {
        clipboard.write({ text, html } as never);
        BrowserWindow.getAllWindows()[0]?.webContents.focus();
    }, [EXCEL_TEXT, EXCEL_HTML]);
    await page.keyboard.press(PASTE_KEY);
    const value = await page.evaluate(() => (window as any).checks.pasteValue());
    await page.evaluate(() => (window as any).checks.focusEditor());
    await page.keyboard.press(PASTE_KEY);
    const editorValue = await page.evaluate(() => (window as any).checks.editorValue());
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), saved);
    return { textareaKeepsTabs: value === EXCEL_TEXT, textareaValue: value, editorKeepsTabs: editorValue === EXCEL_TEXT, editorValue };
}

async function pdfChecks(page: Page, pdfPath: string, runs: number): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    out.workerStartMs = await page.evaluate(() => (window as any).checks.prepareWorker());
    const variants = ['ipc', 'protocolRange', 'protocolFull'] as const;
    const times: Record<string, number[]> = { ipc: [], protocolRange: [], protocolFull: [] };
    for (const variant of variants) {
        const first = await page.evaluate(([v, p]) => (window as any).checks.loadOnce(v, p, true).then((r: any) => r, (e: Error) => ({ error: String(e) })), [variant, pdfPath]);
        out[`first_${variant}`] = first;
    }
    for (let run = 0; run < runs; run++) {
        for (const variant of variants) {
            const r = await page.evaluate(([v, p]) => (window as any).checks.loadOnce(v, p).then((x: any) => x.ms, () => -1), [variant, pdfPath]);
            times[variant]?.push(r as number);
        }
    }
    out.times = times;
    out.fastest = Object.fromEntries(Object.entries(times).map(([k, v]) => [k, Math.min(...v)]));
    return out;
}

async function protocolSecurity(page: Page, allowed: string, outside: string): Promise<Record<string, unknown>> {
    const probe = (p: string): Promise<string> => page.evaluate(async (path) => {
        try { return String((await fetch(`latexeditor://pdf/?p=${encodeURIComponent(path)}`)).status); } catch (e) { return `Fehler ${(e as Error).name}`; }
    }, p);
    return {
        innerhalb: await probe(allowed),
        ausserhalb: await probe(outside),
        traversal: await probe(`${dirname(allowed)}/pdf/../outside/secret.pdf`),
        anderesHost: await page.evaluate(async () => { try { return String((await fetch('latexeditor://evil/?p=/etc/hosts')).status); } catch (e) { return `Fehler ${(e as Error).name}`; } }),
    };
}

async function runPage(pageName: string, runs: number, pdfPath: string, outside: string): Promise<Record<string, unknown>> {
    const app = await _electron.launch({
        executablePath: electronPath,
        args: [join(spikeDirectory, 'out/main.cjs')],
        env: { ...process.env, SPIKE_PAGE: pageName, SPIKE_PDF: pdfPath, SPIKE_ALLOWED_DIR: pdfDirectory, SPIKE_OUTSIDE: outside },
        timeout: LAUNCH_TIMEOUT_MS,
    });
    const child = app.process();
    const pid = child.pid;
    console.log(`${pageName}: Electron PID ${pid}`);
    const out: Record<string, unknown> = {};
    try {
        const page = await app.firstWindow();
        await page.waitForFunction(() => 'checks' in window);
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
        out.userAgent = await page.evaluate(() => navigator.userAgent);
        out.webPreferences = await app.evaluate(({ BrowserWindow }) => (BrowserWindow.getAllWindows()[0]?.webContents as any).getLastWebPreferences?.() ?? "nicht verfügbar");
        out.sandbox = await page.evaluate(() => (window as any).checks.sandbox());
        out.csp = await page.evaluate(() => (window as any).checks.csp());
        out.probeWorker = await page.evaluate(() => (window as any).checks.probeWorker().catch((e: Error) => String(e)));
        out.clipboardRenderer = await page.evaluate(() => (window as any).checks.clipboard());
        out.paste = await pasteCheck(app, page);
        out.altgr = await altGrChecks(page);
        out.ime = await imeChecks(page);
        await page.setInputFiles('#fileInput', pdfPath);
        out.drop = await page.evaluate(() => (window as any).checks.drop());
        out.protocolSecurity = await protocolSecurity(page, pdfPath, outside);
        out.pdf = await pdfChecks(page, pdfPath, runs);
        out.violations = await page.evaluate(() => (window as any).checks.violations());
    } catch (error) {
        out.driverError = String(error);
    } finally {
        await app.close().catch(() => undefined);
        if (pid !== undefined && child.exitCode === null) process.kill(pid);
    }
    return out;
}

async function main(): Promise<void> {
    const runs = Number(process.argv[2] ?? DEFAULT_RUNS);
    await mkdir(pdfDirectory, { recursive: true });
    await mkdir(outsideDirectory, { recursive: true });
    const pdfPath = join(pdfDirectory, 'big.pdf');
    const size = await writeSyntheticPdf(pdfPath, PDF_BYTES, PDF_PAGES);
    const outside = join(outsideDirectory, 'secret.pdf');
    await writeSyntheticPdf(outside, 20_000, 1);
    report.pdfBytes = size;
    for (const pageName of ['index.html', 'index-protocol.html']) report[pageName] = await runPage(pageName, runs, pdfPath, outside);
    const resultsDirectory = join(spikeDirectory, 'results');
    await mkdir(resultsDirectory, { recursive: true });
    const file = join(resultsDirectory, `mac-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(file, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
}

await main();
