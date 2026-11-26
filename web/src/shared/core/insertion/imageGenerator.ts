import { captionLines, DEFAULT_INDENT, type FloatPlacement, joinLines, placementOption } from './floatOptions';

const MINIMUM_PERCENT = 1;
const MAXIMUM_PERCENT = 100;
const DEFAULT_WIDTH_PERCENT = 75;
const DIGITS_PER_PERCENT = 2;

export interface ImageSettings {
    readonly widthPercent: number;
    readonly caption: string;
    readonly placement: FloatPlacement;
    readonly escapeText: boolean;
    readonly indent: string;
}

export function createImageSettings(overrides: Partial<ImageSettings> = {}): ImageSettings {
    return {
        widthPercent: DEFAULT_WIDTH_PERCENT,
        caption: '',
        placement: 'standard',
        escapeText: true,
        indent: DEFAULT_INDENT,
        ...overrides,
    };
}

/** 75 → `.75\textwidth`, 50 → `.5\textwidth`, 100 → `\textwidth` */
export function widthText(percent: number): string {
    const clamped = Math.min(Math.max(Math.trunc(percent), MINIMUM_PERCENT), MAXIMUM_PERCENT);
    if (clamped === MAXIMUM_PERCENT) return '\\textwidth';
    const hundredths = String(clamped).padStart(DIGITS_PER_PERCENT, '0');
    const trimmed = hundredths.endsWith('0') ? hundredths.slice(0, -1) : hundredths;
    return `.${trimmed}\\textwidth`;
}

/** `figure`-Float mit `\includegraphics`; `reference` ist der Pfad aus `graphicsReference` */
export function generateImage(settings: ImageSettings, reference: string, label: string): string {
    const { indent } = settings;
    return joinLines([
        `\\begin{figure}${placementOption(settings.placement)}`,
        `${indent}\\centering`,
        `${indent}\\includegraphics[width=${widthText(settings.widthPercent)}]{${reference}}`,
        ...captionLines(settings.caption, label, settings.escapeText, indent),
        '\\end{figure}',
    ]);
}
