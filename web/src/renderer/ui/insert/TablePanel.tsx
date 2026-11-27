// Einstellungen „Tabelle“ (Vorlage `TableSettingsView`): Größe, Optionen, Linien, Beschriftung und das Raster. Das
// Raster nimmt auch Zellen aus Excel/Numbers auf (Tab-Text): in ein Einfügefeld oder direkt in eine Zelle einfügen.
import type { ClipboardEvent } from 'react';
import { resizeTable } from '../../../shared/core/insertion';
import type { ColumnAlignment, TableRules, TableSettings } from '../../../shared/core/insertion';
import { MAXIMUM_TABLE_COLUMNS, MAXIMUM_TABLE_ROWS } from '../../../shared/core/insertion/tableModel';
import { clearCells, looksLikeSpreadsheet, pasteSpreadsheet, setAlignment, setCell } from '../../app/insertTableEdit';
import { insertStore, useInsertStore } from '../../stores/insert';
import { CaptionFields } from './CaptionFields';
import { CheckField, NumberField, SelectField, SettingsCard } from './Fields';
import type { SelectOption } from './Fields';

export const TABLE_TEXTS = {
    structure: 'Aufbau',
    rows: 'Zeilen',
    columns: 'Spalten',
    header: 'Kopfzeile',
    escape: 'Sonderzeichen maskieren',
    rules: 'Linien',
    content: 'Inhalt',
    pasteLabel: 'Zellen aus Excel oder Numbers einfügen',
    pastePlaceholder: 'Zellen kopieren und hier mit Strg+V einfügen',
    clear: 'Zellen leeren',
    alignment: (column: number) => `Ausrichtung Spalte ${column}`,
    cell: (row: number, column: number) => `Zeile ${row}, Spalte ${column}`,
} as const;

const RULE_OPTIONS: readonly SelectOption[] = [
    { value: 'booktabs', title: 'Horizontale Linien (booktabs)' },
    { value: 'grid', title: 'Alle Linien' },
    { value: 'none', title: 'Keine Linien' },
];

const ALIGNMENT_OPTIONS: readonly SelectOption[] = [
    { value: 'left', title: 'Links' },
    { value: 'center', title: 'Zentriert' },
    { value: 'right', title: 'Rechts' },
];

const updateTable = (change: (table: TableSettings) => TableSettings): void => insertStore.getState().update('table', change);

function SizeAndOptions({ table }: { readonly table: TableSettings }) {
    return (
        <SettingsCard title={TABLE_TEXTS.structure}>
            <div className="insert-inline">
                <NumberField
                    label={TABLE_TEXTS.rows}
                    value={table.rows}
                    minimum={1}
                    maximum={MAXIMUM_TABLE_ROWS}
                    onChange={(rows) => updateTable((current) => resizeTable(current, rows, current.columns))}
                />
                <NumberField
                    label={TABLE_TEXTS.columns}
                    value={table.columns}
                    minimum={1}
                    maximum={MAXIMUM_TABLE_COLUMNS}
                    onChange={(columns) => updateTable((current) => resizeTable(current, current.rows, columns))}
                />
            </div>
            <div className="insert-inline">
                <CheckField label={TABLE_TEXTS.header} checked={table.hasHeader} onChange={(hasHeader) => updateTable((current) => ({ ...current, hasHeader }))} />
                <CheckField label={TABLE_TEXTS.escape} checked={table.escapeText} onChange={(escapeText) => updateTable((current) => ({ ...current, escapeText }))} />
            </div>
            <SelectField
                label={TABLE_TEXTS.rules}
                value={table.rules}
                options={RULE_OPTIONS}
                onChange={(rules) => updateTable((current) => ({ ...current, rules: rules as TableRules }))}
            />
        </SettingsCard>
    );
}

/** Excel-Text aus der Zwischenablage; ein einzelner Wert ohne Tab und Umbruch bleibt ein normales Einfügen in die Zelle */
function pasteIntoGrid(event: ClipboardEvent<HTMLElement>): void {
    const text = event.clipboardData.getData('text/plain');
    if (!looksLikeSpreadsheet(text)) return;
    event.preventDefault();
    updateTable((current) => pasteSpreadsheet(current, text));
}

function PasteArea() {
    return (
        <textarea
            className="insert-paste"
            rows={2}
            aria-label={TABLE_TEXTS.pasteLabel}
            placeholder={TABLE_TEXTS.pastePlaceholder}
            value=""
            onPaste={pasteIntoGrid}
            onChange={(event) => {
                // Einzelnes Tippen ist kein Einfügen: erst Tabulator oder Umbruch macht daraus Zellen
                if (looksLikeSpreadsheet(event.target.value)) updateTable((current) => pasteSpreadsheet(current, event.target.value));
            }}
        />
    );
}

function AlignmentRow({ table }: { readonly table: TableSettings }) {
    return (
        <tr>
            {table.alignments.map((alignment, column) => (
                <th key={column} scope="col">
                    <select
                        aria-label={TABLE_TEXTS.alignment(column + 1)}
                        value={alignment}
                        onChange={(event) => updateTable((current) => setAlignment(current, column, event.target.value as ColumnAlignment))}
                    >
                        {ALIGNMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.title}</option>)}
                    </select>
                </th>
            ))}
        </tr>
    );
}

function GridRows({ table }: { readonly table: TableSettings }) {
    return (
        <>
            {table.cells.slice(0, table.rows).map((cells, row) => (
                <tr key={row}>
                    {cells.slice(0, table.columns).map((value, column) => (
                        <td key={column}>
                            <input
                                type="text"
                                autoComplete="off"
                                spellCheck={false}
                                className={row === 0 && table.hasHeader ? 'is-header' : undefined}
                                style={{ textAlign: table.alignments[column] ?? 'left' }}
                                aria-label={TABLE_TEXTS.cell(row + 1, column + 1)}
                                value={value}
                                onPaste={pasteIntoGrid}
                                onChange={(event) => updateTable((current) => setCell(current, row, column, event.target.value))}
                            />
                        </td>
                    ))}
                </tr>
            ))}
        </>
    );
}

export function TablePanel() {
    const table = useInsertStore((state) => state.table);
    return (
        <>
            <SizeAndOptions table={table} />
            <CaptionFields kind="table" />
            <SettingsCard title={TABLE_TEXTS.content}>
                <PasteArea />
                <div>
                    <button type="button" onClick={() => updateTable(clearCells)}>{TABLE_TEXTS.clear}</button>
                </div>
                <div className="insert-grid-scroll">
                    <table className="insert-grid">
                        <thead><AlignmentRow table={table} /></thead>
                        <tbody><GridRows table={table} /></tbody>
                    </table>
                </div>
            </SettingsCard>
        </>
    );
}
