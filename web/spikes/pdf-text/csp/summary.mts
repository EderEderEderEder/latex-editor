// Fasst results/w33a-*.json als Markdown-Tabellen zusammen (Aufruf aus web/: node spikes/pdf-text/csp/summary.mts <Datei>)
import { readFile } from 'node:fs/promises';

interface Summary {
    count: number;
    p50: number;
    p95: number;
    max: number;
    mean: number;
}

interface TypingRound {
    round: number;
    mode: string;
    devicePixelRatio: number;
    workerRenderingActive: boolean;
    inputDelay: Summary;
    latency: Summary;
    pageRender: Summary;
    geometry: Summary;
    pagesRendered: number;
    longTasks: Summary;
    charactersInserted: number;
    fontFaces: number;
}

interface MemorySample {
    totalMb: number;
    rendererMb: number;
    gpuMb: number;
}

interface ScrollRound {
    round: number;
    mode: string;
    opened: { documentMs: number; firstVisibleMs: number; workerRenderingActive: boolean; pages: number };
    scroll: {
        durationMs: number;
        frames: number;
        framesOverBudget: number;
        framesDropped: number;
        frameGap: Summary;
        frameWork: Summary;
        longTasks: Summary;
        pagesRendered: number;
        renderErrors: number;
        lastPageVisibleMs: number;
        jsHeapMb: number;
    };
    jumps: number[];
    memory: { before: MemorySample; opened: MemorySample; peakWhileScrolling: MemorySample; end: MemorySample };
}

const number = (value: number, digits = 1): string => (Number.isFinite(value) ? value.toFixed(digits).replace('.', ',') : '–');

function typingTable(rounds: TypingRound[]): string[] {
    const lines = [
        '| Runde | Last | DPR | Worker aktiv | Zeichen | Eingangsverzug p50 / p95 / max | Taste bis Paint p50 / p95 / max | Seiten gerendert | Seite rendern p50 / p95 | Geometrie p50 | Long Tasks (Anzahl, max) |',
        '|---|---|---|---|---|---|---|---|---|---|---|',
    ];
    for (const r of rounds) {
        lines.push(`| ${r.round + 1} | ${r.mode} | ${r.mode === 'none' ? '–' : number(r.devicePixelRatio)} | ${r.workerRenderingActive ? 'ja' : 'nein'} | ${r.charactersInserted} | ${number(r.inputDelay.p50)} / ${number(r.inputDelay.p95)} / ${number(r.inputDelay.max)} | ${number(r.latency.p50)} / ${number(r.latency.p95)} / ${number(r.latency.max)} | ${r.pagesRendered} | ${number(r.pageRender.p50)} / ${number(r.pageRender.p95)} | ${number(r.geometry.p50)} | ${r.longTasks.count}, ${number(r.longTasks.max)} |`);
    }
    return lines;
}

function scrollTable(rounds: ScrollRound[]): string[] {
    const lines = [
        '| Runde | Rendern | Worker aktiv | getDocument | erste Seite sichtbar | Rahmen | > 16 ms | > 33 ms | Rahmenabstand p95 / max | Long Tasks (Anzahl, max) | Seiten gerendert | letzte Seite nach Stopp | Sprünge p50 / max | Speicher gesamt vorher → Spitze (Renderer, GPU) MB |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ];
    for (const r of rounds) {
        const s = r.scroll;
        const jumps = [...r.jumps].filter(Number.isFinite).sort((a, b) => a - b);
        const peak = r.memory.peakWhileScrolling;
        lines.push(`| ${r.round + 1} | ${r.mode} | ${r.opened.workerRenderingActive ? 'ja' : 'nein'} | ${number(r.opened.documentMs)} | ${number(r.opened.firstVisibleMs)} | ${s.frames} | ${s.framesOverBudget} | ${s.framesDropped} | ${number(s.frameGap.p95)} / ${number(s.frameGap.max)} | ${s.longTasks.count}, ${number(s.longTasks.max)} | ${s.pagesRendered} | ${number(s.lastPageVisibleMs)} | ${number(jumps[Math.floor(jumps.length / 2)] ?? NaN)} / ${number(jumps[jumps.length - 1] ?? NaN)} | ${number(r.memory.before.totalMb, 0)} → ${number(peak.totalMb, 0)} (${number(peak.rendererMb, 0)}, ${number(peak.gpuMb, 0)}) |`);
    }
    return lines;
}

const file = process.argv[2];
if (file === undefined) throw new Error('Datei fehlt');
const results = JSON.parse(await readFile(file, 'utf8')) as { typing: TypingRound[]; scrolling: ScrollRound[] };
console.log([...typingTable(results.typing), '', ...scrollTable(results.scrolling)].join('\n'));
