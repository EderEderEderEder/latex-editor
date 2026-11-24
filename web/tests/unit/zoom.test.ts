import { describe, expect, it } from 'vitest';
import { createSettingsStore } from '../../src/renderer/stores/settings';
import { MAX_ZOOM_PERCENT, MIN_ZOOM_PERCENT } from '../../src/shared/settingsSchema';
import { ZOOM_STEPS, changeEditorZoom, clampZoom, nextZoom } from '../../src/renderer/app/zoom';
import { IpcFailure } from '../../src/shared/ipcResult';
import { createPreloadStub } from '../support/preloadStub';

describe('Zoom: Klemmung', () => {
    it('hält Werte im Bereich 85 bis 200 und rundet', () => {
        expect(clampZoom(10)).toBe(MIN_ZOOM_PERCENT);
        expect(clampZoom(999)).toBe(MAX_ZOOM_PERCENT);
        expect(clampZoom(112.4)).toBe(112);
    });

    it('fällt bei ungültigen Zahlen auf 100 zurück', () => {
        expect(clampZoom(Number.NaN)).toBe(100);
        expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(100);
    });

    it('die Stufen liegen im Bereich und steigen', () => {
        expect(ZOOM_STEPS[0]).toBe(MIN_ZOOM_PERCENT);
        expect(ZOOM_STEPS.at(-1)).toBe(MAX_ZOOM_PERCENT);
        expect([...ZOOM_STEPS].sort((a, b) => a - b)).toEqual([...ZOOM_STEPS]);
    });
});

describe('Zoom: Schritte', () => {
    it('geht stufenweise vor und zurück', () => {
        expect(nextZoom(100, 'in')).toBe(115);
        expect(nextZoom(115, 'in')).toBe(130);
        expect(nextZoom(115, 'out')).toBe(100);
        expect(nextZoom(100, 'out')).toBe(85);
    });

    it('bleibt an den Rändern stehen', () => {
        expect(nextZoom(MAX_ZOOM_PERCENT, 'in')).toBe(MAX_ZOOM_PERCENT);
        expect(nextZoom(MIN_ZOOM_PERCENT, 'out')).toBe(MIN_ZOOM_PERCENT);
    });

    it('rastet einen Wert zwischen den Stufen zuerst ein', () => {
        expect(nextZoom(120, 'in')).toBe(130);
        expect(nextZoom(120, 'out')).toBe(100);
    });

    it('Zurücksetzen ergibt 100', () => {
        expect(nextZoom(175, 'reset')).toBe(100);
    });
});

describe('Zoom: Einstellung ändern', () => {
    it('setzt editorZoom im Store und speichert über settings:set', async () => {
        const stub = createPreloadStub();
        const store = createSettingsStore(() => stub.api);
        await changeEditorZoom(store, 'in', () => undefined);
        expect(store.getState().values.editorZoom).toBe(115);
        expect(stub.calls.filter((call) => call.channel === 'settings:set').map((call) => call.args)).toEqual([['editorZoom', 115]]);
    });

    it('meldet einen Fehler beim Speichern und stellt den Wert zurück', async () => {
        const stub = createPreloadStub();
        stub.respond('settings:set', () => {
            throw new IpcFailure({ kind: 'io', message: 'Platte voll' });
        });
        const store = createSettingsStore(() => stub.api);
        const messages: string[] = [];
        await changeEditorZoom(store, 'in', (text) => messages.push(text));
        expect(store.getState().values.editorZoom).toBe(100);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain('Platte voll');
    });
});
