// Treiber der W3-3a-Messung (Aufruf aus web/, außerhalb der Claude-Sandbox):
//   node spikes/pdf-text/csp/build.mts && node spikes/pdf-text/csp/run.mts [--vsync]
// Baut aus einer Kopie von shared/Testdaten/HgbDemo in $TMPDIR ein ~300-Seiten-PDF (Kapitel 56-mal wiederholt), startet
// die Messseite in Electron unter RENDERER_CSP und misst (1) Tippen während des Renderns, (2) Scrollen und Sprünge.
// Ergebnis: results/w33a-<rahmentakt>.json. Ohne `--vsync` wie tests/perf ohne Rahmentakt (Arbeit je Rahmen).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { _electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';
import type { W33aApi } from './src/page.ts';

const runProcess = promisify(execFile);
// macOS: MacTeX-Ort (PATH der GUI-Shells enthält ihn oft nicht); Windows/Linux: latexmk aus dem PATH
const TEX_BIN = process.platform === 'darwin' ? '/Library/TeX/texbin' : '';
const LATEXMK = TEX_BIN === '' ? 'latexmk' : `${TEX_BIN}/latexmk`;
const LATEXMK_TIMEOUT_MS = 600_000;
const CHAPTER_REPEATS = 56;
const KEY_COUNT = 120;
const KEY_DELAY_MS = 40;
const TYPING_ROUNDS = 3;
const WARMUP_MS = 500;
const SCROLL_ROUNDS = 2;
const SCROLL_SPEED_PX_PER_S = 8_000;
const JUMP_PAGES = [150, 20, 280, 75, 210, 5, 299];
const METRICS_INTERVAL_MS = 500;
const KIB_PER_MIB = 1024;
/** Last je Runde: ohne PDF, Hauptthread, Worker (je mit devicePixelRatio) und Hauptthread mit Pixelverhältnis 1 */
const TYPING_LOADS = [
    { mode: 'none', pixelRatio: null },
    { mode: 'mainThread', pixelRatio: null },
    { mode: 'worker', pixelRatio: null },
    { mode: 'mainThread', pixelRatio: 1 },
] as const;
const TYPED_TEXT = 'abcdefghij '.repeat(Math.ceil(KEY_COUNT / 11)).slice(0, KEY_COUNT);

const cspDirectory = dirname(fileURLToPath(import.meta.url));
const workDirectory = join(os.tmpdir(), 'w33a');
const longProject = join(workDirectory, 'HgbDemo300');
const vsync = process.argv.includes('--vsync');

type Api = { w33a: W33aApi };

const LONG_TEX = String.raw`\documentclass[type=bachelor,language=german,theme=default,degree=engineering]{hgbthesis}
\graphicspath{{images/}}
\bibliography{hgbreferences}
\title{Lange Demo-Arbeit (W3-3a)}
\author{Max Mustermann}
\date{\today}
\newcount\demorepeat
\begin{document}
\maketitle
\tableofcontents
\demorepeat=0
\loop
\input{chapters/einleitung}
\input{chapters/grundlagen}
\input{chapters/umsetzung}
\input{chapters/fazit}
\advance\demorepeat by 1
\ifnum\demorepeat<${CHAPTER_REPEATS} \repeat
\printbibliography
\end{document}
`;

/** Nie im Original kompilieren: Kopie in $TMPDIR, latexmk erkennt selbst, ob neu gebaut werden muss */
async function buildLongPdf(): Promise<{ pdf: string; pages: number }> {
    const source = join(cspDirectory, '../../../../shared/Testdaten/HgbDemo');
    if (!existsSync(longProject)) await cp(source, longProject, { recursive: true });
    await writeFile(join(longProject, 'long.tex'), LONG_TEX);
    const env = TEX_BIN === '' ? process.env : { ...process.env, PATH: `${TEX_BIN}:${process.env.PATH ?? ''}` };
    const args = ['-pdf', '-interaction=nonstopmode', 'long.tex'];
    await runProcess(LATEXMK, args, { cwd: longProject, env, timeout: LATEXMK_TIMEOUT_MS }).catch(() => undefined);
    const log = await readFile(join(longProject, 'long.log'), 'latin1');
    const pages = Number(/Output written on long\.pdf \((\d+) pages/.exec(log)?.[1] ?? 0);
    return { pdf: join(longProject, 'long.pdf'), pages };
}

async function launch(): Promise<{ application: ElectronApplication; page: Page; console: string[] }> {
    const electronPath = createRequire(import.meta.url)('electron') as string;
    const env = { ...process.env, W33A_VSYNC: vsync ? '1' : '0' };
    const application = await _electron.launch({ executablePath: electronPath, args: [join(cspDirectory, 'out', 'main.cjs')], env });
    const page = await application.firstWindow();
    const messages: string[] = [];
    page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`));
    page.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`));
    await page.waitForFunction(() => (window as unknown as Partial<Api>).w33a !== undefined);
    return { application, page, console: messages };
}

interface MemorySample {
    totalMb: number;
    rendererMb: number;
    gpuMb: number;
}

async function memory(application: ElectronApplication): Promise<MemorySample> {
    const metrics = await application.evaluate(({ app }) => app.getAppMetrics());
    const sum = (filter: (type: string) => boolean): number =>
        metrics.filter((metric) => filter(metric.type)).reduce((total, metric) => total + metric.memory.workingSetSize, 0) / KIB_PER_MIB;
    return { totalMb: sum(() => true), rendererMb: sum((type) => type === 'Tab'), gpuMb: sum((type) => type === 'GPU') };
}

async function typingRound(page: Page, load: (typeof TYPING_LOADS)[number]): Promise<unknown> {
    const args = [load.mode, WARMUP_MS, load.pixelRatio] as const;
    await page.evaluate(([m, warmup, ratio]) => (window as unknown as Api).w33a.beginTyping(m, warmup, ratio), args);
    await page.evaluate(() => (window as unknown as Api).w33a.focusEditor());
    const before = await page.evaluate(() => (window as unknown as Api).w33a.documentLength());
    await page.keyboard.type(TYPED_TEXT, { delay: KEY_DELAY_MS });
    const result = await page.evaluate(() => (window as unknown as Api).w33a.finishTyping());
    const after = await page.evaluate(() => (window as unknown as Api).w33a.documentLength());
    return { ...result, charactersInserted: after - before };
}

async function typingMeasurement(page: Page): Promise<unknown[]> {
    const rounds: unknown[] = [];
    for (let round = 0; round < TYPING_ROUNDS; round += 1) {
        for (const load of TYPING_LOADS) rounds.push({ round, ...(await typingRound(page, load) as object) });
    }
    return rounds;
}

/** Fragt während des Scrollens den Speicher ab und merkt sich den Höchstwert */
function memoryPeakWatcher(application: ElectronApplication): { stop: () => Promise<MemorySample> } {
    let peak: MemorySample = { totalMb: 0, rendererMb: 0, gpuMb: 0 };
    const poll = async (): Promise<void> => {
        const sample = await memory(application).catch(() => peak);
        if (sample.totalMb > peak.totalMb) peak = sample;
    };
    const timer = setInterval(() => void poll(), METRICS_INTERVAL_MS);
    return {
        stop: async () => {
            clearInterval(timer);
            await poll();
            return peak;
        },
    };
}

async function scrollRound(application: ElectronApplication, page: Page, mode: 'mainThread' | 'worker'): Promise<unknown> {
    const memoryBefore = await memory(application);
    const opened = await page.evaluate((m) => (window as unknown as Api).w33a.openViewer(m), mode);
    const memoryOpened = await memory(application);
    const watcher = memoryPeakWatcher(application);
    const scroll = await page.evaluate((speed) => (window as unknown as Api).w33a.scrollThrough(speed), SCROLL_SPEED_PX_PER_S);
    const memoryPeak = await watcher.stop();
    const jumps = await page.evaluate((pages) => (window as unknown as Api).w33a.jumpTo(pages), JUMP_PAGES);
    const memoryEnd = await memory(application);
    await page.evaluate(() => (window as unknown as Api).w33a.closeViewer());
    return { opened, scroll, jumps, memory: { before: memoryBefore, opened: memoryOpened, peakWhileScrolling: memoryPeak, end: memoryEnd } };
}

async function scrollMeasurement(application: ElectronApplication, page: Page): Promise<unknown[]> {
    const rounds: unknown[] = [];
    for (let round = 0; round < SCROLL_ROUNDS; round += 1) {
        for (const mode of ['mainThread', 'worker'] as const) rounds.push({ round, mode, ...(await scrollRound(application, page, mode) as object) });
    }
    return rounds;
}

/** Nur die eigene Electron-PID, falls `close()` sie nicht beendet hat */
function stopIfAlive(pid: number | undefined): void {
    if (pid === undefined) return;
    try {
        process.kill(pid, 0);
    } catch {
        return;
    }
    process.kill(pid, 'SIGTERM');
}

async function measure(pdf: string): Promise<Record<string, unknown>> {
    const { application, page, console: messages } = await launch();
    try {
        const bytes = await page.evaluate((base64) => (window as unknown as Api).w33a.setPdf(base64), (await readFile(pdf)).toString('base64'));
        const csp = await page.evaluate(() => (window as unknown as Api).w33a.probeCsp());
        const typing = await typingMeasurement(page);
        const scrolling = await scrollMeasurement(application, page);
        const violations = await page.evaluate(() => (window as unknown as Api).w33a.violations());
        const main = await application.evaluate(() => (globalThis as { w33aMain?: unknown }).w33aMain);
        return { bytes, csp, typing, scrolling, violations, main, console: messages };
    } finally {
        const pid = application.process().pid;
        await application.close();
        stopIfAlive(pid);
    }
}

async function main(): Promise<void> {
    await mkdir(workDirectory, { recursive: true });
    const { pdf, pages } = await buildLongPdf();
    console.log(`PDF: ${pdf} (${pages} Seiten)`);
    const results = { vsync, pdfPages: pages, platform: `${process.platform} ${os.release()}`, cpu: os.cpus()[0]?.model, ...(await measure(pdf)) };
    const file = join(cspDirectory, '..', 'results', `w33a-${vsync ? 'vsync' : 'ohne-rahmentakt'}.json`);
    await writeFile(file, JSON.stringify(results, null, 2));
    console.log(`Ergebnis: ${file}`);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
