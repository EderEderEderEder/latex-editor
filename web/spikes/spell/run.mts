// Playwright-Treiber für Spike S8: startet je Variante ein frisches Electron (eigenes --user-data-dir, Net-Log),
// misst und schreibt results/electron-<variante>.json. Aufruf aus web/ (außerhalb der Sandbox, nach build.mts):
//   SPELL_SPIKE_MODULES=<Ordner> SPELL_SPIKE_DEMO=<HgbDemo-Kopie> SPELL_SPIKE_SCRATCH=<Ordner> node spikes/spell/run.mts <variante>
// Varianten: chromium, chromium-syntax, provider, worker
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';

const LAUNCH_TIMEOUT_MS = 60_000;
const SPELLCHECK_SETTLE_MS = 2_500;
const BIG_DOCUMENT_LINES = 10_000;
const BYTES_PER_KB = 1024;
const PROBE_WORDS = ['Rechtschreibfeler', 'Tippfehlr', 'fehlerhaftt', 'alphaa', 'befehlx', 'Kommentaar', 'Optionfehler', 'Fließtext'];
const VISIBLE_CHECK_RUNS = 5;
const TYPED_WORD = 'Nochainfehler';
const PROBE_CLIP = { x: 0, y: 0, width: 900, height: 160 };

function variantLabel(withProvider: boolean): string {
    if (withProvider) return 'provider';
    return process.argv[2] ?? 'chromium';
}

const spikeDirectory = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const electronPath = require('electron') as string;
const resultsDirectory = join(spikeDirectory, 'results');

function requiredEnv(name: string): string {
    const value = process.env[name];
    if (value === undefined) throw new Error(`${name} fehlt`);
    return value;
}

async function bigDocument(): Promise<string> {
    const folder = join(requiredEnv('SPELL_SPIKE_DEMO'), 'chapters');
    const files = (await readdir(folder)).filter((name) => name.endsWith('.tex')).sort();
    const texts = await Promise.all(files.map((name) => readFile(join(folder, name), 'utf8')));
    const block = texts.join('\n').split('\n');
    const lines: string[] = [];
    while (lines.length < BIG_DOCUMENT_LINES) lines.push(...block);
    return lines.slice(0, BIG_DOCUMENT_LINES).join('\n');
}

async function rendererWorkingSetMB(application: ElectronApplication): Promise<number> {
    const kilobytes = await application.evaluate(({ app }) =>
        app.getAppMetrics().filter((metric) => metric.type === 'Tab').map((metric) => metric.memory.workingSetSize),
    );
    return Math.max(...kilobytes) / BYTES_PER_KB;
}

/** Rechtsklick auf jedes Prüfwort; der Main schreibt `params.misspelledWord` des Kontextmenüs mit */
async function rightClickProbeWords(application: ElectronApplication, page: Page): Promise<object[]> {
    await page.waitForTimeout(SPELLCHECK_SETTLE_MS);
    const results: object[] = [];
    for (const word of PROBE_WORDS) {
        const center = await page.evaluate((target) => window.spellSpike.wordCenter(target), word);
        if (center === null) continue;
        await page.mouse.click(center.x, center.y, { button: 'right' });
        await page.waitForTimeout(150);
        const menus = await application.evaluate(() => (globalThis as unknown as { spikeLog: { contextMenus: object[] } }).spikeLog.contextMenus);
        results.push({ word, menu: menus[menus.length - 1] ?? null });
    }
    return results;
}

/** Echtes Tippen (Tastaturereignisse): Chromium prüft Wörter beim Tippen („hot mode“) */
async function typedWordCheck(application: ElectronApplication, page: Page): Promise<object> {
    await page.evaluate(() => window.spellSpike.cursorToEnd());
    await page.keyboard.type(`\nTippen: ${TYPED_WORD} und \\textit{Zweitfeler} weiter `);
    await page.waitForTimeout(SPELLCHECK_SETTLE_MS);
    const results: object[] = [];
    for (const word of [TYPED_WORD, 'Zweitfeler', 'textit']) {
        const center = await page.evaluate((target) => window.spellSpike.wordCenter(target), word);
        if (center === null) continue;
        await page.mouse.click(center.x, center.y, { button: 'right' });
        await page.waitForTimeout(150);
        const menus = await application.evaluate(() => (globalThis as unknown as { spikeLog: { contextMenus: object[] } }).spikeLog.contextMenus);
        results.push({ word, menu: menus[menus.length - 1] ?? null });
    }
    return results;
}

async function sessionApis(application: ElectronApplication): Promise<object> {
    return application.evaluate(async ({ session }) => {
        const attempt = (work: () => unknown): string => {
            try {
                return `ok: ${JSON.stringify(work() ?? null)}`;
            } catch (error) {
                return `Fehler: ${String(error)}`;
            }
        };
        const target = session.defaultSession;
        return {
            enabled: target.isSpellCheckerEnabled(),
            languagesBefore: target.getSpellCheckerLanguages(),
            availableCount: target.availableSpellCheckerLanguages.length,
            availableGerman: target.availableSpellCheckerLanguages.filter((code) => code.startsWith('de')),
            setLanguages: attempt(() => target.setSpellCheckerLanguages(['de-AT', 'de-DE'])),
            languagesAfter: target.getSpellCheckerLanguages(),
            setFileUrl: attempt(() => target.setSpellCheckerDictionaryDownloadURL('file:///nicht/vorhanden/')),
            customWords: (await target.listWordsInSpellCheckerDictionary()).length,
        };
    });
}

async function spikeLog(application: ElectronApplication): Promise<object> {
    return application.evaluate(() => {
        const log = (globalThis as unknown as { spikeLog: { requests: string[]; spellEvents: string[] } }).spikeLog;
        return { requests: log.requests.filter((url) => !url.startsWith('file:')), fileRequests: log.requests.length, spellEvents: log.spellEvents };
    });
}

async function measureChromium(application: ElectronApplication, page: Page, withProvider: boolean): Promise<object> {
    if (withProvider) await page.evaluate(() => window.spellSpike.enableProvider());
    const apis = await sessionApis(application);
    await page.evaluate(() => window.spellSpike.openProbe(true));
    const hasFocus = await page.evaluate(() => window.spellSpike.hasFocus());
    const spellcheckAttribute = await page.evaluate(() => document.querySelector('.cm-content')?.getAttribute('spellcheck') ?? null);
    const probe = await rightClickProbeWords(application, page);
    await page.screenshot({ path: join(resultsDirectory, `probe-${variantLabel(withProvider)}.png`), clip: PROBE_CLIP });
    const typed = await typedWordCheck(application, page);
    await page.screenshot({ path: join(resultsDirectory, `typed-${variantLabel(withProvider)}.png`), clip: PROBE_CLIP });
    const providerWords = await page.evaluate(() => window.spellSpike.providerWords());
    const text = await bigDocument();
    await page.evaluate((document) => window.spellSpike.openDocument(document, false), text);
    const typingOff = await page.evaluate(() => window.spellSpike.measureTyping());
    await page.evaluate((document) => window.spellSpike.openDocument(document, true), text);
    await page.waitForTimeout(SPELLCHECK_SETTLE_MS);
    const typingOn = await page.evaluate(() => window.spellSpike.measureTyping());
    return { apis, hasFocus, spellcheckAttribute, probe, typed, providerWords: providerWords.slice(0, 20), typingOff, typingOn, log: await spikeLog(application) };
}

async function measureWorker(application: ElectronApplication, page: Page): Promise<object> {
    const text = await bigDocument();
    await page.evaluate((document) => window.spellSpike.openDocument(document, false), text);
    const typingBaseline = await page.evaluate(() => window.spellSpike.measureTyping());
    const memoryBeforeMB = await rendererWorkingSetMB(application);
    const load = await page.evaluate(() => window.spellSpike.startWorker('dictionary-de-at'));
    await page.waitForTimeout(SPELLCHECK_SETTLE_MS);
    const memoryAfterMB = await rendererWorkingSetMB(application);
    await page.evaluate(() => window.spellSpike.openProbe(false));
    const probe = await page.evaluate(() => window.spellSpike.checkVisibleOnce());
    await page.evaluate((document) => window.spellSpike.openDocument(document, false), text);
    const visibleChecks: object[] = [];
    for (let run = 0; run < VISIBLE_CHECK_RUNS; run++) visibleChecks.push(await page.evaluate(() => window.spellSpike.checkVisibleOnce()));
    const typingWithWorker = await page.evaluate(() => window.spellSpike.measureWorkerTyping());
    return { load, memoryBeforeMB, memoryAfterMB, probe, visibleChecks, typingBaseline, typingWithWorker, log: await spikeLog(application) };
}

const VARIANTS: Record<string, { mode: string; syntax: string; chromium: string }> = {
    'chromium': { mode: 'chromium', syntax: '0', chromium: '1' },
    'chromium-syntax': { mode: 'chromium', syntax: '1', chromium: '1' },
    'provider': { mode: 'provider', syntax: '1', chromium: '1' },
    'worker': { mode: 'worker', syntax: '0', chromium: '0' },
};

async function launch(variantName: string): Promise<ElectronApplication> {
    const variant = VARIANTS[variantName];
    if (variant === undefined) throw new Error(`unbekannte Variante ${variantName}`);
    const scratch = requiredEnv('SPELL_SPIKE_SCRATCH');
    const application = await _electron.launch({
        executablePath: electronPath,
        args: [join(spikeDirectory, 'out/main.cjs'), `--user-data-dir=${join(scratch, `userdata-${variantName}`)}`,
            `--log-net-log=${join(scratch, `netlog-${variantName}.json`)}`],
        env: { ...process.env, SPELL_SPIKE_MODE: variant.mode, SPELL_SPIKE_SYNTAX: variant.syntax, SPELL_SPIKE_CHROMIUM: variant.chromium },
        timeout: LAUNCH_TIMEOUT_MS,
    });
    console.log(`Electron gestartet, PID ${application.process().pid}`);
    return application;
}

async function measure(variantName: string, application: ElectronApplication, page: Page): Promise<object> {
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const versions = await application.evaluate(() => process.versions);
    const body = variantName === 'worker'
        ? await measureWorker(application, page)
        : await measureChromium(application, page, variantName === 'provider');
    return { variant: variantName, platform: process.platform, userAgent, electron: versions.electron, chrome: versions.chrome, ...body };
}

/** Startet Electron, misst und beendet nur den eigenen Prozess (per PID). */
async function main(): Promise<void> {
    const variantName = process.argv[2] ?? 'chromium';
    await mkdir(resultsDirectory, { recursive: true });
    const application = await launch(variantName);
    const child = application.process();
    try {
        const page = await application.firstWindow();
        await page.waitForFunction(() => 'spellSpike' in window);
        const result = await measure(variantName, application, page);
        await writeFile(join(resultsDirectory, `electron-${variantName}.json`), JSON.stringify(result, null, 4));
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.log(`Lauf abgebrochen: ${String(error).split('\n')[0]}`);
    } finally {
        await application.close().catch(() => undefined);
        if (child.pid !== undefined && child.exitCode === null) process.kill(child.pid);
    }
}

await main();
