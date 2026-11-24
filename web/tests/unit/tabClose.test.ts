import { describe, expect, it, vi } from 'vitest';
import type { TextFile } from '../../src/shared/contract';
import { IpcFailure } from '../../src/shared/ipcResult';
import { closeActiveTabWithPrompt, closeTabWithPrompt } from '../../src/renderer/app/tabClose';
import type { TabCloseChoice, TabCloseDeps } from '../../src/renderer/app/tabClose';
import { createTabClosePrompt } from '../../src/renderer/app/tabClosePrompt';
import { createEditorStore } from '../../src/renderer/stores/editor';
import type { StatusMessage } from '../../src/renderer/stores/status';
import { createPreloadStub } from '../support/preloadStub';

function textFile(path: string, name: string): TextFile {
    return { path, name, text: 'Text', encoding: 'utf8', eol: 'lf', hash: 'h', mtime: 0 };
}

function setup(choice: TabCloseChoice = 'cancel') {
    const stub = createPreloadStub();
    const store = createEditorStore();
    const messages: StatusMessage[] = [];
    const ask = vi.fn((_name: string) => Promise.resolve(choice));
    const deps: TabCloseDeps = { api: stub.api, store, report: (message) => messages.push(message), ask };
    const open = (path: string, name: string, dirty: boolean): void => {
        store.getState().open(textFile(path, name), { asPreview: false });
        if (dirty) store.getState().session(path)!.dispatch({ changes: { from: 0, insert: 'x' } });
    };
    const calls = (channel: string) => stub.calls.filter((call) => call.channel === channel);
    return { stub, store, messages, ask, deps, open, calls };
}

describe('Tab schließen mit Nachfrage', () => {
    it('ein gespeicherter Tab schließt ohne Nachfrage', async () => {
        const { deps, open, ask, store } = setup();
        open('/p/a.tex', 'a.tex', false);
        expect(await closeTabWithPrompt(deps, '/p/a.tex')).toBe('closed');
        expect(ask).not.toHaveBeenCalled();
        expect(store.getState().tabs.items).toEqual([]);
    });

    it('ein unbekannter Tab ist schon zu', async () => {
        const { deps, ask } = setup();
        expect(await closeTabWithPrompt(deps, '/p/weg.tex')).toBe('closed');
        expect(ask).not.toHaveBeenCalled();
    });

    it('Abbrechen lässt den Tab samt Änderung offen', async () => {
        const { deps, open, ask, store } = setup('cancel');
        open('/p/a.tex', 'a.tex', true);
        expect(await closeTabWithPrompt(deps, '/p/a.tex')).toBe('kept');
        expect(ask).toHaveBeenCalledWith('a.tex');
        expect(store.getState().tabs.items).toEqual(['/p/a.tex']);
        expect(store.getState().files['/p/a.tex']?.isDirty).toBe(true);
    });

    it('Nicht speichern schließt, ohne zu schreiben', async () => {
        const { deps, open, store, calls } = setup('discard');
        open('/p/a.tex', 'a.tex', true);
        expect(await closeTabWithPrompt(deps, '/p/a.tex')).toBe('closed');
        expect(calls('fs:writeText')).toHaveLength(0);
        expect(store.getState().tabs.items).toEqual([]);
    });

    it('Speichern schreibt und schließt dann', async () => {
        const { deps, open, store, calls } = setup('save');
        open('/p/a.tex', 'a.tex', true);
        expect(await closeTabWithPrompt(deps, '/p/a.tex')).toBe('closed');
        expect(calls('fs:writeText')).toHaveLength(1);
        expect(store.getState().tabs.items).toEqual([]);
    });

    it('Speichern mit Fehler lässt den Tab offen und meldet den Fehler', async () => {
        const { deps, open, store, stub, messages } = setup('save');
        stub.respond('fs:writeText', () => {
            throw new IpcFailure({ kind: 'io', message: 'Platte voll' });
        });
        open('/p/a.tex', 'a.tex', true);
        expect(await closeTabWithPrompt(deps, '/p/a.tex')).toBe('kept');
        expect(store.getState().tabs.items).toEqual(['/p/a.tex']);
        expect(messages.some((message) => message.kind === 'error' && message.text.includes('Platte voll'))).toBe(true);
    });

    it('Tippen während des Speicherns hält den Tab offen', async () => {
        const { deps, open, store, stub } = setup('save');
        stub.respond('fs:writeText', () => {
            store.getState().session('/p/a.tex')!.dispatch({ changes: { from: 0, insert: 'noch mehr' } });
            return { hash: 'neu', mtime: 1 };
        });
        open('/p/a.tex', 'a.tex', true);
        expect(await closeTabWithPrompt(deps, '/p/a.tex')).toBe('kept');
        expect(store.getState().tabs.items).toEqual(['/p/a.tex']);
    });

    it('der Titel in der Frage ist der Anzeigename, nie die Kennung', async () => {
        const { deps, open, ask } = setup('cancel');
        open('5f0c2d3e-grant', 'quellen.bib', true);
        await closeTabWithPrompt(deps, '5f0c2d3e-grant');
        expect(ask).toHaveBeenCalledWith('quellen.bib');
    });

    it('ein zweiter Schließen-Aufruf während der Frage fragt nicht doppelt', async () => {
        const { deps, open, ask } = setup();
        let answer!: (choice: TabCloseChoice) => void;
        ask.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
        open('/p/a.tex', 'a.tex', true);
        const first = closeTabWithPrompt(deps, '/p/a.tex');
        expect(await closeTabWithPrompt(deps, '/p/a.tex')).toBe('kept');
        answer('discard');
        expect(await first).toBe('closed');
        expect(ask).toHaveBeenCalledTimes(1);
    });

    it('Strg+W-Befehl: schließt den aktiven Tab, ohne Tabs nichts', async () => {
        const { deps, open, store } = setup();
        open('/p/a.tex', 'a.tex', false);
        open('/p/b.tex', 'b.tex', false);
        expect(await closeActiveTabWithPrompt(deps)).toBe('closed');
        expect(store.getState().tabs.items).toEqual(['/p/a.tex']);
        await closeActiveTabWithPrompt(deps);
        expect(await closeActiveTabWithPrompt(deps)).toBe('closed');
    });
});

describe('Nachfrage-Speicher', () => {
    it('zeigt die Frage und liefert die Antwort', async () => {
        const prompt = createTabClosePrompt();
        const pending = prompt.ask('a.tex');
        expect(prompt.store.getState().question).toEqual({ name: 'a.tex' });
        prompt.answer('save');
        expect(await pending).toBe('save');
        expect(prompt.store.getState().question).toBeNull();
    });

    it('eine zweite Frage während einer offenen gilt als Abbrechen', async () => {
        const prompt = createTabClosePrompt();
        const first = prompt.ask('a.tex');
        expect(await prompt.ask('b.tex')).toBe('cancel');
        expect(prompt.store.getState().question).toEqual({ name: 'a.tex' });
        prompt.answer('discard');
        expect(await first).toBe('discard');
    });

    it('eine Antwort ohne Frage bewirkt nichts', () => {
        const prompt = createTabClosePrompt();
        expect(() => prompt.answer('cancel')).not.toThrow();
    });
});
