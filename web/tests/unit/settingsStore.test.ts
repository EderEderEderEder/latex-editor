import { describe, expect, it, vi } from 'vitest';
import { IpcFailure } from '../../src/shared/ipcResult';
import { createSettingsStore, mergeSettings } from '../../src/renderer/stores/settings';
import { defaultSettings } from '../../src/renderer/stores/settingsSchema';
import { createPreloadStub } from '../support/preloadStub';

function setup(stored: Record<string, unknown> = {}) {
    const stub = createPreloadStub();
    stub.respond('settings:get', () => stored as never);
    const store = createSettingsStore(() => stub.api);
    const setCalls = () => stub.calls.filter((call) => call.channel === 'settings:set');
    return { stub, store, setCalls };
}

describe('Einstellungs-Store', () => {
    it('hat bis zum Laden die Standardwerte', () => {
        const { store } = setup();
        expect(store.getState().values).toEqual(defaultSettings());
        expect(store.getState().loaded).toBe(false);
    });

    it('übernimmt geladene gültige Werte und ignoriert ungültige und unbekannte', async () => {
        const { store } = setup({ editorZoom: 130, fontSize: 500, unbekannt: 1 });
        await store.getState().load();
        const { values, loaded } = store.getState();
        expect(loaded).toBe(true);
        expect(values.editorZoom).toBe(130);
        expect(values.fontSize).toBe(defaultSettings().fontSize);
        expect(Object.keys(values)).not.toContain('unbekannt');
    });

    it('setzt den Zustand nur bei echter Änderung', async () => {
        const { store, setCalls } = setup();
        const listener = vi.fn();
        store.subscribe(listener);
        await store.getState().set('editorZoom', defaultSettings().editorZoom);
        expect(listener).not.toHaveBeenCalled();
        expect(setCalls()).toHaveLength(0);
        await store.getState().set('editorZoom', 120);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(setCalls().map((call) => call.args)).toEqual([['editorZoom', 120]]);
    });

    it('lässt beim Laden ohne Unterschied das values-Objekt unverändert', async () => {
        const { store } = setup({ editorZoom: defaultSettings().editorZoom });
        const before = store.getState().values;
        await store.getState().load();
        expect(store.getState().values).toBe(before);
    });

    it('nimmt den Wert zurück, wenn der Main ihn ablehnt', async () => {
        const { stub, store } = setup();
        stub.respond('settings:set', () => {
            throw new IpcFailure({ kind: 'invalidInput', message: 'abgelehnt' });
        });
        await expect(store.getState().set('editorZoom', 120)).rejects.toBeInstanceOf(IpcFailure);
        expect(store.getState().values.editorZoom).toBe(defaultSettings().editorZoom);
    });

    it('mergeSettings ignoriert __proto__', () => {
        const incoming = JSON.parse('{"__proto__":{"polluted":true}}');
        const defaults = defaultSettings();
        expect(mergeSettings(defaults, incoming)).toBe(defaults);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
});
