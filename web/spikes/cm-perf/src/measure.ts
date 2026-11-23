// Messungen im Renderer. Zeiten mit performance.now(); "bis nächster Rahmen" heißt:
// requestAnimationFrame und danach eine MessageChannel-Nachricht (läuft nach Layout und Paint).
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import type { Extension, TransactionSpec } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import { streamLanguageExtension } from './streamVariant';
import { viewPluginExtension } from './viewPluginVariant';

export type VariantName = 'plain' | 'stream' | 'viewPlugin';

export interface Stats {
    p50: number;
    p95: number;
    max: number;
}

/** latency: bis nach dem Paint des nächsten Rahmens (inklusive Warten auf VSync); work: nur Hauptthread-Arbeit. */
export interface FrameStats {
    latency: Stats;
    work: Stats;
}

export interface RunResult {
    variant: VariantName;
    lines: number;
    openMs: number;
    keyMid: FrameStats;
    keyStart: FrameStats;
    keyDollar: FrameStats;
    scroll: FrameStats;
    jumpEndMs: number;
    heapDeltaMB: number;
    isGcExposed: boolean;
}

interface FrameTiming {
    latency: number;
    work: number;
}

const KEYSTROKES = 100;
const KEY_GAP_MS = 40;
const SETTLE_MS = 500;
const SETTLE_FRAMES = 3;
const SCROLL_FRAMES = 120;
const SCROLL_STEP_PX = 400;
const MIN_PROSE_LENGTH = 40;
const MID_LINE_OFFSET = 20;
const IDLE_FRAME_SAMPLES = 30;
const BYTES_PER_MB = 1024 * 1024;
const PERCENTILE_50 = 0.5;
const PERCENTILE_95 = 0.95;

interface ChromiumMemory {
    usedJSHeapSize: number;
}

export function afterNextFrame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => resolve();
            channel.port2.postMessage(null);
        });
    });
}

/**
 * Wartet bis nach dem Paint des nächsten Rahmens. Arbeit = synchroner Teil (start..syncEnd)
 * plus Rahmenarbeit ab Rahmenbeginn (rAF-Zeitstempel) bis nach dem Paint; das Warten dazwischen zählt nicht.
 */
function measureFrame(start: number, syncEnd: number): Promise<FrameTiming> {
    return new Promise((resolve) => {
        requestAnimationFrame((frameStart) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => {
                const end = performance.now();
                resolve({ latency: end - start, work: syncEnd - start + (end - Math.max(frameStart, syncEnd)) });
            };
            channel.port2.postMessage(null);
        });
    });
}

function toFrameStats(timings: FrameTiming[]): FrameStats {
    return { latency: toStats(timings.map((timing) => timing.latency)), work: toStats(timings.map((timing) => timing.work)) };
}

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function settle(): Promise<void> {
    for (let index = 0; index < SETTLE_FRAMES; index++) await afterNextFrame();
    await sleep(SETTLE_MS);
}

function percentile(sorted: number[], fraction: number): number {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
    return sorted[index] ?? Number.NaN;
}

export function toStats(values: number[]): Stats {
    const sorted = [...values].sort((left, right) => left - right);
    return {
        p50: percentile(sorted, PERCENTILE_50),
        p95: percentile(sorted, PERCENTILE_95),
        max: sorted[sorted.length - 1] ?? Number.NaN,
    };
}

function isGcExposed(): boolean {
    return typeof (globalThis as { gc?: () => void }).gc === 'function';
}

function heapBytes(): number {
    const gc = (globalThis as { gc?: () => void }).gc;
    gc?.();
    const memory = (performance as unknown as { memory?: ChromiumMemory }).memory;
    return memory?.usedJSHeapSize ?? Number.NaN;
}

function variantExtension(variant: VariantName): Extension {
    if (variant === 'stream') return streamLanguageExtension();
    if (variant === 'viewPlugin') return viewPluginExtension();
    return [];
}

/** Grundausstattung wie im späteren Editor (Zeilennummern, Umbruch, Verlauf, Auswahl). */
function baseExtensions(): Extension {
    return [
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
    ];
}

async function openView(variant: VariantName, text: string, parent: HTMLElement): Promise<{ view: EditorView; openMs: number }> {
    const start = performance.now();
    const state = EditorState.create({ doc: text, extensions: [baseExtensions(), variantExtension(variant)] });
    const view = new EditorView({ state, parent });
    await afterNextFrame();
    return { view, openMs: performance.now() - start };
}

/** Erste Fließtextzeile ab der Dokumentmitte (kein Befehl, kein Kommentar, keine Einrückung). */
function middleProsePosition(view: EditorView): number {
    const doc = view.state.doc;
    for (let number = Math.floor(doc.lines / 2); number <= doc.lines; number++) {
        const line = doc.line(number);
        if (line.length >= MIN_PROSE_LENGTH && /^[a-zA-Z]/.test(line.text)) return line.from + MID_LINE_OFFSET;
    }
    return Math.floor(doc.length / 2);
}

async function moveCursor(view: EditorView, position: number): Promise<void> {
    view.dispatch({
        selection: EditorSelection.cursor(position),
        effects: EditorView.scrollIntoView(position, { y: 'center' }),
    });
    await settle();
}

async function measureKeystrokes(view: EditorView, makeSpec: (index: number) => TransactionSpec): Promise<FrameStats> {
    const timings: FrameTiming[] = [];
    for (let index = 0; index < KEYSTROKES; index++) {
        await sleep(KEY_GAP_MS);
        const start = performance.now();
        view.dispatch(makeSpec(index));
        timings.push(await measureFrame(start, performance.now()));
    }
    return toFrameStats(timings);
}

function typeCharacterSpec(view: EditorView): TransactionSpec {
    const cursor = view.state.selection.main.head;
    return { changes: { from: cursor, insert: 'x' }, selection: EditorSelection.cursor(cursor + 1), userEvent: 'input.type' };
}

/** Abwechselnd `$` einfügen (öffnet Mathe bis Absatzende) und wieder löschen. */
function toggleDollarSpec(view: EditorView, position: number, index: number): TransactionSpec {
    if (index % 2 === 0) return { changes: { from: position, insert: '$' }, userEvent: 'input.type' };
    return { changes: { from: position, to: position + 1 }, userEvent: 'delete.backward' };
}

/** latency = Abstand der Rahmen, work = Arbeit des Rahmens ab Rahmenbeginn bis nach dem Paint. */
function measureScroll(view: EditorView): Promise<FrameStats> {
    view.scrollDOM.scrollTop = 0;
    return new Promise((resolve) => {
        const timings: FrameTiming[] = [];
        let previous = -1;
        const channel = new MessageChannel();
        const tick = (frameStart: number): void => {
            if (timings.length >= SCROLL_FRAMES) {
                resolve(toFrameStats(timings));
                return;
            }
            channel.port1.onmessage = () => {
                if (previous >= 0) timings.push({ latency: frameStart - previous, work: performance.now() - frameStart });
                previous = frameStart;
            };
            channel.port2.postMessage(null);
            view.scrollDOM.scrollTop += SCROLL_STEP_PX;
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
}

async function measureJumpToEnd(view: EditorView): Promise<number> {
    const end = view.state.doc.length;
    const start = performance.now();
    view.dispatch({ selection: EditorSelection.cursor(end), effects: EditorView.scrollIntoView(end) });
    await afterNextFrame();
    await afterNextFrame();
    return performance.now() - start;
}

let currentView: EditorView | null = null;

export function closeView(): void {
    currentView?.destroy();
    currentView = null;
}

/** Ein kompletter Lauf für eine Variante und ein Dokument; die Ansicht bleibt bis `closeView` offen. */
export async function runOne(variant: VariantName, text: string, lines: number, parent: HTMLElement): Promise<RunResult> {
    closeView();
    await settle();
    const heapBefore = heapBytes();
    const { view, openMs } = await openView(variant, text, parent);
    currentView = view;
    await settle();
    const heapDeltaMB = (heapBytes() - heapBefore) / BYTES_PER_MB;
    await moveCursor(view, 0);
    const keyStart = await measureKeystrokes(view, () => typeCharacterSpec(view));
    const middle = middleProsePosition(view);
    await moveCursor(view, middle);
    const keyMid = await measureKeystrokes(view, () => typeCharacterSpec(view));
    const lineStart = view.state.doc.lineAt(middle).from;
    const keyDollar = await measureKeystrokes(view, (index) => toggleDollarSpec(view, lineStart, index));
    await settle();
    const scroll = await measureScroll(view);
    await settle();
    const jumpEndMs = await measureJumpToEnd(view);
    return { variant, lines, openMs, keyMid, keyStart, keyDollar, scroll, jumpEndMs, heapDeltaMB, isGcExposed: isGcExposed() };
}

/** Nur öffnen (ohne Messung), um Einfärbung und Verhalten von Hand oder per Treiber zu prüfen. */
export async function openForInspection(variant: VariantName, text: string, parent: HTMLElement): Promise<EditorView> {
    closeView();
    currentView = (await openView(variant, text, parent)).view;
    return currentView;
}

/** Rahmenabstand ohne Arbeit: zeigt, ob die Bildratenbegrenzung wirklich aus ist. */
export async function idleFrameIntervalMs(): Promise<number> {
    const samples: number[] = [];
    let previous = performance.now();
    for (let index = 0; index < IDLE_FRAME_SAMPLES; index++) {
        await new Promise<number>((resolve) => requestAnimationFrame(resolve));
        const now = performance.now();
        samples.push(now - previous);
        previous = now;
    }
    return toStats(samples).p50;
}
