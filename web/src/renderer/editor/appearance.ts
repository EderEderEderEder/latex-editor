// Darstellung des Editors aus den Einstellungen (W1-12b), ohne DOM: eine Sitzung trägt je Einstellungsgruppe einen
// `Compartment` (Theme, Zeilenumbruch, Anzeige, Tippen). Ein Wechsel schickt nur `reconfigure`-Effekte; Text,
// Undo-Verlauf und Auswahl bleiben. Schrift, Größe × Zoom und Zeilenabstand sind CSS-Variablen (`appearanceCssVariables`).
import { indentUnit } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import type { Extension, StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { EditorSettingsValues } from '../stores/settingsSchema';
import { typingSettings } from './typing';
import { selectColorScheme, selectThemeMode, themeCompartment, themeExtension } from './themeController';
import type { ColorSchemeId, ThemeMode } from './theme';

export interface AppearanceValues {
    readonly scheme: ColorSchemeId;
    readonly mode: ThemeMode;
    readonly wrapsLines: boolean;
    readonly showsLineNumbers: boolean;
    readonly highlightsCurrentLine: boolean;
    readonly tabWidth: number;
    readonly indentUnit: string;
    readonly autoClosesBrackets: boolean;
}

const INDENT_UNITS: Readonly<Record<string, string>> = { tab: '\t', twoSpaces: '  ', fourSpaces: '    ' };
const DEFAULT_INDENT_UNIT = '\t';
const LINE_HEIGHTS: Readonly<Record<string, string>> = { compact: '1.25', normal: '1.5', wide: '1.75' };
const DEFAULT_LINE_HEIGHT = '1.5';
const DEFAULT_FONT_STACK = 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace';
const PERCENT = 100;
const FONT_SIZE_DECIMALS = 100;
const UI_FONT_PX = 13;

export const wrapCompartment = new Compartment();
export const displayCompartment = new Compartment();
export const typingCompartment = new Compartment();

export function appearanceFromSettings(settings: EditorSettingsValues, systemPrefersDark: boolean): AppearanceValues {
    return {
        scheme: selectColorScheme(settings.colorScheme),
        mode: selectThemeMode(systemPrefersDark),
        wrapsLines: settings.wrapsLines,
        showsLineNumbers: settings.showsLineNumbers,
        highlightsCurrentLine: settings.highlightsCurrentLine,
        tabWidth: settings.tabWidth,
        indentUnit: INDENT_UNITS[settings.indentation] ?? DEFAULT_INDENT_UNIT,
        autoClosesBrackets: settings.autoClosesBrackets,
    };
}

export const DEFAULT_APPEARANCE: AppearanceValues = {
    scheme: 'standard',
    mode: 'light',
    wrapsLines: true,
    showsLineNumbers: true,
    highlightsCurrentLine: true,
    tabWidth: 4,
    indentUnit: DEFAULT_INDENT_UNIT,
    autoClosesBrackets: true,
};

export function sameAppearance(a: AppearanceValues, b: AppearanceValues): boolean {
    return (Object.keys(a) as (keyof AppearanceValues)[]).every((key) => a[key] === b[key]);
}

// ---------- Bausteine je Gruppe ----------

/** Zeilennummern und aktuelle Zeile werden nur ausgeblendet (die Erweiterungen selbst bleiben in `gutter.ts`) */
function displayExtension(values: AppearanceValues): Extension {
    const hidden: Record<string, Record<string, string>> = {};
    if (!values.showsLineNumbers) hidden['.cm-gutter.cm-lineNumbers'] = { display: 'none' };
    if (!values.highlightsCurrentLine) {
        hidden['.cm-activeLine'] = { backgroundColor: 'transparent' };
        hidden['.cm-activeLineGutter'] = { backgroundColor: 'transparent' };
    }
    return EditorView.theme(hidden);
}

function typingExtension(values: AppearanceValues): Extension {
    return [
        EditorState.tabSize.of(values.tabWidth),
        indentUnit.of(values.indentUnit),
        typingSettings.of({ indentUnit: values.indentUnit, autoPairBrackets: values.autoClosesBrackets }),
    ];
}

const wrapExtension = (values: AppearanceValues): Extension => (values.wrapsLines ? EditorView.lineWrapping : []);

/** Schrift, Größe und Abstand kommen aus CSS-Variablen (`appearanceCssVariables`), damit kein Zustand neu entsteht */
const baseTheme = EditorView.theme({
    '&': { height: '100%', fontSize: 'var(--editor-font-size)' },
    '.cm-scroller': { fontFamily: 'var(--editor-font-family)', lineHeight: 'var(--editor-line-height)' },
    '.cm-panels': { fontFamily: 'inherit', fontSize: `calc(${UI_FONT_PX}px * var(--ui-scale, 1))` },
});

/** Alles, was eine neue Sitzung für `values` mitbekommt */
export function appearanceExtensions(values: AppearanceValues): Extension[] {
    return [
        baseTheme,
        themeCompartment.of(themeExtension(values.scheme, values.mode)),
        wrapCompartment.of(wrapExtension(values)),
        displayCompartment.of(displayExtension(values)),
        typingCompartment.of(typingExtension(values)),
    ];
}

/** Nur die Gruppen, die sich von `previous` zu `next` ändern */
export function appearanceEffects(previous: AppearanceValues, next: AppearanceValues): StateEffect<unknown>[] {
    const effects: StateEffect<unknown>[] = [];
    if (previous.scheme !== next.scheme || previous.mode !== next.mode) {
        effects.push(themeCompartment.reconfigure(themeExtension(next.scheme, next.mode)));
    }
    if (previous.wrapsLines !== next.wrapsLines) effects.push(wrapCompartment.reconfigure(wrapExtension(next)));
    if (previous.showsLineNumbers !== next.showsLineNumbers || previous.highlightsCurrentLine !== next.highlightsCurrentLine) {
        effects.push(displayCompartment.reconfigure(displayExtension(next)));
    }
    if (
        previous.tabWidth !== next.tabWidth || previous.indentUnit !== next.indentUnit ||
        previous.autoClosesBrackets !== next.autoClosesBrackets
    ) effects.push(typingCompartment.reconfigure(typingExtension(next)));
    return effects;
}

// ---------- Aktueller Stand (für neue und wieder angezeigte Sitzungen) ----------

let current: AppearanceValues = DEFAULT_APPEARANCE;

export function currentAppearance(): AppearanceValues {
    return current;
}

/** Liefert `true`, wenn sich etwas geändert hat; gleiche Werte behalten dasselbe Objekt */
export function setCurrentAppearance(values: AppearanceValues): boolean {
    if (sameAppearance(current, values)) return false;
    current = values;
    return true;
}

// ---------- CSS-Variablen ----------

export function appearanceCssVariables(settings: EditorSettingsValues): Readonly<Record<string, string>> {
    const fontSize = Math.round((settings.fontSize * settings.editorZoom * FONT_SIZE_DECIMALS) / PERCENT) / FONT_SIZE_DECIMALS;
    return {
        '--editor-font-family': settings.fontFamily === '' ? DEFAULT_FONT_STACK : settings.fontFamily,
        '--editor-font-size': `${fontSize}px`,
        '--editor-line-height': LINE_HEIGHTS[settings.lineSpacing] ?? DEFAULT_LINE_HEIGHT,
        '--ui-scale': String(settings.interfaceZoom / PERCENT),
    };
}
