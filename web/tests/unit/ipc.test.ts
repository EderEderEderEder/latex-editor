import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import {
    createEventSender,
    dispatchRequest,
    type InvokeEventLike,
    type IpcDependencies,
    registerIpcHandlers,
    type SenderPolicy,
} from '../../src/main/ipc';
import { createHandlerRegistry, type IpcHandlers } from '../../src/main/ipcHandlers';
import { areArgsValid } from '../../src/main/ipcValidation';
import { MACOS_PATHS } from '../../src/main/paths';
import { REQUEST_CHANNELS } from '../../src/shared/contract';
import { IpcFailure } from '../../src/shared/ipcResult';

const TRUSTED_ID = 7;
const FOREIGN_ID = 8;
const INDEX_URL = 'file:///app/out/renderer/index.html';

const POLICY: SenderPolicy = {
    getTrustedWebContentsId: () => TRUSTED_ID,
    location: { kind: 'packaged', indexFileUrl: INDEX_URL },
    platform: MACOS_PATHS,
};

function fakeEvent(options: { id?: number; url?: string; parent?: object | null; frame?: boolean } = {}): InvokeEventLike {
    const frame = options.frame === false ? null : { url: options.url ?? INDEX_URL, parent: options.parent ?? null };
    return { sender: { id: options.id ?? TRUSTED_ID }, senderFrame: frame };
}

function dependencies(overrides: Partial<IpcHandlers> = {}, policy: SenderPolicy = POLICY) {
    const log = vi.fn<(message: string) => void>();
    const deps: IpcDependencies = { handlers: createHandlerRegistry(overrides), policy, log };
    return { deps, log };
}

describe('Absenderprüfung', () => {
    it('eigenes Fenster, Hauptframe, eigene index.html: erlaubt', async () => {
        const { deps } = dependencies();
        await expect(dispatchRequest('app:ping', fakeEvent(), [], deps)).resolves.toEqual({ ok: true, value: 'pong' });
    });

    it.each([
        ['fremdes webContents', fakeEvent({ id: FOREIGN_ID })],
        ['Unterframe', fakeEvent({ parent: {} })],
        ['Frame weg', fakeEvent({ frame: false })],
        ['fremde URL', fakeEvent({ url: 'https://evil.example/' })],
        ['andere Datei', fakeEvent({ url: 'file:///tmp/evil.html' })],
    ])('%s: abgelehnt und protokolliert, Handler nicht aufgerufen', async (_name, event) => {
        const handler = vi.fn(() => Promise.resolve('pong' as const));
        const { deps, log } = dependencies({ 'app:ping': handler });
        const result = await dispatchRequest('app:ping', event, [], deps);
        expect(result).toEqual({ ok: false, error: { kind: 'forbiddenSender', message: 'Absender nicht erlaubt' } });
        expect(handler).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledTimes(1);
    });

    it('ohne Hauptfenster wird alles abgelehnt', async () => {
        const { deps } = dependencies({}, { ...POLICY, getTrustedWebContentsId: () => null });
        const result = await dispatchRequest('app:ping', fakeEvent(), [], deps);
        expect(result.ok).toBe(false);
    });
});

describe('Argumentprüfung', () => {
    it.each([
        ['fs:readText', [42]],
        ['fs:readText', []],
        ['fs:readText', ['/a.tex', 'zu viel']],
        ['fs:readText', ['']],
        ['fs:writeText', ['/a.tex', 'x', 'utf16', 'lf']],
        ['synctex:forward', ['/a.tex', 0]],
        ['synctex:backward', [1, Number.NaN, 0]],
        ['dialog:pickFiles', [{ title: 'x', unbekannt: true }]],
        ['search:project', ['x', { caseSensitive: true, wholeWord: false }, []]],
        ['settings:set', ['k', () => undefined]],
        ['project:open', ['/Users/u/geheim']],
        ['project:open', ['C:\\']],
        ['fs:import', [['/etc/passwd'], '/p']],
        ['image:import', ['../a.png', '/p/images']],
        ['marks:load', ['/p']],
        ['marks:save', ['/p', '{}']],
        ['recovery:list', ['/p']],
        ['recovery:delete', ['/p', '/p/a.tex']],
        ['recovery:save', [{ projectRoot: '/p', path: '/p/a.tex', text: '', savedAt: 0 }]],
    ] as const)('%s %j ist ungültig', (channel, args) => {
        expect(areArgsValid(channel, args)).toBe(false);
    });

    it.each([
        ['fs:writeText', ['/a.tex', 'x', 'utf8', 'crlf']],
        ['fs:writeText', ['/a.tex', 'x', 'latin1', 'lf', 'abc123']],
        ['dialog:pickFiles', [{}]],
        ['dialog:pickFiles', [{ title: 'Bilder', filters: [{ name: 'Bild', extensions: ['png'] }], multiple: true }]],
        ['settings:set', ['editor.fontSize', { a: [1, 'b', null, true] }]],
        ['synctex:backward', [3, 10.5, 200]],
        ['project:open', ['b1f0c2e4-1a2b-4c3d-8e9f-0123456789ab']],
        ['fs:import', [['g-1', 'g-2'], '/p/kapitel']],
        ['image:import', ['g-1', '/p/images']],
        ['marks:save', ['{}']],
        ['recovery:save', [{ path: '/p/a.tex', text: '', savedAt: 0 }]],
        ['recovery:delete', ['/p/a.tex']],
        ['drop:grant', [['/Users/u/a.png']]],
    ] as const)('%s %j ist gültig', (channel, args) => {
        expect(areArgsValid(channel, args)).toBe(true);
    });

    it('ungültige Argumente ergeben invalidInput, ohne den Handler aufzurufen', async () => {
        const handler = vi.fn(() => Promise.reject(new Error('darf nicht laufen')));
        const { deps } = dependencies({ 'fs:readText': handler });
        const result = await dispatchRequest('fs:readText', fakeEvent(), [{ path: '/a.tex' }], deps);
        expect(result.ok ? null : result.error.kind).toBe('invalidInput');
        expect(handler).not.toHaveBeenCalled();
    });
});

describe('Fehlerumwandlung', () => {
    it('Platzhalter melden notImplemented', async () => {
        const { deps } = dependencies();
        const result = await dispatchRequest('git:status', fakeEvent(), [], deps);
        expect(result.ok ? null : result.error.kind).toBe('notImplemented');
    });

    it('IpcFailure wird unverändert weitergegeben', async () => {
        const gitError = { kind: 'nonFastForward', message: 'Kein Vorspulen möglich' } as const;
        const { deps } = dependencies({ 'git:pullFf': () => Promise.reject(new IpcFailure(gitError)) });
        await expect(dispatchRequest('git:pullFf', fakeEvent(), [], deps)).resolves.toEqual({ ok: false, error: gitError });
    });

    it('sonstige Fehler werden internal und protokolliert', async () => {
        const { deps, log } = dependencies({ 'tools:detect': () => Promise.reject(new Error('kaputt')) });
        const result = await dispatchRequest('tools:detect', fakeEvent(), [], deps);
        expect(result).toEqual({ ok: false, error: { kind: 'internal', message: 'Interner Fehler: kaputt' } });
        expect(log).toHaveBeenCalledWith('IPC „tools:detect“: Interner Fehler: kaputt');
    });
});

describe('registerIpcHandlers', () => {
    it('registriert jeden Kanal genau einmal und leitet an dispatchRequest weiter', async () => {
        const listeners = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>();
        const ipcMain = { handle: vi.fn((channel: string, listener) => listeners.set(channel, listener)) };
        registerIpcHandlers(ipcMain, dependencies().deps);
        expect(ipcMain.handle).toHaveBeenCalledTimes(REQUEST_CHANNELS.length);
        expect([...listeners.keys()].sort()).toEqual([...REQUEST_CHANNELS].sort());
        const ping = listeners.get('app:ping');
        await expect(ping?.(fakeEvent() as unknown as IpcMainInvokeEvent)).resolves.toEqual({ ok: true, value: 'pong' });
        const forged = fakeEvent({ id: FOREIGN_ID }) as unknown as IpcMainInvokeEvent;
        await expect(ping?.(forged)).resolves.toMatchObject({ ok: false });
    });
});

describe('createEventSender', () => {
    it('sendet an das Fenster, solange es lebt', () => {
        const target = { isDestroyed: vi.fn(() => false), send: vi.fn() };
        const send = createEventSender(() => target);
        send('synctex:ready', { pdfMtime: 1 });
        target.isDestroyed.mockReturnValue(true);
        send('synctex:ready', { pdfMtime: 2 });
        expect(target.send.mock.calls).toEqual([['synctex:ready', { pdfMtime: 1 }]]);
    });

    it('ohne Fenster passiert nichts', () => {
        expect(() => createEventSender(() => null)('app:closeRequested', null)).not.toThrow();
    });
});
