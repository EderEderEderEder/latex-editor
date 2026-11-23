// Playwright-Treiber: startet die Messseite in der installierten Electron-Binärdatei,
// führt n Läufe aus und schreibt Rohwerte (JSON) und Zusammenfassung (Markdown).
// Aufruf aus web/: node spikes/cm-perf/run.mts <Laufnummer>  (ein Lauf je Aufruf, frisches Electron)
//                 node spikes/cm-perf/run.mts summary      (fasst alle results/mac-*.json zusammen)
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';
import type { RunResult, VariantName } from './src/measure';
import { summarize } from './src/summary.ts';

const SIZES: readonly number[] = [10_000, 50_000];
const VARIANTS: readonly VariantName[] = ['plain', 'stream', 'viewPlugin'];
const BYTES_PER_KB = 1024;
const LAUNCH_TIMEOUT_MS = 60_000;

interface MeasuredRun extends RunResult {
    rendererMB: number;
    run?: number;
}

const spikeDirectory = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const electronPath = require('electron') as string;
const resultsDirectory = join(spikeDirectory, 'results');

async function rendererWorkingSetMB(application: ElectronApplication): Promise<number> {
    const kilobytes = await application.evaluate(({ app }) =>
        app.getAppMetrics().filter((metric) => metric.type === 'Tab').map((metric) => metric.memory.workingSetSize),
    );
    return Math.max(...kilobytes) / BYTES_PER_KB;
}

async function measureOnce(application: ElectronApplication, page: Page, variant: VariantName, lines: number): Promise<MeasuredRun> {
    const result = await page.evaluate(([name, count]) => window.cmPerf.runVariant(name, count), [variant, lines] as const);
    const rendererMB = await rendererWorkingSetMB(application);
    await page.evaluate(() => window.cmPerf.closeView());
    console.log(`${variant} ${lines}: Öffnen ${result.openMs.toFixed(1)} ms, mittig Arbeit p95 ${result.keyMid.work.p95.toFixed(1)} ms, Latenz p95 ${result.keyMid.latency.p95.toFixed(1)} ms`);
    return { ...result, rendererMB };
}

/** Ein Lauf = alle Varianten und Größen in einem frisch gestarteten Electron (Reihenfolge je Lauf gedreht). */
async function measureRun(application: ElectronApplication, page: Page, run: number): Promise<void> {
    const sink: MeasuredRun[] = [];
    const path = join(resultsDirectory, `mac-run${run}.json`);
    for (const lines of SIZES) {
        for (let index = 0; index < VARIANTS.length; index++) {
            const variant = VARIANTS[(index + run) % VARIANTS.length] as VariantName;
            sink.push({ ...(await measureOnce(application, page, variant, lines)), run });
            await writeFile(path, JSON.stringify(sink, null, 4));
        }
    }
    const idleFrame = await page.evaluate(() => window.cmPerf.idleFrameIntervalMs());
    const userAgent = await page.evaluate(() => navigator.userAgent);
    await writeFile(join(resultsDirectory, `mac-run${run}.txt`), `${userAgent}\nRahmenabstand ohne Arbeit: ${idleFrame.toFixed(2)} ms\n`);
}

function rendererSummary(results: MeasuredRun[]): string {
    const groups = new Map<string, number[]>();
    for (const run of results) {
        const key = `${run.variant} ${run.lines}`;
        groups.set(key, [...(groups.get(key) ?? []), run.rendererMB]);
    }
    const lines = [...groups].map(([key, values]) =>
        `- ${key}: ${Math.min(...values).toFixed(0)}–${Math.max(...values).toFixed(0)} MB`);
    return `Renderer-Arbeitsspeicher (Working Set, nach dem Lauf):\n${lines.join('\n')}`;
}

async function writeSummary(): Promise<void> {
    const files = (await readdir(resultsDirectory)).filter((name) => /^mac-run\d+\.json$/.test(name));
    const results: MeasuredRun[] = [];
    for (const name of files) results.push(...(JSON.parse(await readFile(join(resultsDirectory, name), 'utf8')) as MeasuredRun[]));
    const report = `Messungen: ${results.length} aus ${files.length} Läufen\n\n${summarize(results)}\n\n${rendererSummary(results)}\n`;
    await writeFile(join(resultsDirectory, 'mac-summary.md'), report);
    console.log(report);
}

async function launch(): Promise<ElectronApplication> {
    const application = await _electron.launch({
        executablePath: electronPath,
        args: [join(spikeDirectory, 'out/main.cjs')],
        timeout: LAUNCH_TIMEOUT_MS,
    });
    console.log(`Electron gestartet, PID ${application.process().pid}`);
    return application;
}

/** Startet Electron, führt `work` aus und beendet nur den eigenen Prozess (per PID). */
async function withElectron(work: (application: ElectronApplication, page: Page) => Promise<void>): Promise<void> {
    const application = await launch();
    const child = application.process();
    try {
        const page = await application.firstWindow();
        page.on('crash', () => console.log('Renderer abgestürzt'));
        page.on('close', () => console.log('Fenster geschlossen'));
        await page.waitForFunction(() => 'cmPerf' in window);
        await work(application, page);
    } catch (error) {
        console.log(`Lauf abgebrochen: ${String(error).split('\n')[0]}`);
    } finally {
        await application.close().catch(() => undefined);
        if (child.pid !== undefined && child.exitCode === null) process.kill(child.pid);
    }
}

async function main(): Promise<void> {
    await mkdir(resultsDirectory, { recursive: true });
    const argument = process.argv[2] ?? 'summary';
    if (argument === 'summary') {
        await writeSummary();
        return;
    }
    await withElectron((application, page) => measureRun(application, page, Number(argument)));
}

await main();
