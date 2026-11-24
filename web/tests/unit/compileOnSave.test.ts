import { describe, expect, it, vi } from 'vitest';
import { COMPILE_ON_SAVE_DELAY_MS, createCompileOnSave } from '../../src/renderer/app/compileOnSave';
import type { BuildTimer } from '../../src/renderer/app/compileOnSave';
import { saveFile } from '../../src/renderer/app/fileActions';
import { saveDirtyProjectFiles } from '../../src/renderer/app/saveBeforeBuild';
import { createEditorStore } from '../../src/renderer/stores/editor';
import { createPreloadStub } from '../support/preloadStub';

const ROOT = '/p';

/** Gefälschter Zeitgeber: Fristen laufen erst bei `advance` ab */
function fakeTimer() {
    let now = 0;
    let nextHandle = 1;
    const pending = new Map<number, { at: number; callback: () => void }>();
    const timer: BuildTimer = {
        set: (callback, delayMs) => {
            const handle = nextHandle++;
            pending.set(handle, { at: now + delayMs, callback });
            return handle;
        },
        clear: (handle) => void pending.delete(handle as number),
    };
    const advance = (ms: number): void => {
        now += ms;
        for (const [handle, entry] of [...pending]) {
            if (entry.at > now) continue;
            pending.delete(handle);
            entry.callback();
        }
    };
    return { timer, advance, pendingCount: () => pending.size };
}

function setup(options: { enabled?: boolean; root?: string | null } = {}) {
    const clock = fakeTimer();
    const compile = vi.fn();
    let enabled = options.enabled ?? true;
    const onSave = createCompileOnSave({
        isEnabled: () => enabled,
        root: () => (options.root === undefined ? ROOT : options.root),
        compile,
        timer: clock.timer,
    });
    return { ...clock, compile, onSave, setEnabled: (value: boolean) => void (enabled = value) };
}

describe('Kompilieren beim Speichern', () => {
    it('startet nach der Frist genau einen Build', () => {
        const { onSave, advance, compile } = setup();
        onSave.notifySaved('/p/main.tex');
        advance(COMPILE_ON_SAVE_DELAY_MS - 1);
        expect(compile).not.toHaveBeenCalled();
        advance(1);
        expect(compile).toHaveBeenCalledTimes(1);
    });

    it('mehrere Speichervorgänge kurz hintereinander ergeben einen Lauf', () => {
        const { onSave, advance, compile } = setup();
        onSave.notifySaved('/p/a.tex');
        advance(300);
        onSave.notifySaved('/p/b.bib');
        advance(300);
        expect(compile).not.toHaveBeenCalled();
        advance(100);
        expect(compile).toHaveBeenCalledTimes(1);
    });

    it('nur .tex und .bib im Projekt zählen', () => {
        const { onSave, advance, compile, pendingCount } = setup();
        for (const path of ['/p/bild.png', '/p/notiz.txt', '/q/fremd.tex', 'grant-1', '/p/main.tex.bak']) onSave.notifySaved(path);
        expect(pendingCount()).toBe(0);
        advance(1000);
        expect(compile).not.toHaveBeenCalled();
        onSave.notifySaved('/P/Kapitel/A.TEX');
        expect(pendingCount()).toBe(1);
    });

    it('ist die Einstellung aus, passiert nichts; wird sie in der Frist ausgeschaltet, entfällt der Lauf', () => {
        const { onSave, advance, compile, setEnabled, pendingCount } = setup({ enabled: false });
        onSave.notifySaved('/p/main.tex');
        expect(pendingCount()).toBe(0);
        setEnabled(true);
        onSave.notifySaved('/p/main.tex');
        setEnabled(false);
        advance(1000);
        expect(compile).not.toHaveBeenCalled();
    });

    it('ohne Projekt wird nichts vorgemerkt; cancel verwirft einen vorgemerkten Lauf', () => {
        expect(setup({ root: null }).pendingCount()).toBe(0);
        const { onSave, advance, compile } = setup();
        onSave.notifySaved('/p/main.tex');
        onSave.cancel();
        advance(1000);
        expect(compile).not.toHaveBeenCalled();
    });

    it('nach dem Lauf lässt sich wieder einer vormerken', () => {
        const { onSave, advance, compile } = setup();
        onSave.notifySaved('/p/main.tex');
        advance(COMPILE_ON_SAVE_DELAY_MS);
        onSave.notifySaved('/p/main.tex');
        advance(COMPILE_ON_SAVE_DELAY_MS);
        expect(compile).toHaveBeenCalledTimes(2);
    });
});

describe('Anbindung an das Speichern', () => {
    it('saveFile meldet erfolgreiche Speichervorgänge über onSaved, das Speichern vor dem Build nicht', async () => {
        const stub = createPreloadStub();
        const store = createEditorStore();
        const onSaved = vi.fn();
        const file = { path: '/p/a.tex', name: 'a.tex', text: '', encoding: 'utf8' as const, eol: 'lf' as const, hash: 'h', mtime: 0 };
        store.getState().open(file, { asPreview: false });
        const dirty = (): void => store.getState().session('/p/a.tex')!.dispatch({ changes: { from: 0, insert: 'x' } });
        const deps = { api: stub.api, store, report: () => undefined };
        dirty();
        await saveDirtyProjectFiles(deps, '/p');
        expect(onSaved).not.toHaveBeenCalled();
        dirty();
        expect(await saveFile({ ...deps, onSaved }, '/p/a.tex')).toBe('saved');
        expect(onSaved).toHaveBeenCalledWith('/p/a.tex');
        expect(await saveFile({ ...deps, onSaved }, '/p/a.tex')).toBe('unchanged');
        expect(onSaved).toHaveBeenCalledTimes(1);
    });
});
