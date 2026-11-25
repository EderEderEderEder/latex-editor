import { describe, expect, it } from 'vitest';
import {
    DEFAULT_SPLIT_FRACTION, DEFAULT_VIEW_MODE, EDITOR_MIN_WIDTH, KEY_STEP_LARGE_PX, KEY_STEP_PX, PDF_MIN_WIDTH,
    SPLIT_HANDLE_WIDTH, clampFraction, computeLayout, editorWidthAfterKey, editorWidthFor, fractionForEditorWidth, isViewMode,
} from '../../src/renderer/app/viewModeLogic';
import { createViewModeStore } from '../../src/renderer/stores/viewMode';
import { createCommandRegistry } from '../../src/renderer/app/commands';
import type { CommandDeps } from '../../src/renderer/app/commands';
import { buildMenuEntries, commandIdsOf } from '../../src/main/menuTemplate';

const TOTAL = 1000;
const AVAILABLE = TOTAL - SPLIT_HANDLE_WIDTH;

describe('Teilerposition', () => {
    it('Standard: geteilt, Mitte', () => {
        expect(DEFAULT_VIEW_MODE).toBe('split');
        expect(editorWidthFor(DEFAULT_SPLIT_FRACTION, AVAILABLE)).toBe(Math.round(AVAILABLE / 2));
    });

    it('klemmt auf die Mindestbreiten beider Seiten', () => {
        expect(editorWidthFor(0, AVAILABLE)).toBe(EDITOR_MIN_WIDTH);
        expect(editorWidthFor(1, AVAILABLE)).toBe(AVAILABLE - PDF_MIN_WIDTH);
        expect(editorWidthFor(0.3, AVAILABLE)).toBe(Math.round(0.3 * AVAILABLE));
    });

    it('reicht der Platz nicht für beide Mindestbreiten, wird halbe-halbe geteilt', () => {
        const narrow = EDITOR_MIN_WIDTH + PDF_MIN_WIDTH;
        expect(editorWidthFor(0.9, narrow)).toBe(narrow / 2);
        expect(editorWidthFor(0.1, 0)).toBe(0);
    });

    it('Anteil: ungültige Werte, Grenzen, Umrechnung', () => {
        expect(clampFraction(Number.NaN)).toBe(DEFAULT_SPLIT_FRACTION);
        expect(clampFraction(-1)).toBe(0);
        expect(clampFraction(2)).toBe(1);
        expect(fractionForEditorWidth(250, 500)).toBe(0.5);
        expect(fractionForEditorWidth(10, 0)).toBe(DEFAULT_SPLIT_FRACTION);
    });

    it('Tastatur: Pfeile mit Schrittweite, Umschalt größer, Pos1/Ende an den Grenzen', () => {
        expect(editorWidthAfterKey('ArrowLeft', 400, AVAILABLE, false)).toBe(400 - KEY_STEP_PX);
        expect(editorWidthAfterKey('ArrowRight', 400, AVAILABLE, true)).toBe(400 + KEY_STEP_LARGE_PX);
        expect(editorWidthAfterKey('Home', 400, AVAILABLE, false)).toBe(EDITOR_MIN_WIDTH);
        expect(editorWidthAfterKey('End', 400, AVAILABLE, false)).toBe(AVAILABLE - PDF_MIN_WIDTH);
        expect(editorWidthAfterKey('a', 400, AVAILABLE, false)).toBeNull();
    });
});

describe('Aufteilung je Modus', () => {
    it('geteilt: Editor, Teiler (14 px), PDF nebeneinander ohne Lücke', () => {
        const layout = computeLayout('split', TOTAL, 0.5);
        expect(layout.handle.width).toBe(SPLIT_HANDLE_WIDTH);
        expect(layout.editor.left + layout.editor.width).toBe(layout.handle.left);
        expect(layout.handle.left + SPLIT_HANDLE_WIDTH).toBe(layout.pdf.left);
        expect(layout.pdf.left + layout.pdf.width).toBe(TOTAL);
        expect([layout.editor.isShown, layout.handle.isShown, layout.pdf.isShown]).toEqual([true, true, true]);
    });

    it('Editor: volle Breite, PDF bleibt mit seiner Breite eingehängt, aber ausgeblendet', () => {
        const split = computeLayout('split', TOTAL, 0.4);
        const layout = computeLayout('editor', TOTAL, 0.4);
        expect(layout.editor).toMatchObject({ left: 0, width: TOTAL, isShown: true });
        expect(layout.pdf).toMatchObject({ width: split.pdf.width, isShown: false });
        expect(layout.handle.isShown).toBe(false);
    });

    it('PDF: volle Breite, Editor behält seine Breite aus „Geteilt“, ausgeblendet', () => {
        const split = computeLayout('split', TOTAL, 0.4);
        const layout = computeLayout('pdf', TOTAL, 0.4);
        expect(layout.pdf).toMatchObject({ left: 0, width: TOTAL, isShown: true });
        expect(layout.editor).toMatchObject({ width: split.editor.width, isShown: false });
    });

    it('die Teilerposition bleibt über alle Modi gleich', () => {
        const widths = (['editor', 'split', 'pdf'] as const).map((mode) => computeLayout(mode, TOTAL, 0.35).splitEditorWidth);
        expect(new Set(widths).size).toBe(1);
    });

    it('Breite 0 (vor der Messung) gibt keine negativen Maße', () => {
        const layout = computeLayout('split', 0, 0.5);
        expect(layout.editor.width).toBe(0);
        expect(layout.pdf.width).toBe(0);
    });
});

describe('Ansichts-Store und Befehle', () => {
    it('Standard geteilt; Moduswechsel behält den Anteil; Zurücksetzen auf die Mitte', () => {
        const store = createViewModeStore();
        expect(store.getState()).toMatchObject({ mode: 'split', fraction: DEFAULT_SPLIT_FRACTION });
        store.getState().setFraction(0.3);
        store.getState().setMode('pdf');
        store.getState().setMode('editor');
        expect(store.getState().fraction).toBe(0.3);
        store.getState().resetFraction();
        expect(store.getState().fraction).toBe(DEFAULT_SPLIT_FRACTION);
    });

    it('setzt nur bei echter Änderung', () => {
        const store = createViewModeStore();
        const before = store.getState();
        store.getState().setMode('split');
        store.getState().setFraction(DEFAULT_SPLIT_FRACTION);
        expect(store.getState()).toBe(before);
    });

    it('isViewMode erkennt nur die drei Modi', () => {
        expect(isViewMode('pdf')).toBe(true);
        expect(isViewMode('both')).toBe(false);
        expect(isViewMode(1)).toBe(false);
    });

    it('Menübefehle view.mode.* stehen im Menü und im Register und setzen den Modus', async () => {
        const store = createViewModeStore();
        const registry = createCommandRegistry({ viewMode: store } as unknown as CommandDeps);
        const ids = commandIdsOf(buildMenuEntries({ platform: 'win32', isPackaged: true }));
        for (const [id, mode] of [['view.mode.editor', 'editor'], ['view.mode.pdf', 'pdf'], ['view.mode.split', 'split']] as const) {
            expect(ids).toContain(id);
            await registry.get(id)?.();
            expect(store.getState().mode).toBe(mode);
        }
    });
});
