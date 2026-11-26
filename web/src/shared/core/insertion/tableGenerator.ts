import { trimBlanks } from '../bib/textUtils';
import { captionLines, joinLines, placementOption } from './floatOptions';
import { escapeLatex } from './latexEscaping';
import type { ColumnAlignment, TableSettings } from './tableModel';
import { characterCount } from './textTrim';

const ROW_END = ' \\\\';
const CELL_SEPARATOR = ' & ';
const ALIGNMENT_LETTERS: Readonly<Record<ColumnAlignment, string>> = { left: 'l', center: 'c', right: 'r' };

function columnSpecification(settings: TableSettings): string {
    const letters = settings.alignments.slice(0, settings.columns).map((alignment) => ALIGNMENT_LETTERS[alignment]);
    return settings.rules === 'grid' ? `|${letters.join('|')}|` : `@{}${letters.join('')}@{}`;
}

/** Die ersten `rows` Zeilen mit je `columns` Zellen, fehlende Zellen leer, auf Wunsch maskiert */
function visibleCells(settings: TableSettings): string[][] {
    return settings.cells.slice(0, settings.rows).map((row) =>
        Array.from({ length: settings.columns }, (_, column) => {
            const value = row[column] ?? '';
            return settings.escapeText ? escapeLatex(value) : value;
        }),
    );
}

function paddedRow(row: readonly string[], widths: readonly number[]): string {
    const padded = row.map((cell, column) => cell + ' '.repeat(Math.max((widths[column] ?? 0) - characterCount(cell), 0)));
    return trimBlanks(padded.join(CELL_SEPARATOR)) + ROW_END;
}

function rowLines(settings: TableSettings): string[] {
    const cells = visibleCells(settings);
    const widths = Array.from({ length: settings.columns }, (_, column) =>
        Math.max(0, ...cells.map((row) => characterCount(row[column] ?? ''))),
    );
    const rowIndent = settings.indent + settings.indent;
    return cells.map((row) => rowIndent + paddedRow(row, widths));
}

function booktabsLines(rows: readonly string[], settings: TableSettings, rule: (command: string) => string): string[] {
    const lines = [rule('\\toprule')];
    rows.forEach((row, index) => {
        lines.push(row);
        if (index === 0 && settings.hasHeader && rows.length > 1) lines.push(rule('\\midrule'));
    });
    return [...lines, rule('\\bottomrule')];
}

function ruledRows(rows: readonly string[], settings: TableSettings): string[] {
    const rule = (command: string): string => settings.indent + settings.indent + command;
    if (settings.rules === 'booktabs') return booktabsLines(rows, settings, rule);
    if (settings.rules === 'grid') return [rule('\\hline'), ...rows.flatMap((row) => [row, rule('\\hline')])];
    return [...rows];
}

/** `table`-Float im Stil der HgbThesis (`booktabs`, Tabulatoren, Beschriftung vor dem Label) */
export function generateTable(settings: TableSettings, label: string): string {
    const { indent } = settings;
    return joinLines([
        `\\begin{table}${placementOption(settings.placement)}`,
        ...captionLines(settings.caption, label, settings.escapeText, indent),
        `${indent}\\centering`,
        `${indent}\\begin{tabular}{${columnSpecification(settings)}}`,
        ...ruledRows(rowLines(settings), settings),
        `${indent}\\end{tabular}`,
        '\\end{table}',
    ]);
}
