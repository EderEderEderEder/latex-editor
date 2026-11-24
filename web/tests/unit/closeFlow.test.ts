import { describe, expect, it, vi } from 'vitest';
import type { TextFile } from '../../src/shared/contract';
import { IpcFailure } from '../../src/shared/ipcResult';
import { CLOSE_TEXTS, createCloseHandler, dirtyPaths } from '../../src/renderer/app/closeFlow';
import type { CloseChoice, CloseFlowDeps } from '../../src/renderer/app/closeFlow';
import { SAVE_TEXTS } from '../../src/renderer/app/fileActions';
import { createEditorStore } from '../../src/renderer/stores/editor';
import type { StatusMessage } from '../../src/renderer/stores/status';
import { createPreloadStub } from '../support/preloadStub';

function textFile(path: string, name: string): TextFile {
    return { path, name, text: 'Text', encoding: 'utf8', eol: 'lf', hash: 'h', mtime: 0 };
}

function setup(choice: CloseChoice = 'cancel') {
    const stub = createPreloadStub();
    const store = createEditorStore();
    const messages: StatusMessage[] = [];
    const ask = vi.fn((_names: readonly string[]) => Promise.resolve(choice));
    const deps: CloseFlowDeps = { api: stub.api, store, report: (message) => messages.push(message), ask };
    const open = (path: string, name: string, dirty: boolean): void => {
        store.getState().open(textFile(path, name), { asPreview: false });
        if (dirty) store.getState().session(path)!.dispatch({ changes: { from: 0, insert: 'x' } });
    };
    const calls = (channel: string) => stub.calls.filter((call) => call.channel === channel);
    return { stub, store, messages, ask, deps, open, calls, handle: createCloseHandler(deps) };
}

describe('Schließen des Fensters (K1)', () => {
    it('ohne Ungespeichertes wird sofort bestätigt, ohne Nachfrage', async () => {
        const { open, handle, ask, calls } = setup();
        open('/p/a.tex', 'a.tex', false);
        expect(await handle()).toBe('closed');
        expect(ask).not.toHaveBeenCalled();
        expect(calls('app:confirmClose')).toHaveLength(1);
    });

    it('fragt mit den Namen der geänderten Dateien (nie mit der Kennung); Abbrechen hält das Fenster offen', async () => {
        const { open, handle, ask, calls, store } = setup('cancel');
        open('/p/a.tex', 'a.tex', true);
        open('/p/b.tex', 'b.tex', false);
        open('grant-1', 'quellen.bib', true);
        expect(dirtyPaths(store)).toEqual(['/p/a.tex', 'grant-1']);
        expect(await handle()).toBe('kept');
        expect(ask).toHaveBeenCalledWith(['a.tex', 'quellen.bib']);
        expect(calls('app:confirmClose')).toHaveLength(0);
        expect(store.getState().files['/p/a.tex']?.isDirty).toBe(true);
    });

    it('„Nicht speichern“ bestätigt ohne zu schreiben', async () => {
        const { open, handle, calls } = setup('discard');
        open('/p/a.tex', 'a.tex', true);
        expect(await handle()).toBe('closed');
        expect(calls('fs:writeText')).toHaveLength(0);
        expect(calls('app:confirmClose')).toHaveLength(1);
    });

    it('„Speichern“ schreibt alle ungespeicherten Dateien und bestätigt dann', async () => {
        const { open, handle, calls, store } = setup('save');
        open('/p/a.tex', 'a.tex', true);
        open('grant-1', 'b.tex', true);
        expect(await handle()).toBe('closed');
        expect(calls('fs:writeText').map((call) => call.args[0])).toEqual(['/p/a.tex', 'grant-1']);
        expect(dirtyPaths(store)).toEqual([]);
        expect(calls('app:confirmClose')).toHaveLength(1);
    });

    it('Konflikt beim Speichern: Fenster bleibt offen, Meldung nennt die Datei', async () => {
        const { open, handle, calls, stub, messages } = setup('save');
        stub.respond('fs:writeText', (path) => {
            if (path === '/p/a.tex') throw new IpcFailure({ kind: 'conflict', message: 'fremd' });
            return { hash: 'neu', mtime: 1 };
        });
        open('/p/a.tex', 'a.tex', true);
        open('/p/b.tex', 'b.tex', true);
        expect(await handle()).toBe('kept');
        expect(calls('app:confirmClose')).toHaveLength(0);
        expect(messages.at(-1)).toEqual({ text: CLOSE_TEXTS.keptOpen(SAVE_TEXTS.conflict('a.tex')), kind: 'error' });
    });

    it('eine zweite Anfrage während der Nachfrage wird übergangen', async () => {
        const { open, deps, calls } = setup();
        let answer: (choice: CloseChoice) => void = () => undefined;
        const handle = createCloseHandler({ ...deps, ask: () => new Promise((resolve) => (answer = resolve)) });
        open('/p/a.tex', 'a.tex', true);
        const first = handle();
        expect(await handle()).toBe('busy');
        answer('discard');
        expect(await first).toBe('closed');
        expect(calls('app:confirmClose')).toHaveLength(1);
    });

    it('meldet, wenn der Main die Bestätigung ablehnt', async () => {
        const { handle, stub, messages } = setup();
        stub.respond('app:confirmClose', () => {
            throw new IpcFailure({ kind: 'forbiddenSender', message: 'nein' });
        });
        expect(await handle()).toBe('kept');
        expect(messages.at(-1)).toEqual({ text: CLOSE_TEXTS.confirmFailed('nein'), kind: 'error' });
    });
});
