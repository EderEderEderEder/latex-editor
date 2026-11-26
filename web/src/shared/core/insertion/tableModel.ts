import { DEFAULT_INDENT, type FloatPlacement } from './floatOptions';

export type ColumnAlignment = 'left' | 'center' | 'right';
export type TableRules = 'booktabs' | 'grid' | 'none';

export const MAXIMUM_TABLE_ROWS = 40;
export const MAXIMUM_TABLE_COLUMNS = 12;
const DEFAULT_TABLE_SIZE = 3;

export interface TableSettings {
    readonly rows: number;
    readonly columns: number;
    readonly hasHeader: boolean;
    readonly alignments: readonly ColumnAlignment[];
    readonly cells: readonly (readonly string[])[];
    readonly rules: TableRules;
    readonly caption: string;
    readonly placement: FloatPlacement;
    readonly escapeText: boolean;
    readonly indent: string;
}

function emptyCells(rows: number, columns: number): string[][] {
    return Array.from({ length: rows }, () => Array.from({ length: columns }, () => ''));
}

export function createTableSettings(overrides: Partial<TableSettings> = {}): TableSettings {
    return {
        rows: DEFAULT_TABLE_SIZE,
        columns: DEFAULT_TABLE_SIZE,
        hasHeader: true,
        alignments: Array.from({ length: DEFAULT_TABLE_SIZE }, () => 'left'),
        cells: emptyCells(DEFAULT_TABLE_SIZE, DEFAULT_TABLE_SIZE),
        rules: 'booktabs',
        caption: '',
        placement: 'standard',
        escapeText: true,
        indent: DEFAULT_INDENT,
        ...overrides,
    };
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum);
}

/** Ändert die Größe (1…40 Zeilen, 1…12 Spalten) und behält vorhandene Zellen links oben und die Ausrichtungen */
export function resizeTable(settings: TableSettings, rows: number, columns: number): TableSettings {
    const rowCount = clamp(Math.trunc(rows), 1, MAXIMUM_TABLE_ROWS);
    const columnCount = clamp(Math.trunc(columns), 1, MAXIMUM_TABLE_COLUMNS);
    const cells = emptyCells(rowCount, columnCount);
    for (let row = 0; row < Math.min(rowCount, settings.cells.length); row += 1) {
        const source = settings.cells[row] ?? [];
        for (let column = 0; column < Math.min(columnCount, source.length); column += 1) {
            cells[row]![column] = source[column] ?? '';
        }
    }
    const alignments = Array.from({ length: columnCount }, (_, column) => settings.alignments[column] ?? 'left');
    return { ...settings, rows: rowCount, columns: columnCount, cells, alignments };
}
