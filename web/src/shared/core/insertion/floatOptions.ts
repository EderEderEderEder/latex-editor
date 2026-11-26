import { escapeLatex } from './latexEscaping';
import { trimWhitespace } from '../bib/textUtils';

export type FloatPlacement = 'standard' | 'here' | 'top' | 'bottom' | 'page' | 'forceHere';

/** Einrückung der HgbThesis (wie `TextEditing.indentUnit` in Swift) */
export const DEFAULT_INDENT = '\t';

const PLACEMENT_OPTIONS: Readonly<Record<FloatPlacement, string>> = {
    standard: '',
    here: 'h',
    top: 't',
    bottom: 'b',
    page: 'p',
    forceHere: 'H',
};

/** `[h]` hinter `\begin{table}`; leer bei Standard */
export function placementOption(placement: FloatPlacement): string {
    const option = PLACEMENT_OPTIONS[placement] ?? '';
    return option === '' ? '' : `[${option}]`;
}

/** `\caption` zuerst, dann `\label`; beides entfällt, wenn keine Beschriftung angegeben ist */
export function captionLines(caption: string, label: string, escapeText: boolean, indent: string): string[] {
    const text = trimWhitespace(caption);
    if (text === '') return [];
    const lines = [`${indent}\\caption{${escapeText ? escapeLatex(text) : text}}`];
    if (label !== '') lines.push(`${indent}\\label{${label}}`);
    return lines;
}

/** Zeilen mit `\n` verbinden, am Ende ein `\n` */
export function joinLines(lines: readonly string[]): string {
    return `${lines.join('\n')}\n`;
}
