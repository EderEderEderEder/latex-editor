import { describe, expect, it } from 'vitest';
import { createHandlerRegistry } from '../../src/main/ipcHandlers';
import { ARG_SCHEMAS } from '../../src/main/ipcValidation';
import {
    EVENT_CHANNELS,
    isGitError,
    isPreloadOnlyChannel,
    RENDERER_CHANNELS,
    REQUEST_CHANNELS,
    splitChannel,
} from '../../src/shared/contract';
import { IpcFailure } from '../../src/shared/ipcResult';
import { createPreloadStub, DEFAULT_STUB_RESPONSES } from '../support/preloadStub';

// Kanäle und Ereignisse aus PLAN-WEBUI.md §2 „Schnittstelle Main ↔ Renderer (IPC)“.
const PLAN_REQUESTS = [
    'tools:detect',
    'project:open',
    'dialog:openProject',
    'dialog:pickFiles',
    'dialog:saveAs',
    'fs:readText',
    'fs:readMany',
    'fs:writeText',
    'fs:create',
    'fs:rename',
    'fs:move',
    'fs:duplicate',
    'fs:import',
    'fs:trash',
    'fs:restore',
    'search:project',
    'build:start',
    'build:cancel',
    'build:clean',
    'synctex:forward',
    'synctex:backward',
    'git:status',
    'git:blob',
    'git:stage',
    'git:unstage',
    'git:commit',
    'git:fetch',
    'git:pullFf',
    'git:push',
    'git:branches',
    'git:checkout',
    'git:create',
    'git:resetPlan',
    'git:resetApply',
    'marks:load',
    'marks:save',
    'recovery:save',
    'recovery:list',
    'recovery:delete',
    'settings:get',
    'settings:set',
    'project:recent',
    'image:import',
    'pdf:open',
];

const PLAN_EVENTS = [
    'fs:changed',
    'build:status',
    'build:finished',
    'synctex:ready',
    'git:changed',
    'search:hits',
    'menu:command',
    'app:closeRequested',
];

const CHANNEL_NAME = /^[a-z]+:[a-z][a-zA-Z]*$/;

function sorted(values: readonly string[]): string[] {
    return [...values].sort();
}

describe('Vertrag: Kanalnamen', () => {
    it('enthält alle Kanäle und Ereignisse aus dem Plan', () => {
        expect(REQUEST_CHANNELS).toEqual(expect.arrayContaining(PLAN_REQUESTS));
        expect(sorted(EVENT_CHANNELS)).toEqual(sorted(PLAN_EVENTS));
    });

    it('Namen sind eindeutig, auch zwischen Anfragen und Ereignissen', () => {
        const all = [...REQUEST_CHANNELS, ...EVENT_CHANNELS];
        expect(new Set(all).size).toBe(all.length);
    });

    it('Namen haben die Form bereich:methode', () => {
        for (const name of [...REQUEST_CHANNELS, ...EVENT_CHANNELS]) expect(name).toMatch(CHANNEL_NAME);
    });

    it('bereich.methode ist eindeutig', () => {
        const paths = REQUEST_CHANNELS.map((channel) => {
            const { area, method } = splitChannel(channel);
            return `${area}.${method}`;
        });
        expect(new Set(paths).size).toBe(REQUEST_CHANNELS.length);
    });
});

describe('Vertrag: Abdeckung', () => {
    it('jeder Kanal hat einen Handler im Register', () => {
        const registry = createHandlerRegistry();
        expect(sorted(Object.keys(registry))).toEqual(sorted(REQUEST_CHANNELS));
        for (const channel of REQUEST_CHANNELS) expect(typeof registry[channel]).toBe('function');
    });

    it('jeder Kanal hat eine Argumentprüfung', () => {
        expect(sorted(Object.keys(ARG_SCHEMAS))).toEqual(sorted(REQUEST_CHANNELS));
    });

    it('jeder Kanal hat einen Eintrag im Preload-Stub', () => {
        expect(sorted(Object.keys(DEFAULT_STUB_RESPONSES))).toEqual(sorted(REQUEST_CHANNELS));
        const api = createPreloadStub().api as unknown as Record<string, Record<string, unknown>>;
        for (const channel of RENDERER_CHANNELS) {
            const { area, method } = splitChannel(channel);
            expect(typeof api[area]?.[method], channel).toBe('function');
        }
    });
});

describe('Vertrag: Gewährungen statt Pfadherkunft (H1)', () => {
    it('drop:grant ist nur für den Preload, nicht als window.api.drop sichtbar', () => {
        expect(isPreloadOnlyChannel('drop:grant')).toBe(true);
        expect(RENDERER_CHANNELS).not.toContain('drop:grant');
        expect(RENDERER_CHANNELS.length).toBe(REQUEST_CHANNELS.length - 1);
        const api = createPreloadStub().api as unknown as Record<string, unknown>;
        expect(api.drop).toBeUndefined();
    });

    it('marks/recovery kennen kein projectRoot, project:open und Importe nehmen Kennungen', () => {
        expect(ARG_SCHEMAS['marks:load']).toHaveLength(0);
        expect(ARG_SCHEMAS['marks:save']).toHaveLength(1);
        expect(ARG_SCHEMAS['recovery:list']).toHaveLength(0);
        expect(ARG_SCHEMAS['recovery:delete']).toHaveLength(1);
        expect(ARG_SCHEMAS['project:open'][0]('/etc')).toBe(false);
        expect(ARG_SCHEMAS['project:open'][0]('b1f0c2e4-1a2b-4c3d-8e9f-0123456789ab')).toBe(true);
        expect(ARG_SCHEMAS['image:import'][0]('C:\\Bilder\\a.png')).toBe(false);
    });

    it('dragDrop.grantFiles schickt nur Pfade aus getPathForFile, nie selbst erzeugte Dateien', async () => {
        const stub = createPreloadStub();
        const dropped = new File(['x'], 'bild.png');
        const fabricated = new File(['x'], 'geheim.tex');
        stub.setPathForFile(dropped, '/Users/u/Bilder/bild.png');
        const result = await stub.api.dragDrop.grantFiles([dropped, fabricated]);
        expect(stub.calls).toEqual([{ channel: 'drop:grant', args: [['/Users/u/Bilder/bild.png']] }]);
        expect(result).toEqual({ ok: true, value: { granted: [{ grantId: 'stub-grant-0', name: 'bild.png' }], rejected: [] } });
    });

    it('dragDrop.grantFiles ohne echte Pfade fragt den Main gar nicht', async () => {
        const stub = createPreloadStub();
        const result = await stub.api.dragDrop.grantFiles([new File(['x'], 'a.tex')]);
        expect(result).toEqual({ ok: true, value: { granted: [], rejected: [] } });
        expect(stub.calls).toEqual([]);
    });
});

describe('Handler-Register', () => {
    it('ping antwortet, alle anderen melden „nicht implementiert“', async () => {
        const registry = createHandlerRegistry();
        await expect(registry['app:ping']()).resolves.toBe('pong');
        const failure = await registry['fs:readText']('/a.tex').catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(IpcFailure);
        expect((failure as IpcFailure).error.kind).toBe('notImplemented');
        expect((failure as IpcFailure).error.message).toContain('fs:readText');
    });

    it('Überschreibungen ersetzen Platzhalter', async () => {
        const registry = createHandlerRegistry({ 'git:status': () => Promise.reject(new Error('x')) });
        await expect(registry['git:status']()).rejects.toThrow('x');
    });
});

describe('Preload-Stub', () => {
    it('liefert Standardantworten im Ergebnisumschlag und protokolliert Aufrufe', async () => {
        const stub = createPreloadStub();
        await expect(stub.api.app.ping()).resolves.toEqual({ ok: true, value: 'pong' });
        await stub.api.fs.writeText('/a.tex', 'x', 'utf8', 'crlf');
        expect(stub.calls.map((call) => call.channel)).toEqual(['app:ping', 'fs:writeText']);
    });

    it('Antworten lassen sich ersetzen, Fehler werden zum IpcError', async () => {
        const stub = createPreloadStub();
        stub.respond('git:commit', () => {
            throw new IpcFailure({ kind: 'nothingToCommit', message: 'Nichts zu committen' });
        });
        const result = await stub.api.git.commit('Nachricht');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(isGitError(result.error)).toBe(true);
    });

    it('Ereignisse: abonnieren, empfangen, abmelden', () => {
        const stub = createPreloadStub();
        const received: string[] = [];
        const unsubscribe = stub.api.events.on('menu:command', (payload) => received.push(payload.commandId));
        stub.emit('menu:command', { commandId: 'build' });
        unsubscribe();
        stub.emit('menu:command', { commandId: 'danach' });
        expect(received).toEqual(['build']);
        expect(stub.listenerCount('menu:command')).toBe(0);
    });

    it('unbekannte Ereignisse werden abgelehnt', () => {
        const on = createPreloadStub().api.events.on as (event: string, listener: () => void) => unknown;
        expect(() => on('shell:exec', () => undefined)).toThrow('Unbekanntes Ereignis');
    });
});

describe('Fehlerarten', () => {
    it('isGitError unterscheidet Git- von allgemeinen Fehlern', () => {
        expect(isGitError({ kind: 'nonFastForward', message: '' })).toBe(true);
        expect(isGitError({ kind: 'notImplemented', message: '' })).toBe(false);
    });
});
