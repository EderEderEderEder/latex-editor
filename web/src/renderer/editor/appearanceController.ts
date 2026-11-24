// Verbindet Einstellungen und Systemfarbschema mit dem Editor (W1-12b): berechnet bei jeder Änderung die
// Darstellung und gibt nur Geändertes weiter (Syntax-`<style>`, CSS-Variablen, Sitzung des sichtbaren Views).
import type { EditorSettingsValues } from '../../shared/settingsSchema';
import { appearanceCssVariables, appearanceFromSettings, setCurrentAppearance } from './appearance';
import { syntaxCssFor } from './themeController';

/** Was der Controller nach außen schreibt; im Test ein Fake, im Fenster `domAppearanceHost` */
export interface AppearanceHost {
    applySyntaxCss(css: string): void;
    applyCssVariables(variables: Readonly<Record<string, string>>): void;
    /** Die Darstellung hat sich geändert: sichtbare Sitzung nachziehen und neu messen */
    appearanceChanged(): void;
}

export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

function sameVariables(a: Readonly<Record<string, string>> | null, b: Readonly<Record<string, string>>): boolean {
    if (a === null) return false;
    return Object.keys(b).every((key) => a[key] === b[key]);
}

/** Erster Aufruf wendet alles an, danach nur noch, was sich unterscheidet */
export function createAppearanceUpdater(host: AppearanceHost): (settings: EditorSettingsValues, prefersDark: boolean) => void {
    let lastVariables: Readonly<Record<string, string>> | null = null;
    let lastCss: string | null = null;
    return (settings, prefersDark) => {
        const variables = appearanceCssVariables(settings);
        const variablesChanged = !sameVariables(lastVariables, variables);
        if (variablesChanged) {
            lastVariables = variables;
            host.applyCssVariables(variables);
        }
        const values = appearanceFromSettings(settings, prefersDark);
        const css = syntaxCssFor(values.scheme, values.mode);
        const cssChanged = css !== lastCss;
        if (cssChanged) {
            lastCss = css;
            host.applySyntaxCss(css);
        }
        const valuesChanged = setCurrentAppearance(values);
        if (variablesChanged || cssChanged || valuesChanged) host.appearanceChanged();
    };
}

/** Minimale Sicht auf den Einstellungs-Store */
export interface SettingsSource {
    getState(): { readonly values: EditorSettingsValues };
    subscribe(listener: () => void): () => void;
}

/** Was von `MediaQueryList` gebraucht wird (der Test läuft ohne DOM) */
export interface MediaSource {
    readonly matches: boolean;
    addEventListener(type: 'change', listener: () => void): void;
    removeEventListener(type: 'change', listener: () => void): void;
}

export interface AppearanceTarget {
    readonly host: AppearanceHost;
    readonly settings: SettingsSource;
    readonly media: MediaSource;
}

/** Wendet sofort an und folgt danach Einstellungen und Systemfarbschema; liefert die Abmeldung */
export function connectAppearance({ host, settings, media }: AppearanceTarget): () => void {
    const update = createAppearanceUpdater(host);
    const refresh = (): void => update(settings.getState().values, media.matches);
    refresh();
    const unsubscribe = settings.subscribe(refresh);
    media.addEventListener('change', refresh);
    return () => {
        unsubscribe();
        media.removeEventListener('change', refresh);
    };
}
