// `ipc/api.ts` greift auf `window.api` zu (DOM-Typen und `global.d.ts` gehören sonst nur zum Renderer-Projekt).
/// <reference lib="dom" />
/// <reference path="../../src/renderer/global.d.ts" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPreloadStub } from '../support/preloadStub';
import { onMainEvent } from '../../src/renderer/ipc/events';

// Läuft in Vitest ohne DOM: `window` wird nur für diesen Test durch den Preload-Stub ersetzt.
afterEach(() => {
    vi.unstubAllGlobals();
});

describe('onMainEvent', () => {
    it('abonniert über getApi() und meldet wieder ab', () => {
        const stub = createPreloadStub();
        vi.stubGlobal('window', { api: stub.api });
        const received: string[] = [];
        const unsubscribe = onMainEvent('menu:command', (payload) => received.push(payload.commandId));
        stub.emit('menu:command', { commandId: 'build' });
        unsubscribe();
        stub.emit('menu:command', { commandId: 'danach' });
        expect(received).toEqual(['build']);
        expect(stub.listenerCount('menu:command')).toBe(0);
    });
});
