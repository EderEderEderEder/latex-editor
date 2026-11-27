import { describe, expect, it } from 'vitest';
import { createTableSettings, generateTable, resizeTable } from '../../src/shared/core/insertion';
import { EMPTY_INSERT_CATALOG } from '../../src/renderer/app/insertLogic';
import { clearCells, looksLikeSpreadsheet, pasteSpreadsheet, setAlignment, setCell } from '../../src/renderer/app/insertTableEdit';
import { createInsertStore } from '../../src/renderer/stores/insert';

const OPEN = { selectedText: '', context: null, canInsertIntoEditor: true } as const;

describe('Einfügen-Store', () => {
    it('öffnet mit dem zuletzt benutzten Baustein und merkt sich den neuen', () => {
        const store = createInsertStore();
        expect(store.getState().kind).toBe('table');
        store.getState().open({ ...OPEN, kind: 'equation' });
        expect(store.getState()).toMatchObject({ isOpen: true, kind: 'equation', canInsertIntoEditor: true });
        store.getState().close();
        store.getState().open(OPEN);
        expect(store.getState().kind).toBe('equation');
    });

    it('übernimmt markierten Text als Inhalt von Code, Gleichung und Liste', () => {
        const store = createInsertStore();
        store.getState().open({ ...OPEN, selectedText: 'x = 1\ny = 2' });
        const state = store.getState();
        expect(state.code.content).toBe('x = 1\ny = 2');
        expect(state.equation.content).toBe('x = 1\ny = 2');
        expect(state.list.items).toEqual(['x = 1', 'y = 2']);
    });

    it('löscht beim Öffnen und Schließen die alte Fehlermeldung', () => {
        const store = createInsertStore();
        store.getState().open(OPEN);
        store.getState().setError('kaputt');
        store.getState().close();
        expect(store.getState().errorMessage).toBeNull();
        store.getState().setError('wieder');
        store.getState().open(OPEN);
        expect(store.getState().errorMessage).toBeNull();
    });

    it('wählt für den Querverweis das erste Label, behält ein vorhandenes und ersetzt ein fehlendes', () => {
        const store = createInsertStore();
        const label = (name: string) => ({ label: name, file: 'a.tex', line: 1 });
        store.getState().setCatalog({ ...EMPTY_INSERT_CATALOG, labels: [label('fig:a'), label('tab:b')] });
        expect(store.getState().reference.label).toBe('fig:a');
        store.getState().update('reference', (current) => ({ ...current, label: 'tab:b' }));
        store.getState().setCatalog({ ...EMPTY_INSERT_CATALOG, labels: [label('fig:a'), label('tab:b')] });
        expect(store.getState().reference.label).toBe('tab:b');
        store.getState().setCatalog({ ...EMPTY_INSERT_CATALOG, labels: [label('eq:c')] });
        expect(store.getState().reference.label).toBe('eq:c');
        store.getState().setCatalog(EMPTY_INSERT_CATALOG);
        expect(store.getState().reference.label).toBe('');
    });

    it('nach dem Anlegen einer Quelle bleiben Art, Sprache und Zitier-Wahl, Eingaben und Seite sind leer', () => {
        const store = createInsertStore();
        store.getState().update('source', (current) => ({ ...current, type: 'article', language: 'english', authors: 'A B', values: { title: 'T' } }));
        store.getState().update('sourceOptions', () => ({ citeAfterInsert: false, note: 'S. 3' }));
        store.getState().resetSource();
        const { source, sourceOptions } = store.getState();
        expect(source).toMatchObject({ type: 'article', language: 'english', authors: '', values: {}, keyOverride: '' });
        expect(sourceOptions).toEqual({ citeAfterInsert: false, note: '' });
    });

    it('Bausteine behalten ihre Einstellungen beim Wechseln', () => {
        const store = createInsertStore();
        store.getState().update('table', (current) => ({ ...current, caption: 'Werte' }));
        store.getState().setKind('image');
        store.getState().setKind('table');
        expect(store.getState().table.caption).toBe('Werte');
    });
});

describe('Tabellenraster', () => {
    it('Größe ändern behält Zellen links oben und Ausrichtungen', () => {
        let table = setCell(createTableSettings(), 0, 0, 'a');
        table = setAlignment(table, 1, 'right');
        const bigger = resizeTable(table, 4, 5);
        expect(bigger.cells[0]?.[0]).toBe('a');
        expect(bigger.alignments).toEqual(['left', 'right', 'left', 'left', 'left']);
        const smaller = resizeTable(bigger, 1, 1);
        expect(smaller.cells).toEqual([['a']]);
    });

    it('Zellen und Ausrichtung außerhalb des Rasters ändern nichts', () => {
        const table = createTableSettings();
        expect(setCell(table, 9, 0, 'x')).toBe(table);
        expect(setCell(table, 0, 9, 'x')).toBe(table);
        expect(setAlignment(table, 9, 'center')).toBe(table);
    });

    it('Zellen leeren lässt die Größe', () => {
        const filled = setCell(createTableSettings(), 1, 1, 'x');
        const cleared = clearCells(filled);
        expect(cleared.cells.flat().every((cell) => cell === '')).toBe(true);
        expect(cleared.rows).toBe(3);
    });

    it('Excel-Text (Tabulator, Zeilenumbruch, Anführungszeichen) füllt und passt die Größe an', () => {
        const pasted = pasteSpreadsheet(createTableSettings(), 'Name\tWert\r\nA\t1\r\n"B\tx"\t"2"\r\n');
        expect(pasted).toMatchObject({ rows: 3, columns: 2 });
        expect(pasted.cells).toEqual([['Name', 'Wert'], ['A', '1'], ['B\tx', '2']]);
        expect(pasted.alignments).toHaveLength(2);
    });

    it('Text aus Excel ersetzt alte Zellen vollständig; leerer Text ändert nichts', () => {
        const old = setCell(createTableSettings(), 2, 2, 'alt');
        const pasted = pasteSpreadsheet(old, 'a\tb');
        expect(pasted.cells).toEqual([['a', 'b']]);
        expect(pasteSpreadsheet(old, '')).toBe(old);
    });

    it('erkennt, ob eingefügter Text mehrere Zellen meint', () => {
        expect(looksLikeSpreadsheet('a\tb')).toBe(true);
        expect(looksLikeSpreadsheet('a\nb')).toBe(true);
        expect(looksLikeSpreadsheet('nur ein Wert')).toBe(false);
    });

    it('der erzeugte Text folgt dem Raster (Kopfzeile, booktabs, maskiert)', () => {
        const filled = pasteSpreadsheet(createTableSettings({ caption: 'Werte' }), 'Name\tAnteil\nA\t50 %');
        const text = generateTable(filled, 'tab:werte');
        expect(text).toContain('\\begin{tabular}{@{}ll@{}}');
        expect(text).toContain('\\midrule');
        expect(text).toContain('50 \\%');
        expect(text.indexOf('\\caption{Werte}')).toBeLessThan(text.indexOf('\\label{tab:werte}'));
    });
});
