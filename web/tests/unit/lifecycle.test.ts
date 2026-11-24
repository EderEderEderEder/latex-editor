import { describe, expect, it, vi } from 'vitest';
import {
    bringToFront,
    CloseGuard,
    type ClosableWindow,
    createBeforeQuitHandler,
    createGuardedQuitHandler,
    QuitTasks,
    type WindowLike,
} from '../../src/main/lifecycle';

const SHORT_TIMEOUT_MS = 20;

function preventable() {
    return { preventDefault: vi.fn() };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((done) => (resolve = done));
    return { promise, resolve };
}

describe('QuitTasks', () => {
    it('führt alle Aufgaben aus, Fehler halten das Beenden nicht auf', async () => {
        const tasks = new QuitTasks();
        const ran: string[] = [];
        tasks.add(() => {
            ran.push('build');
        });
        tasks.add(() => Promise.reject(new Error('kaputt')));
        const log = vi.fn();
        await tasks.runAll(log);
        expect(ran).toEqual(['build']);
        expect(log).toHaveBeenCalledWith('Aufräumen beim Beenden fehlgeschlagen: kaputt');
    });

    it('abgemeldete Aufgaben laufen nicht; hängende Aufgaben enden mit der Frist', async () => {
        const tasks = new QuitTasks();
        const removed = vi.fn();
        tasks.add(removed)();
        tasks.add(() => new Promise<void>(() => undefined));
        const log = vi.fn();
        await tasks.runAll(log, SHORT_TIMEOUT_MS);
        expect(removed).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith('Aufräumen beim Beenden: Frist abgelaufen');
    });
});

describe('createBeforeQuitHandler', () => {
    it('hält das erste Beenden auf, bis z. B. der Build abgebrochen ist, und beendet dann wirklich', async () => {
        const tasks = new QuitTasks();
        const cancel = deferred();
        const buildCancel = vi.fn(() => cancel.promise);
        tasks.add(buildCancel);
        const quit = vi.fn();
        const handler = createBeforeQuitHandler({ tasks, quit, log: vi.fn() });

        const first = preventable();
        handler(first);
        const second = preventable();
        handler(second);
        expect(first.preventDefault).toHaveBeenCalled();
        expect(second.preventDefault).toHaveBeenCalled();
        expect(buildCancel).toHaveBeenCalledTimes(1);
        expect(quit).not.toHaveBeenCalled();

        cancel.resolve();
        await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1));
        const final = preventable();
        handler(final);
        expect(final.preventDefault).not.toHaveBeenCalled();
    });
});

function fakeWindow(minimized: boolean, destroyed = false): WindowLike & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        isDestroyed: () => destroyed,
        isMinimized: () => minimized,
        restore: () => calls.push('restore'),
        show: () => calls.push('show'),
        focus: () => calls.push('focus'),
    };
}

describe('bringToFront (zweite Instanz)', () => {
    it('stellt ein minimiertes Fenster wieder her und holt es nach vorn', () => {
        const window = fakeWindow(true);
        bringToFront(window);
        expect(window.calls).toEqual(['restore', 'show', 'focus']);
    });

    it('ohne oder mit zerstörtem Fenster passiert nichts', () => {
        const destroyed = fakeWindow(false, true);
        bringToFront(destroyed);
        bringToFront(null);
        expect(destroyed.calls).toEqual([]);
    });
});

function closableWindow(): ClosableWindow & { calls: string[] } {
    const calls: string[] = [];
    let destroyed = false;
    return {
        calls,
        isDestroyed: () => destroyed,
        close: () => calls.push('close'),
        destroy: () => {
            destroyed = true;
            calls.push('destroy');
        },
    };
}

function guardWith(canAsk = true) {
    const requestConfirmation = vi.fn(() => canAsk);
    const log = vi.fn();
    return { guard: new CloseGuard({ requestConfirmation, log }), requestConfirmation, log };
}

describe('CloseGuard (K1: Schließen angefragt → bestätigt)', () => {
    it('hält das Schließen auf und fragt den Renderer; erst die Bestätigung zerstört das Fenster', () => {
        const { guard, requestConfirmation } = guardWith();
        const window = closableWindow();
        const close = preventable();
        guard.onWindowClose(close);
        expect(close.preventDefault).toHaveBeenCalled();
        expect(requestConfirmation).toHaveBeenCalledTimes(1);
        expect(guard.phase).toBe('asking');
        guard.confirm(window);
        expect(guard.phase).toBe('confirmed');
        expect(window.calls).toEqual(['destroy']);
        const after = preventable();
        guard.onWindowClose(after);
        expect(after.preventDefault).not.toHaveBeenCalled();
    });

    it('nach „Abbrechen“ fragt ein erneutes Schließen wieder nach', () => {
        const { guard, requestConfirmation } = guardWith();
        guard.onWindowClose(preventable());
        const again = preventable();
        guard.onWindowClose(again);
        expect(again.preventDefault).toHaveBeenCalled();
        expect(requestConfirmation).toHaveBeenCalledTimes(2);
    });

    it('eine Bestätigung ohne Anfrage wird ignoriert', () => {
        const { guard, log } = guardWith();
        const window = closableWindow();
        guard.confirm(window);
        expect(window.calls).toEqual([]);
        expect(guard.phase).toBe('open');
        expect(log).toHaveBeenCalled();
    });

    it('kann der Renderer nicht antworten (lädt, abgestürzt, Stub), schließt das Fenster ohne Nachfrage', () => {
        const { guard } = guardWith(false);
        const close = preventable();
        guard.onWindowClose(close);
        expect(close.preventDefault).not.toHaveBeenCalled();
        expect(guard.phase).toBe('confirmed');
    });
});

describe('createGuardedQuitHandler (⌘Q, Dock, app.quit)', () => {
    it('Beenden mit offenem Fenster: erst die Nachfrage, das Aufräumen läuft noch nicht', () => {
        const { guard } = guardWith();
        const window = closableWindow();
        const cleanup = vi.fn();
        const handler = createGuardedQuitHandler(guard, () => window, cleanup);
        const quit = preventable();
        handler(quit);
        expect(quit.preventDefault).toHaveBeenCalled();
        expect(window.calls).toEqual(['close']);
        expect(cleanup).not.toHaveBeenCalled();
    });

    it('nach der Bestätigung (Fenster zerstört) räumt das erneute Beenden auf', () => {
        const { guard } = guardWith();
        const window = closableWindow();
        const cleanup = vi.fn();
        const handler = createGuardedQuitHandler(guard, () => window, cleanup);
        guard.onWindowClose(preventable());
        guard.confirm(window);
        const quit = preventable();
        handler(quit);
        expect(cleanup).toHaveBeenCalledWith(quit);
        expect(quit.preventDefault).not.toHaveBeenCalled();
    });

    it('ohne Fenster wird sofort aufgeräumt', () => {
        const { guard } = guardWith();
        const cleanup = vi.fn();
        createGuardedQuitHandler(guard, () => null, cleanup)(preventable());
        expect(cleanup).toHaveBeenCalledTimes(1);
    });
});
