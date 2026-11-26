import { DEFAULT_CODE_ENVIRONMENT } from './codeLanguages';
import { captionLines, DEFAULT_INDENT, type FloatPlacement, joinLines, placementOption } from './floatOptions';
import { trimNewlines } from './textTrim';

const NO_LINE_NUMBERS = '[numbers=none]';

export interface CodeSettings {
    /** Umgebungsname aus `CODE_LANGUAGES` */
    readonly language: string;
    readonly content: string;
    /** In einem `program`-Float mit Beschriftung (sonst nur die Umgebung) */
    readonly asFloat: boolean;
    readonly caption: string;
    readonly placement: FloatPlacement;
    readonly lineNumbers: boolean;
    readonly escapeText: boolean;
    readonly indent: string;
}

export function createCodeSettings(overrides: Partial<CodeSettings> = {}): CodeSettings {
    return {
        language: DEFAULT_CODE_ENVIRONMENT,
        content: '',
        asFloat: true,
        caption: '',
        placement: 'standard',
        lineNumbers: true,
        escapeText: true,
        indent: DEFAULT_INDENT,
        ...overrides,
    };
}

/** Code in `program` mit Sprachumgebung (`lstlisting` ist in der Vorlage gesperrt); der Inhalt bleibt unmaskiert und unverändert eingerückt */
export function generateCode(settings: CodeSettings, label: string): string {
    const environment = settings.language;
    const options = settings.lineNumbers ? '' : NO_LINE_NUMBERS;
    const lines: string[] = [];
    if (settings.asFloat) {
        lines.push(`\\begin{program}${placementOption(settings.placement)}`);
        lines.push(...captionLines(settings.caption, label, settings.escapeText, settings.indent));
    }
    lines.push(`\\begin{${environment}}${options}`, trimNewlines(settings.content), `\\end{${environment}}`);
    if (settings.asFloat) lines.push('\\end{program}');
    return joinLines(lines);
}
