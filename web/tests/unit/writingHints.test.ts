import { EditorState } from '@codemirror/state';
import type { TransactionSpec } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
    WritingDriver, WritingHub, onWritingResult, wordCountOf, writingHintsExtension, writingHintsOf,
} from '../../src/renderer/editor/writingHints';
import type { WritingClient, WritingClientFactory, WritingSettings } from '../../src/renderer/editor/writingHints';
import type { AnalysisTimer } from '../../src/renderer/workers/analysisClient';
import type { WritingResult } from '../../src/renderer/workers/analysisLogic';
import type { WritingHint } from '../../src/shared/core/latex/writingHints';

const DEBOUNCE_MS = 600;
const IDLE_MS = 30_000;
const PATH = '/projekt/kapitel.tex';
const TEXT = 'Das das ist doppelt.';

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
    readonly includeHints: boolean;
}

class FakeClient implements WritingClient {
    readonly requests: Request[] = [];
    disposed = false;

    constructor(readonly onWriting: (docId: string, version: number, result: WritingResult) => void) {}

    requestWriting(docId: string, version: number, text: string, includeHints: boolean): void {
        this.requests.push({ docId, version, text, includeHints });
    }

    dispose(): void {
        this.disposed = true;
    }

    replyToLast(result: WritingResult): void {
        const last = this.requests[this.requests.length - 1];
        if (last === undefined) throw new Error('keine Anfrage');
        this.onWriting(last.docId, last.version, result);
    }
}

class FakeSettings implements WritingSettings {
    enabled = true;
    private readonly listeners = new Set<() => void>();

    isEnabled(): boolean {
        return this.enabled;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}

const REPEATED: WritingHint = { kind: 'repeatedWord', start: 4, end: 7, message: '„das“ steht zweimal hintereinander.' };
const RESULT: WritingResult = { hints: [REPEATED], words: 3 };

/** Ein Editor ohne DOM: Zustand + Treiber; `type` verhält sich wie eine Eingabe im View */
class Harness {
    readonly timer = new FakeTimer();
    readonly clients: FakeClient[] = [];
    readonly settings = new FakeSettings();
    readonly hub: WritingHub;
    readonly driver: WritingDriver;
    state: EditorState;

    constructor(text: string, name = 'kapitel.tex') {
        const factory: WritingClientFactory = (callbacks) => {
            const client = new FakeClient((docId, version, result) => callbacks.onWriting?.(docId, version, result));
            this.clients.push(client);
            return client;
        };
        this.hub = new WritingHub(factory, this.timer);
        const extension = writingHintsExtension({ path: PATH, name }, { hub: this.hub, timer: this.timer, settings: this.settings });
        this.state = EditorState.create({ doc: text, extensions: [extension] });
        this.driver = new WritingDriver(this, {
            docId: PATH, hub: this.hub, timer: this.timer, debounceMs: DEBOUNCE_MS, hintsAllowed: name.endsWith('.tex'),
        });
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

describe('Schreibhinweise im Editor', () => {
    it('fragt beim Aufbau einmal mit Hinweisen an; Hinweise und Wortzahl erscheinen nach der Antwort', () => {
        const h = new Harness(TEXT);
        expect(h.client.requests).toEqual([{ docId: PATH, version: expect.any(Number) as number, text: TEXT, includeHints: true }]);
        expect(wordCountOf(h.state)).toBeNull();
        h.client.replyToLast(RESULT);
        expect(writingHintsOf(h.state)).toEqual([REPEATED]);
        expect(wordCountOf(h.state)).toBe(3);
    });

    it('entprellt wie die Syntaxprüfung: Text erst nach 0,6 s Ruhe, nur der letzte Stand', () => {
        const h = new Harness(TEXT);
        h.client.replyToLast(RESULT);
        h.type(0, 'a');
        h.timer.advance(DEBOUNCE_MS - 1);
        h.type(0, 'b');
        h.timer.advance(DEBOUNCE_MS - 1);
        expect(h.client.requests).toHaveLength(1);
        h.timer.advance(1);
        expect(h.client.requests).toHaveLength(2);
        expect(h.client.requests[1]?.text).toBe(`ba${TEXT}`);
    });

    it('Hinweise wandern beim Tippen mit; die Antwort auf den neuen Stand ersetzt sie, der Hinweis verschwindet beim Beheben', () => {
        const h = new Harness(TEXT);
        h.client.replyToLast(RESULT);
        h.type(0, 'XY');
        expect(writingHintsOf(h.state)).toEqual([{ ...REPEATED, start: 6, end: 9 }]);
        expect(wordCountOf(h.state)).toBe(3);
        h.type(6, '', 10);
        h.timer.advance(DEBOUNCE_MS);
        h.client.replyToLast({ hints: [], words: 2 });
        expect(writingHintsOf(h.state)).toEqual([]);
        expect(wordCountOf(h.state)).toBe(2);
    });

    it('entfernt einen Hinweis, wenn sein ganzer Text gelöscht wird', () => {
        const h = new Harness(TEXT);
        h.client.replyToLast(RESULT);
        h.type(4, '', 7);
        expect(writingHintsOf(h.state)).toEqual([]);
    });

    it('verwirft eine veraltete Antwort', () => {
        const h = new Harness(TEXT);
        h.client.replyToLast(RESULT);
        h.type(0, 'a');
        h.timer.advance(DEBOUNCE_MS);
        const stale = h.client.requests[1];
        h.type(0, 'b');
        h.client.onWriting(PATH, stale?.version ?? -1, { hints: [], words: 99 });
        expect(wordCountOf(h.state)).toBe(3);
        expect(writingHintsOf(h.state)).toHaveLength(1);
    });

    it('übersteht Hinweise hinter dem Textende und leere Bereiche', () => {
        const h = new Harness('kurz');
        h.client.replyToLast({
            hints: [
                { kind: 'ellipsis', start: 2, end: 99, message: 'zu lang' },
                { kind: 'ellipsis', start: 1, end: 1, message: 'leer' },
            ],
            words: 1,
        });
        expect(writingHintsOf(h.state)).toEqual([{ kind: 'ellipsis', start: 2, end: 4, message: 'zu lang' }]);
    });

    it('meldet jede eingesetzte Antwort an die Statusleiste', () => {
        const h = new Harness(TEXT);
        let calls = 0;
        const stop = onWritingResult(() => (calls += 1));
        h.client.replyToLast(RESULT);
        stop();
        h.type(0, 'a');
        h.timer.advance(DEBOUNCE_MS);
        h.client.replyToLast(RESULT);
        expect(calls).toBe(1);
    });
});

describe('Schalter „Schreibhinweise anzeigen“', () => {
    it('aus: nur zählen (includeHints false), die Wortzahl kommt trotzdem', () => {
        const h = new Harness(TEXT);
        h.settings.enabled = false;
        h.driver.settingsChanged();
        expect(h.client.requests.map((request) => request.includeHints)).toEqual([true, false]);
        h.client.replyToLast({ hints: [], words: 4 });
        expect(wordCountOf(h.state)).toBe(4);
        expect(writingHintsOf(h.state)).toEqual([]);
    });

    it('einschalten fordert sofort Hinweise für den unveränderten Text an; unnötige Anfragen entfallen', () => {
        const h = new Harness(TEXT);
        h.settings.enabled = false;
        h.driver.settingsChanged();
        h.client.replyToLast({ hints: [], words: 3 });
        const count = h.client.requests.length;
        h.driver.settingsChanged();
        expect(h.client.requests).toHaveLength(count);
        h.settings.enabled = true;
        h.driver.settingsChanged();
        expect(h.client.requests).toHaveLength(count + 1);
        expect(h.client.requests[count]?.includeHints).toBe(true);
        h.client.replyToLast(RESULT);
        expect(writingHintsOf(h.state)).toEqual([REPEATED]);
    });

    it('BibTeX: nie Hinweise, aber die Wortzahl', () => {
        const h = new Harness('@book{a, title = {Ein Titel}}', 'lit.bib');
        expect(h.client.requests[0]?.includeHints).toBe(false);
        h.client.replyToLast({ hints: [], words: 2 });
        expect(wordCountOf(h.state)).toBe(2);
    });
});

describe('WritingHub', () => {
    it('beendet den Worker nach 30 s ohne Hörer, eine neue Anfrage startet ihn wieder', () => {
        const timer = new FakeTimer();
        const clients: FakeClient[] = [];
        const hub = new WritingHub((callbacks) => {
            const client = new FakeClient((docId, version, result) => callbacks.onWriting?.(docId, version, result));
            clients.push(client);
            return client;
        }, timer);
        const stop = hub.subscribe(PATH, () => undefined);
        hub.requestWriting(PATH, 1, 'a', true);
        stop();
        timer.advance(IDLE_MS - 1);
        expect(clients[0]?.disposed).toBe(false);
        timer.advance(1);
        expect(clients[0]?.disposed).toBe(true);
        hub.requestWriting(PATH, 2, 'b', true);
        expect(clients).toHaveLength(2);
    });
});
