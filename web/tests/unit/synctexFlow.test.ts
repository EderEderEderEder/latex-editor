import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectInfo, RendererApi, SyncTexForwardResult, TextFile } from '../../src/shared/contract';
import { IpcFailure } from '../../src/shared/ipcResult';
import {
    connectSyncTeX,
    FOLLOW_CURSOR_DELAY_MS,
    isSyncTeXClick,
    revealCursorInPdf,
    showPdfPointInEditor,
    SYNCTEX_TEXTS,
} from '../../src/renderer/app/synctexFlow';
import type { SyncTeXFlowDeps, SyncTeXTarget, SyncTeXViewerPort, ViewerRevealResult } from '../../src/renderer/app/synctexFlow';
import { createEditorStore } from '../../src/renderer/stores/editor';
import type { EditorStore } from '../../src/renderer/stores/editor';
import { createProjectStore } from '../../src/renderer/stores/project';
import type { StatusMessage } from '../../src/renderer/stores/status';
import { createSyncTeXStore } from '../../src/renderer/stores/synctex';
import { createViewModeStore } from '../../src/renderer/stores/viewMode';
import { createPreloadStub } from '../support/preloadStub';
import type { StubControl } from '../support/preloadStub';

// W3-5: SyncTeX-Abläufe mit Fakes (Stub-Preload, Fake-Viewer, echte Stores). Beispielprojekt des Stubs: /stub/projekt.

afterEach(() => vi.useRealTimers());

const ROOT = '/stub/projekt';
const CHAPTER = `${ROOT}/kapitel/einleitung.tex`;
const CHAPTER_TEXT = '\\section{Motivation}\nText\n\\section{Ziel}\nText\n';
const OUTSIDE = '/anderswo/fremd.tex';
const PAGE_COUNT = 4;
const FORWARD: SyncTexForwardResult = {
    page: 3,
    rects: [{ x: 10, y: 100, width: 50, height: 10 }, { x: 10, y: 112, width: 80, height: 10 }],
};
const UNION = { x: 10, y: 100, width: 80, height: 22 };
const POINT = { x: 100, y: 200 };

class FakeViewer implements SyncTeXViewerPort {
    readonly reveals: { target: SyncTeXTarget; onlyIfHidden: boolean }[] = [];
    isTargetVisible = false;
    result: ViewerRevealResult = 'scrolled';

    reveal(target: SyncTeXTarget, onlyIfHidden: boolean): ViewerRevealResult {
        this.reveals.push({ target, onlyIfHidden });
        return onlyIfHidden && this.isTargetVisible ? 'visible' : this.result;
    }
}

function textFile(path: string, text: string): TextFile {
    return { path, name: path.split('/').at(-1) ?? path, text, encoding: 'utf8', eol: 'lf', hash: 'h', mtime: 0 };
}

function openAtLine(editor: EditorStore, path: string, text: string, line: number): void {
    editor.getState().open(textFile(path, text), { asPreview: false });
    editor.getState().session(path)!.revealLine(line);
}

function setup(options: { readonly pageCount?: number; readonly root?: string | null } = {}) {
    const stub = createPreloadStub();
    const control = (stub.api as unknown as { __stub: StubControl }).__stub;
    control.installSampleProject();
    const editor = createEditorStore();
    const viewMode = createViewModeStore();
    const synctex = createSyncTeXStore(() => 0);
    const viewer = new FakeViewer();
    const messages: StatusMessage[] = [];
    const focusEditor = vi.fn();
    const root = options.root === undefined ? ROOT : options.root;
    const pageCount = options.pageCount ?? PAGE_COUNT;
    const report = (message: StatusMessage): void => void messages.push(message);
    const api = stub.api as RendererApi;
    const deps: SyncTeXFlowDeps = {
        api, editor, viewMode, synctex, report,
        project: { getState: () => ({ current: root === null ? null : { root } }) } as unknown as SyncTeXFlowDeps['project'],
        pdf: { getState: () => ({ pageCount }) } as unknown as SyncTeXFlowDeps['pdf'],
        viewer: () => viewer,
        reveal: () => ({ api, store: editor, report, focusEditor }),
    };
    const callsOf = (channel: string) => stub.calls.filter((call) => call.channel === channel).map((call) => call.args);
    return { stub, control, editor, viewMode, synctex, viewer, messages, focusEditor, deps, callsOf };
}

describe('Vorwärts (Strg+J)', () => {
    it('fragt mit Datei und Cursorzeile, scrollt zur Vereinigung der Rechtecke, ohne Meldung', async () => {
        const { control, editor, viewer, messages, deps, callsOf, synctex } = setup();
        control.setSyncTeX(FORWARD, null);
        openAtLine(editor, CHAPTER, CHAPTER_TEXT, 2);
        expect(await revealCursorInPdf(deps, 'explicit')).toBe('shown');
        expect(callsOf('synctex:forward')).toEqual([[CHAPTER, 2]]);
        expect(viewer.reveals).toEqual([{ target: { page: 3, rect: UNION }, onlyIfHidden: false }]);
        expect(messages).toEqual([]);
        expect(synctex.getState().lastRequest).toMatchObject({ kind: 'forward', outcome: 'shown' });
    });

    it('wechselt im Modus „Editor“ nach „Geteilt“, im Modus „PDF“ bleibt es', async () => {
        const { control, editor, viewMode, deps } = setup();
        control.setSyncTeX(FORWARD, null);
        openAtLine(editor, CHAPTER, CHAPTER_TEXT, 1);
        viewMode.getState().setMode('editor');
        await revealCursorInPdf(deps, 'explicit');
        expect(viewMode.getState().mode).toBe('split');
        viewMode.getState().setMode('pdf');
        await revealCursorInPdf(deps, 'explicit');
        expect(viewMode.getState().mode).toBe('pdf');
    });

    it('ohne SyncTeX-Daten: freundliche Meldung, kein Scrollen, kein Moduswechsel', async () => {
        const { editor, viewMode, viewer, messages, deps } = setup();
        openAtLine(editor, CHAPTER, CHAPTER_TEXT, 1);
        viewMode.getState().setMode('editor');
        expect(await revealCursorInPdf(deps, 'explicit')).toBe('noSyncTeX');
        expect(messages).toEqual([{ text: SYNCTEX_TEXTS.noSyncTeX, kind: 'info' }]);
        expect(viewer.reveals).toEqual([]);
        expect(viewMode.getState().mode).toBe('editor');
    });

    it('Antwort null bei geladenen Daten: Zeile ohne Stelle im PDF', async () => {
        const { editor, synctex, messages, deps } = setup();
        synctex.getState().markReady(1);
        openAtLine(editor, CHAPTER, CHAPTER_TEXT, 3);
        expect(await revealCursorInPdf(deps, 'explicit')).toBe('notFound');
        expect(messages).toEqual([{ text: SYNCTEX_TEXTS.lineNotFound('einleitung.tex', 3), kind: 'info' }]);
    });

    it('ohne Datei, mit Datei außerhalb des Projekts oder ohne PDF wird nicht gefragt', async () => {
        const noPdf = setup({ pageCount: 0 });
        expect(await revealCursorInPdf(noPdf.deps, 'explicit')).toBe('noFile');
        openAtLine(noPdf.editor, CHAPTER, CHAPTER_TEXT, 1);
        expect(await revealCursorInPdf(noPdf.deps, 'explicit')).toBe('noPdf');
        expect(noPdf.messages.map((message) => message.text)).toEqual([SYNCTEX_TEXTS.noFile, SYNCTEX_TEXTS.noPdf]);
        const outside = setup();
        openAtLine(outside.editor, OUTSIDE, 'x\n', 1);
        expect(await revealCursorInPdf(outside.deps, 'explicit')).toBe('notInProject');
        expect(outside.messages).toEqual([{ text: SYNCTEX_TEXTS.notInProject('fremd.tex'), kind: 'info' }]);
        expect([...noPdf.callsOf('synctex:forward'), ...outside.callsOf('synctex:forward')]).toEqual([]);
    });

    it('ein Fehler des Mains wird gemeldet, nicht geworfen', async () => {
        const { stub, editor, messages, deps } = setup();
        stub.respond('synctex:forward', () => {
            throw new IpcFailure({ kind: 'forbiddenPath', message: 'außerhalb' });
        });
        openAtLine(editor, CHAPTER, CHAPTER_TEXT, 1);
        expect(await revealCursorInPdf(deps, 'explicit')).toBe('failed');
        expect(messages).toEqual([{ text: SYNCTEX_TEXTS.failed('außerhalb'), kind: 'error' }]);
    });

    it('eine überholte Antwort scrollt nicht mehr', async () => {
        const { stub, editor, viewer, deps } = setup();
        let answerFirst: (value: SyncTexForwardResult) => void = () => undefined;
        stub.respond('synctex:forward', () => new Promise<SyncTexForwardResult>((resolve) => {
            answerFirst = resolve;
        }));
        openAtLine(editor, CHAPTER, CHAPTER_TEXT, 1);
        const first = revealCursorInPdf(deps, 'follow');
        stub.respond('synctex:forward', () => FORWARD);
        expect(await revealCursorInPdf(deps, 'follow')).toBe('shown');
        answerFirst({ page: 1, rects: [UNION] });
        expect(await first).toBe('superseded');
        expect(viewer.reveals).toHaveLength(1);
    });
});

describe('PDF folgt Cursor', () => {
    it('scrollt nur, wenn die Stelle unsichtbar ist, und meldet nie etwas', async () => {
        const { control, editor, viewer, messages, deps } = setup();
        control.setSyncTeX(FORWARD, null);
        openAtLine(editor, CHAPTER, CHAPTER_TEXT, 2);
        viewer.isTargetVisible = true;
        expect(await revealCursorInPdf(deps, 'follow')).toBe('alreadyVisible');
        viewer.isTargetVisible = false;
        expect(await revealCursorInPdf(deps, 'follow')).toBe('shown');
        expect(viewer.reveals.map((entry) => entry.onlyIfHidden)).toEqual([true, true]);
        control.setSyncTeX(null, null);
        expect(await revealCursorInPdf(deps, 'follow')).toBe('noSyncTeX');
        expect(messages).toEqual([]);
    });

    it('fragt im Modus „Editor“ gar nicht (PDF unsichtbar) und wechselt den Modus nicht', async () => {
        const { control, editor, viewMode, deps, callsOf } = setup();
        control.setSyncTeX(FORWARD, null);
        openAtLine(editor, CHAPTER, CHAPTER_TEXT, 2);
        viewMode.getState().setMode('editor');
        expect(await revealCursorInPdf(deps, 'follow')).toBe('pdfHidden');
        expect(callsOf('synctex:forward')).toEqual([]);
        expect(viewMode.getState().mode).toBe('editor');
    });
});

describe('Rückwärts (Klick ins PDF)', () => {
    it('öffnet die Projektdatei, setzt den Cursor auf die Zeile und gibt dem Editor den Fokus', async () => {
        const { control, editor, focusEditor, deps, callsOf, messages } = setup();
        control.setSyncTeX(null, { file: CHAPTER, line: 3 });
        expect(await showPdfPointInEditor(deps, 2, POINT)).toBe('opened');
        expect(callsOf('synctex:backward')).toEqual([[2, POINT.x, POINT.y]]);
        const session = editor.getState().activeSession()!;
        expect(session.path).toBe(CHAPTER);
        expect(session.state.doc.lineAt(session.selection.head).number).toBe(3);
        expect(focusEditor).toHaveBeenCalledOnce();
        expect(messages).toEqual([]);
    });

    it('wechselt im Modus „PDF“ nach „Geteilt“, sonst bleibt der Modus', async () => {
        const { control, viewMode, deps } = setup();
        control.setSyncTeX(null, { file: CHAPTER, line: 1 });
        viewMode.getState().setMode('pdf');
        await showPdfPointInEditor(deps, 1, POINT);
        expect(viewMode.getState().mode).toBe('split');
        viewMode.getState().setMode('editor');
        await showPdfPointInEditor(deps, 1, POINT);
        expect(viewMode.getState().mode).toBe('editor');
    });

    it('Antwort null: Meldung je nachdem, ob SyncTeX-Daten da sind; kein Tab', async () => {
        const { editor, synctex, messages, deps } = setup();
        expect(await showPdfPointInEditor(deps, 1, POINT)).toBe('noSyncTeX');
        synctex.getState().markReady(1);
        expect(await showPdfPointInEditor(deps, 1, POINT)).toBe('notFound');
        expect(messages.map((message) => message.text)).toEqual([SYNCTEX_TEXTS.noSyncTeX, SYNCTEX_TEXTS.pointNotFound]);
        expect(editor.getState().tabs.items).toEqual([]);
    });

    it('Datei außerhalb des Projekts oder keine .tex-Datei wird nicht geöffnet', async () => {
        const { control, editor, viewMode, messages, deps } = setup();
        viewMode.getState().setMode('pdf');
        control.setSyncTeX(null, { file: OUTSIDE, line: 1 });
        expect(await showPdfPointInEditor(deps, 1, POINT)).toBe('notProjectTex');
        control.setSyncTeX(null, { file: `${ROOT}/literatur.bib`, line: 1 });
        expect(await showPdfPointInEditor(deps, 1, POINT)).toBe('notProjectTex');
        expect(messages.map((message) => message.text)).toEqual([
            SYNCTEX_TEXTS.notProjectTex('fremd.tex'), SYNCTEX_TEXTS.notProjectTex('literatur.bib'),
        ]);
        expect(editor.getState().tabs.items).toEqual([]);
        expect(viewMode.getState().mode).toBe('pdf');
    });

    it('ohne Projekt wird nicht gefragt', async () => {
        const { deps, callsOf, messages } = setup({ root: null });
        expect(await showPdfPointInEditor(deps, 1, POINT)).toBe('noProject');
        expect(callsOf('synctex:backward')).toEqual([]);
        expect(messages).toEqual([{ text: SYNCTEX_TEXTS.noProject, kind: 'info' }]);
    });
});

describe('Geste für die Rückwärtssuche', () => {
    const click = { button: 0, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

    it('macOS: ⌘-Klick; Windows/Linux: Strg-Klick', () => {
        expect(isSyncTeXClick({ ...click, metaKey: true }, true)).toBe(true);
        expect(isSyncTeXClick({ ...click, ctrlKey: true }, true)).toBe(false);
        expect(isSyncTeXClick({ ...click, ctrlKey: true }, false)).toBe(true);
        expect(isSyncTeXClick({ ...click, metaKey: true }, false)).toBe(false);
    });

    it('normaler Klick, rechte Taste, Alt und Umschalt bleiben für Auswahl und Links', () => {
        expect(isSyncTeXClick(click, true)).toBe(false);
        expect(isSyncTeXClick(click, false)).toBe(false);
        expect(isSyncTeXClick({ ...click, ctrlKey: true, button: 2 }, false)).toBe(false);
        expect(isSyncTeXClick({ ...click, ctrlKey: true, shiftKey: true }, false)).toBe(false);
        expect(isSyncTeXClick({ ...click, metaKey: true, altKey: true }, true)).toBe(false);
    });
});

describe('Verdrahtung (connectSyncTeX)', () => {
    const OTHER_PROJECT: ProjectInfo = {
        root: '/anderes', mainFile: null, tree: { kind: 'directory', name: 'anderes', path: '/anderes', children: [] },
    };

    function connected(followsCursor: { value: boolean }) {
        const context = setup();
        const cursorListeners = new Set<() => void>();
        const project = createProjectStore({ api: () => context.stub.api as RendererApi });
        const disconnect = connectSyncTeX({
            flow: () => context.deps,
            store: context.synctex,
            project,
            followsCursor: () => followsCursor.value,
            onReady: (listener) => context.stub.api.events.on('synctex:ready', listener),
            onCursorActivity: (listener) => {
                cursorListeners.add(listener);
                return () => cursorListeners.delete(listener);
            },
        });
        const moveCursor = (): void => cursorListeners.forEach((listener) => listener());
        return { ...context, project, disconnect, moveCursor, cursorListeners };
    }

    it('synctex:ready macht bereit, ein Projektwechsel setzt zurück', () => {
        const { stub, synctex, project, disconnect } = connected({ value: false });
        stub.emit('synctex:ready', { pdfMtime: 42 });
        expect(synctex.getState()).toMatchObject({ isReady: true, pdfMtime: 42 });
        project.getState().setProject(OTHER_PROJECT, 'grant-x');
        expect(synctex.getState()).toMatchObject({ isReady: false, pdfMtime: null, lastRequest: null });
        disconnect();
        stub.emit('synctex:ready', { pdfMtime: 43 });
        expect(synctex.getState().isReady).toBe(false);
    });

    it('PDF folgt Cursor: aus fragt nie, an fragt entprellt einmal nach der Pause', async () => {
        vi.useFakeTimers();
        const follows = { value: false };
        const { control, editor, callsOf, moveCursor, disconnect, cursorListeners } = connected(follows);
        control.setSyncTeX(FORWARD, null);
        openAtLine(editor, CHAPTER, CHAPTER_TEXT, 2);
        moveCursor();
        await vi.advanceTimersByTimeAsync(FOLLOW_CURSOR_DELAY_MS);
        expect(callsOf('synctex:forward')).toEqual([]);
        follows.value = true;
        moveCursor();
        moveCursor();
        await vi.advanceTimersByTimeAsync(FOLLOW_CURSOR_DELAY_MS - 1);
        expect(callsOf('synctex:forward')).toEqual([]);
        moveCursor();
        await vi.advanceTimersByTimeAsync(FOLLOW_CURSOR_DELAY_MS);
        expect(callsOf('synctex:forward')).toEqual([[CHAPTER, 2]]);
        disconnect();
        expect(cursorListeners.size).toBe(0);
    });
});
