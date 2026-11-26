// Messseite für Spike S8 (Wegwerfcode). Der Treiber (run.mts) ruft `window.spellSpike.*` über Playwright auf.
import { EditorSelection, StateEffect, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { setSpellErrors, spellcheckAttribute, spellErrorField, syntaxWithoutSpellcheck } from './editorSetup';
import { measureFrame, sleep, toStats, type FrameTiming, type Stats } from './timing';
import type { CheckResponse, WorkerRequest, WorkerResponse } from './workerProtocol';

interface SpikeHost {
    loadDictionary(name: string): Promise<{ aff: string; dic: string }>;
    enableProvider(): void;
    providerWords(): string[][];
}

declare global {
    interface Window {
        spikeHost: SpikeHost;
        spellSpike: typeof spellSpike;
    }
}

const KEYSTROKES = 200;
const KEY_GAP_MS = 30;
/** Zeilen vor dem sichtbaren Bereich, ab denen der Worker tokenisiert (Normalzustand angenommen) */
const CONTEXT_LINES = 50;
const SETTLE_MS = 300;

/** Prüftext: falsche Wörter in Fließtext und in jeder Art LaTeX-Syntax */
export const PROBE_TEXT = [
    '\\section{Einleitung}',
    'Ein Rechtschreibfeler im Fließtext und \\textbf{Tippfehlr} in Fettdruck.',
    'Ein Verweis \\label{sec:fehlerhaftt} und Mathe $\\alphaa + x$ im Satz.',
    '\\befehlx{Inhalt} steht hier. % Kommentaar am Ende',
    '\\includegraphics[Optionfehler]{bild}',
].join('\n');

const parameters = new URLSearchParams(location.search);
const mode = parameters.get('mode') ?? 'chromium';
const withSyntaxAttributes = parameters.get('syntax') === '1';

let view: EditorView | null = null;
let worker: Worker | null = null;

function extensionsFor(spellcheck: boolean): Extension[] {
    const extensions: Extension[] = [lineNumbers(), EditorView.lineWrapping, spellcheckAttribute(spellcheck), spellErrorField];
    if (withSyntaxAttributes) extensions.push(syntaxWithoutSpellcheck);
    return extensions;
}

function openEditor(text: string, spellcheck: boolean): EditorView {
    view?.destroy();
    const parent = document.getElementById('editor');
    if (parent === null) throw new Error('kein #editor');
    view = new EditorView({ doc: text, parent, extensions: extensionsFor(spellcheck) });
    view.focus();
    return view;
}

function activeView(): EditorView {
    if (view === null) throw new Error('kein Editor offen');
    return view;
}

/** Mittelpunkt jedes Vorkommens von `word` (Bildschirmkoordinaten im Fenster) für den Rechtsklick */
function wordCenter(word: string): { x: number; y: number } | null {
    const current = activeView();
    const index = current.state.doc.toString().indexOf(word);
    if (index < 0) return null;
    const start = current.coordsAtPos(index + 1);
    const end = current.coordsAtPos(index + word.length - 1);
    if (start === null || end === null) return null;
    return { x: (start.left + end.right) / 2, y: (start.top + start.bottom) / 2 };
}

async function typeKeystrokes(): Promise<FrameTiming[]> {
    const current = activeView();
    const middle = current.state.doc.line(Math.ceil(current.state.doc.lines / 2));
    current.dispatch({ selection: EditorSelection.cursor(middle.to), effects: EditorView.scrollIntoView(middle.to, { y: 'center' }) });
    await sleep(SETTLE_MS);
    const timings: FrameTiming[] = [];
    for (let index = 0; index < KEYSTROKES; index++) {
        await sleep(KEY_GAP_MS);
        const cursor = current.state.selection.main.head;
        const start = performance.now();
        current.dispatch({ changes: { from: cursor, insert: index % 6 === 5 ? ' ' : 'x' }, selection: EditorSelection.cursor(cursor + 1), userEvent: 'input.type' });
        timings.push(await measureFrame(start, performance.now()));
    }
    return timings;
}

function frameStats(timings: readonly FrameTiming[]): { latency: Stats; work: Stats } {
    return { latency: toStats(timings.map((timing) => timing.latency)), work: toStats(timings.map((timing) => timing.work)) };
}

// ---------- Weg (b): nspell im Worker ----------

interface WorkerStats {
    roundTripMs: number[];
    checkMs: number[];
    words: number[];
    lastErrors: number;
}

const workerStats: WorkerStats = { roundTripMs: [], checkMs: [], words: [], lastErrors: 0 };
const pendingSince = new Map<number, number>();
let nextRequestId = 1;

function handleResult(message: CheckResponse): void {
    const sentAt = pendingSince.get(message.id);
    pendingSince.delete(message.id);
    if (sentAt !== undefined) workerStats.roundTripMs.push(performance.now() - sentAt);
    workerStats.checkMs.push(message.checkMs);
    workerStats.words.push(message.words);
    workerStats.lastErrors = message.errors.length;
    // Veraltete Antworten (Text hat sich seitdem geändert) verwirft der echte Editor; hier nur die neueste anwenden.
    if (message.id === nextRequestId - 1) view?.dispatch({ effects: setSpellErrors.of(message.errors) });
}

function requestVisibleCheck(): void {
    if (worker === null || view === null) return;
    const ranges = view.visibleRanges;
    const visibleFrom = ranges[0]?.from ?? 0;
    const visibleTo = ranges[ranges.length - 1]?.to ?? 0;
    const firstLine = view.state.doc.lineAt(visibleFrom).number;
    const offset = view.state.doc.line(Math.max(1, firstLine - CONTEXT_LINES)).from;
    const id = nextRequestId++;
    pendingSince.set(id, performance.now());
    const request: WorkerRequest = { type: 'check', id, text: view.state.sliceDoc(offset, visibleTo), offset, visibleFrom, visibleTo };
    worker.postMessage(request);
}

function waitForMessage(target: Worker, type: WorkerResponse['type']): Promise<WorkerResponse> {
    return new Promise((resolve) => {
        const listener = (event: MessageEvent<WorkerResponse>): void => {
            if (event.data.type !== type) return;
            target.removeEventListener('message', listener);
            resolve(event.data);
        };
        target.addEventListener('message', listener);
    });
}

async function startWorker(name: string): Promise<{ ipcMs: number; buildMs: number; totalMs: number; dictionaryChars: number }> {
    const start = performance.now();
    const { aff, dic } = await window.spikeHost.loadDictionary(name);
    const ipcMs = performance.now() - start;
    worker?.terminate();
    worker = new Worker('./spell.worker.js');
    const loaded = waitForMessage(worker, 'loaded');
    worker.postMessage({ type: 'load', aff, dic } satisfies WorkerRequest);
    const message = await loaded;
    worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === 'result') handleResult(event.data);
    });
    const buildMs = message.type === 'loaded' ? message.buildMs : Number.NaN;
    return { ipcMs, buildMs, totalMs: performance.now() - start, dictionaryChars: aff.length + dic.length };
}

async function measureWorkerTyping(): Promise<object> {
    const current = activeView();
    const listener = EditorView.updateListener.of((update) => {
        if (update.docChanged || update.viewportChanged) requestVisibleCheck();
    });
    current.dispatch({ effects: StateEffect.appendConfig.of(listener) });
    workerStats.roundTripMs.length = 0;
    workerStats.checkMs.length = 0;
    workerStats.words.length = 0;
    const typing = frameStats(await typeKeystrokes());
    await sleep(SETTLE_MS);
    return { typing, roundTrip: toStats(workerStats.roundTripMs), check: toStats(workerStats.checkMs), words: toStats(workerStats.words), lastErrors: workerStats.lastErrors };
}

async function checkVisibleOnce(): Promise<{ roundTripMs: number; errorWords: string[] }> {
    if (worker === null) throw new Error('kein Worker');
    const result = waitForMessage(worker, 'result');
    const start = performance.now();
    requestVisibleCheck();
    await result;
    const roundTripMs = performance.now() - start;
    const current = activeView();
    const errorWords: string[] = [];
    current.state.field(spellErrorField).between(0, current.state.doc.length, (from, to) => {
        errorWords.push(current.state.sliceDoc(from, to));
    });
    return { roundTripMs, errorWords };
}

const spellSpike = {
    mode,
    withSyntaxAttributes,
    probeText: PROBE_TEXT,
    openProbe: (spellcheck: boolean): void => void openEditor(PROBE_TEXT, spellcheck),
    openDocument: (text: string, spellcheck: boolean): void => void openEditor(text, spellcheck),
    wordCenter,
    measureTyping: async (): Promise<object> => frameStats(await typeKeystrokes()),
    enableProvider: (): void => window.spikeHost.enableProvider(),
    providerWords: (): string[][] => window.spikeHost.providerWords(),
    startWorker,
    checkVisibleOnce,
    measureWorkerTyping,
    cursorToEnd: (): void => {
        const current = activeView();
        current.focus();
        current.dispatch({ selection: EditorSelection.cursor(current.state.doc.length) });
    },
    hasFocus: (): boolean => document.hasFocus(),
    heapMB: (): number => ((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / (1024 * 1024),
};

window.spellSpike = spellSpike;
