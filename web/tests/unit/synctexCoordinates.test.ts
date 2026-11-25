import { describe, expect, it } from 'vitest';
import {
    containsRect,
    mediaBoxFromViewBox,
    pdfRectFromSyncTeX,
    syncTeXPointFromPdf,
    unionRect,
} from '../../src/shared/core/synctexCoordinates';

// W3-5: gemeinsame Umrechnung für Main und Renderer (`shared/core/synctexCoordinates.ts`). Die Fälle aus
// `shared/spec/synctex.json` laufen in `synctexSpec.test.ts`; hier die Hilfen der PDF-Ansicht.

const A4 = { x: 0, y: 0, width: 595, height: 842 };
const CROPPED = { x: 20, y: 30, width: 595, height: 842 };

describe('Umrechnung SyncTeX ↔ PDF-Benutzerraum', () => {
    it('Klick zurück: Mitte des Vorwärts-Rechtecks ergibt wieder einen Punkt darin (auch mit verschobener Media-Box)', () => {
        const syncRect = { x: 72, y: 300, width: 200, height: 12 };
        for (const mediaBox of [A4, CROPPED]) {
            const pdfRect = pdfRectFromSyncTeX(syncRect, mediaBox);
            const center = { x: pdfRect.x + pdfRect.width / 2, y: pdfRect.y + pdfRect.height / 2 };
            expect(syncTeXPointFromPdf(center, mediaBox)).toEqual({ x: 172, y: 306 });
        }
    });

    it('oben in SyncTeX ist oben im PDF (y wächst im PDF nach oben)', () => {
        const top = pdfRectFromSyncTeX({ x: 0, y: 0, width: 10, height: 10 }, A4);
        expect(top.y).toBe(A4.height - 10);
    });
});

describe('Media-Box aus dem viewBox von pdf.js', () => {
    it('liest [xMin, yMin, xMax, yMax], auch vertauscht', () => {
        expect(mediaBoxFromViewBox([0, 0, 595, 842])).toEqual(A4);
        expect(mediaBoxFromViewBox([20, 30, 615, 872])).toEqual(CROPPED);
        expect(mediaBoxFromViewBox([615, 872, 20, 30])).toEqual(CROPPED);
    });

    it('unvollständige Werte ergeben null', () => {
        expect(mediaBoxFromViewBox([0, 0, 595])).toBeNull();
        expect(mediaBoxFromViewBox([])).toBeNull();
    });
});

describe('Vereinigung und Enthaltensein', () => {
    it('vereinigt die Zeilenrechtecke; leer ergibt null', () => {
        expect(unionRect([{ x: 10, y: 100, width: 50, height: 10 }, { x: 5, y: 112, width: 80, height: 10 }]))
            .toEqual({ x: 5, y: 100, width: 80, height: 22 });
        expect(unionRect([])).toBeNull();
    });

    it('nur ganz enthaltene Rechtecke gelten als sichtbar (Ränder zählen dazu)', () => {
        const visible = { x: 0, y: 0, width: 100, height: 100 };
        expect(containsRect(visible, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
        expect(containsRect(visible, { x: 10, y: 10, width: 20, height: 20 })).toBe(true);
        expect(containsRect(visible, { x: 90, y: 10, width: 20, height: 20 })).toBe(false);
        expect(containsRect(visible, { x: 10, y: -1, width: 20, height: 20 })).toBe(false);
    });
});
