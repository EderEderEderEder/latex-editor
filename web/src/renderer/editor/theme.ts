// Farbschemata des Editors (W1-11b): reine Daten plus Funktionen, die daraus CSS-Text für die `cm-syntax-*`-Klassen und
// eine CodeMirror-Theme-Erweiterung bauen. Farbwerte und Namen stammen aus `swift/.../Editor/EditorTheme.swift`
// (`EditorColorScheme.palette`). Kein Zugriff auf `window`: Hell/Dunkel kommt als Parameter.
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { TokenKind } from '../../shared/core/latex/tokenizer';
import { TOKEN_CLASS_BY_KIND } from './language';

export type ColorSchemeId = 'standard' | 'classic' | 'solarized' | 'highContrast';
export type ThemeMode = 'light' | 'dark';
/** Einstellung „Erscheinungsbild“: folgt dem System oder ist fest */
export type ThemeModeSetting = 'system' | ThemeMode;

/** Die sechs Farben des Swift-Vorbilds; Argument gilt für `optionalArgument` und `keyArgument` */
interface SchemeColors {
    readonly background: string;
    readonly text: string;
    readonly command: string;
    readonly delimiter: string;
    readonly argument: string;
    readonly math: string;
    readonly comment: string;
    readonly verbatim: string;
}

export interface DiagnosticColors {
    readonly hint: string;
    readonly warning: string;
    readonly error: string;
}

/** Vollständige Palette für ein Schema in einer Helligkeit */
export interface ThemePalette {
    readonly dark: boolean;
    readonly background: string;
    readonly text: string;
    readonly syntax: Readonly<Record<TokenKind, string>>;
    readonly cursor: string;
    readonly selection: string;
    readonly activeLine: string;
    readonly gutterBackground: string;
    readonly gutterText: string;
    readonly gutterActiveText: string;
    readonly diagnostics: DiagnosticColors;
}

export interface ColorScheme {
    readonly id: ColorSchemeId;
    /** Anzeigename wie in Swift (`EditorColorScheme.title`) */
    readonly title: string;
    /** Mindestkontrast Text/Token gegen Hintergrund (Swift: `minimumContrast`) */
    readonly minimumContrast: number;
    readonly light: SchemeColors;
    readonly dark: SchemeColors;
}

export const DEFAULT_COLOR_SCHEME: ColorSchemeId = 'standard';
export const NORMAL_MINIMUM_CONTRAST = 4.5;
export const HIGH_CONTRAST_MINIMUM_CONTRAST = 7;

/** Swift nutzt für „Standard“ die Systemfarben `textBackgroundColor`/`textColor`; im Web feste Entsprechungen */
const SYSTEM_LIGHT = { background: '#ffffff', text: '#000000' } as const;
const SYSTEM_DARK = { background: '#1e1e1e', text: '#ffffff' } as const;

/** Deckkraft der aktiven Zeile (Swift: `currentLineAlpha`, Textfarbe darüber) */
const ACTIVE_LINE_ALPHA = 0.035;
/** Deckkraft der Auswahl (Swift nutzt die Systemauswahl; hier die Befehlsfarbe, damit der Text lesbar bleibt) */
const SELECTION_ALPHA = 0.25;
const HEX_RADIX = 16;
const HEX_COLOR = /^#([0-9a-f]{6})$/i;
const RGB_CHANNELS = 3;
const CHANNEL_MAX = 255;
const BYTE_BITS = 8;

/** Systemfarben für Unterstreichungen (Swift: `systemBlue`, `systemOrange`, `systemRed`) */
const DIAGNOSTICS_LIGHT: DiagnosticColors = { hint: '#007aff', warning: '#ff9500', error: '#ff3b30' };
const DIAGNOSTICS_DARK: DiagnosticColors = { hint: '#0a84ff', warning: '#ff9f0a', error: '#ff453a' };

export const COLOR_SCHEMES: readonly ColorScheme[] = [
    {
        id: 'standard',
        title: 'Standard',
        minimumContrast: NORMAL_MINIMUM_CONTRAST,
        light: { ...SYSTEM_LIGHT, command: '#1f5fbf', delimiter: '#5a6b85', argument: '#8a3fb8', math: '#1b7f3b', comment: '#737373', verbatim: '#a0522d' },
        dark: { ...SYSTEM_DARK, command: '#6cb4ff', delimiter: '#9aa8bd', argument: '#d09cff', math: '#7dd38b', comment: '#7f8a93', verbatim: '#e3a06b' },
    },
    {
        id: 'classic',
        title: 'Klassisch',
        minimumContrast: NORMAL_MINIMUM_CONTRAST,
        light: { background: '#ffffff', text: '#000000', command: '#9b2393', delimiter: '#5c6670', argument: '#0b4f79', math: '#1c00cf', comment: '#5d6c79', verbatim: '#c41a16' },
        dark: { background: '#1f1f24', text: '#dfdfe0', command: '#fc5fa3', delimiter: '#a6a6ad', argument: '#5dd8ff', math: '#d0bf69', comment: '#8a99a6', verbatim: '#fc6a5d' },
    },
    {
        id: 'solarized',
        title: 'Solarized',
        minimumContrast: NORMAL_MINIMUM_CONTRAST,
        light: { background: '#fdf6e3', text: '#3e5159', command: '#1a6aa6', delimiter: '#5c6e73', argument: '#8c3b8a', math: '#5f7300', comment: '#62706f', verbatim: '#a8521e' },
        dark: { background: '#002b36', text: '#a4b1b1', command: '#4fa8e8', delimiter: '#93a1a1', argument: '#c79be0', math: '#a9b83a', comment: '#869799', verbatim: '#e08a4e' },
    },
    {
        id: 'highContrast',
        title: 'Hoher Kontrast',
        minimumContrast: HIGH_CONTRAST_MINIMUM_CONTRAST,
        light: { background: '#ffffff', text: '#000000', command: '#0033b3', delimiter: '#333333', argument: '#6b00a8', math: '#005a1e', comment: '#4d4d4d', verbatim: '#8b2500' },
        dark: { background: '#000000', text: '#ffffff', command: '#8cccff', delimiter: '#d0d0d0', argument: '#e2b6ff', math: '#8cf0a0', comment: '#bbbbbb', verbatim: '#ffb57a' },
    },
];

/** Hell/Dunkel aus Einstellung und Systemzustand (`prefers-color-scheme` reicht der Aufrufer herein) */
export function resolveThemeMode(setting: ThemeModeSetting, systemPrefersDark: boolean): ThemeMode {
    if (setting !== 'system') return setting;
    return systemPrefersDark ? 'dark' : 'light';
}

export function findColorScheme(id: ColorSchemeId): ColorScheme {
    return COLOR_SCHEMES.find((scheme) => scheme.id === id) ?? COLOR_SCHEMES[0]!;
}

function parseHex(hex: string): readonly [number, number, number] {
    const match = HEX_COLOR.exec(hex);
    if (match === null) throw new Error(`Ungültige Farbe: ${hex}`);
    const value = parseInt(match[1]!, HEX_RADIX);
    const mask = CHANNEL_MAX;
    return [(value >> (BYTE_BITS * 2)) & mask, (value >> BYTE_BITS) & mask, value & mask];
}

/** `#rrggbb` mit Deckkraft als CSS-Farbe */
function withAlpha(hex: string, alpha: number): string {
    const [red, green, blue] = parseHex(hex);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** Relative Leuchtdichte nach WCAG 2.x */
export function relativeLuminance(hex: string): number {
    const [red, green, blue] = parseHex(hex).map((channel) => {
        const value = channel / CHANNEL_MAX;
        return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    }) as [number, number, number];
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG-Kontrastverhältnis (1 bis 21) */
export function contrastRatio(firstHex: string, secondHex: string): number {
    const first = relativeLuminance(firstHex);
    const second = relativeLuminance(secondHex);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function syntaxColors(colors: SchemeColors): Record<TokenKind, string> {
    return {
        command: colors.command,
        delimiter: colors.delimiter,
        optionalArgument: colors.argument,
        keyArgument: colors.argument,
        math: colors.math,
        comment: colors.comment,
        verbatim: colors.verbatim,
    };
}

/** Palette eines Schemas in einer Helligkeit; Auswahl, Zeile und Gutter werden aus den Schemafarben abgeleitet */
export function resolvePalette(schemeId: ColorSchemeId, mode: ThemeMode): ThemePalette {
    const scheme = findColorScheme(schemeId);
    const colors = scheme[mode];
    const dark = mode === 'dark';
    return {
        dark,
        background: colors.background,
        text: colors.text,
        syntax: syntaxColors(colors),
        cursor: colors.text,
        selection: withAlpha(colors.command, SELECTION_ALPHA),
        activeLine: withAlpha(colors.text, ACTIVE_LINE_ALPHA),
        gutterBackground: colors.background,
        gutterText: colors.delimiter,
        gutterActiveText: colors.text,
        diagnostics: dark ? DIAGNOSTICS_DARK : DIAGNOSTICS_LIGHT,
    };
}

/** Variablenname je Token-Art, z. B. `--editor-syntax-optionalArgument` */
function syntaxVariable(kind: string): string {
    return `--editor-syntax-${kind}`;
}

function variableBlock(palette: ThemePalette): string {
    const lines = [
        `--editor-background: ${palette.background};`,
        `--editor-text: ${palette.text};`,
        `--editor-cursor: ${palette.cursor};`,
        `--editor-selection: ${palette.selection};`,
        `--editor-active-line: ${palette.activeLine};`,
        `--editor-gutter-background: ${palette.gutterBackground};`,
        `--editor-gutter-text: ${palette.gutterText};`,
        `--editor-gutter-active-text: ${palette.gutterActiveText};`,
        `--editor-diagnostic-hint: ${palette.diagnostics.hint};`,
        `--editor-diagnostic-warning: ${palette.diagnostics.warning};`,
        `--editor-diagnostic-error: ${palette.diagnostics.error};`,
        ...Object.entries(palette.syntax).map(([kind, color]) => `${syntaxVariable(kind)}: ${color};`),
    ];
    return lines.map((line) => `    ${line}`).join('\n');
}

/**
 * CSS-Text mit Variablen auf `:root` und einer Regel je `cm-syntax-*`-Klasse (per `<style>` setzbar). Die Form der
 * Unterstreichungen (wie Swift: Fehler gestrichelt, Warnung strichpunktiert, Hinweis gepunktet) steht nur in
 * `diagnostics.ts`; von hier kommen dafür nur die Farben `--editor-diagnostic-*`.
 */
export function buildSyntaxCss(palette: ThemePalette): string {
    const rules = Object.entries(TOKEN_CLASS_BY_KIND)
        .map(([kind, className]) => `.${className} {\n    color: var(${syntaxVariable(kind)});\n}`);
    return [`:root {\n${variableBlock(palette)}\n}`, ...rules].join('\n');
}

/** CodeMirror-Theme: Hintergrund, Text, Cursor, Auswahl, aktive Zeile und Gutter */
export function buildEditorTheme(palette: ThemePalette): Extension {
    const selectionRule = { backgroundColor: palette.selection };
    return EditorView.theme(
        {
            '&': { color: palette.text, backgroundColor: palette.background },
            '.cm-content': { caretColor: palette.cursor },
            '.cm-cursor, .cm-dropCursor': { borderLeftColor: palette.cursor },
            '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': selectionRule,
            '.cm-selectionBackground': selectionRule,
            '.cm-activeLine': { backgroundColor: palette.activeLine },
            '.cm-gutters': { color: palette.gutterText, backgroundColor: palette.gutterBackground, border: 'none' },
            '.cm-activeLineGutter': { color: palette.gutterActiveText, backgroundColor: palette.activeLine },
        },
        { dark: palette.dark },
    );
}

/**
 * Popup der Vervollständigung (W4-6) in den Farben der Oberfläche (`--chrome-*` aus `ui/editorPane.css`, Hell/Dunkel
 * dort); höchstens etwa 8 Zeilen sichtbar wie in Swift (`CompletionController.visibleRows`).
 */
export const completionPopupTheme: Extension = EditorView.theme({
    '.cm-tooltip.cm-tooltip-autocomplete': {
        backgroundColor: 'var(--chrome-active)',
        color: 'var(--chrome-text)',
        border: '1px solid var(--chrome-border)',
        borderRadius: '6px',
        boxShadow: '0 4px 14px rgba(0, 0, 0, 0.2)',
        padding: '4px 0',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': { minWidth: '18em', maxWidth: '36em', maxHeight: '13.5em' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '1px 10px', lineHeight: '1.6' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--chrome-accent)',
        color: 'var(--chrome-active)',
    },
    '.cm-tooltip-autocomplete .cm-completionDetail': { color: 'var(--chrome-muted)', fontStyle: 'normal', marginLeft: '1.5em' },
    '.cm-tooltip-autocomplete li[aria-selected] .cm-completionDetail': { color: 'inherit' },
});
