// Einstellungen im App-Datenordner (JSON). Ohne Electron-Import: der Ordner kommt vom Aufrufer.
// Laden validiert je Schlüssel (Fehlendes/Ungültiges → Standard); eine unlesbare oder neuere Datei
// wird beiseitegelegt und nie überschrieben. Speichern: atomar (textIo) und entprellt.
import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import type { SettingsData } from '../shared/contract';
import { IpcFailure } from '../shared/ipcResult';
import {
    defaultSettings,
    isSettingKey,
    isValidSettingValue,
    SETTING_KEYS,
    SETTING_SPECS,
    type EditorSettingsValues,
    type SettingKey,
} from '../shared/settingsSchema';
import { readTextFile, writeTextFile } from './textIo';

export const SETTINGS_FILE_NAME = 'settings.json';
export const SETTINGS_VERSION = 1;
export const SAVE_DEBOUNCE_MS = 400;
// Schlüsselform: nur Buchstaben und Ziffern, damit weder `__proto__` noch Pfade oder Punkte durchkommen.
const SAFE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]*$/;

export interface SettingsServiceOptions {
    readonly wait?: (ms: number) => Promise<void>;
    readonly now?: () => Date;
    readonly onSaveError?: (error: unknown) => void;
}

function invalid(message: string): IpcFailure {
    return new IpcFailure({ kind: 'invalidInput', message });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Übernimmt nur bekannte Schlüssel mit gültigem Wert; alles andere bleibt Standard.
export function normalizeSettings(raw: unknown): EditorSettingsValues {
    const result: Record<string, unknown> = { ...defaultSettings() };
    if (!isPlainRecord(raw)) return result as unknown as EditorSettingsValues;
    for (const key of SETTING_KEYS) {
        if (!Object.hasOwn(raw, key)) continue;
        if (isValidSettingValue(SETTING_SPECS[key], raw[key])) result[key] = raw[key];
    }
    return result as unknown as EditorSettingsValues;
}

export function validateSettingChange(key: unknown, value: unknown): SettingKey {
    if (typeof key !== 'string' || !SAFE_KEY_PATTERN.test(key)) throw invalid('Ungültiger Einstellungsschlüssel');
    if (!isSettingKey(key)) throw invalid(`Unbekannte Einstellung: ${key}`);
    if (!isValidSettingValue(SETTING_SPECS[key], value)) throw invalid(`Ungültiger Wert für „${key}“`);
    return key;
}

type ParsedFile = { readonly kind: 'ok'; readonly values: EditorSettingsValues } | { readonly kind: 'reject' };

// Version 0 (ohne Versionsfeld) ist die flache Form; neuere Versionen kennen wir nicht.
function parseSettingsFile(text: string): ParsedFile {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return { kind: 'reject' };
    }
    if (!isPlainRecord(raw)) return { kind: 'reject' };
    const version = Object.hasOwn(raw, 'version') ? raw.version : 0;
    if (!Number.isInteger(version) || (version as number) > SETTINGS_VERSION) return { kind: 'reject' };
    const values = version === 0 ? raw : raw.values;
    return { kind: 'ok', values: normalizeSettings(values) };
}

export class SettingsService {
    private values: EditorSettingsValues = defaultSettings();
    private loading: Promise<void> | undefined;
    private dirty = false;
    private flushRequested = false;
    private wakeUp: (() => void) | undefined;
    private saving: Promise<void> | undefined;
    private readonly wait: (ms: number) => Promise<void>;
    private readonly now: () => Date;

    constructor(
        private readonly directory: string,
        private readonly options: SettingsServiceOptions = {},
    ) {
        this.wait = options.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
        this.now = options.now ?? (() => new Date());
    }

    get filePath(): string {
        return join(this.directory, SETTINGS_FILE_NAME);
    }

    async get(): Promise<SettingsData> {
        await this.ensureLoaded();
        return { ...this.values };
    }

    async set(key: unknown, value: unknown): Promise<void> {
        const checked = validateSettingChange(key, value);
        await this.ensureLoaded();
        if (this.values[checked] === value) return;
        (this.values as Record<SettingKey, unknown>)[checked] = value;
        this.dirty = true;
        this.saving ??= this.saveLoop();
    }

    // Schreibt ausstehende Änderungen sofort (z. B. beim Beenden).
    async flush(): Promise<void> {
        this.flushRequested = true;
        this.wakeUp?.();
        try {
            await this.saving;
        } finally {
            this.flushRequested = false;
        }
    }

    private ensureLoaded(): Promise<void> {
        this.loading ??= this.load();
        return this.loading;
    }

    private async load(): Promise<void> {
        let text: string;
        try {
            text = (await readTextFile(this.filePath)).text;
        } catch (error) {
            if (error instanceof IpcFailure && error.error.kind === 'notFound') return;
            throw error;
        }
        const parsed = parseSettingsFile(text);
        if (parsed.kind === 'ok') this.values = parsed.values;
        else await this.setAside();
    }

    private async setAside(): Promise<void> {
        const stamp = this.now().toISOString().replace(/[:.]/g, '-');
        await fsp.rename(this.filePath, join(this.directory, `settings.defekt-${stamp}.json`));
    }

    private async saveLoop(): Promise<void> {
        try {
            while (this.dirty) {
                if (!this.flushRequested) await this.waitForDebounce();
                this.dirty = false;
                await this.write();
            }
        } finally {
            this.saving = undefined;
        }
    }

    private async waitForDebounce(): Promise<void> {
        const woken = new Promise<void>((resolve) => (this.wakeUp = resolve));
        await Promise.race([this.wait(SAVE_DEBOUNCE_MS), woken]);
        this.wakeUp = undefined;
    }

    private async write(): Promise<void> {
        const content = JSON.stringify({ version: SETTINGS_VERSION, values: this.values }, null, 4);
        try {
            await fsp.mkdir(this.directory, { recursive: true });
            await writeTextFile(this.filePath, content, 'utf8', 'lf');
        } catch (error) {
            this.options.onSaveError?.(error);
        }
    }
}

// Handler für `createHandlerRegistry({...})`; der Aufrufer legt den Dienst mit dem `userData`-Ordner an.
export function createSettingsHandlers(service: SettingsService) {
    return {
        'settings:get': () => service.get(),
        'settings:set': (key: string, value: unknown) => service.set(key, value),
    };
}
