import { describe, expect, it } from 'vitest';
import { computeVirtualWindow, scaledRowHeight, scrollTopToReveal } from '../../src/renderer/app/virtualWindow';

const BASE = { rowHeight: 24, overscan: 2 } as const;

describe('Virtualisierungsfenster', () => {
    it('rendert bei 5.000 Zeilen nur die sichtbaren plus Puffer', () => {
        const window = computeVirtualWindow({ ...BASE, scrollTop: 0, viewportHeight: 480, rowCount: 5000 });
        expect(window).toEqual({ start: 0, end: 22, totalHeight: 120_000 });
    });

    it('verschiebt das Fenster beim Scrollen und klemmt am Ende', () => {
        const middle = computeVirtualWindow({ ...BASE, scrollTop: 2400, viewportHeight: 480, rowCount: 5000 });
        expect(middle.start).toBe(98);
        expect(middle.end).toBe(122);
        const bottom = computeVirtualWindow({ ...BASE, scrollTop: 119_520, viewportHeight: 480, rowCount: 5000 });
        expect(bottom.end).toBe(5000);
        expect(bottom.start).toBeGreaterThan(4900);
    });

    it('liefert bei wenigen oder keinen Zeilen sinnvolle Fenster', () => {
        expect(computeVirtualWindow({ ...BASE, scrollTop: 0, viewportHeight: 480, rowCount: 3 })).toEqual({ start: 0, end: 3, totalHeight: 72 });
        expect(computeVirtualWindow({ ...BASE, scrollTop: 0, viewportHeight: 480, rowCount: 0 })).toEqual({ start: 0, end: 0, totalHeight: 0 });
        expect(computeVirtualWindow({ ...BASE, scrollTop: 0, viewportHeight: 0, rowCount: 100 }).end).toBe(2);
    });

    it('scrollt nur, wenn die Zeile nicht ganz sichtbar ist', () => {
        const view = { scrollTop: 240, viewportHeight: 240, rowHeight: 24 };
        expect(scrollTopToReveal(12, view)).toBe(240);
        expect(scrollTopToReveal(5, view)).toBe(120);
        expect(scrollTopToReveal(30, view)).toBe(504);
    });

    it('skaliert die Zeilenhöhe mit dem Zoom der Oberfläche', () => {
        expect(scaledRowHeight(24, 100)).toBe(24);
        expect(scaledRowHeight(24, 150)).toBe(36);
        expect(scaledRowHeight(24, Number.NaN)).toBe(24);
    });
});
