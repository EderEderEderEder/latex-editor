import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import type { StateCommand, Transaction, TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { scanFoldRegions } from '../../src/shared/core/latex/foldRegions';
import type { FoldRegion } from '../../src/shared/core/latex/foldRegions';
import {
    FOLD_SCAN_DELAY_MS, FoldScanScheduler, adoptFoldRegionsEffect, foldAll, foldAtCursor, foldSnapshotOf,
    foldingExtension, toggleFoldAtLine, unfoldAll, unfoldAtCursor, unfoldPlaceholderAt,
} from '../../src/renderer/editor/folding';
import type { FoldScanOptions, FoldScanTarget, FoldScanTimer } from '../../src/renderer/editor/folding';

// Einklappen ohne DOM: nur `EditorState`, Befehle über ein Ziel mit `state` und `dispatch`.

const TEX_PATH = '/p/kapitel.tex';
/** Wie `FoldingTests.swift`: Kopfzeile endet bei 14, Ausgeblendetes 14…27, „\chapter{Zwei}“ beginnt bei 28 */
const CHAPTERS = '\\chapter{Eins}\nerste\nzweite\n\\chapter{Zwei}\nletzte\n';
const HEADER_END = 14;
const HIDDEN_END = 27;
const NEXT_HEADING = 28;
const NESTED = '\\section{A}\n\\begin{x}\nb\n\\end{x}\nc\n';
const WITH_DOCUMENT = '\\begin{document}\n\\section{A}\na\n\\section{B}\nb\n\\end{document}\n';

/** Hält den aktuellen Zustand wie ein View; zählt Transaktionen */
class Holder implements FoldScanTarget {
    readonly transactions: Transaction[] = [];

    constructor(public state: EditorState) {}

    dispatch(spec: TransactionSpec): void {
        this.apply(this.state.update(spec));
    }

    apply(tr: Transaction): void {
        this.transactions.push(tr);
        this.state = tr.state;
    }

    run(command: StateCommand): boolean {
        return command({ state: this.state, dispatch: (tr) => this.apply(tr) });
    }

    toggle(line: number): boolean {
        return toggleFoldAtLine({ state: this.state, dispatch: (tr) => this.apply(tr) }, line);
    }

    select(anchor: number, head = anchor): void {
        this.dispatch({ selection: EditorSelection.single(anchor, head) });
    }
}

function adoptSpec(state: EditorState): TransactionSpec {
    const generation = foldSnapshotOf(state)?.generation ?? 0;
    return { effects: adoptFoldRegionsEffect.of({ regions: scanFoldRegions(state.doc.toString()), generation }) };
}

/** Zustand mit sofort übernommenen Bereichen (ohne auf den entprellten Scan zu warten) */
function scannedHolder(text: string, path = TEX_PATH): Holder {
    const holder = new Holder(EditorState.create({ doc: text, extensions: foldingExtension({ path }) }));
    if (foldSnapshotOf(holder.state) !== undefined) holder.dispatch(adoptSpec(holder.state));
    holder.transactions.length = 0;
    return holder;
}

function hidden(holder: Holder): { location: number; length: number }[] {
    return [...(foldSnapshotOf(holder.state)?.hiddenRanges ?? [])];
}

/** Bereiche der Platzhalter-Dekorationen, wie sie der View bekäme */
function placeholderRanges(state: EditorState): [number, number][] {
    const ranges: [number, number][] = [];
    for (const source of state.facet(EditorView.decorations)) {
        if (typeof source === 'function') continue;
        source.between(0, state.doc.length, (from, to) => {
            ranges.push([from, to]);
        });
    }
    return ranges;
}

function head(holder: Holder): number {
    return holder.state.selection.main.head;
}

describe('Einklappen: zu- und aufklappen', () => {
    it('Pfeil an der Kopfzeile klappt zu und wieder auf; der Text bleibt derselbe', () => {
        const holder = scannedHolder(CHAPTERS);
        const doc = holder.state.doc;
        expect(holder.toggle(0)).toBe(true);
        expect(hidden(holder)).toEqual([{ location: HEADER_END, length: HIDDEN_END - HEADER_END }]);
        expect(placeholderRanges(holder.state)).toEqual([[HEADER_END, HIDDEN_END]]);
        expect(holder.toggle(0)).toBe(true);
        expect(foldSnapshotOf(holder.state)?.hasFolds).toBe(false);
        expect(placeholderRanges(holder.state)).toEqual([]);
        expect(holder.state.doc).toBe(doc);
        expect(holder.transactions.every((tr) => !tr.docChanged)).toBe(true);
    });

    it('Zeile ohne Bereich: nichts passiert', () => {
        const holder = scannedHolder(CHAPTERS);
        expect(holder.toggle(1)).toBe(false);
        expect(holder.transactions).toEqual([]);
    });

    it('Klick auf den Platzhalter klappt auf', () => {
        const holder = scannedHolder(CHAPTERS);
        holder.toggle(0);
        const target = { state: holder.state, dispatch: (tr: Transaction) => holder.apply(tr) };
        expect(unfoldPlaceholderAt(target, HEADER_END)).toBe(true);
        expect(foldSnapshotOf(holder.state)?.hasFolds).toBe(false);
    });

    it('alles zu lässt `document` offen, alles auf öffnet alles; Text unverändert', () => {
        const holder = scannedHolder(WITH_DOCUMENT);
        expect(holder.run(foldAll)).toBe(true);
        expect(foldSnapshotOf(holder.state)?.folded).toHaveLength(2);
        expect(holder.state.doc.toString()).toBe(WITH_DOCUMENT);
        expect(holder.run(unfoldAll)).toBe(true);
        expect(foldSnapshotOf(holder.state)?.hasFolds).toBe(false);
        expect(holder.run(unfoldAll)).toBe(false);
        expect(holder.transactions.every((tr) => !tr.docChanged)).toBe(true);
    });

    it('Zuklappen am Cursor nimmt den innersten Bereich und setzt den Cursor an die Kopfzeile (wie Swift)', () => {
        const holder = scannedHolder(NESTED);
        holder.select(20);
        expect(holder.run(foldAtCursor)).toBe(true);
        expect(hidden(holder)).toEqual([{ location: 21, length: 10 }]);
        expect(head(holder)).toBe(20);
        holder.run(foldAtCursor);
        expect(foldSnapshotOf(holder.state)?.folded).toHaveLength(2);
        expect(head(holder)).toBe(11);
        holder.run(unfoldAtCursor);
        expect(foldSnapshotOf(holder.state)?.folded).toHaveLength(1);
        holder.run(unfoldAll);
        expect(foldSnapshotOf(holder.state)?.hasFolds).toBe(false);
    });

    it('jeder Zustand behält seine Faltung (kein geteilter veränderlicher Zustand)', () => {
        const holder = scannedHolder(CHAPTERS);
        const before = holder.state;
        holder.toggle(0);
        expect(foldSnapshotOf(before)?.hasFolds).toBe(false);
        const spec: TransactionSpec = { changes: { from: 0, insert: 'x' } };
        expect(foldSnapshotOf(holder.state.update(spec).state)?.hiddenRanges)
            .toEqual(foldSnapshotOf(holder.state.update(spec).state)?.hiddenRanges);
        expect(hidden(holder)).toEqual([{ location: HEADER_END, length: HIDDEN_END - HEADER_END }]);
    });

    it('.bib-Dateien haben kein Einklappen', () => {
        const holder = scannedHolder('@book{a,\n  title={T}\n}\n', '/p/quellen.bib');
        expect(foldSnapshotOf(holder.state)).toBeUndefined();
        expect(holder.run(foldAll)).toBe(false);
        expect(holder.toggle(0)).toBe(false);
    });
});

describe('Einklappen: Bearbeitungen', () => {
    it('Bearbeitung davor verschiebt den zugeklappten Bereich und die Bereiche', () => {
        const holder = scannedHolder(CHAPTERS);
        holder.toggle(0);
        holder.dispatch({ changes: { from: 0, insert: 'x' } });
        expect(hidden(holder)).toEqual([{ location: HEADER_END + 1, length: HIDDEN_END - HEADER_END }]);
        holder.dispatch({ changes: { from: 0, insert: 'neu\n' } });
        expect(foldSnapshotOf(holder.state)?.regions.map((region) => region.startLine)).toEqual([1, 4]);
        expect(hidden(holder)).toEqual([{ location: HEADER_END + 5, length: HIDDEN_END - HEADER_END }]);
        expect(placeholderRanges(holder.state)).toEqual([[HEADER_END + 5, HIDDEN_END + 5]]);
    });

    it('Tippen am Ende der Kopfzeile lässt zu, Ersetzen im Ausgeblendeten klappt auf (wie Swift)', () => {
        const holder = scannedHolder(CHAPTERS);
        holder.toggle(0);
        holder.dispatch({ changes: { from: HEADER_END, insert: ' x' }, userEvent: 'input.type' });
        expect(hidden(holder)[0]?.location).toBe(HEADER_END + 2);
        holder.dispatch({ changes: { from: 18, to: 20, insert: 'ZZ' } });
        expect(foldSnapshotOf(holder.state)?.hasFolds).toBe(false);
        expect(placeholderRanges(holder.state)).toEqual([]);
    });

    it('Rückschritt am Zeilenanfang hinter dem Bereich klappt vorher auf', () => {
        const holder = scannedHolder(CHAPTERS);
        holder.toggle(0);
        holder.dispatch({ changes: { from: HIDDEN_END, to: NEXT_HEADING }, userEvent: 'delete.backward' });
        expect(foldSnapshotOf(holder.state)?.hasFolds).toBe(false);
        expect(holder.state.doc.toString().startsWith('\\chapter{Eins}\nerste\nzweite\\chapter{Zwei}')).toBe(true);
    });

    it('Scan klappt auf, was keinen Bereich mehr hat', () => {
        const holder = scannedHolder(CHAPTERS);
        holder.toggle(3);
        const heading = '\\chapter{Zwei}';
        holder.dispatch({ changes: { from: NEXT_HEADING, to: NEXT_HEADING + heading.length, insert: 'Zwei' } });
        expect(foldSnapshotOf(holder.state)?.hasFolds).toBe(true);
        holder.dispatch(adoptSpec(holder.state));
        expect(foldSnapshotOf(holder.state)?.hasFolds).toBe(false);
    });
});

describe('Einklappen: Auswahl', () => {
    it('Cursor am Ende des Ausgeblendeten rückt an das Ende der Kopfzeile', () => {
        const holder = scannedHolder(CHAPTERS);
        holder.toggle(0);
        holder.select(3);
        holder.select(HIDDEN_END);
        expect(head(holder)).toBe(HEADER_END);
        expect(foldSnapshotOf(holder.state)?.hasFolds).toBe(true);
    });

    it('Sprung mitten hinein klappt auf, der Cursor bleibt dort', () => {
        const holder = scannedHolder(CHAPTERS);
        holder.toggle(0);
        holder.select(17);
        expect(foldSnapshotOf(holder.state)?.hasFolds).toBe(false);
        expect(head(holder)).toBe(17);
    });

    it('Pfeil rechts von der Kopfzeile geht hinter den Bereich, links wieder zurück', () => {
        const holder = scannedHolder(CHAPTERS);
        holder.toggle(0);
        holder.select(HEADER_END);
        holder.select(HIDDEN_END);
        expect(head(holder)).toBe(NEXT_HEADING);
        holder.select(HIDDEN_END);
        expect(head(holder)).toBe(HEADER_END);
        expect(foldSnapshotOf(holder.state)?.hasFolds).toBe(true);
    });

    it('mit Umschalt wird der Bereich in einem Schritt markiert', () => {
        const holder = scannedHolder(CHAPTERS);
        holder.toggle(0);
        holder.select(HEADER_END);
        holder.select(HEADER_END, HIDDEN_END);
        expect(holder.state.selection.main).toMatchObject({ anchor: HEADER_END, head: NEXT_HEADING });
        expect(foldSnapshotOf(holder.state)?.hasFolds).toBe(true);
    });

    it('Auswahl mit einem Rand im Ausgeblendeten klappt auf', () => {
        const holder = scannedHolder(CHAPTERS);
        holder.toggle(0);
        holder.select(2, 18);
        expect(foldSnapshotOf(holder.state)?.hasFolds).toBe(false);
        expect(holder.state.selection.main).toMatchObject({ anchor: 2, head: 18 });
    });
});

interface PendingTimer {
    readonly callback: () => void;
    readonly delayMs: number;
}

class FakeTimer implements FoldScanTimer {
    readonly pending = new Map<number, PendingTimer>();
    private nextId = 1;

    setTimeout(callback: () => void, delayMs: number): unknown {
        const id = this.nextId++;
        this.pending.set(id, { callback, delayMs });
        return id;
    }

    clearTimeout(handle: unknown): void {
        this.pending.delete(handle as number);
    }

    fireAll(): void {
        const due = [...this.pending.values()];
        this.pending.clear();
        for (const timer of due) timer.callback();
    }
}

function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

function schedulerFor(text: string, options: FoldScanOptions) {
    const holder = new Holder(EditorState.create({ doc: text, extensions: foldingExtension({ path: TEX_PATH }) }));
    return { holder, scheduler: new FoldScanScheduler(holder, options) };
}

describe('Einklappen: Scan entprellt', () => {
    it('mehrere Änderungen hintereinander: ein Scan nach der Wartezeit', async () => {
        const timer = new FakeTimer();
        const scanned: string[] = [];
        const scan = (text: string): FoldRegion[] => {
            scanned.push(text);
            return scanFoldRegions(text);
        };
        const { holder, scheduler } = schedulerFor(CHAPTERS, { timer, scan });
        scheduler.scanSoon();
        scheduler.scanSoon();
        scheduler.scanSoon();
        expect([...timer.pending.values()].map((pending) => pending.delayMs)).toEqual([FOLD_SCAN_DELAY_MS]);
        expect(scanned).toEqual([]);
        timer.fireAll();
        await flushMicrotasks();
        expect(scanned).toEqual([CHAPTERS]);
        expect(foldSnapshotOf(holder.state)?.regions.map((region) => region.startLine)).toEqual([0, 3]);
    });

    it('beim Anzeigen sofort scannen, aber nur, wenn seit dem letzten Scan bearbeitet wurde', async () => {
        const timer = new FakeTimer();
        const { holder, scheduler } = schedulerFor(CHAPTERS, { timer });
        scheduler.scanIfNeeded();
        expect([...timer.pending.values()].map((pending) => pending.delayMs)).toEqual([0]);
        timer.fireAll();
        await flushMicrotasks();
        expect(foldSnapshotOf(holder.state)?.regions).toHaveLength(2);
        new FoldScanScheduler(holder, { timer }).scanIfNeeded();
        expect(timer.pending.size).toBe(0);
    });

    it('nach dem Auflösen kein Zeitgeber mehr, kein Scan', async () => {
        const timer = new FakeTimer();
        const { holder, scheduler } = schedulerFor(CHAPTERS, { timer });
        scheduler.scanSoon();
        scheduler.dispose();
        expect(timer.pending.size).toBe(0);
        scheduler.scanSoon();
        expect(timer.pending.size).toBe(0);
        await flushMicrotasks();
        expect(foldSnapshotOf(holder.state)?.regions).toEqual([]);
    });
});

describe('Einklappen: veraltete Scans', () => {
    it('Bearbeitung während des Scans: Ergebnis wird verworfen', async () => {
        const timer = new FakeTimer();
        let finish: (regions: readonly FoldRegion[]) => void = () => undefined;
        const scan = (): Promise<readonly FoldRegion[]> => new Promise((resolve) => {
            finish = resolve;
        });
        const { holder, scheduler } = schedulerFor(CHAPTERS, { timer, scan });
        scheduler.scanSoon();
        timer.fireAll();
        holder.dispatch({ changes: { from: 0, insert: 'x' } });
        finish(scanFoldRegions(CHAPTERS));
        await flushMicrotasks();
        expect(foldSnapshotOf(holder.state)?.regions).toEqual([]);
        expect(holder.transactions.some((tr) => tr.effects.some((effect) => effect.is(adoptFoldRegionsEffect)))).toBe(false);
    });

    it('das Zustandsfeld übernimmt kein Ergebnis mit alter `generation`', () => {
        const holder = scannedHolder('');
        const stale = foldSnapshotOf(holder.state)?.generation ?? 0;
        holder.dispatch({ changes: { from: 0, insert: CHAPTERS } });
        holder.dispatch({ effects: adoptFoldRegionsEffect.of({ regions: scanFoldRegions(CHAPTERS), generation: stale }) });
        expect(foldSnapshotOf(holder.state)?.regions).toEqual([]);
        holder.dispatch(adoptSpec(holder.state));
        expect(foldSnapshotOf(holder.state)?.regions).toHaveLength(2);
    });
});
