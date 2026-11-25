import { describe, expect, it } from 'vitest';
import { createAppUndoStore, MAX_APP_UNDO_STEPS } from '../../src/renderer/stores/appUndo';
import type { AppUndoAction, AppUndoStep } from '../../src/renderer/stores/appUndo';

// W2-9: App-Rückgängig-Stapel für Datei-Aktionen (Titel im Zustand, Schritte außerhalb).

function action(title: string, log: string[], result: AppUndoStep = { changed: true }): AppUndoAction {
    return {
        title,
        undo: () => {
            log.push(`undo ${title}`);
            return Promise.resolve(result);
        },
        redo: () => {
            log.push(`redo ${title}`);
            return Promise.resolve(result);
        },
    };
}

describe('App-Rückgängig', () => {
    it('nimmt in umgekehrter Reihenfolge zurück und wiederholt', async () => {
        const store = createAppUndoStore();
        const log: string[] = [];
        store.getState().push(action('A', log));
        store.getState().push(action('B', log));
        expect(store.getState().undoTitle).toBe('B');
        expect(await store.getState().undo()).toEqual({ kind: 'done', title: 'B', warning: null });
        expect(store.getState()).toMatchObject({ undoTitle: 'A', redoTitle: 'B' });
        await store.getState().undo();
        expect(await store.getState().undo()).toEqual({ kind: 'empty' });
        await store.getState().redo();
        expect(log).toEqual(['undo B', 'undo A', 'redo A']);
        expect(store.getState()).toMatchObject({ undoTitle: 'A', redoTitle: 'B' });
    });

    it('ein neuer Schritt leert den Wiederholen-Stapel', async () => {
        const store = createAppUndoStore();
        const log: string[] = [];
        store.getState().push(action('A', log));
        await store.getState().undo();
        store.getState().push(action('C', log));
        expect(store.getState().redoTitle).toBeNull();
        expect(await store.getState().redo()).toEqual({ kind: 'empty' });
    });

    it('ein gescheiterter Schritt bleibt, wo er war', async () => {
        const store = createAppUndoStore();
        store.getState().push(action('A', [], { changed: false }));
        expect(await store.getState().undo()).toEqual({ kind: 'failed', title: 'A' });
        expect(store.getState()).toMatchObject({ undoTitle: 'A', redoTitle: null });
    });

    it('ein geworfener Fehler lässt den Schritt liegen und gibt den Stapel wieder frei', async () => {
        const store = createAppUndoStore();
        store.getState().push({ title: 'A', undo: () => Promise.reject(new Error('kaputt')), redo: () => Promise.resolve({ changed: true }) });
        await expect(store.getState().undo()).rejects.toThrow('kaputt');
        expect(store.getState()).toMatchObject({ undoTitle: 'A', isBusy: false });
    });

    it('meldet eine Warnung des Schritts', async () => {
        const store = createAppUndoStore();
        store.getState().push(action('A', [], { changed: true, warning: 'Verweis offen' }));
        expect(await store.getState().undo()).toEqual({ kind: 'done', title: 'A', warning: 'Verweis offen' });
    });

    it('weist einen zweiten Aufruf ab, solange ein Schritt läuft', async () => {
        const store = createAppUndoStore();
        let finish: (step: AppUndoStep) => void = () => undefined;
        store.getState().push(action('B', []));
        store.getState().push({ title: 'A', undo: () => new Promise((resolve) => (finish = resolve)), redo: () => Promise.resolve({ changed: true }) });
        const running = store.getState().undo();
        expect(store.getState().isBusy).toBe(true);
        expect(await store.getState().undo()).toEqual({ kind: 'busy' });
        finish({ changed: true });
        expect(await running).toEqual({ kind: 'done', title: 'A', warning: null });
        expect(store.getState()).toMatchObject({ isBusy: false, undoTitle: 'B', redoTitle: 'A' });
    });

    it('hält höchstens MAX_APP_UNDO_STEPS Schritte; „clear“ leert beide Stapel', async () => {
        const store = createAppUndoStore();
        for (let index = 0; index <= MAX_APP_UNDO_STEPS; index++) store.getState().push(action(String(index), []));
        let count = 0;
        while ((await store.getState().undo()).kind === 'done') count++;
        expect(count).toBe(MAX_APP_UNDO_STEPS);
        store.getState().clear();
        expect(store.getState()).toMatchObject({ undoTitle: null, redoTitle: null });
    });
});
