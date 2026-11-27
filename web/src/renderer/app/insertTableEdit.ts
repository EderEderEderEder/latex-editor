// Tabellenraster im Einfügen-Fenster (W4-10): einzelne Zellen und Ausrichtungen ändern, Zellen leeren, Text aus
// Excel/Numbers (Tabulatoren, Zeilenumbrüche) übernehmen. Reine Funktionen über `TableSettings`.
import { fillTableFromTabSeparated } from '../../shared/core/insertion';
import type { ColumnAlignment, TableSettings } from '../../shared/core/insertion';

const TAB = '\t';
const LINE_FEED = '\n';
const CARRIAGE_RETURN = '\r';

export function setCell(table: TableSettings, row: number, column: number, value: string): TableSettings {
    const current = table.cells[row];
    if (current === undefined || column < 0 || column >= current.length) return table;
    const cells = table.cells.map((cellRow, index) => (index === row ? cellRow.map((cell, at) => (at === column ? value : cell)) : cellRow));
    return { ...table, cells };
}

export function setAlignment(table: TableSettings, column: number, alignment: ColumnAlignment): TableSettings {
    if (column < 0 || column >= table.alignments.length) return table;
    return { ...table, alignments: table.alignments.map((current, index) => (index === column ? alignment : current)) };
}

export function clearCells(table: TableSettings): TableSettings {
    return { ...table, cells: table.cells.map((row) => row.map(() => '')) };
}

/** Sieht der Text nach mehreren Zellen aus (Tabulator oder Zeilenumbruch)? Dann ist es Excel-Text, kein Einzelwert */
export function looksLikeSpreadsheet(text: string): boolean {
    return text.includes(TAB) || text.includes(LINE_FEED) || text.includes(CARRIAGE_RETURN);
}

/** Übernimmt Excel-/Numbers-Text; ohne Zellen im Text bleibt die Tabelle unverändert */
export function pasteSpreadsheet(table: TableSettings, text: string): TableSettings {
    return fillTableFromTabSeparated(table, text);
}
