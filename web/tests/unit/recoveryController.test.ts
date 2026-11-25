import { undo } from '@codemirror/commands';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecoveryEntry, TextFile } from '../../src/shared/contract';
import { IpcFailure } from '../../src/shared/ipcResult';
import { createCloseHandler } from '../../src/renderer/app/closeFlow';
import type { CloseChoice } from '../../src/renderer/app/closeFlow';
import {
    RECOVERY_MAX_WAIT_MS, RECOVERY_POLL_MS, RECOVERY_QUIET_MS, RECOVERY_TEXTS, RecoveryController, startRecovery, stopRecovery,
} from '../../src/renderer/app/recovery';
import { closeTabWithPrompt } from '../../src/renderer/app/tabClose';
import { createEditorStore } from '../../src/renderer/stores/editor';
import type { StatusMessage } from '../../src/renderer/stores/status';
import { createPreloadStub } from '../support/preloadStub';

const PATH = '/p/a.tex';
const SECOND = 1000;

function textFile(path: string, name: string): TextFile {
    return { path, name, text: 'Text', encoding: 'utf8', eol: 'lf', hash: 'h', mtime: 0 };
}

const started: RecoveryController[] = [];

function setup() {
    const stub = createPreloadStub();
    const store = createEditorStore();
    const messages: StatusMessage[] = [];
    const deps = { api: stub.api, store, report: (message: StatusMessage) => messages.push(message) };
    const controller = startRecovery(deps);
    started.push(controller);
    const open = (path = PATH): void => store.getState().open(textFile(path, path.split('/').at(-1)!), { asPreview: false });
    const type = (text = 'x', path = PATH): void => store.getState().session(path)!.dispatch({ changes: { from: 0, insert: text } });
    const calls = (channel: string) => stub.calls.filter((call) => call.channel === channel);
    const saves = () => calls('recovery:save').map((call) => call.args[0] as RecoveryEntry);
    const deletes = () => calls('recovery:delete').map((call) => call.args[0]);
    return { stub, store, messages, deps, controller, open, type, calls, saves, deletes };
}

const advance = async (ms: number): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(async () => {
    for (const controller of started.splice(0)) await stopRecovery(controller);
    vi.useRealTimers();
});

describe('Sicherung: Entprellung', () => {
    it('sichert den Text erst nach der Ruhezeit seit der letzten Änderung', async () => {
        const { open, type, saves } = setup();
        open();
        type();
        await advance(RECOVERY_QUIET_MS - RECOVERY_POLL_MS);
        expect(saves()).toHaveLength(0);
        await advance(2 * RECOVERY_POLL_MS);
        expect(saves()).toMatchObject([{ path: PATH, text: 'xText' }]);
    });

    it('beim Weitertippen wird spätestens nach der Höchstwartezeit gesichert', async () => {
        const { open, type, saves } = setup();
        open();
        for (let second = 1; second < RECOVERY_MAX_WAIT_MS / SECOND; second++) {
            type();
            await advance(SECOND);
        }
        expect(saves()).toHaveLength(0);
        type();
        await advance(SECOND);
        expect(saves()).toHaveLength(1);
    });

    it('sichert ohne neue Änderung nicht noch einmal', async () => {
        const { open, type, saves } = setup();
        open();
        type();
        await advance(RECOVERY_MAX_WAIT_MS * 2);
        expect(saves()).toHaveLength(1);
    });

    it('ohne ungespeicherte Änderungen wird nichts gesichert', async () => {
        const { open, calls } = setup();
        open();
        await advance(RECOVERY_MAX_WAIT_MS * 2);
        expect(calls('recovery:save')).toHaveLength(0);
        expect(calls('recovery:delete')).toHaveLength(0);
    });
});

describe('Sicherung: Löschen', () => {
    it('nach erfolgreichem Speichern wird die Sicherung gelöscht', async () => {
        const { open, type, store, saves, deletes } = setup();
        open();
        type();
        await advance(RECOVERY_QUIET_MS + RECOVERY_POLL_MS);
        expect(saves()).toHaveLength(1);
        const session = store.getState().session(PATH)!;
        store.getState().markSaved(PATH, session.snapshotForSave(), { hash: 'neu', mtime: 1 });
        await advance(0);
        expect(deletes()).toEqual([PATH]);
        type();
        await advance(RECOVERY_QUIET_MS + RECOVERY_POLL_MS);
        expect(saves()).toHaveLength(2);
    });

    it('Rückgängig bis zum Plattenstand löscht die Sicherung ebenfalls', async () => {
        const { open, type, store, deletes } = setup();
        open();
        type();
        const session = store.getState().session(PATH)!;
        undo({ state: session.state, dispatch: (transaction) => session.dispatch(transaction) });
        await advance(0);
        expect(session.isDirty).toBe(false);
        expect(deletes()).toEqual([PATH]);
    });

    it('zieht ein ungespeicherter Tab um (Speichern unter, Umbenennen), verschwindet die Sicherung des alten Pfads', async () => {
        const { open, type, store, deletes, saves } = setup();
        open();
        type();
        store.getState().relocate(PATH, '/p/b.tex');
        await advance(RECOVERY_QUIET_MS + RECOVERY_POLL_MS);
        expect(deletes()).toEqual([PATH]);
        expect(saves().map((entry) => entry.path)).toEqual(['/p/b.tex']);
    });
});

describe('Sicherung: bleibt beim bewussten Verwerfen erhalten (K1)', () => {
    it('ein Tab, der mit „Nicht speichern“ schließt, wird vorher noch einmal gesichert und nicht gelöscht', async () => {
        const { deps, open, type, saves, deletes } = setup();
        open();
        type();
        const ask = () => Promise.resolve('discard' as const);
        await closeTabWithPrompt({ ...deps, ask }, PATH);
        await advance(0);
        expect(saves()).toMatchObject([{ path: PATH, text: 'xText' }]);
        expect(deletes()).toEqual([]);
        await advance(RECOVERY_MAX_WAIT_MS * 2);
        expect(deletes()).toEqual([]);
    });

    it('Fenster schließen mit „Nicht speichern“: erst sichern, dann bestätigen, nichts löschen', async () => {
        const { stub, deps, store, open, type, saves, deletes, calls } = setup();
        open();
        type();
        const ask = () => Promise.resolve('discard' as CloseChoice);
        const handle = createCloseHandler({ api: stub.api, store, report: deps.report, ask, beforeConfirm: () => Promise.resolve() });
        expect(await handle()).toBe('closed');
        expect(saves()).toMatchObject([{ path: PATH, text: 'xText' }]);
        expect(deletes()).toEqual([]);
        const order = stub.calls.map((call) => call.channel);
        expect(order.indexOf('recovery:save')).toBeLessThan(order.indexOf('app:confirmClose'));
        expect(calls('fs:writeText')).toHaveLength(0);
    });

    it('Fenster schließen mit „Speichern“ löscht die Sicherung nach dem Speichern', async () => {
        const { stub, deps, store, open, type, deletes } = setup();
        open();
        type();
        const ask = () => Promise.resolve('save' as CloseChoice);
        await createCloseHandler({ api: stub.api, store, report: deps.report, ask, beforeConfirm: () => Promise.resolve() })();
        await advance(0);
        expect(deletes()).toEqual([PATH]);
    });
});

describe('Sicherung: flush und Fehler', () => {
    it('flush sichert sofort, aber nur einmal je Stand', async () => {
        const { controller, open, type, saves } = setup();
        open();
        type();
        await controller.flush();
        await controller.flush();
        expect(saves()).toHaveLength(1);
    });

    it('ein Schreibfehler wird einmal je Fehlerserie gemeldet', async () => {
        const { stub, controller, open, type, messages } = setup();
        stub.respond('recovery:save', () => {
            throw new IpcFailure({ kind: 'io', message: 'Platte voll' });
        });
        open();
        type();
        await controller.flush();
        type();
        await controller.flush();
        expect(messages).toEqual([{ text: RECOVERY_TEXTS.writeFailed('a.tex', 'Platte voll'), kind: 'error' }]);
    });

    it('stop beendet die Überwachung: später keine Aufträge mehr', async () => {
        const { controller, open, type, saves } = setup();
        open();
        type();
        await controller.stop();
        const before = saves().length;
        type();
        await advance(RECOVERY_MAX_WAIT_MS * 2);
        expect(saves()).toHaveLength(before);
    });
});
