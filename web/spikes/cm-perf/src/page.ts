// Messseite: Knopf für den Handlauf (Windows) und `window.cmPerf` für den Playwright-Treiber.
import { generateDocument } from './documentGenerator';
import { afterNextFrame, closeView, idleFrameIntervalMs, openForInspection, runOne } from './measure';
import { EditorView } from '@codemirror/view';
import type { RunResult, VariantName } from './measure';
import { summarize } from './summary';

const SIZES: readonly number[] = [10_000, 50_000];
const VARIANTS: readonly VariantName[] = ['plain', 'stream', 'viewPlugin'];
const DEFAULT_RUNS = 5;

const documents = new Map<number, string>();

function documentWithLines(lines: number): string {
    const cached = documents.get(lines);
    if (cached !== undefined) return cached;
    const text = generateDocument(lines);
    documents.set(lines, text);
    return text;
}

function editorParent(): HTMLElement {
    const parent = document.getElementById('editor');
    if (parent === null) throw new Error('Element #editor fehlt');
    return parent;
}

function runVariant(variant: VariantName, lines: number): Promise<RunResult> {
    return runOne(variant, documentWithLines(lines), lines, editorParent());
}

/** Reihenfolge der Varianten je Lauf drehen, damit keine immer zuerst (kalt) läuft. */
function rotated<T>(items: readonly T[], offset: number): T[] {
    return items.map((_item, index) => items[(index + offset) % items.length] as T);
}

function setStatus(text: string): void {
    const status = document.getElementById('status');
    if (status !== null) status.textContent = text;
}

async function runAll(runs: number): Promise<string> {
    const results: RunResult[] = [];
    for (let run = 0; run < runs; run++) {
        for (const lines of SIZES) {
            for (const variant of rotated(VARIANTS, run)) {
                setStatus(`Lauf ${run + 1}/${runs}: ${variant}, ${lines} Zeilen …`);
                results.push(await runVariant(variant, lines));
            }
        }
    }
    closeView();
    const idleFrame = await idleFrameIntervalMs();
    return `${navigator.userAgent}\nRahmenabstand ohne Arbeit: ${idleFrame.toFixed(2)} ms\n\n${summarize(results)}`;
}

function installButton(): void {
    const button = document.getElementById('start');
    const output = document.getElementById('output');
    button?.addEventListener('click', () => {
        button.setAttribute('disabled', 'true');
        void runAll(DEFAULT_RUNS).then((text) => {
            if (output !== null) output.textContent = text;
            setStatus('Fertig. Tabelle unten kopieren.');
        });
    });
}

/** Öffnet ohne Messung; `jumpToEnd()` springt ans Dokumentende (für die Prüfung der Einfärbung). */
async function inspect(variant: VariantName, lines: number): Promise<void> {
    const view = await openForInspection(variant, documentWithLines(lines), editorParent());
    inspectedView = view;
}

let inspectedView: EditorView | null = null;

function jumpToEnd(): void {
    const view = inspectedView;
    if (view === null) return;
    const end = view.state.doc.length;
    view.dispatch({ selection: { anchor: end }, effects: EditorView.scrollIntoView(end) });
}

function highlightedSpanCount(): number {
    return document.querySelectorAll('.cm-line span').length;
}

const COLOR_TIMEOUT_MS = 5000;
const EDIT_SETTLE_MS = 500;

/** Öffnen, Ruhezeit, ein Zeichen am Anfang tippen, sofort ans Ende springen: ms bis das Ende eingefärbt ist. */
async function colorDelayAfterEditAndJump(variant: VariantName, lines: number): Promise<number> {
    await inspect(variant, lines);
    await new Promise((resolve) => setTimeout(resolve, EDIT_SETTLE_MS));
    inspectedView?.dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' });
    await afterNextFrame();
    const start = performance.now();
    jumpToEnd();
    while (performance.now() - start < COLOR_TIMEOUT_MS) {
        await afterNextFrame();
        if (highlightedSpanCount() > 0) return performance.now() - start;
    }
    return Number.NaN;
}

const api = { runVariant, closeView, idleFrameIntervalMs, summarize, inspect, jumpToEnd, highlightedSpanCount, colorDelayAfterEditAndJump };

declare global {
    interface Window {
        cmPerf: typeof api;
    }
}

window.cmPerf = api;
installButton();
