// Messcode, der im Renderer läuft (`page.evaluate`). Jede Funktion wird einzeln serialisiert und muss daher in sich
// geschlossen sein; geteilt wird nur über `globalThis.__perf`. Die Node-Typprüfung kennt kein DOM, deshalb stehen
// hier schmale Schnittstellen statt der DOM-Typen.
//
// Zugriff auf den `EditorView`: `.cm-content` trägt `cmTile` (@codemirror/view 6.43, Version ist festgelegt). Der Zugriff
// ist nur für die Messung da: Er hängt sich in `dispatchTransactions`, um das Ende der synchronen Arbeit zu sehen.

export interface FrameTiming {
    readonly frameStart: number;
    readonly end: number;
}

/** work: synchroner Teil plus Rahmenarbeit ohne Warten auf den Rahmentakt; latency: Taste bis nach dem Paint */
export interface KeySample {
    readonly latency: number;
    readonly work: number;
}

export interface ScrollSamples {
    /** Arbeit je Rahmen ab Rahmenbeginn bis nach dem Paint */
    readonly work: readonly number[];
    /** Abstand der Rahmenbeginne */
    readonly gap: readonly number[];
}

export interface FoldScanSample {
    /** längste Hauptthread-Aufgabe zwischen Bearbeitung und Marke (der Scan) */
    readonly stallMs: number;
    /** Beginn dieser Aufgabe bis nach dem Paint des Rahmens, der die neue Marke zeigt */
    readonly frameMs: number;
    /** Bearbeitung bis nach dem Paint der neuen Marke (enthält die Entprellung) */
    readonly totalMs: number;
}

export interface SearchSample {
    readonly ms: number;
    readonly head: number;
}

interface Transaction {
    readonly docChanged: boolean;
}

interface ProbeElement {
    scrollTop: number;
    textContent: string | null;
    querySelectorAll(selector: string): ArrayLike<ProbeElement>;
}

interface ProbeView {
    readonly state: { readonly selection: { readonly main: { readonly head: number } } };
    readonly dom: ProbeElement;
    readonly scrollDOM: ProbeElement;
    dispatchTransactions: (transactions: readonly Transaction[], view: ProbeView) => void;
    dispatch(spec: unknown): void;
    posAtDOM(node: ProbeElement): number;
}

interface PerfHelpers {
    frame(): Promise<FrameTiming>;
    sleep(ms: number): Promise<void>;
    view(): ProbeView;
    keySamples: KeySample[];
    keyStart: number;
    keyArmed: boolean;
    searchStart: number;
    searchBefore: number;
    spin?: SpinLoop;
    foldResult?: Promise<FoldScanSample | null>;
}

interface ObserverHandle {
    observe(target: ProbeElement, options: { childList: boolean; subtree: boolean; attributes: boolean }): void;
    disconnect(): void;
}

interface ProbeChannel {
    readonly port1: { onmessage: (() => void) | null };
    readonly port2: { postMessage(data: null): void };
}

interface PerfScope {
    MessageChannel: new () => ProbeChannel;
    __perf?: PerfHelpers;
    __editorTestApi?: { open(path: string, text: string): void; activate(path: string): void };
    document: { querySelector(selector: string): unknown };
    addEventListener(type: 'keydown', listener: (event: { key: string }) => void, capture: boolean): void;
    requestAnimationFrame(callback: (frameStart: number) => void): number;
    MutationObserver: new (callback: () => void) => ObserverHandle;
}

type ViewHolder = { cmTile?: { root?: { view?: ProbeView } } };

const MISSING_VIEW = 'EditorView nicht gefunden (.cm-content hat kein cmTile)';

export function installHelpers(): void {
    const scope = globalThis as unknown as PerfScope;
    scope.__perf = {
        frame: () =>
            new Promise<FrameTiming>((resolve) => {
                scope.requestAnimationFrame((frameStart) => {
                    const channel = new scope.MessageChannel();
                    channel.port1.onmessage = () => resolve({ frameStart, end: performance.now() });
                    channel.port2.postMessage(null);
                });
            }),
        sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
        view: () => {
            const content = scope.document.querySelector('.cm-content') as ViewHolder | null;
            const view = content?.cmTile?.root?.view;
            if (view === undefined) throw new Error(MISSING_VIEW);
            return view;
        },
        keySamples: [],
        keyStart: 0,
        keyArmed: false,
        searchStart: 0,
        searchBefore: 0,
    };
}

/** Taste (keydown) bis nach dem Paint; Ende der synchronen Arbeit ist das Ende des ersten Dispatch mit Textänderung */
export function installKeyProbe(): void {
    const scope = globalThis as unknown as PerfScope;
    const perf = scope.__perf as PerfHelpers;
    const view = perf.view();
    const original = view.dispatchTransactions;
    scope.addEventListener('keydown', () => {
        perf.keyStart = performance.now();
        perf.keyArmed = true;
    }, true);
    view.dispatchTransactions = (transactions, target) => {
        original(transactions, target);
        const syncEnd = performance.now();
        if (!perf.keyArmed || !transactions.some((transaction) => transaction.docChanged)) return;
        perf.keyArmed = false;
        const start = perf.keyStart;
        void perf.frame().then(({ frameStart, end }) => {
            perf.keySamples.push({ latency: end - start, work: syncEnd - start + (end - Math.max(frameStart, syncEnd)) });
        });
    };
}

export function takeKeySamples(): KeySample[] {
    const perf = (globalThis as unknown as PerfScope).__perf as PerfHelpers;
    return perf.keySamples.splice(0, perf.keySamples.length);
}

/** Dokument setzen und anzeigen, Zeit bis nach dem ersten Paint */
export async function measureOpen(args: { path: string; text: string }): Promise<number> {
    const scope = globalThis as unknown as PerfScope;
    const perf = scope.__perf as PerfHelpers;
    const api = scope.__editorTestApi;
    if (api === undefined) throw new Error('window.__editorTestApi fehlt');
    const start = performance.now();
    api.open(args.path, args.text);
    api.activate(args.path);
    await perf.frame();
    return performance.now() - start;
}

/** Rahmen für Rahmen um `stepPx` nach unten, ab dem oberen Rand; wie `measureScroll` im Spike S1 */
export function measureScroll(args: { frames: number; stepPx: number }): Promise<ScrollSamples> {
    const scope = globalThis as unknown as PerfScope;
    const scroller = (scope.__perf as PerfHelpers).view().scrollDOM;
    scroller.scrollTop = 0;
    return new Promise((resolve) => {
        const work: number[] = [];
        const gap: number[] = [];
        let previous = -1;
        const tick = (frameStart: number): void => {
            if (work.length >= args.frames) {
                resolve({ work, gap });
                return;
            }
            const channel = new scope.MessageChannel();
            channel.port1.onmessage = () => {
                if (previous >= 0) {
                    work.push(performance.now() - frameStart);
                    gap.push(frameStart - previous);
                }
                previous = frameStart;
            };
            channel.port2.postMessage(null);
            scroller.scrollTop += args.stepPx;
            scope.requestAnimationFrame(tick);
        };
        scope.requestAnimationFrame(tick);
    });
}

/** Merkt Zeit und Cursor beim Drücken von Enter (im Suchfeld: springt zum nächsten Treffer) */
export function armSearch(): void {
    const scope = globalThis as unknown as PerfScope;
    const perf = scope.__perf as PerfHelpers;
    scope.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        perf.searchStart = performance.now();
        perf.searchBefore = perf.view().state.selection.main.head;
    }, true);
}

/** Wartet, bis sich der Cursor bewegt hat, und dann bis nach dem Paint; -1, wenn nichts passiert */
export async function awaitSearchHit(timeoutMs: number): Promise<SearchSample> {
    const perf = (globalThis as unknown as PerfScope).__perf as PerfHelpers;
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
        const head = perf.view().state.selection.main.head;
        if (head !== perf.searchBefore) {
            const { end } = await perf.frame();
            return { ms: end - perf.searchStart, head };
        }
        await perf.frame();
    }
    return { ms: -1, head: -1 };
}

/** Anzahl der Meldungen (Unterstreichungen) im sichtbaren Text */
export function countVisibleDiagnostics(): number {
    const scope = globalThis as unknown as PerfScope;
    const content = scope.document.querySelector('.cm-content') as ProbeElement | null;
    return content?.querySelectorAll('[class*="cm-diagnostic"]').length ?? 0;
}

interface SpinLoop {
    stamps: number[];
    running: boolean;
    start(): void;
    stop(): void;
    longestGap(): { gap: number; startedAt: number };
}

/** Nachrichtenschleife ohne Pause: die längste Lücke zwischen zwei Nachrichten ist die längste Hauptthread-Aufgabe */
export function installSpinLoop(): void {
    const scope = globalThis as unknown as PerfScope;
    const channel = new scope.MessageChannel();
    const spin: SpinLoop = {
        stamps: [],
        running: false,
        start: () => {
            spin.stamps.length = 0;
            spin.running = true;
            channel.port2.postMessage(null);
        },
        stop: () => {
            spin.running = false;
        },
        longestGap: () => {
            let result = { gap: 0, startedAt: spin.stamps[0] ?? 0 };
            for (let index = 1; index < spin.stamps.length; index++) {
                const gap = (spin.stamps[index] as number) - (spin.stamps[index - 1] as number);
                if (gap > result.gap) result = { gap, startedAt: spin.stamps[index - 1] as number };
            }
            return result;
        },
    };
    channel.port1.onmessage = () => {
        spin.stamps.push(performance.now());
        if (spin.running) channel.port2.postMessage(null);
    };
    (scope.__perf as PerfHelpers).spin = spin;
}

/**
 * Fügt eine Überschrift in den sichtbaren Text ein; das Ergebnis (`awaitFoldScan`) ist die Zeit, bis die neue
 * Einklapp-Marke steht. Der Scan läuft nach der Entprellung als eine Hauptthread-Aufgabe.
 */
export function startFoldScan(args: { insert: string; spinAfterMs: number; timeoutMs: number }): boolean {
    const scope = globalThis as unknown as PerfScope;
    const perf = scope.__perf as PerfHelpers;
    const spin = perf.spin as SpinLoop;
    const view = perf.view();
    const line = Array.from(view.dom.querySelectorAll('.cm-line')).find((element) => /^[a-zA-Z].{39}/.test(element.textContent ?? ''));
    if (line === undefined) return false;
    const markersBefore = view.dom.querySelectorAll('.cm-fold-marker').length;
    const start = performance.now();
    perf.foldResult = new Promise((resolve) => {
        const observer = new scope.MutationObserver(() => {
            if (!spin.running || view.dom.querySelectorAll('.cm-fold-marker').length <= markersBefore) return;
            observer.disconnect();
            spin.stop();
            void perf.frame().then(({ end }) => {
                const { gap, startedAt } = spin.longestGap();
                resolve({ stallMs: gap, frameMs: end - startedAt, totalMs: end - start });
            });
        });
        observer.observe(view.dom, { childList: true, subtree: true, attributes: false });
        setTimeout(spin.start, args.spinAfterMs);
        setTimeout(() => {
            if (spin.running) { observer.disconnect(); spin.stop(); resolve(null); }
        }, args.timeoutMs);
    });
    view.dispatch({ changes: { from: view.posAtDOM(line), insert: args.insert } });
    return true;
}

export function awaitFoldScan(): Promise<FoldScanSample | null> {
    const perf = (globalThis as unknown as PerfScope).__perf as PerfHelpers;
    return perf.foldResult ?? Promise.resolve(null);
}
