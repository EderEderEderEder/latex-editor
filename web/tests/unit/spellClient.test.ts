import { describe, expect, it, vi } from 'vitest';
import { SPELL_CLIENT_TEXTS, SpellClient } from '../../src/renderer/app/spellClient';
import type { SpellDictionaryFiles, SpellWorkerLike } from '../../src/renderer/app/spellClient';
import type { SpellRequest, SpellResponse } from '../../src/shared/core/spelling/spellProtocol';

// Client des Rechtschreib-Workers mit gefälschtem Worker (W7-2): lazy, Reihenfolge, veraltete Antworten, Ausfall.

class FakeWorker implements SpellWorkerLike {
    readonly posted: { request: SpellRequest; transfer?: ArrayBuffer[] }[] = [];
    terminated = false;
    onmessage: ((event: { readonly data: SpellResponse }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onmessageerror: ((event: unknown) => void) | null = null;

    postMessage(request: SpellRequest, transfer?: ArrayBuffer[]): void {
        this.posted.push(transfer === undefined ? { request } : { request, transfer });
    }

    terminate(): void {
        this.terminated = true;
    }

    reply(response: SpellResponse): void {
        this.onmessage?.({ data: response });
    }

    kinds(): string[] {
        return this.posted.map((entry) => entry.request.kind);
    }

    lastId(kind: 'check' | 'suggest'): number {
        const entry = [...this.posted].reverse().find((item) => item.request.kind === kind);
        return (entry?.request as { id: number }).id;
    }
}

const FILES: SpellDictionaryFiles = { affix: new ArrayBuffer(4), dictionary: new ArrayBuffer(8) };
const INPUT = { language: 'latex', text: 'Haus', offset: 0, startState: 'normal' } as const;

/** Wartet, bis alle ausstehenden Promise-Ketten gelaufen sind */
function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(loadDictionary: () => Promise<SpellDictionaryFiles> = () => Promise.resolve(FILES)) {
    const workers: FakeWorker[] = [];
    const onUnavailable = vi.fn();
    const client = new SpellClient({
        loadDictionary,
        onUnavailable,
        createWorker: () => {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        },
    });
    return { client, workers, onUnavailable };
}

describe('SpellClient', () => {
    it('startet Worker und Wörterbuch erst bei der ersten Anfrage; Wörter, Wörterbuch, dann Prüfung', async () => {
        const loadDictionary = vi.fn(() => Promise.resolve(FILES));
        const { client, workers } = setup(loadDictionary);
        client.setWords(['Haus']);
        expect(workers).toHaveLength(0);
        expect(loadDictionary).not.toHaveBeenCalled();
        client.check('a.tex', INPUT, () => undefined);
        await flush();
        expect(workers).toHaveLength(1);
        expect(workers[0]!.kinds()).toEqual(['words', 'load', 'check']);
        expect(workers[0]!.posted[0]!.request).toEqual({ kind: 'words', words: ['Haus'] });
        expect(workers[0]!.posted[1]!.transfer).toEqual([FILES.affix, FILES.dictionary]);
    });

    it('liefert nur die Antwort der letzten Prüfung je Dokument', async () => {
        const { client, workers } = setup();
        const first = vi.fn();
        const second = vi.fn();
        client.check('a.tex', INPUT, first);
        client.check('a.tex', INPUT, second);
        await flush();
        const [worker] = workers;
        const [firstId, secondId] = worker!.posted.filter((entry) => entry.request.kind === 'check').map((entry) => (entry.request as { id: number }).id);
        worker!.reply({ kind: 'check', id: firstId!, errors: [[0, 4]], words: 1 });
        worker!.reply({ kind: 'check', id: secondId!, errors: [[1, 2]], words: 1 });
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledWith([[1, 2]]);
    });

    it('nach `forget` verfällt die offene Prüfung; andere Dokumente bleiben unberührt', async () => {
        const { client, workers } = setup();
        const closed = vi.fn();
        const open = vi.fn();
        client.check('a.tex', INPUT, closed);
        client.check('b.tex', INPUT, open);
        await flush();
        client.forget('a.tex');
        const ids = workers[0]!.posted.filter((entry) => entry.request.kind === 'check').map((entry) => (entry.request as { id: number }).id);
        for (const id of ids) workers[0]!.reply({ kind: 'check', id, errors: [], words: 0 });
        expect(closed).not.toHaveBeenCalled();
        expect(open).toHaveBeenCalledOnce();
    });

    it('Vorschläge kommen per Kennung; ein nicht tödlicher Fehler ergibt eine leere Liste', async () => {
        const { client, workers } = setup();
        const suggestions = client.suggest('Fehlr');
        await flush();
        workers[0]!.reply({ kind: 'suggest', id: workers[0]!.lastId('suggest'), suggestions: ['Fehler'] });
        await expect(suggestions).resolves.toEqual(['Fehler']);
        const failing = client.suggest('Xy');
        await flush();
        workers[0]!.reply({ kind: 'failed', id: workers[0]!.lastId('suggest'), message: 'nicht geladen', fatal: false });
        await expect(failing).resolves.toEqual([]);
        expect(client.isAvailable).toBe(true);
    });

    it('Ladefehler des Wörterbuchs: einmal gemeldet, danach keine Anfragen mehr, nie eine Ausnahme', async () => {
        const { client, workers, onUnavailable } = setup(() => Promise.reject(new Error('nicht gefunden')));
        client.check('a.tex', INPUT, () => undefined);
        const suggestions = client.suggest('Haus');
        await flush();
        expect(onUnavailable).toHaveBeenCalledOnce();
        expect(onUnavailable).toHaveBeenCalledWith(SPELL_CLIENT_TEXTS.unavailable(SPELL_CLIENT_TEXTS.dictionaryMissing('nicht gefunden')));
        await expect(suggestions).resolves.toEqual([]);
        expect(workers[0]!.terminated).toBe(true);
        expect(workers[0]!.kinds()).toEqual([]);
        client.check('a.tex', INPUT, () => undefined);
        expect(workers).toHaveLength(1);
        expect(client.isAvailable).toBe(false);
    });

    it('tödliche Antwort (`fatal`) oder Absturz des Workers schalten die Prüfung ab', async () => {
        const { client, workers, onUnavailable } = setup();
        client.check('a.tex', INPUT, () => undefined);
        await flush();
        workers[0]!.reply({ kind: 'failed', id: null, message: 'Wörterbuch nicht ladbar: kaputt', fatal: true });
        expect(onUnavailable).toHaveBeenCalledWith(SPELL_CLIENT_TEXTS.unavailable('Wörterbuch nicht ladbar: kaputt'));
        expect(client.isAvailable).toBe(false);

        const crashed = setup();
        crashed.client.check('a.tex', INPUT, () => undefined);
        await flush();
        crashed.workers[0]!.onerror?.(new Error('Absturz'));
        expect(crashed.onUnavailable).toHaveBeenCalledWith(SPELL_CLIENT_TEXTS.unavailable(SPELL_CLIENT_TEXTS.workerFailed));
    });

    it('Wortänderungen gehen an einen laufenden Worker', async () => {
        const { client, workers } = setup();
        client.check('a.tex', INPUT, () => undefined);
        await flush();
        client.setWords(['Electron']);
        await flush();
        expect(workers[0]!.posted.at(-1)!.request).toEqual({ kind: 'words', words: ['Electron'] });
    });
});
