import { describe, expect, it } from 'vitest';
import type { TextFile } from '../../src/shared/contract';
import { SessionRegistry } from '../../src/renderer/editor/session';
import { createEditorStore } from '../../src/renderer/stores/editor';
import type { EditorStore } from '../../src/renderer/stores/editor';

// Fälle aus swift/Tests/LatexEditorTests/EditorTabStoreTests.swift (ohne Platte: die Dateien kommen fertig geladen;
// Pfad-Normalisierung, gelöschte Dateien und Wiederherstellen gehören zu Main bzw. W2-4/W2-13).

const path = (name: string): string => `/p/${name}.tex`;

function file(name: string): TextFile {
    return { path: path(name), text: `Inhalt ${name}\n`, encoding: 'utf8', eol: 'lf', hash: `hash-${name}`, mtime: 1 };
}

function makeStore(): { store: EditorStore; registry: SessionRegistry } {
    const registry = new SessionRegistry();
    return { store: createEditorStore(registry), registry };
}

function typeInto(store: EditorStore, name: string, text: string): void {
    store.getState().session(path(name))?.dispatch({ changes: { from: 0, insert: text } });
}

describe('Editor-Store: Tabs und Sitzungen', () => {
    it('Einfachklicks ersetzen den Vorschau-Tab und geben dessen Sitzung frei', () => {
        const { store, registry } = makeStore();
        store.getState().open(file('a'));
        store.getState().open(file('b'));
        expect(store.getState().tabs.items).toEqual([path('b')]);
        expect(registry.get(path('a'))).toBeUndefined();
        expect(store.getState().files[path('a')]).toBeUndefined();

        store.getState().open(file('c'), { asPreview: false });
        store.getState().open(file('a'));
        expect(store.getState().tabs.items).toEqual([path('a'), path('c')]);
        expect(registry.get(path('b'))).toBeUndefined();
        expect(store.getState().activeSession()?.path).toBe(path('a'));
    });

    it('erste Änderung hält den Vorschau-Tab fest, er wird nicht mehr ersetzt', () => {
        const { store } = makeStore();
        store.getState().open(file('a'));
        expect(store.getState().tabs.preview).toBe(path('a'));
        typeInto(store, 'a', 'x');
        expect(store.getState().tabs.preview).toBeNull();
        expect(store.getState().files[path('a')]?.isDirty).toBe(true);

        store.getState().open(file('b'));
        expect(store.getState().tabs.items).toEqual([path('a'), path('b')]);
        expect(store.getState().session(path('a'))?.isDirty).toBe(true);
    });

    it('Wechsel zwischen Tabs behält jede Sitzung samt Änderungen', () => {
        const { store } = makeStore();
        store.getState().open(file('a'), { asPreview: false });
        const first = store.getState().activeSession();
        typeInto(store, 'a', 'NEU ');
        store.getState().open(file('b'), { asPreview: false });
        expect(store.getState().activeSession()?.path).toBe(path('b'));

        store.getState().activate(path('a'));
        expect(store.getState().activeSession()).toBe(first);
        expect(first?.state.doc.toString().startsWith('NEU ')).toBe(true);
        store.getState().activateNext();
        expect(store.getState().activeSession()?.path).toBe(path('b'));
        store.getState().activatePrevious();
        expect(store.getState().activeSession()).toBe(first);
    });

    it('aktiven Tab schließen zeigt den Nachbarn, letzten Tab schließen leert die Anzeige', () => {
        const { store, registry } = makeStore();
        for (const name of ['a', 'b', 'c']) store.getState().open(file(name), { asPreview: false });
        store.getState().activate(path('b'));

        store.getState().close(path('b'));
        expect(store.getState().activeSession()?.path).toBe(path('c'));
        expect(registry.get(path('b'))).toBeUndefined();
        store.getState().close(path('c'));
        expect(store.getState().activeSession()?.path).toBe(path('a'));
        store.getState().close(path('a'));
        expect(store.getState().activeSession()).toBeNull();
        expect(store.getState().tabs.items).toEqual([]);
        store.getState().close(path('a'));
        expect(registry.size).toBe(0);
    });

    it('andere schließen gibt deren Sitzungen frei', () => {
        const { store, registry } = makeStore();
        for (const name of ['a', 'b', 'c']) store.getState().open(file(name), { asPreview: false });
        store.getState().closeOthers(path('b'));
        expect(store.getState().tabs.items).toEqual([path('b')]);
        expect(store.getState().activeSession()?.path).toBe(path('b'));
        expect(registry.get(path('a'))).toBeUndefined();
        expect(registry.get(path('c'))).toBeUndefined();
    });

    it('schnelles Öffnen mehrerer Dateien hinterlässt keine verwaisten Sitzungen', () => {
        const { store, registry } = makeStore();
        for (const name of ['a', 'b', 'c', 'd']) store.getState().open(file(name));
        expect(store.getState().tabs.items).toHaveLength(1);
        expect(registry.size).toBe(1);
        expect(store.getState().activeSession()?.path).toBe(store.getState().tabs.active);
    });

    it('Änderungen der Tabs werden gemeldet', () => {
        const { store } = makeStore();
        const reported: string[][] = [];
        store.subscribe((state, previous) => {
            if (state.tabs !== previous.tabs) reported.push([...state.tabs.items]);
        });
        store.getState().open(file('a'), { asPreview: false });
        store.getState().open(file('b'), { asPreview: false });
        store.getState().close(path('a'));
        expect(reported).toEqual([[path('a')], [path('a'), path('b')], [path('b')]]);
    });
});

describe('Editor-Store: Metadaten ohne Text', () => {
    it('hält Titel, Kodierung, Zeilenenden, Hash und mtime, aber keinen Text', () => {
        const { store } = makeStore();
        store.getState().open({ ...file('a'), eol: 'crlf', encoding: 'latin1' });
        const info = store.getState().files[path('a')];
        expect(info).toEqual({
            path: path('a'), title: 'a.tex', isDirty: false, encoding: 'latin1', eol: 'crlf', hash: 'hash-a', mtime: 1,
        });
        expect(JSON.stringify(store.getState())).not.toContain('Inhalt');
    });

    it('setzt nur bei echter Änderung', () => {
        const { store } = makeStore();
        store.getState().open(file('a'), { asPreview: false });
        let notifications = 0;
        store.subscribe(() => notifications++);
        store.getState().activate(path('a'));
        store.getState().pin(path('a'));
        store.getState().open(file('a'), { asPreview: false });
        typeInto(store, 'a', 'x');
        typeInto(store, 'a', 'y');
        expect(notifications).toBe(1);
    });

    it('Speichern setzt Hash und mtime und „geändert“ zurück', () => {
        const { store } = makeStore();
        store.getState().open(file('a'), { asPreview: false });
        typeInto(store, 'a', 'x');
        const snapshot = store.getState().session(path('a'))!.snapshotForSave();
        store.getState().markSaved(path('a'), snapshot, { hash: 'neu', mtime: 9 });
        expect(store.getState().files[path('a')]).toMatchObject({ isDirty: false, hash: 'neu', mtime: 9 });
    });

    it('Umbenennen folgt der Datei samt Sitzung', () => {
        const { store, registry } = makeStore();
        store.getState().open(file('a'), { asPreview: false });
        const session = registry.get(path('a'));
        store.getState().relocate(path('a'), '/p/quellen.bib');
        expect(store.getState().tabs.items).toEqual(['/p/quellen.bib']);
        expect(store.getState().files['/p/quellen.bib']?.title).toBe('quellen.bib');
        expect(store.getState().files[path('a')]).toBeUndefined();
        expect(registry.get('/p/quellen.bib')).toBe(session);
    });
});
