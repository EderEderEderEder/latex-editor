// Einstellungsschlüssel mit Standardwerten und Wertebereichen (nach den Swift-`EditorSettings`).
// Rein und ohne Importe: Main (Prüfung, Speicherung) und Renderer (Standardwerte bis zum Laden) teilen sie.

export type SettingSpec =
    | { readonly kind: 'boolean'; readonly default: boolean }
    | { readonly kind: 'integer'; readonly default: number; readonly min: number; readonly max: number }
    | { readonly kind: 'oneOf'; readonly default: string | number; readonly options: readonly (string | number)[] }
    | { readonly kind: 'text'; readonly default: string; readonly maxLength: number; readonly pattern?: RegExp };

export const MIN_ZOOM_PERCENT = 85;
export const MAX_ZOOM_PERCENT = 200;
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 24;
export const MIN_COLUMN_GUIDE = 40;
export const MAX_COLUMN_GUIDE = 200;
const MAX_FONT_FAMILY_LENGTH = 200;
const MAX_SCHEME_NAME_LENGTH = 40;
const SCHEME_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;

export const SETTING_SPECS = {
    // Leer: Festbreitenschrift des Systems
    fontFamily: { kind: 'text', default: '', maxLength: MAX_FONT_FAMILY_LENGTH },
    fontSize: { kind: 'integer', default: 13, min: MIN_FONT_SIZE, max: MAX_FONT_SIZE },
    editorZoom: { kind: 'integer', default: 100, min: MIN_ZOOM_PERCENT, max: MAX_ZOOM_PERCENT },
    interfaceZoom: { kind: 'integer', default: 100, min: MIN_ZOOM_PERCENT, max: MAX_ZOOM_PERCENT },
    lineSpacing: { kind: 'oneOf', default: 'normal', options: ['compact', 'normal', 'wide'] },
    showsLineNumbers: { kind: 'boolean', default: true },
    highlightsCurrentLine: { kind: 'boolean', default: true },
    wrapsLines: { kind: 'boolean', default: true },
    indentation: { kind: 'oneOf', default: 'tab', options: ['tab', 'twoSpaces', 'fourSpaces'] },
    tabWidth: { kind: 'oneOf', default: 4, options: [2, 4, 8] },
    autoClosesBrackets: { kind: 'boolean', default: true },
    showsColumnGuide: { kind: 'boolean', default: false },
    columnGuideColumn: { kind: 'integer', default: 80, min: MIN_COLUMN_GUIDE, max: MAX_COLUMN_GUIDE },
    showsStickyHeading: { kind: 'boolean', default: true },
    checksSpelling: { kind: 'boolean', default: true },
    spellingLanguage: { kind: 'oneOf', default: 'austrianGerman', options: ['austrianGerman', 'german', 'english'] },
    colorScheme: { kind: 'text', default: 'standard', maxLength: MAX_SCHEME_NAME_LENGTH, pattern: SCHEME_NAME_PATTERN },
    savesAutomatically: { kind: 'boolean', default: true },
    compilesOnSave: { kind: 'boolean', default: true },
    // „PDF folgt Cursor“ (Swift `pdfFollowsCursor`, Standard aus)
    pdfFollowsCursor: { kind: 'boolean', default: false },
    // „Automatisch vervollständigen“ (Swift `CompletionSettings.automaticKey` = `autoComplete`, Standard an)
    autoComplete: { kind: 'boolean', default: true },
    // „Groß-/Kleinschreibung automatisch korrigieren“ (Swift `Capitalization.automaticKey` = `autoCapitalize`, Standard an)
    autoCapitalize: { kind: 'boolean', default: true },
    // „Schreibhinweise anzeigen“ (Swift `WritingHints.enabledKey` = `writingHints`, Standard an)
    writingHints: { kind: 'boolean', default: true },
} as const satisfies Readonly<Record<string, SettingSpec>>;

export type SettingKey = keyof typeof SETTING_SPECS;
export type SettingValue = boolean | number | string;
export type EditorSettingsValues = {
    -readonly [K in SettingKey]: (typeof SETTING_SPECS)[K]['default'] extends boolean
        ? boolean
        : (typeof SETTING_SPECS)[K]['default'] extends number
            ? number
            : string;
};

const SPEC_BY_KEY: ReadonlyMap<string, SettingSpec> = new Map(Object.entries(SETTING_SPECS));

export const SETTING_KEYS = Object.keys(SETTING_SPECS) as readonly SettingKey[];

export function specFor(key: string): SettingSpec | undefined {
    return SPEC_BY_KEY.get(key);
}

export function isSettingKey(key: string): key is SettingKey {
    return SPEC_BY_KEY.has(key);
}

export function isValidSettingValue(spec: SettingSpec, value: unknown): boolean {
    switch (spec.kind) {
        case 'boolean':
            return typeof value === 'boolean';
        case 'integer':
            return Number.isInteger(value) && (value as number) >= spec.min && (value as number) <= spec.max;
        case 'oneOf':
            return (typeof value === 'string' || typeof value === 'number') && spec.options.includes(value);
        case 'text':
            return isValidText(spec, value);
    }
}

function isValidText(spec: Extract<SettingSpec, { kind: 'text' }>, value: unknown): boolean {
    if (typeof value !== 'string' || value.length > spec.maxLength) return false;
    return spec.pattern === undefined || spec.pattern.test(value);
}

export function defaultSettings(): EditorSettingsValues {
    const values: Record<string, SettingValue> = {};
    for (const key of SETTING_KEYS) values[key] = SETTING_SPECS[key].default;
    return values as unknown as EditorSettingsValues;
}
