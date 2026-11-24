import type { StatusMessage } from '../stores/status';
import type { SettingsStore } from '../stores/settings';

const loads = new WeakMap<SettingsStore, Promise<void>>();

export const SETTINGS_LOAD_FAILED = 'Einstellungen konnten nicht geladen werden; es gelten die Standardwerte.';

/** Lädt die Einstellungen einmal je Store (auch bei doppeltem Effekt im Entwicklungsmodus); Fehler werden gemeldet */
export function loadSettingsOnce(store: SettingsStore, report: (message: StatusMessage) => void): Promise<void> {
    const existing = loads.get(store);
    if (existing !== undefined) return existing;
    const loading = store
        .getState()
        .load()
        .catch((error: unknown) => {
            const detail = error instanceof Error ? ` (${error.message})` : '';
            report({ text: `${SETTINGS_LOAD_FAILED}${detail}`, kind: 'error' });
        });
    loads.set(store, loading);
    return loading;
}
