import { describe, expect, it, vi } from 'vitest';
import { bringToFront, createBeforeQuitHandler, QuitTasks, type WindowLike } from '../../src/main/lifecycle';

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
