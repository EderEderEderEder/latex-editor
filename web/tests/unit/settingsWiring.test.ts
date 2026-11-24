import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppHandlers } from '../../src/main/handlers/appHandlers';
import type { DialogLike } from '../../src/main/handlers/dialogHandlers';
import { QuitTasks } from '../../src/main/lifecycle';
import { MACOS_PATHS } from '../../src/main/paths';
import { SETTINGS_FILE_NAME } from '../../src/main/settings';
import { IpcFailure } from '../../src/shared/ipcResult';
import { defaultSettings } from '../../src/shared/settingsSchema';

let userData: string;

beforeEach(async () => {
    userData = await mkdtemp(join(tmpdir(), 'settings-wiring-'));
});

afterEach(async () => {
    await rm(userData, { recursive: true, force: true });
});

function setup() {
    const dialog: DialogLike<object> = {
        showOpenDialog: vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] })),
        showSaveDialog: vi.fn(() => Promise.resolve({ canceled: true })),
    };
    const quitTasks = new QuitTasks();
    const log = vi.fn();
    const confirmClose = vi.fn();
    const app = createAppHandlers({
        userDataDir: userData, dialog, window: () => ({}), platform: MACOS_PATHS, quitTasks, log, confirmClose,
    });
    return { ...app, quitTasks, log, confirmClose };
}

describe('Verdrahtung der echten Handler', () => {
    it('app:confirmClose reicht die Bestätigung an den Main weiter (K1)', async () => {
        const { handlers, confirmClose } = setup();
        await handlers['app:confirmClose']();
        expect(confirmClose).toHaveBeenCalledTimes(1);
    });

    it('settings:get und settings:set sind echt, nicht Platzhalter', async () => {
        const { handlers } = setup();
        expect(await handlers['settings:get']()).toEqual(defaultSettings());
        await handlers['settings:set']('fontSize', 16);
        expect((await handlers['settings:get']()).fontSize).toBe(16);
        await expect(handlers['settings:set']('__proto__', 1)).rejects.toThrow(IpcFailure);
    });

    it('beim Beenden schreibt flush die ausstehende Änderung sofort', async () => {
        const { handlers, quitTasks, log } = setup();
        expect(quitTasks.size).toBeGreaterThanOrEqual(1);
        await handlers['settings:set']('wrapsLines', false);
        await quitTasks.runAll(log);
        const stored = JSON.parse(await readFile(join(userData, SETTINGS_FILE_NAME), 'utf8'));
        expect(stored.values.wrapsLines).toBe(false);
        expect(log).not.toHaveBeenCalled();
    });

    it('Dialog-, Datei- und Projekt-Handler sind verdrahtet, andere Kanäle bleiben Platzhalter', async () => {
        const { handlers } = setup();
        expect(await handlers['dialog:openProject']()).toBeNull();
        expect(await handlers['dialog:pickFiles']({})).toBeNull();
        await expect(handlers['fs:readText']('/etc/hosts')).rejects.toMatchObject({ error: { kind: 'notFound' } });
        await expect(handlers['project:open']('grant-1')).rejects.toMatchObject({ error: { kind: 'forbiddenPath' } });
        await expect(handlers['git:status']()).rejects.toMatchObject({ error: { kind: 'notImplemented' } });
    });

    it('ein Dialog-Ergebnis gilt im selben Lauf für fs:readText', async () => {
        const { handlers, grants } = setup();
        const { grantId } = grants.grant(join(userData, 'fehlt.tex'), 'pickedFile');
        await expect(handlers['fs:readText'](grantId)).rejects.toMatchObject({ error: { kind: 'notFound' } });
    });
});
