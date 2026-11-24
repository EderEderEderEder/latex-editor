import { describe, expect, it, vi } from 'vitest';
import type { RendererApi } from '../../src/shared/contract';
import { revealLine } from '../../src/renderer/app/revealLine';
import type { RevealDeps } from '../../src/renderer/app/revealLine';
import { EditorSession } from '../../src/renderer/editor/session';
import { createEditorStore } from '../../src/renderer/stores/editor';
import { createPreloadStub } from '../support/preloadStub';

const ROOT = '/stub/projekt';

function sessionOf(text: string): EditorSession {
    return new EditorSession({ path: '/p/a.tex', name: 'a.tex', text, encoding: 'utf8', eol: 'lf', hash: 'h', mtime: 0 });
}

describe('Sprung zur Zeile', () => {
    it('setzt den Cursor an den Anfang der 1-basierten Zeile', () => {
        const session = sessionOf('eins\nzwei\ndrei');
        session.revealLine(2);
        expect(session.selection).toEqual({ anchor: 5, head: 5 });
        session.revealLine(3);
        expect(session.selection.head).toBe(10);
    });

    it('klemmt zu kleine, zu große und ungültige Zeilen', () => {
        const session = sessionOf('eins\nzwei');
        session.revealLine(99);
        expect(session.selection.head).toBe(5);
        session.revealLine(0);
        expect(session.selection.head).toBe(0);
        session.revealLine(Number.NaN);
        expect(session.selection.head).toBe(0);
    });

    it('ist keine Änderung am Text', () => {
        const session = sessionOf('eins\nzwei');
        session.revealLine(2);
        expect(session.isDirty).toBe(false);
    });
});

describe('revealLine: Datei öffnen und springen', () => {
    function setup() {
        const stub = createPreloadStub();
        (stub.api as unknown as { __stub: { installSampleProject(extra?: number): void } }).__stub.installSampleProject();
        const store = createEditorStore();
        const focusEditor = vi.fn();
        const report = vi.fn();
        const deps: RevealDeps = { api: stub.api as RendererApi, store, report, focusEditor };
        return { store, focusEditor, report, deps };
    }

    it('öffnet die geschlossene Datei als Vorschau, setzt den Cursor und gibt dem Editor den Fokus', async () => {
        const { store, focusEditor, deps } = setup();
        await revealLine(deps, `${ROOT}/kapitel/einleitung.tex`, 3);
        const session = store.getState().session(`${ROOT}/kapitel/einleitung.tex`);
        expect(store.getState().tabs.active).toBe(`${ROOT}/kapitel/einleitung.tex`);
        expect(session?.selection.head).toBe('\\section{Motivation}\nText\n'.length);
        expect(focusEditor).toHaveBeenCalledTimes(1);
    });

    it('springt in einer schon offenen Datei, ohne sie neu zu lesen', async () => {
        const { store, deps } = setup();
        await revealLine(deps, `${ROOT}/main.tex`, 2);
        await revealLine(deps, `${ROOT}/main.tex`, 3);
        expect(store.getState().session(`${ROOT}/main.tex`)?.selection.head).toBeGreaterThan(20);
    });

    it('springt nicht und fokussiert nicht, wenn die Datei nicht zu öffnen ist', async () => {
        const { focusEditor, deps } = setup();
        await revealLine(deps, `${ROOT}/bilder/logo.png`, 1);
        expect(focusEditor).not.toHaveBeenCalled();
    });
});
