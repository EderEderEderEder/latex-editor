import { describe, expect, it, vi } from 'vitest';
import { loadSettingsOnce, SETTINGS_LOAD_FAILED } from '../../src/renderer/app/startup';
import { createSettingsStore } from '../../src/renderer/stores/settings';
import { createStatusStore } from '../../src/renderer/stores/status';
import { IpcFailure } from '../../src/shared/ipcResult';
import { createPreloadStub } from '../support/preloadStub';

describe('Status-Store', () => {
    it('setzt nur bei echter Änderung', () => {
        const store = createStatusStore();
        const listener = vi.fn();
        store.subscribe(listener);
        store.getState().clear();
        store.getState().show({ text: 'a', kind: 'info' });
        store.getState().show({ text: 'a', kind: 'info' });
        expect(listener).toHaveBeenCalledTimes(1);
        store.getState().show({ text: 'a', kind: 'error' });
        expect(listener).toHaveBeenCalledTimes(2);
        store.getState().clear();
        expect(store.getState().message).toBeNull();
    });
});

describe('Einstellungen beim Start laden', () => {
    it('lädt je Store nur einmal', async () => {
        const stub = createPreloadStub();
        const store = createSettingsStore(() => stub.api);
        await Promise.all([loadSettingsOnce(store, () => undefined), loadSettingsOnce(store, () => undefined)]);
        expect(stub.calls.filter((call) => call.channel === 'settings:get')).toHaveLength(1);
        expect(store.getState().loaded).toBe(true);
    });

    it('meldet einen Ladefehler und behält die Standardwerte', async () => {
        const stub = createPreloadStub();
        stub.respond('settings:get', () => {
            throw new IpcFailure({ kind: 'io', message: 'defekt' });
        });
        const store = createSettingsStore(() => stub.api);
        const reported: string[] = [];
        await loadSettingsOnce(store, (message) => reported.push(message.text));
        expect(store.getState().loaded).toBe(false);
        expect(reported).toEqual([`${SETTINGS_LOAD_FAILED} (defekt)`]);
    });
});
