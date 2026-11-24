// Fensterweite Tastenkürzel (Strg, auf macOS auch ⌘); Suche und Tippen regeln die Editor-Erweiterungen selbst.
import type { ZoomDirection } from './zoom';

export type ShortcutAction =
    | { readonly kind: 'open' }
    | { readonly kind: 'save' }
    | { readonly kind: 'saveAs' }
    | { readonly kind: 'nextTab' }
    | { readonly kind: 'previousTab' }
    | { readonly kind: 'zoom'; readonly direction: ZoomDirection };

export interface KeyInput {
    readonly key: string;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
    readonly defaultPrevented?: boolean;
}

const ZOOM_IN_KEYS: ReadonlySet<string> = new Set(['+', '=']);
const ZOOM_OUT_KEYS: ReadonlySet<string> = new Set(['-', '_']);

function letterAction(key: string, shift: boolean): ShortcutAction | null {
    if (key === 'o' && !shift) return { kind: 'open' };
    if (key === 's') return { kind: shift ? 'saveAs' : 'save' };
    return null;
}

function zoomAction(key: string): ShortcutAction | null {
    if (ZOOM_IN_KEYS.has(key)) return { kind: 'zoom', direction: 'in' };
    if (ZOOM_OUT_KEYS.has(key)) return { kind: 'zoom', direction: 'out' };
    if (key === '0') return { kind: 'zoom', direction: 'reset' };
    return null;
}

// Strg+Tab / Strg+Umschalt+Tab wechseln die Tabs (auf allen Systemen mit Strg, auch auf macOS)
function tabSwitchAction(input: KeyInput): ShortcutAction | null {
    if (input.key !== 'Tab' || !input.ctrlKey || input.metaKey) return null;
    return { kind: input.shiftKey ? 'previousTab' : 'nextTab' };
}

export function matchShortcut(input: KeyInput): ShortcutAction | null {
    if (input.defaultPrevented === true || input.altKey) return null;
    const tabSwitch = tabSwitchAction(input);
    if (tabSwitch !== null) return tabSwitch;
    if (input.ctrlKey === input.metaKey) return null;
    return letterAction(input.key.toLowerCase(), input.shiftKey) ?? zoomAction(input.key);
}
