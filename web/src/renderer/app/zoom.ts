// Zoom in Stufen (Vorbild: `InterfaceZoom.steps` der Swift-Version), ohne DOM.
import { MAX_ZOOM_PERCENT, MIN_ZOOM_PERCENT } from '../../shared/settingsSchema';

export const DEFAULT_ZOOM_PERCENT = 100;
export const ZOOM_STEPS: readonly number[] = [MIN_ZOOM_PERCENT, 100, 115, 130, 150, 175, MAX_ZOOM_PERCENT];

export type ZoomDirection = 'in' | 'out' | 'reset';

export function clampZoom(percent: number): number {
    if (!Number.isFinite(percent)) return DEFAULT_ZOOM_PERCENT;
    return Math.min(Math.max(Math.round(percent), MIN_ZOOM_PERCENT), MAX_ZOOM_PERCENT);
}

function nearestStepIndex(percent: number): number {
    const clamped = clampZoom(percent);
    let best = 0;
    ZOOM_STEPS.forEach((step, index) => {
        if (Math.abs(step - clamped) < Math.abs(ZOOM_STEPS[best]! - clamped)) best = index;
    });
    return best;
}

/** Nächste Stufe; ein Wert zwischen den Stufen rastet zuerst auf die nächste ein und geht dann einen Schritt weiter. */
export function nextZoom(current: number, direction: ZoomDirection): number {
    if (direction === 'reset') return DEFAULT_ZOOM_PERCENT;
    const offset = direction === 'in' ? 1 : -1;
    const index = Math.min(Math.max(nearestStepIndex(current) + offset, 0), ZOOM_STEPS.length - 1);
    return ZOOM_STEPS[index]!;
}

/** Was `changeEditorZoom` vom Einstellungs-Store braucht */
export interface ZoomSettingsStore {
    getState(): {
        readonly values: { readonly editorZoom: number };
        set(key: 'editorZoom', value: number): Promise<void>;
    };
}

/** Strg+Plus/Minus/0: setzt `editorZoom`; ein Fehler beim Speichern wird gemeldet, der Wert springt dann zurück */
export async function changeEditorZoom(
    store: ZoomSettingsStore,
    direction: ZoomDirection,
    report: (message: string) => void,
): Promise<void> {
    const state = store.getState();
    try {
        await state.set('editorZoom', nextZoom(state.values.editorZoom, direction));
    } catch (error) {
        report(`Zoom konnte nicht gespeichert werden: ${error instanceof Error ? error.message : String(error)}`);
    }
}
