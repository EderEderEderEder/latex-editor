import { trimBlanks, trimWhitespace } from '../bib/textUtils';
import { DEFAULT_INDENT, joinLines } from './floatOptions';

export type EquationKind = 'equation' | 'equationStar' | 'align' | 'alignStar';

export interface EquationSettings {
    readonly kind: EquationKind;
    readonly content: string;
    readonly indent: string;
}

const PLACEHOLDER_EQUATION = 'a = b';
const ENVIRONMENTS: Readonly<Record<EquationKind, string>> = {
    equation: 'equation',
    equationStar: 'equation*',
    align: 'align',
    alignStar: 'align*',
};
const NUMBERED_KINDS: ReadonlySet<EquationKind> = new Set(['equation', 'align']);
// In Swift ist `\r\n` ein einzelnes Zeichen und trennt keine Zeilen
const LINE_FEED_NOT_AFTER_CARRIAGE_RETURN = /(?<!\r)\n/;

export function createEquationSettings(overrides: Partial<EquationSettings> = {}): EquationSettings {
    return { kind: 'equation', content: '', indent: DEFAULT_INDENT, ...overrides };
}

export function equationEnvironment(kind: EquationKind): string {
    return ENVIRONMENTS[kind];
}

export function isNumberedEquation(kind: EquationKind): boolean {
    return NUMBERED_KINDS.has(kind);
}

/** Gleichung; das Label steht nur bei nummerierten Umgebungen und nicht leerem Label */
export function generateEquation(settings: EquationSettings, label: string): string {
    const environment = equationEnvironment(settings.kind);
    const content = trimWhitespace(settings.content);
    const lines = [`\\begin{${environment}}`];
    for (const line of (content === '' ? PLACEHOLDER_EQUATION : content).split(LINE_FEED_NOT_AFTER_CARRIAGE_RETURN)) {
        lines.push(settings.indent + trimBlanks(line));
    }
    if (isNumberedEquation(settings.kind) && label !== '') lines.push(`${settings.indent}\\label{${label}}`);
    lines.push(`\\end{${environment}}`);
    return joinLines(lines);
}
