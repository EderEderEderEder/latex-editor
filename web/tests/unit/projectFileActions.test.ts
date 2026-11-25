import { describe, expect, it, vi } from 'vitest';
import type { RendererApi, TreeNode } from '../../src/shared/contract';
import { saveFile } from '../../src/renderer/app/fileActions';
import { openProjectFile } from '../../src/renderer/app/projectFiles';
import {
    beginMove, beginNewEntry, beginRename, createEntry, duplicateEntry, FILE_ACTION_TEXTS, moveEntry, redoFileAction,
    renameEntry, trashEntry, undoFileAction,
} from '../../src/renderer/app/projectFileActions';
import type { ProjectFileActionDeps } from '../../src/renderer/app/projectFileActions';
import type { FileActionAsk, NameQuestion, ReferenceChoice } from '../../src/renderer/app/projectFileActionsPrompts';
import { treeFileKey, treeMenuItems } from '../../src/renderer/app/projectFileActionsTree';
import { createAppUndoStore } from '../../src/renderer/stores/appUndo';
import { createEditorStore } from '../../src/renderer/stores/editor';
import { createProjectStore } from '../../src/renderer/stores/project';
import { createSidebarStore } from '../../src/renderer/stores/sidebar';
import type { StatusMessage } from '../../src/renderer/stores/status';
import { createPreloadStub } from '../support/preloadStub';

// W2-9: Datei-Aktionen gegen das virtuelle Dateisystem des Stubs (`VirtualFileOps` spielt `main/fsOps.ts` nach).
// Geprüft wird jeweils Platte (Einträge, Texte), Baum, Tabs und das App-Rückgängig, das alles byte-gleich herstellt.

const GRANT = 'stub-project-grant';
const ROOT = '/stub/projekt';
const MAIN = `${ROOT}/main.tex`;
const INTRO = `${ROOT}/kapitel/einleitung.tex`;
const MAIN_TEXT = '\\chapter{Einleitung}\n\\input{kapitel/einleitung}\n\\input{kapitel/fazit}\n';

interface StubControl {
    installSampleProject(extra?: number): void;
    projectEntries(): string[];
    projectFileText(relativePath: string): string | null;
}

interface Answers {
    references: ReferenceChoice;
    trash: boolean;
    moveTarget: string | null;
    name: string | null;
}

function fakeAsk(answers: Answers, nameErrors: (string | null)[]): FileActionAsk & { questions: NameQuestion[] } {
    const questions: NameQuestion[] = [];
    return {
        questions,
        askName: async (question) => {
            questions.push(question);
            if (answers.name !== null) nameErrors.push(await question.submit(answers.name));
        },
        confirmTrash: vi.fn(() => Promise.resolve(answers.trash)),
        askReferenceUpdate: vi.fn(() => Promise.resolve(answers.references)),
        askMoveTarget: vi.fn(() => Promise.resolve(answers.moveTarget)),
    };
}

async function setup() {
    const stub = createPreloadStub();
    const control = (stub.api as unknown as { __stub: StubControl }).__stub;
    control.installSampleProject();
    const api = stub.api as RendererApi;
    const editor = createEditorStore();
    const project = createProjectStore({ api: () => api, delayMs: 0 });
    const opened = await api.project.open(GRANT);
    if (!opened.ok) throw new Error('Stub-Projekt fehlt');
    project.getState().setProject(opened.value, GRANT);
    const messages: StatusMessage[] = [];
    const report = (message: StatusMessage): void => void messages.push(message);
    const answers: Answers = { references: 'update', trash: true, moveTarget: null, name: null };
    const nameErrors: (string | null)[] = [];
    const ask = fakeAsk(answers, nameErrors);
    const undo = createAppUndoStore();
    const deps: ProjectFileActionDeps = {
        api, editor, project, sidebar: createSidebarStore(), undo, ask, report, platform: { windows: false },
        open: (path, asPreview) => openProjectFile({ api, store: editor, report }, path, asPreview),
        save: (path) => saveFile({ api, store: editor, report }, path),
    };
    const openTab = async (path: string, edit?: string): Promise<void> => {
        await deps.open(path, false);
        if (edit !== undefined) editor.getState().session(path)!.dispatch({ changes: { from: 0, insert: edit } });
    };
    const textOf = (path: string): string | undefined => editor.getState().session(path)?.state.doc.toString();
    return { stub, control, deps, editor, project, undo, messages, answers, ask, nameErrors, openTab, textOf };
}

function treeNames(project: ReturnType<typeof createProjectStore>): string[] {
    const names: string[] = [];
    const visit = (nodes: readonly TreeNode[], prefix: string): void => {
        for (const node of nodes) {
            names.push(prefix + node.name);
            if (node.kind === 'directory') visit(node.children, `${prefix}${node.name}/`);
        }
    };
    visit(project.getState().current?.tree.children ?? [], '');
    return names;
}

describe('Umbenennen mit Verweisen', () => {
    it('passt \\input in main.tex an, Tabs folgen mit ungespeichertem Text; Rückgängig stellt alles byte-gleich her', async () => {
        const { control, deps, editor, project, undo, openTab, textOf } = await setup();
        const before = control.projectEntries();
        await openTab(INTRO, '% neu\n');
        expect(await renameEntry(deps, INTRO, 'intro')).toBeNull();
        expect(control.projectFileText('main.tex')).toBe(MAIN_TEXT.replace('kapitel/einleitung', 'kapitel/intro'));
        expect(control.projectEntries()).toContain('kapitel/intro.tex');
        expect(treeNames(project)).toContain('kapitel/intro.tex');
        expect(editor.getState().tabs.items).toEqual([`${ROOT}/kapitel/intro.tex`]);
        expect(textOf(`${ROOT}/kapitel/intro.tex`)?.startsWith('% neu\n')).toBe(true);
        expect(editor.getState().files[`${ROOT}/kapitel/intro.tex`]?.isDirty).toBe(true);
        expect(undo.getState().undoTitle).toBe(FILE_ACTION_TEXTS.rename);

        expect(await undoFileAction(deps)).toBe(true);
        expect(control.projectFileText('main.tex')).toBe(MAIN_TEXT);
        expect(control.projectEntries()).toEqual(before);
        expect(editor.getState().tabs.items).toEqual([INTRO]);
        expect(textOf(INTRO)?.startsWith('% neu\n')).toBe(true);
        expect(undo.getState().redoTitle).toBe(FILE_ACTION_TEXTS.rename);
    });

    it('ändert eine offene, gespeicherte main.tex im Editor und speichert sie; Rückgängig setzt Text und Platte zurück', async () => {
        const { control, deps, editor, openTab, textOf } = await setup();
        await openTab(MAIN);
        await renameEntry(deps, INTRO, 'intro.tex');
        expect(textOf(MAIN)).toContain('\\input{kapitel/intro}');
        expect(control.projectFileText('main.tex')).toContain('\\input{kapitel/intro}');
        expect(editor.getState().files[MAIN]?.isDirty).toBe(false);
        await undoFileAction(deps);
        expect(textOf(MAIN)).toBe(MAIN_TEXT);
        expect(control.projectFileText('main.tex')).toBe(MAIN_TEXT);
    });

    it('Wiederholen benennt erneut um und passt die Verweise wieder an', async () => {
        const { control, deps } = await setup();
        await renameEntry(deps, INTRO, 'intro');
        await undoFileAction(deps);
        expect(await redoFileAction(deps)).toBe(true);
        expect(control.projectEntries()).toContain('kapitel/intro.tex');
        expect(control.projectFileText('main.tex')).toContain('\\input{kapitel/intro}');
        await undoFileAction(deps);
        expect(control.projectFileText('main.tex')).toBe(MAIN_TEXT);
    });

    it('rechnet beim Rückgängig neu, wenn die Stelle inzwischen verschoben ist (Text davor eingefügt)', async () => {
        const { control, deps, openTab, textOf } = await setup();
        await openTab(MAIN);
        await renameEntry(deps, INTRO, 'intro');
        deps.editor.getState().session(MAIN)!.dispatch({ changes: { from: 0, insert: '% Vorspann\n' } });
        await undoFileAction(deps);
        expect(textOf(MAIN)).toBe(`% Vorspann\n${MAIN_TEXT}`);
        expect(control.projectEntries()).toContain('kapitel/einleitung.tex');
    });

    it('„Nur umbenennen“ lässt die Verweise, „Abbrechen“ ändert nichts', async () => {
        const { control, deps, answers, undo } = await setup();
        answers.references = 'cancel';
        await renameEntry(deps, INTRO, 'intro');
        expect(control.projectEntries()).toContain('kapitel/einleitung.tex');
        expect(undo.getState().undoTitle).toBeNull();
        answers.references = 'skip';
        await renameEntry(deps, INTRO, 'intro');
        expect(control.projectEntries()).toContain('kapitel/intro.tex');
        expect(control.projectFileText('main.tex')).toBe(MAIN_TEXT);
    });

    it('Ordner umbenennen zieht Tabs darin mit und passt beide \\input an', async () => {
        const { control, deps, editor, openTab } = await setup();
        await openTab(`${ROOT}/kapitel/fazit.tex`);
        await renameEntry(deps, `${ROOT}/kapitel`, 'chapters');
        expect(control.projectFileText('main.tex')).toBe(MAIN_TEXT.replaceAll('kapitel/', 'chapters/'));
        expect(editor.getState().tabs.items).toEqual([`${ROOT}/chapters/fazit.tex`]);
        await undoFileAction(deps);
        expect(control.projectFileText('main.tex')).toBe(MAIN_TEXT);
        expect(editor.getState().tabs.items).toEqual([`${ROOT}/kapitel/fazit.tex`]);
    });

    it('meldet einen belegten Namen und lässt den Dialog offen (Fehlertext zurück)', async () => {
        const { deps } = await setup();
        expect(await renameEntry(deps, INTRO, 'fazit')).toContain('existiert');
    });

    it('der Dialog prüft beim Tippen; „submit“ führt aus', async () => {
        const { control, deps, ask } = await setup();
        await beginRename(deps, INTRO);
        const question = ask.questions[0]!;
        expect(question.initialName).toBe('einleitung.tex');
        expect(question.selectsBaseName).toBe(true);
        expect(question.location).toBe('in kapitel');
        expect(question.validate('fazit')).toContain('existiert');
        expect(question.validate('Einleitung')).toBeNull();
        expect(question.validate('a/b')).not.toBeNull();
        expect(question.validate('')).not.toBeNull();
        expect(await question.submit('intro')).toBeNull();
        expect(control.projectEntries()).toContain('kapitel/intro.tex');
    });
});

describe('Verschieben', () => {
    it('Ziehen in die Wurzel passt den Verweis an; Rückgängig verschiebt zurück', async () => {
        const { control, deps } = await setup();
        expect(await moveEntry(deps, `${ROOT}/kapitel/fazit.tex`, ROOT)).toBe(true);
        expect(control.projectEntries()).toContain('fazit.tex');
        expect(control.projectFileText('main.tex')).toBe(MAIN_TEXT.replace('kapitel/fazit', 'fazit'));
        await undoFileAction(deps);
        expect(control.projectEntries()).toContain('kapitel/fazit.tex');
        expect(control.projectFileText('main.tex')).toBe(MAIN_TEXT);
    });

    it('lehnt einen Ordner in sich selbst ab und tut nichts im selben Ordner', async () => {
        const { deps, messages, undo } = await setup();
        expect(await moveEntry(deps, `${ROOT}/kapitel`, `${ROOT}/kapitel`)).toBe(false);
        expect(messages.at(-1)?.text).toBe(FILE_ACTION_TEXTS.intoItself);
        expect(await moveEntry(deps, INTRO, `${ROOT}/kapitel`)).toBe(false);
        expect(undo.getState().undoTitle).toBeNull();
    });

    it('„Verschieben nach …“ nimmt den gewählten Ordner', async () => {
        const { control, deps, answers } = await setup();
        answers.moveTarget = `${ROOT}/bilder`;
        await beginMove(deps, INTRO);
        expect(control.projectEntries()).toContain('bilder/einleitung.tex');
        expect(control.projectFileText('main.tex')).toContain('\\input{bilder/einleitung}');
    });
});

describe('Papierkorb', () => {
    it('schließt den Tab; Rückgängig holt Datei und ungespeicherte Änderungen zurück, Wiederholen legt sie wieder hinein', async () => {
        const { control, deps, editor, openTab, textOf, ask } = await setup();
        await openTab(INTRO, 'UNGESPEICHERT ');
        expect(await trashEntry(deps, INTRO)).toBe(true);
        const question = vi.mocked(ask.confirmTrash).mock.calls[0]![0];
        expect(question.title).toBe(FILE_ACTION_TEXTS.trashTitle('einleitung.tex'));
        expect(question.detail.some((line) => line.includes('einleitung.tex'))).toBe(true);
        expect(control.projectEntries()).not.toContain('kapitel/einleitung.tex');
        expect(editor.getState().tabs.items).not.toContain(INTRO);

        await undoFileAction(deps);
        expect(control.projectEntries()).toContain('kapitel/einleitung.tex');
        expect(textOf(INTRO)?.startsWith('UNGESPEICHERT ')).toBe(true);
        expect(editor.getState().files[INTRO]?.isDirty).toBe(true);
        expect(control.projectFileText('kapitel/einleitung.tex')).toBe('\\section{Motivation}\nText\n\\section{Ziel}\nText\n');

        await redoFileAction(deps);
        expect(control.projectEntries()).not.toContain('kapitel/einleitung.tex');
    });

    it('tut ohne Bestätigung nichts und warnt bei der Hauptdatei', async () => {
        const { control, deps, answers, ask } = await setup();
        answers.trash = false;
        expect(await trashEntry(deps, MAIN)).toBe(false);
        expect(control.projectEntries()).toContain('main.tex');
        expect(vi.mocked(ask.confirmTrash).mock.calls[0]![0].detail).toContain(FILE_ACTION_TEXTS.trashMain);
    });
});

describe('Anlegen und Duplizieren', () => {
    it('neue Datei bekommt .tex, öffnet fest; Rückgängig legt sie in den Papierkorb und schließt den Tab', async () => {
        const { control, deps, editor } = await setup();
        expect(await createEntry(deps, `${ROOT}/kapitel`, 'neu', 'file')).toBeNull();
        expect(control.projectEntries()).toContain('kapitel/neu.tex');
        expect(editor.getState().tabs.active).toBe(`${ROOT}/kapitel/neu.tex`);
        await undoFileAction(deps);
        expect(control.projectEntries()).not.toContain('kapitel/neu.tex');
        expect(editor.getState().tabs.items).not.toContain(`${ROOT}/kapitel/neu.tex`);
        await redoFileAction(deps);
        expect(control.projectEntries()).toContain('kapitel/neu.tex');
        expect(editor.getState().tabs.items).toContain(`${ROOT}/kapitel/neu.tex`);
    });

    it('neuer Ordner im gewählten Ordner; Name schon vorhanden ergibt einen Fehlertext', async () => {
        const { control, deps, answers, nameErrors } = await setup();
        deps.sidebar.getState().select(INTRO);
        answers.name = 'abbildungen';
        await beginNewEntry(deps, 'directory');
        expect(control.projectEntries()).toContain('kapitel/abbildungen/');
        expect(await createEntry(deps, `${ROOT}/kapitel`, 'abbildungen', 'directory')).toContain('existiert');
        expect(nameErrors).toEqual([null]);
    });

    it('Duplizieren legt „… Kopie.tex“ an; Rückgängig entfernt die Kopie', async () => {
        const { control, deps } = await setup();
        expect(await duplicateEntry(deps, INTRO)).toBe(true);
        expect(control.projectEntries()).toContain('kapitel/einleitung Kopie.tex');
        expect(control.projectFileText('kapitel/einleitung Kopie.tex')).toBe(control.projectFileText('kapitel/einleitung.tex'));
        await undoFileAction(deps);
        expect(control.projectEntries()).not.toContain('kapitel/einleitung Kopie.tex');
    });
});

describe('Rückgängig-Meldungen und Baum-Befehle', () => {
    it('meldet „… rückgängig gemacht“ bzw. „nichts zu tun“', async () => {
        const { deps, messages } = await setup();
        expect(await undoFileAction(deps)).toBe(false);
        expect(messages.at(-1)?.text).toBe('Keine Datei-Aktion zum Rückgängigmachen.');
        await createEntry(deps, ROOT, 'a', 'file');
        await undoFileAction(deps);
        expect(messages.at(-1)?.text).toBe('„Neue Datei“ rückgängig gemacht');
        await redoFileAction(deps);
        expect(messages.at(-1)?.text).toBe('„Neue Datei“ wiederholt');
    });

    it('Tasten im Baum: F2, Entf, Menü-Taste, Umschalt+F10, Strg+Z, Strg+Y, ⌘⌫', () => {
        const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
            treeFileKey({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
        expect(key('F2')).toBe('rename');
        expect(key('Delete')).toBe('trash');
        expect(key('ContextMenu')).toBe('menu');
        expect(key('F10', { shiftKey: true })).toBe('menu');
        expect(key('z', { ctrlKey: true })).toBe('undo');
        expect(key('Z', { metaKey: true, shiftKey: true })).toBe('redo');
        expect(key('y', { ctrlKey: true })).toBe('redo');
        expect(key('Backspace', { metaKey: true })).toBe('trash');
        expect(key('z', { ctrlKey: true, altKey: true })).toBeNull();
        expect(key('ArrowDown')).toBeNull();
    });

    it('Kontextmenü: Datei mit Duplizieren, Ordner ohne, freie Fläche nur Neu', async () => {
        const { deps } = await setup();
        const labels = (row: Parameters<typeof treeMenuItems>[0]) =>
            treeMenuItems(row, ROOT, () => deps).flatMap((item) => (item.kind === 'item' ? [item.label] : []));
        const fileRow = { path: INTRO, name: 'einleitung.tex', label: 'einleitung.tex', kind: 'file', depth: 1, isExpanded: null,
            isBuildFile: false, parentPath: `${ROOT}/kapitel`, position: 1, siblingCount: 2 } as const;
        expect(labels(fileRow)).toEqual([
            'Neue Datei …', 'Neuer Ordner …', 'Umbenennen …', 'Duplizieren', 'Verschieben nach …', 'In den Papierkorb legen', 'Pfad kopieren',
        ]);
        expect(labels({ ...fileRow, kind: 'directory', path: `${ROOT}/kapitel`, isExpanded: true })).not.toContain('Duplizieren');
        expect(labels(null)).toEqual(['Neue Datei …', 'Neuer Ordner …']);
    });
});
