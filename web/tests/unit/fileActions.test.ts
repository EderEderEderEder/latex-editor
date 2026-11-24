import { describe, expect, it } from 'vitest';
import type { TextFile } from '../../src/shared/contract';
import { IpcFailure } from '../../src/shared/ipcResult';
import {
    SAVE_TEXTS, openFilesFromDialog, saveActiveFile, saveActiveFileAs, saveFile, saveFileAs,
} from '../../src/renderer/app/fileActions';
import type { FileActionDeps } from '../../src/renderer/app/fileActions';
import { createEditorStore } from '../../src/renderer/stores/editor';
import type { StatusMessage } from '../../src/renderer/stores/status';
import { createPreloadStub } from '../support/preloadStub';

const PATH = '/stub/projekt/a.tex';
const HASH_AT_READ = 'hash-beim-lesen';

function textFile(path: string, text: string): TextFile {
    return { path, name: path.split('/').at(-1) ?? path, text, encoding: 'latin1', eol: 'crlf', hash: HASH_AT_READ, mtime: 1 };
}

function setup(text = 'Hallo') {
    const stub = createPreloadStub();
    const store = createEditorStore();
    const messages: StatusMessage[] = [];
    const deps: FileActionDeps = { api: stub.api, store, report: (message) => messages.push(message) };
    store.getState().open(textFile(PATH, text), { asPreview: false });
    const type = (insert: string): void => store.getState().session(PATH)!.dispatch({ changes: { from: 0, insert } });
    const writes = () => stub.calls.filter((call) => call.channel === 'fs:writeText');
    return { stub, store, messages, deps, type, writes };
}

describe('Speichern', () => {
    it('schreibt Text, Kodierung, Zeilenende und erwarteten Hash und markiert die Datei als gespeichert', async () => {
        const { store, deps, type, writes, messages, stub } = setup();
        stub.respond('fs:writeText', () => ({ hash: 'neuer-hash', mtime: 7 }));
        type('Neu: ');
        expect(store.getState().files[PATH]?.isDirty).toBe(true);

        expect(await saveFile(deps, PATH)).toBe('saved');
        expect(writes()).toHaveLength(1);
        expect(writes()[0]!.args).toEqual([PATH, 'Neu: Hallo', 'latin1', 'crlf', HASH_AT_READ]);
        expect(store.getState().files[PATH]).toMatchObject({ isDirty: false, hash: 'neuer-hash', mtime: 7 });
        expect(messages.at(-1)).toEqual({ text: SAVE_TEXTS.saved('a.tex'), kind: 'info' });
    });

    it('der nächste Speichervorgang erwartet den Hash des letzten', async () => {
        const { deps, type, writes, stub } = setup();
        stub.respond('fs:writeText', () => ({ hash: 'zweiter', mtime: 8 }));
        type('1');
        await saveFile(deps, PATH);
        type('2');
        await saveFile(deps, PATH);
        expect(writes()[1]!.args[4]).toBe('zweiter');
    });

    it('meldet einen Konflikt (fremder Hash) sichtbar, lässt den Text ungespeichert und stürzt nicht ab', async () => {
        const { store, deps, type, messages, stub } = setup();
        stub.respond('fs:writeText', () => {
            throw new IpcFailure({ kind: 'conflict', message: 'Hash passt nicht' });
        });
        type('x');
        expect(await saveFile(deps, PATH)).toBe('conflict');
        expect(store.getState().files[PATH]?.isDirty).toBe(true);
        expect(messages.at(-1)).toEqual({ text: SAVE_TEXTS.conflict('a.tex'), kind: 'error' });
    });

    it('meldet andere Fehler mit ihrem Text', async () => {
        const { store, deps, type, messages, stub } = setup();
        stub.respond('fs:writeText', () => {
            throw new IpcFailure({ kind: 'io', message: 'Platte voll' });
        });
        type('x');
        expect(await saveFile(deps, PATH)).toBe('failed');
        expect(store.getState().files[PATH]?.isDirty).toBe(true);
        expect(messages.at(-1)).toEqual({ text: SAVE_TEXTS.failed('a.tex', 'Platte voll'), kind: 'error' });
    });

    it('fängt auch einen unerwartet geworfenen Fehler ab', async () => {
        const { deps, type, messages } = setup();
        type('x');
        const broken = { ...deps, api: { ...deps.api, fs: { ...deps.api.fs, writeText: () => Promise.reject(new Error('kaputt')) } } };
        expect(await saveFile(broken as FileActionDeps, PATH)).toBe('failed');
        expect(messages.at(-1)?.kind).toBe('error');
    });

    it('schreibt nichts, wenn nichts geändert ist, und kennt unbekannte Tabs', async () => {
        const { deps, writes, messages } = setup();
        expect(await saveFile(deps, PATH)).toBe('unchanged');
        expect(await saveFile(deps, '/gibt/es/nicht.tex')).toBe('missing');
        expect(writes()).toHaveLength(0);
        expect(messages.at(-1)).toEqual({ text: SAVE_TEXTS.unchanged, kind: 'info' });
    });

    it('speichert über saveActiveFile den aktiven Tab', async () => {
        const { deps, type, writes } = setup();
        type('y');
        expect(await saveActiveFile(deps)).toBe('saved');
        expect(writes()).toHaveLength(1);
    });

    it('Strg+S während des Schreibens merkt ein Nachspeichern vor, das den neuesten Stand schreibt (N3)', async () => {
        const { store, deps, type, stub, writes } = setup();
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => (release = resolve));
        let call = 0;
        stub.respond('fs:writeText', async () => {
            call++;
            if (call === 1) await gate;
            return { hash: `h${call}`, mtime: call };
        });
        type('1');
        const first = saveFile(deps, PATH);
        await Promise.resolve();
        type('2');
        const second = saveFile(deps, PATH);
        const third = saveFile(deps, PATH);
        expect(third).toBe(second);
        release();
        expect(await first).toBe('saved');
        expect(await second).toBe('saved');
        expect(writes().map((entry) => entry.args[1])).toEqual(['1Hallo', '21Hallo']);
        expect(writes()[1]!.args[4]).toBe('h1');
        expect(store.getState().files[PATH]?.isDirty).toBe(false);
    });

    it('vorgemerktes Nachspeichern ohne neue Änderung schreibt nichts und meldet nichts', async () => {
        const { deps, type, writes, messages } = setup();
        type('1');
        const first = saveFile(deps, PATH);
        const second = saveFile(deps, PATH);
        expect(await first).toBe('saved');
        expect(await second).toBe('unchanged');
        expect(writes()).toHaveLength(1);
        expect(messages.at(-1)?.text).toBe(SAVE_TEXTS.saved('a.tex'));
    });

    it('Text, der während des Schreibens getippt wird, bleibt ungespeichert', async () => {
        const { store, deps, type, stub } = setup();
        stub.respond('fs:writeText', async () => {
            type('später ');
            return { hash: 'h2', mtime: 2 };
        });
        type('x');
        await saveFile(deps, PATH);
        expect(store.getState().files[PATH]?.isDirty).toBe(true);
    });
});

describe('Datei öffnen', () => {
    it('liest jede gewählte Datei und öffnet sie als festen Tab', async () => {
        const { store, deps, stub } = setup();
        stub.respond('dialog:pickFiles', () => [
            { grantId: 'g1', name: 'b.tex' },
            { grantId: 'g2', name: 'c.bib' },
        ]);
        // Wie der Main: `path` ist die Kennung, `name` der Anzeigename.
        stub.respond('fs:readText', (target) => ({ ...textFile(target, `Inhalt ${target}`), name: target === 'g1' ? 'b.tex' : 'c.bib' }));
        await openFilesFromDialog(deps);
        expect(store.getState().tabs.items).toEqual([PATH, 'g1', 'g2']);
        expect(store.getState().tabs.active).toBe('g2');
        expect(store.getState().tabs.preview).toBeNull();
        expect(store.getState().session('g1')?.state.doc.toString()).toBe('Inhalt g1');
        expect(store.getState().files.g2?.title).toBe('c.bib');
        expect(store.getState().session('g2')?.language).toBe('bibtex');
    });

    it('dieselbe Datei zweimal geöffnet (gleiche Kennung) ergibt einen Tab', async () => {
        const { store, deps, stub } = setup();
        stub.respond('dialog:pickFiles', () => [{ grantId: 'g1', name: 'b.tex' }]);
        stub.respond('fs:readText', (target) => ({ ...textFile(target, 'b'), name: 'b.tex' }));
        await openFilesFromDialog(deps);
        await openFilesFromDialog(deps);
        expect(store.getState().tabs.items).toEqual([PATH, 'g1']);
    });

    it('ein abgebrochener Dialog ändert nichts', async () => {
        const { store, deps, messages } = setup();
        const before = store.getState().tabs;
        await openFilesFromDialog(deps);
        expect(store.getState().tabs).toBe(before);
        expect(messages).toHaveLength(0);
    });

    it('meldet eine nicht lesbare Datei und öffnet die übrigen', async () => {
        const { store, deps, messages, stub } = setup();
        stub.respond('dialog:pickFiles', () => [
            { grantId: 'kaputt', name: 'x.tex' },
            { grantId: 'g2', name: 'y.tex' },
        ]);
        stub.respond('fs:readText', (path) => {
            if (path === 'kaputt') throw new IpcFailure({ kind: 'io', message: 'nicht lesbar' });
            return textFile('/stub/projekt/y.tex', 'y');
        });
        await openFilesFromDialog(deps);
        expect(store.getState().tabs.items).toContain('/stub/projekt/y.tex');
        expect(messages).toEqual([{ text: SAVE_TEXTS.openFailed('x.tex: nicht lesbar'), kind: 'error' }]);
    });

    it('meldet einen Fehler des Dialogs', async () => {
        const { deps, messages, stub } = setup();
        stub.respond('dialog:pickFiles', () => {
            throw new IpcFailure({ kind: 'forbiddenSender', message: 'nein' });
        });
        await openFilesFromDialog(deps);
        expect(messages).toEqual([{ text: SAVE_TEXTS.openFailed('nein'), kind: 'error' }]);
    });
});

describe('Speichern unter', () => {
    const TARGET = 'ziel';

    function setupSaveAs() {
        const env = setup();
        env.stub.respond('dialog:saveAs', () => ({ grantId: TARGET, name: 'neu.bib' }));
        env.stub.respond('fs:writeText', () => ({ hash: 'ziel-hash', mtime: 5 }));
        return env;
    }

    it('schreibt über die Gewährung und zieht den Tab auf die neue Datei um (Titel und Sprache aus dem Namen)', async () => {
        const { store, deps, type, writes, messages } = setupSaveAs();
        type('Neu ');
        expect(await saveActiveFileAs(deps)).toBe('saved');
        expect(writes()[0]!.args).toEqual([TARGET, 'Neu Hallo', 'latin1', 'crlf']);
        expect(store.getState().tabs.items).toEqual([TARGET]);
        expect(store.getState().files[TARGET]).toMatchObject({ isDirty: false, hash: 'ziel-hash', title: 'neu.bib' });
        expect(store.getState().session(TARGET)?.language).toBe('bibtex');
        expect(messages.at(-1)).toEqual({ text: SAVE_TEXTS.saved('neu.bib'), kind: 'info' });
    });

    it('schlägt bei einer Dialog-Datei den Namen vor, nie die Kennung; bei Projektdateien den Pfad', async () => {
        const { store, deps, stub } = setupSaveAs();
        stub.respond('dialog:saveAs', () => null);
        await saveFileAs(deps, PATH);
        store.getState().open({ ...textFile('g7', 'x'), name: 'brief.tex' });
        await saveFileAs(deps, 'g7');
        const suggestions = stub.calls.filter((call) => call.channel === 'dialog:saveAs').map((call) => call.args[0]);
        expect(suggestions).toMatchObject([{ defaultPath: PATH }, { defaultPath: 'brief.tex' }]);
    });

    it('bricht ohne Auswahl still ab', async () => {
        const { store, deps, stub, writes } = setupSaveAs();
        stub.respond('dialog:saveAs', () => null);
        expect(await saveFileAs(deps, PATH)).toBe('cancelled');
        expect(writes()).toHaveLength(0);
        expect(store.getState().tabs.items).toEqual([PATH]);
    });

    it('meldet einen Fehler beim Schreiben und lässt den Tab, wie er ist', async () => {
        const { store, deps, stub, messages } = setupSaveAs();
        stub.respond('fs:writeText', () => {
            throw new IpcFailure({ kind: 'io', message: 'gesperrt' });
        });
        expect(await saveFileAs(deps, PATH)).toBe('failed');
        expect(store.getState().tabs.items).toEqual([PATH]);
        expect(messages.at(-1)?.kind).toBe('error');
    });

    it('lässt den Tab stehen, wenn das Ziel schon in einem anderen Tab offen ist', async () => {
        const { store, deps, messages } = setupSaveAs();
        store.getState().open({ ...textFile(TARGET, 'anderes'), name: 'neu.bib' }, { asPreview: false });
        expect(await saveFileAs(deps, PATH)).toBe('failed');
        expect(store.getState().tabs.items).toEqual([PATH, TARGET]);
        expect(messages.at(-1)).toEqual({ text: SAVE_TEXTS.alreadyOpen('neu.bib'), kind: 'error' });
    });
});
