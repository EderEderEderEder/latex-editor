import { EditorState, Compartment } from '@codemirror/state';
import type { Extension, TransactionSpec } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
    DiagnosticsDriver,
    DiagnosticsHub,
    diagnosticsEnabled,
    diagnosticsExtension,
    diagnosticsOf,
} from '../../src/renderer/editor/diagnostics';
import type {
    DiagnosticsClient,
    DiagnosticsClientFactory,
    DiagnosticsDriverSettings,
} from '../../src/renderer/editor/diagnostics';
import type { AnalysisTimer } from '../../src/renderer/workers/analysisClient';
import type { TextMark } from '../../src/shared/core/latex/syntaxChecker';

const DEBOUNCE_MS = 600;
const IDLE_MS = 30_000;
const PATH = '/projekt/kapitel.tex';

class FakeTimer implements AnalysisTimer {
    now = 0;
    private nextHandle = 1;
    private readonly scheduled = new Map<number, { at: number; callback: () => void }>();

    set(callback: () => void, delayMs: number): unknown {
        const handle = this.nextHandle++;
        this.scheduled.set(handle, { at: this.now + delayMs, callback });
        return handle;
    }

    clear(handle: unknown): void {
        this.scheduled.delete(handle as number);
    }

    advance(ms: number): void {
        this.now += ms;
        for (const [handle, entry] of [...this.scheduled]) {
            if (entry.at > this.now) continue;
            this.scheduled.delete(handle);
            entry.callback();
        }
    }
}

interface Request {
    readonly docId: string;
    readonly version: number;
    readonly text: string;
}

class FakeClient implements DiagnosticsClient {
    readonly requests: Request[] = [];
    disposed = false;

    constructor(readonly onMarks: (docId: string, version: number, marks: readonly TextMark[]) => void) {}

    requestCheck(docId: string, version: number, text: string): void {
        this.requests.push({ docId, version, text });
    }

    dispose(): void {
        this.disposed = true;
    }

    /** Antwort auf die letzte Anfrage */
    replyToLast(marks: readonly TextMark[]): void {
        const last = this.requests[this.requests.length - 1];
        if (last === undefined) throw new Error('keine Anfrage');
        this.onMarks(last.docId, last.version, marks);
    }
}

/** Ein Editor ohne DOM: Zustand + Treiber, `type` verhält sich wie eine Eingabe im View */
class Harness {
    readonly timer = new FakeTimer();
    readonly clients: FakeClient[] = [];
    readonly hub: DiagnosticsHub;
    readonly driver: DiagnosticsDriver;
    state: EditorState;

    constructor(text: string, enabled?: boolean, extra: Extension[] = []) {
        const factory: DiagnosticsClientFactory = (callbacks) => {
            const client = new FakeClient((docId, version, marks) => callbacks.onMarks?.(docId, version, marks));
            this.clients.push(client);
            return client;
        };
        this.hub = new DiagnosticsHub(factory, this.timer);
        const options = { hub: this.hub, timer: this.timer, enabled };
        this.state = EditorState.create({ doc: text, extensions: [...extra, diagnosticsExtension({ path: PATH }, options)] });
        const settings: DiagnosticsDriverSettings = {
            docId: PATH, hub: this.hub, timer: this.timer, debounceMs: DEBOUNCE_MS,
        };
        this.driver = new DiagnosticsDriver(this, settings);
    }

    get client(): FakeClient {
        const client = this.clients[this.clients.length - 1];
        if (client === undefined) throw new Error('kein Client');
        return client;
    }

    dispatch(spec: TransactionSpec): void {
        const tr = this.state.update(spec);
        const startState = this.state;
        this.state = tr.state;
        this.driver.handleUpdate(startState, tr.state);
    }

    type(at: number, insert: string, to = at): void {
        this.dispatch({ changes: { from: at, to, insert } });
    }
}

const ERROR: TextMark = { severity: 'error', start: 5, end: 10, message: 'Klammer nicht geschlossen' };
const WARNING: TextMark = { severity: 'warning', start: 12, end: 14, message: 'Warnung' };
const HINT: TextMark = { severity: 'hint', start: 0, end: 3, message: 'Hinweis' };
const TEXT = '0123456789abcdefghij';

describe('diagnostics', () => {
    it('fragt beim Aufbau einmal an, Meldungen erscheinen nach der Antwort', () => {
        const h = new Harness(TEXT);
        expect(h.client.requests).toHaveLength(1);
        expect(h.client.requests[0]).toMatchObject({ docId: PATH, text: TEXT });
        h.client.replyToLast([ERROR, WARNING, HINT]);
        expect(diagnosticsOf(h.state)).toEqual([HINT, ERROR, WARNING]);
    });

    it('mappt Meldungen beim Tippen mit, bis die neue Analyse eintrifft', () => {
        const h = new Harness(TEXT);
        h.client.replyToLast([ERROR]);
        h.type(0, 'XYZ');
        expect(diagnosticsOf(h.state)).toEqual([{ ...ERROR, start: 8, end: 13 }]);
        h.type(11, '--');
        expect(diagnosticsOf(h.state)).toEqual([{ ...ERROR, start: 8, end: 15 }]);
    });

    it('entfernt eine Meldung, wenn ihr ganzer Text gelöscht wird', () => {
        const h = new Harness(TEXT);
        h.client.replyToLast([ERROR]);
        h.type(4, '', 11);
        expect(diagnosticsOf(h.state)).toEqual([]);
    });

    it('entprellt: Text wird erst nach 0,6 s ohne Änderung übergeben, nur der letzte Stand', () => {
        const h = new Harness(TEXT);
        h.client.replyToLast([]);
        h.type(0, 'a');
        h.timer.advance(DEBOUNCE_MS - 1);
        h.type(0, 'b');
        h.timer.advance(DEBOUNCE_MS - 1);
        expect(h.client.requests).toHaveLength(1);
        h.timer.advance(1);
        expect(h.client.requests).toHaveLength(2);
        expect(h.client.requests[1]?.text).toBe(`ba${TEXT}`);
    });

    it('ersetzt gemappte Meldungen durch die Antwort auf den neuen Stand', () => {
        const h = new Harness(TEXT);
        h.client.replyToLast([ERROR]);
        h.type(0, 'XYZ');
        h.timer.advance(DEBOUNCE_MS);
        h.client.replyToLast([WARNING]);
        expect(diagnosticsOf(h.state)).toEqual([WARNING]);
    });

    it('verwirft eine veraltete Antwort, die Meldungen bleiben die gemappten', () => {
        const h = new Harness(TEXT);
        h.client.replyToLast([ERROR]);
        h.type(0, 'a');
        h.timer.advance(DEBOUNCE_MS);
        const stale = h.client.requests[1];
        h.type(0, 'b');
        h.client.onMarks(PATH, stale?.version ?? -1, [WARNING]);
        expect(diagnosticsOf(h.state)).toEqual([{ ...ERROR, start: 7, end: 12 }]);
    });

    it('Version ist ein Zähler, nicht der Text: gleicher Text nach Undo-artiger Rückänderung bekommt neue Version', () => {
        const h = new Harness(TEXT);
        const first = h.client.requests[0]?.version ?? 0;
        h.client.replyToLast([]);
        h.type(0, 'a');
        h.type(0, '', 1);
        h.timer.advance(DEBOUNCE_MS);
        expect(h.client.requests[1]?.text).toBe(TEXT);
        expect(h.client.requests[1]?.version).toBeGreaterThan(first);
    });

    it('übersteht Meldungen hinter dem Textende und leere Bereiche', () => {
        const h = new Harness(TEXT);
        h.client.replyToLast([
            { severity: 'error', start: 18, end: 99, message: 'zu lang' },
            { severity: 'hint', start: 7, end: 7, message: 'leer' },
        ]);
        expect(diagnosticsOf(h.state)).toEqual([
            { severity: 'hint', start: 7, end: 8, message: 'leer' },
            { severity: 'error', start: 18, end: 20, message: 'zu lang' },
        ]);
    });

    it('deaktiviert: keine Anfragen, keine Meldungen', () => {
        const h = new Harness(TEXT, false);
        h.type(0, 'a');
        h.timer.advance(DEBOUNCE_MS);
        expect(h.clients).toHaveLength(0);
        expect(diagnosticsOf(h.state)).toEqual([]);
    });

    it('Ausschalten löscht Meldungen und bricht die Frist ab; Einschalten fragt sofort an', () => {
        const toggle = new Compartment();
        const h = new Harness(TEXT, undefined, [toggle.of(diagnosticsEnabled.of(true))]);
        h.client.replyToLast([ERROR]);
        h.type(0, 'a');
        h.dispatch({ effects: toggle.reconfigure(diagnosticsEnabled.of(false)) });
        expect(diagnosticsOf(h.state)).toEqual([]);
        h.timer.advance(DEBOUNCE_MS);
        expect(h.client.requests).toHaveLength(1);
        h.dispatch({ effects: toggle.reconfigure(diagnosticsEnabled.of(true)) });
        expect(h.client.requests).toHaveLength(2);
        expect(h.client.requests[1]?.text).toBe(`a${TEXT}`);
    });

    it('ignoriert Antworten nach destroy und meldet den Hörer ab', () => {
        const h = new Harness(TEXT);
        const { onMarks } = h.client;
        const request = h.client.requests[0];
        h.type(0, 'a');
        h.driver.destroy();
        h.timer.advance(DEBOUNCE_MS);
        expect(h.client.requests).toHaveLength(1);
        onMarks(PATH, request?.version ?? -1, [ERROR]);
        expect(diagnosticsOf(h.state)).toEqual([]);
    });

    it('Hub: beendet den Client erst nach der Leerlaufzeit, ein neuer Hörer rettet ihn', () => {
        const h = new Harness(TEXT);
        h.driver.destroy();
        h.timer.advance(IDLE_MS - 1);
        expect(h.client.disposed).toBe(false);
        const unsubscribe = h.hub.subscribe(PATH, () => undefined);
        h.timer.advance(IDLE_MS);
        expect(h.client.disposed).toBe(false);
        unsubscribe();
        h.timer.advance(IDLE_MS);
        expect(h.client.disposed).toBe(true);
    });

    it('Hub.dispose beendet den Client sofort; danach startet eine Anfrage einen neuen', () => {
        const h = new Harness(TEXT);
        const first = h.client;
        h.hub.dispose();
        expect(first.disposed).toBe(true);
        h.hub.requestCheck('x', 1, 'text');
        expect(h.clients).toHaveLength(2);
    });

    it('prüft BibTeX-Dateien nicht', () => {
        const state = EditorState.create({ doc: TEXT, extensions: [diagnosticsExtension({ path: '/p/lit.bib' })] });
        expect(diagnosticsOf(state)).toEqual([]);
    });
});
