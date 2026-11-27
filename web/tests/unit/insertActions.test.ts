import { undo, undoDepth } from '@codemirror/commands';
import type { EditorState, Transaction } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import type { RendererApi } from '../../src/shared/contract';
import { closeInsertDialog, openInsertDialog, performInsert, refreshInsertCatalog } from '../../src/renderer/app/insertActions';
import type { InsertDeps } from '../../src/renderer/app/insertDeps';
import { chooseImageFile, chooseProjectImage, dropImageFiles, IMAGE_TEXTS } from '../../src/renderer/app/insertImage';
import { INSERT_TEXTS } from '../../src/renderer/app/insertLogic';
import { EMPTY_COMPLETION_INDEX } from '../../src/renderer/app/completionIndexLogic';
import type { CompletionIndexSnapshot } from '../../src/renderer/app/completionIndexLogic';
import { createAppUndoStore } from '../../src/renderer/stores/appUndo';
import { createEditorStore } from '../../src/renderer/stores/editor';
import { createInsertStore } from '../../src/renderer/stores/insert';
import { createOverlayStore } from '../../src/renderer/stores/overlays';
import { createProjectStore } from '../../src/renderer/stores/project';
import type { StatusMessage } from '../../src/renderer/stores/status';
import { createPreloadStub } from '../support/preloadStub';

const GRANT = 'stub-project-grant';
const ROOT = '/stub/projekt';
const TEX = `${ROOT}/kapitel/test.tex`;
const BIB = `${ROOT}/literatur.bib`;
const TODAY = '2026-11-27';

interface StubSetup {
    prepareFile(name: string, text: string): void;
    installSampleProject(): void;
    addProjectFile(path: string, text: string): void;
}

async function setup(index: CompletionIndexSnapshot = EMPTY_COMPLETION_INDEX) {
    const stub = createPreloadStub();
    const control = (stub.api as unknown as { __stub: StubSetup }).__stub;
    control.installSampleProject();
    const project = createProjectStore({ api: () => stub.api as RendererApi });
    const opened = await stub.api.project.open(GRANT);
    if (!opened.ok) throw new Error('Stub-Projekt fehlt');
    project.getState().setProject(opened.value, GRANT);
    const editor = createEditorStore();
    const messages: StatusMessage[] = [];
    const deps: InsertDeps = {
        api: stub.api, editor, project, insert: createInsertStore(), overlays: createOverlayStore(), appUndo: createAppUndoStore(),
        completionIndex: () => index, report: (message) => messages.push(message), today: () => TODAY, focusEditor: vi.fn(),
    };
    const open = (path: string, text: string): void => {
        const name = path.split('/').at(-1) ?? path;
        editor.getState().open({ path, name, text, encoding: 'utf8', eol: 'lf', hash: 'h', mtime: 0 }, { asPreview: false });
    };
    const calls = (channel: string) => stub.calls.filter((call) => call.channel === channel);
    return { stub, control, deps, editor, messages, open, calls };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function textOf(setupResult: Setup, path = TEX): string {
    return setupResult.editor.getState().session(path)?.state.doc.toString() ?? '';
}

/** Rückgängig auf einem Zustand ohne View: der Zustand danach */
function afterUndo(state: EditorState): EditorState {
    let result = state;
    undo({ state, dispatch: (transaction: Transaction) => { result = transaction.state; } });
    return result;
}

async function openAndInsert(s: Setup, kind: Parameters<typeof openInsertDialog>[1]): Promise<void> {
    openInsertDialog(s.deps, kind);
    await refreshInsertCatalog(s.deps);
    await performInsert(s.deps);
}

describe('Einfügen-Fenster öffnen', () => {
    it('ohne .tex vorne: Blocker, kein Einfügen, das Fenster bleibt offen', async () => {
        const s = await setup();
        s.open(BIB, '@book{a,\n}\n');
        openInsertDialog(s.deps, 'table');
        expect(s.deps.insert.getState()).toMatchObject({ isOpen: true, canInsertIntoEditor: false, context: null });
        await performInsert(s.deps);
        expect(s.deps.insert.getState()).toMatchObject({ isOpen: true, errorMessage: INSERT_TEXTS.needsTeX });
        expect(textOf(s, BIB)).toBe('@book{a,\n}\n');
    });

    it('schließt offene Schnellsuche und merkt Datei und Zeile der Umgebung', async () => {
        const s = await setup();
        s.open(TEX, 'eins\nzwei\ndrei');
        s.editor.getState().session(TEX)?.select({ anchor: 6, head: 6 });
        s.deps.overlays.getState().show('quickOpen');
        openInsertDialog(s.deps);
        expect(s.deps.overlays.getState().active).toBeNull();
        expect(s.deps.insert.getState().context).toMatchObject({ fileName: 'test.tex', firstLineNumber: 1 });
    });

    it('der Katalog nennt Bilder, Literaturdatei und Hauptdatei-Pfad des Projekts', async () => {
        const s = await setup();
        s.open(TEX, 'x');
        openInsertDialog(s.deps);
        await refreshInsertCatalog(s.deps);
        const { catalog } = s.deps.insert.getState();
        expect(catalog.projectRoot).toBe(ROOT);
        expect(catalog.images.map((image) => image.relative)).toEqual(['bilder/logo.png']);
        expect(catalog.bibliography).toEqual({ path: BIB, name: 'literatur.bib' });
    });
});

describe('Einfügen im Editor', () => {
    it('Tabelle: ein Undo-Schritt, Block in eigenen Zeilen, Cursor dahinter, Meldung, Fenster zu', async () => {
        const s = await setup();
        s.open(TEX, 'Text vorne');
        s.editor.getState().session(TEX)?.select({ anchor: 5, head: 5 });
        const before = s.editor.getState().session(TEX)!.state;
        await openAndInsert(s, 'table');
        const session = s.editor.getState().session(TEX)!;
        const text = textOf(s);
        expect(text.startsWith('Text \n\\begin{table}')).toBe(true);
        expect(text.endsWith('\\end{table}\nvorne')).toBe(true);
        expect(undoDepth(session.state)).toBe(1);
        expect(afterUndo(session.state).doc.toString()).toBe(before.doc.toString());
        expect(session.state.selection.main.head).toBe(text.length - 'vorne'.length);
        expect(s.deps.insert.getState().isOpen).toBe(false);
        expect(s.messages.at(-1)).toEqual({ text: 'Tabelle eingefügt.', kind: 'info' });
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(s.deps.focusEditor).toHaveBeenCalled();
    });

    it('markierter Text wird Inhalt der Gleichung und dabei ersetzt', async () => {
        const s = await setup();
        s.open(TEX, 'vorher FORMEL nachher');
        s.editor.getState().session(TEX)?.select({ anchor: 7, head: 13 });
        await openAndInsert(s, 'equation');
        expect(textOf(s)).toBe('vorher \n\\begin{equation}\n\tFORMEL\n\\end{equation}\n nachher');
        expect(undoDepth(s.editor.getState().session(TEX)!.state)).toBe(1);
    });

    it('Label ist eindeutig gegenüber Index und vorderer Datei', async () => {
        const index: CompletionIndexSnapshot = { ...EMPTY_COMPLETION_INDEX, labels: [{ label: 'tab:werte', file: 'a.tex', line: 2 }] };
        const s = await setup(index);
        s.open(TEX, '\\label{tab:werte-2}\n');
        s.deps.insert.getState().update('table', (table) => ({ ...table, caption: 'Werte' }));
        await openAndInsert(s, 'table');
        expect(textOf(s)).toContain('\\label{tab:werte-3}');
    });

    it('Verweis und Zitat stehen im Fließtext (kein eigener Zeilenblock)', async () => {
        const index: CompletionIndexSnapshot = {
            ...EMPTY_COMPLETION_INDEX,
            labels: [{ label: 'fig:a', file: 'a.tex', line: 1 }],
            citations: [{ key: 'knuth1984', summary: 'Knuth 1984', searchText: '' }],
        };
        const s = await setup(index);
        s.open(TEX, 'Siehe  und ');
        s.editor.getState().session(TEX)?.select({ anchor: 6, head: 6 });
        await openAndInsert(s, 'reference');
        expect(textOf(s)).toBe('Siehe Abbildung~\\ref{fig:a} und ');
        openInsertDialog(s.deps, 'citation');
        await refreshInsertCatalog(s.deps);
        s.deps.insert.getState().update('citation', (citation) => ({ ...citation, keys: ['knuth1984'] }));
        await performInsert(s.deps);
        expect(textOf(s)).toContain('\\cite{knuth1984}');
    });

    it('Abbrechen schließt ohne Änderung und gibt den Fokus zurück', async () => {
        const s = await setup();
        s.open(TEX, 'Text');
        openInsertDialog(s.deps, 'list');
        closeInsertDialog(s.deps);
        expect(s.deps.insert.getState().isOpen).toBe(false);
        expect(textOf(s)).toBe('Text');
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(s.deps.focusEditor).toHaveBeenCalled();
    });
});

describe('Bild', () => {
    it('aus dem Projekt: nicht kopiert, Pfad ohne \\graphicspath-Anteil', async () => {
        const s = await setup();
        s.open(TEX, '');
        openInsertDialog(s.deps, 'image');
        await refreshInsertCatalog(s.deps);
        chooseProjectImage(s.deps, `${ROOT}/bilder/logo.png`);
        await performInsert(s.deps);
        expect(textOf(s)).toContain('\\includegraphics[width=.75\\textwidth]{bilder/logo.png}');
        expect(s.calls('image:import')).toHaveLength(0);
    });

    it('per Dateidialog: nach images/ kopiert, \\includegraphics bekommt den Pfad aus dem Main', async () => {
        const s = await setup();
        s.control.prepareFile('foto.png', 'x');
        s.open(TEX, '');
        openInsertDialog(s.deps, 'image');
        await chooseImageFile(s.deps);
        const choice = s.deps.insert.getState().imageChoice;
        expect(choice).toMatchObject({ kind: 'external', name: 'foto.png' });
        await performInsert(s.deps);
        expect(s.calls('image:import').map((call) => call.args)).toEqual([[(choice as { grantId: string }).grantId, `${ROOT}/images`]]);
        expect(textOf(s)).toContain('{images/bild.png}');
        expect(undoDepth(s.editor.getState().session(TEX)!.state)).toBe(1);
    });

    it('per Drag & Drop: Gewährung über den Preload, unbrauchbare Formate werden gemeldet', async () => {
        const s = await setup();
        s.open(TEX, '');
        openInsertDialog(s.deps, 'image');
        const good = new File(['x'], 'bild.jpg');
        s.stub.setPathForFile(good, '/außen/bild.jpg');
        await dropImageFiles(s.deps, [good]);
        expect(s.deps.insert.getState().imageChoice).toMatchObject({ kind: 'external', name: 'bild.jpg' });
        await dropImageFiles(s.deps, [new File(['x'], 'anim.gif')]);
        expect(s.deps.insert.getState().errorMessage).toBe(IMAGE_TEXTS.unsupported('anim.gif'));
    });

    it('ein Fehler beim Kopieren bleibt im Fenster, nichts wird eingefügt', async () => {
        const s = await setup();
        s.stub.respond('image:import', () => {
            throw new Error('Platte voll');
        });
        s.control.prepareFile('foto.png', 'x');
        s.open(TEX, 'Text');
        openInsertDialog(s.deps, 'image');
        await chooseImageFile(s.deps);
        await performInsert(s.deps);
        expect(s.deps.insert.getState()).toMatchObject({ isOpen: true, errorMessage: 'Interner Fehler: Platte voll', isBusy: false });
        expect(textOf(s)).toBe('Text');
    });
});

describe('Quelle', () => {
    function fillBook(s: Setup, citeAfterInsert: boolean): void {
        const insert = s.deps.insert.getState();
        insert.update('source', (source) => ({
            ...source, type: 'book', authors: 'Max Mustermann', values: { title: 'Ein Buch', publisher: 'Verlag', date: '2024' },
        }));
        insert.update('sourceOptions', () => ({ citeAfterInsert, note: '' }));
    }

    it('Ziel-.bib nicht offen: bib:append mit dem Eintrag, danach \\cite, Rückgängig-Schritt und Meldung', async () => {
        const s = await setup();
        s.open(TEX, 'Beleg: ');
        s.editor.getState().session(TEX)?.select({ anchor: 7, head: 7 });
        fillBook(s, true);
        await openAndInsert(s, 'source');
        const [append] = s.calls('bib:append');
        expect(append?.args[0]).toBe(BIB);
        expect(String(append?.args[1])).toContain('@book{Mustermann2024,');
        expect(textOf(s)).toBe('Beleg: \\cite{Mustermann2024}');
        expect(s.deps.insert.getState()).toMatchObject({ isOpen: false });
        expect(s.deps.insert.getState().source.authors).toBe('');
        expect(s.deps.appUndo.getState().undoTitle).toBe('Quelle „Mustermann2024“ anlegen');
        expect(s.messages.at(-1)?.text).toContain('Quelle „Mustermann2024“ in literatur.bib angelegt');
        await s.deps.appUndo.getState().undo();
        expect(s.calls('bib:undo').map((call) => call.args)).toEqual([['stub-undo']]);
    });

    it('Ziel-.bib im Editor offen: Eintrag in den Puffer (ein Undo-Schritt), kein bib:append', async () => {
        const s = await setup();
        s.open(BIB, '@book{a,\n}\n');
        s.open(TEX, 'Beleg: ');
        s.editor.getState().activate(TEX);
        s.editor.getState().session(TEX)?.select({ anchor: 7, head: 7 });
        fillBook(s, true);
        await openAndInsert(s, 'source');
        expect(s.calls('bib:append')).toHaveLength(0);
        const bib = textOf(s, BIB);
        expect(bib.startsWith('@book{a,\n}\n\n@book{Mustermann2024,')).toBe(true);
        expect(undoDepth(s.editor.getState().session(BIB)!.state)).toBe(1);
        expect(s.editor.getState().files[BIB]?.isDirty).toBe(true);
        expect(textOf(s)).toBe('Beleg: \\cite{Mustermann2024}');
        expect(s.deps.appUndo.getState().undoTitle).toBeNull();
    });

    it('ohne Zitieren braucht die Quelle keine .tex-Datei', async () => {
        const s = await setup();
        fillBook(s, false);
        await openAndInsert(s, 'source');
        expect(s.calls('bib:append')).toHaveLength(1);
        expect(s.deps.insert.getState().isOpen).toBe(false);
    });

    it('Schreibfehler: Meldung im Fenster, kein Zitat, Fenster bleibt offen', async () => {
        const s = await setup();
        s.stub.respond('bib:append', () => {
            throw new Error('gesperrt');
        });
        s.open(TEX, 'Beleg: ');
        fillBook(s, true);
        await openAndInsert(s, 'source');
        expect(s.deps.insert.getState()).toMatchObject({ isOpen: true, errorMessage: 'literatur.bib konnte nicht geschrieben werden: Interner Fehler: gesperrt' });
        expect(textOf(s)).toBe('Beleg: ');
        expect(s.deps.appUndo.getState().undoTitle).toBeNull();
    });

    it('Pflichtfelder fehlen: Hinweis statt Schreiben', async () => {
        const s = await setup();
        s.open(TEX, '');
        openInsertDialog(s.deps, 'source');
        await refreshInsertCatalog(s.deps);
        await performInsert(s.deps);
        expect(s.deps.insert.getState().errorMessage).toContain('Bitte noch ausfüllen');
        expect(s.calls('bib:append')).toHaveLength(0);
    });
});
