import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    normalizeSettings,
    SETTINGS_FILE_NAME,
    SETTINGS_VERSION,
    SettingsService,
    validateSettingChange,
} from '../../src/main/settings';
import { IpcFailure } from '../../src/shared/ipcResult';
import { defaultSettings, SETTING_KEYS } from '../../src/shared/settingsSchema';

let dir: string;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'settings-'));
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

// Wartefunktion, die der Test von Hand auslöst.
function manualClock() {
    const pending: (() => void)[] = [];
    return {
        wait: () => new Promise<void>((resolve) => pending.push(resolve)),
        release: () => pending.splice(0).forEach((resolve) => resolve()),
        get waiting() {
            return pending.length;
        },
    };
}

const instant = () => Promise.resolve();
const file = () => join(dir, SETTINGS_FILE_NAME);
const readStored = async () => JSON.parse(await readFile(file(), 'utf8'));
const rejects = (action: () => unknown) => expect(action).toThrow(IpcFailure);

describe('Standardwerte und Normalisierung', () => {
    it('liefert Standardwerte ohne Datei', async () => {
        const service = new SettingsService(dir, { wait: instant });
        expect(await service.get()).toEqual(defaultSettings());
        expect(await readdir(dir)).toEqual([]);
    });

    it('fällt bei fehlenden und ungültigen Feldern auf Standard zurück', () => {
        const result = normalizeSettings({ fontSize: 99, editorZoom: 120, tabWidth: 3, wrapsLines: 'ja', extra: 1 });
        expect(result.fontSize).toBe(defaultSettings().fontSize);
        expect(result.editorZoom).toBe(120);
        expect(result.tabWidth).toBe(4);
        expect(result.wrapsLines).toBe(true);
        expect(Object.keys(result).sort()).toEqual([...SETTING_KEYS].sort());
    });

    it('behandelt Nicht-Objekte als leer', () => {
        expect(normalizeSettings(null)).toEqual(defaultSettings());
        expect(normalizeSettings([1, 2])).toEqual(defaultSettings());
    });
});

describe('Laden und Migration', () => {
    it('liest die versionierte Datei', async () => {
        await writeFile(file(), JSON.stringify({ version: SETTINGS_VERSION, values: { interfaceZoom: 150 } }));
        const loaded = await new SettingsService(dir, { wait: instant }).get();
        expect(loaded.interfaceZoom).toBe(150);
        expect(loaded.fontSize).toBe(defaultSettings().fontSize);
    });

    it('migriert die flache Form ohne Versionsfeld', async () => {
        await writeFile(file(), JSON.stringify({ editorZoom: 90, wrapsLines: false }));
        const loaded = await new SettingsService(dir, { wait: instant }).get();
        expect(loaded.editorZoom).toBe(90);
        expect(loaded.wrapsLines).toBe(false);
    });

    it('legt eine unlesbare Datei beiseite und überschreibt sie nicht', async () => {
        await writeFile(file(), '{ kaputt');
        const service = new SettingsService(dir, { wait: instant, now: () => new Date('2026-01-02T03:04:05.678Z') });
        expect(await service.get()).toEqual(defaultSettings());
        expect(await readdir(dir)).toEqual(['settings.defekt-2026-01-02T03-04-05-678Z.json']);
        const kept = await readFile(join(dir, 'settings.defekt-2026-01-02T03-04-05-678Z.json'), 'utf8');
        expect(kept).toBe('{ kaputt');
    });

    it('legt eine Datei aus einer neueren Version beiseite', async () => {
        const newer = JSON.stringify({ version: SETTINGS_VERSION + 1, values: { editorZoom: 150 } });
        await writeFile(file(), newer);
        const service = new SettingsService(dir, { wait: instant });
        expect((await service.get()).editorZoom).toBe(defaultSettings().editorZoom);
        const names = await readdir(dir);
        expect(names).toHaveLength(1);
        expect(names[0]).toMatch(/^settings\.defekt-.*\.json$/);
    });
});

describe('Prüfung von settings:set', () => {
    it.each(['__proto__', 'constructor', 'prototype', 'a.b', 'a/b', 'a\\b', '', 'unbekannt', 'toString'])(
        'lehnt Schlüssel „%s“ ab',
        (key) => rejects(() => validateSettingChange(key, 1)),
    );

    it('lehnt Nicht-Strings als Schlüssel ab', () => {
        rejects(() => validateSettingChange(5, 1));
        rejects(() => validateSettingChange(undefined, 1));
    });

    it.each([
        ['editorZoom', 84],
        ['editorZoom', 201],
        ['editorZoom', 100.5],
        ['interfaceZoom', '100'],
        ['fontSize', 9],
        ['tabWidth', 3],
        ['indentation', 'spaces'],
        ['wrapsLines', 1],
        ['columnGuideColumn', 39],
        ['colorScheme', '../etc'],
        ['colorScheme', 'x'.repeat(41)],
        ['fontFamily', { a: 1 }],
        ['fontFamily', ['x']],
        ['fontFamily', null],
        ['editorZoom', Number.NaN],
    ])('lehnt Wert für %s ab: %j', (key, value) => rejects(() => validateSettingChange(key, value)));

    it.each([
        ['editorZoom', 85],
        ['editorZoom', 200],
        ['tabWidth', 8],
        ['indentation', 'twoSpaces'],
        ['colorScheme', 'Solarized Dark'],
        ['fontFamily', ''],
    ])('nimmt %s = %j an', (key, value) => {
        expect(validateSettingChange(key, value)).toBe(key);
    });

    it('verändert bei Pollution-Versuchen weder Object.prototype noch den Zustand', async () => {
        const service = new SettingsService(dir, { wait: instant });
        const before = await service.get();
        await expect(service.set('__proto__', { polluted: true })).rejects.toBeInstanceOf(IpcFailure);
        await expect(service.set('constructor', { prototype: { polluted: true } })).rejects.toBeInstanceOf(IpcFailure);
        await expect(service.set('__proto__.polluted', true)).rejects.toBeInstanceOf(IpcFailure);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(await service.get()).toEqual(before);
    });

    it('ignoriert __proto__ in der Datei', async () => {
        await writeFile(file(), '{"version":1,"values":{"__proto__":{"polluted":true},"editorZoom":120}}');
        const loaded = await new SettingsService(dir, { wait: instant }).get();
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        expect(Object.keys(loaded)).not.toContain('polluted');
        expect(loaded.editorZoom).toBe(120);
    });
});

describe('Speichern', () => {
    it('fasst mehrere Änderungen zu einem Schreibvorgang zusammen', async () => {
        const clock = manualClock();
        const service = new SettingsService(dir, { wait: clock.wait });
        await service.set('editorZoom', 110);
        await service.set('fontSize', 15);
        await service.set('editorZoom', 120);
        expect(clock.waiting).toBe(1);
        await expect(readFile(file())).rejects.toThrow();
        clock.release();
        await service.flush();
        const stored = await readStored();
        expect(stored.version).toBe(SETTINGS_VERSION);
        expect(stored.values).toMatchObject({ editorZoom: 120, fontSize: 15 });
    });

    it('schreibt bei unverändertem Wert nichts', async () => {
        const clock = manualClock();
        const service = new SettingsService(dir, { wait: clock.wait });
        await service.set('editorZoom', defaultSettings().editorZoom);
        expect(clock.waiting).toBe(0);
    });

    it('flush schreibt sofort, ohne die Wartezeit abzuwarten', async () => {
        const clock = manualClock();
        const service = new SettingsService(dir, { wait: clock.wait });
        await service.set('wrapsLines', false);
        await service.flush();
        expect((await readStored()).values.wrapsLines).toBe(false);
    });

    it('übersteht einen Neustart', async () => {
        const first = new SettingsService(dir, { wait: instant });
        await first.set('colorScheme', 'Dunkel');
        await first.flush();
        expect((await new SettingsService(dir, { wait: instant }).get()).colorScheme).toBe('Dunkel');
    });
});
