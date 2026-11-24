// Farbschema einspielen (W1-12b): Schema aus dem Einstellungs-Store (`colorScheme`), hell/dunkel aus
// `prefers-color-scheme`. Die Syntaxfarben kommen als `<style>` (CSS-Variablen und `cm-syntax-*`-Regeln), das
// CodeMirror-Theme über einen `Compartment` der Sitzung; ein Wechsel baut keine Sitzung neu auf.
import { Compartment } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import {
    COLOR_SCHEMES, DEFAULT_COLOR_SCHEME, buildEditorTheme, buildSyntaxCss, resolvePalette, resolveThemeMode,
} from './theme';
import type { ColorSchemeId, ThemeMode } from './theme';

export const themeCompartment = new Compartment();

/** Unbekannte Namen (alte oder fremde Einstellung) fallen auf das Standardschema zurück */
export function selectColorScheme(name: string): ColorSchemeId {
    return COLOR_SCHEMES.find((scheme) => scheme.id === name)?.id ?? DEFAULT_COLOR_SCHEME;
}

export function selectThemeMode(systemPrefersDark: boolean): ThemeMode {
    return resolveThemeMode('system', systemPrefersDark);
}

export function themeExtension(scheme: ColorSchemeId, mode: ThemeMode): Extension {
    return buildEditorTheme(resolvePalette(scheme, mode));
}

export function syntaxCssFor(scheme: ColorSchemeId, mode: ThemeMode): string {
    return buildSyntaxCss(resolvePalette(scheme, mode));
}
