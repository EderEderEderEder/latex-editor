import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { RendererApi } from '../../shared/contract';
import { unwrap } from '../../shared/ipcResult';
import {
    defaultSettings,
    isSettingKey,
    isValidSettingValue,
    SETTING_KEYS,
    SETTING_SPECS,
    type EditorSettingsValues,
    type SettingKey,
} from '../../shared/settingsSchema';

// Einstellungs-Store: Standardwerte bis zum Laden; geschrieben wird nur bei echter Änderung
// (gleicher Wert → gleicher Zustand, damit Selektoren nicht neu auslösen). Gespeichert wird im Main.

export interface SettingsState {
    readonly values: EditorSettingsValues;
    readonly loaded: boolean;
    load(): Promise<void>;
    set<K extends SettingKey>(key: K, value: EditorSettingsValues[K]): Promise<void>;
}

export type SettingsStore = UseBoundStore<StoreApi<SettingsState>>;

// Übernimmt nur gültige Werte bekannter Schlüssel; liefert dasselbe Objekt, wenn sich nichts ändert.
export function mergeSettings(current: EditorSettingsValues, incoming: Readonly<Record<string, unknown>>): EditorSettingsValues {
    let next: Record<string, unknown> | undefined;
    for (const key of SETTING_KEYS) {
        if (!Object.hasOwn(incoming, key)) continue;
        const value = incoming[key];
        if (value === current[key] || !isValidSettingValue(SETTING_SPECS[key], value)) continue;
        next ??= { ...current };
        next[key] = value;
    }
    return (next ?? current) as unknown as EditorSettingsValues;
}

// Wie `getApi()` aus ipc/api.ts, aber ohne DOM-Typen (der Node-tsconfig der Tests kennt `window` nicht).
function rendererApi(): RendererApi {
    return (globalThis as unknown as { api: RendererApi }).api;
}

export function createSettingsStore(apiProvider: () => RendererApi = rendererApi): SettingsStore {
    return create<SettingsState>()((set, get) => ({
        values: defaultSettings(),
        loaded: false,
        async load() {
            const stored = unwrap(await apiProvider().settings.get());
            set((state) => ({ values: mergeSettings(state.values, stored), loaded: true }));
        },
        async set(key, value) {
            if (!isSettingKey(key) || get().values[key] === value) return;
            const previous = get().values;
            set({ values: { ...previous, [key]: value } });
            try {
                unwrap(await apiProvider().settings.set(key, value));
            } catch (error) {
                set((state) => (state.values[key] === value ? { values: { ...state.values, [key]: previous[key] } } : state));
                throw error;
            }
        },
    }));
}

export const useSettingsStore: SettingsStore = createSettingsStore();
