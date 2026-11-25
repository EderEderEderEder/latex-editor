import type { PdfRect } from '../contract';

// Umrechnung zwischen SyncTeX-Koordinaten (PDF-Punkte, Ursprung oben links der Seite, y nach unten) und dem
// PDF-Benutzerraum (Ursprung unten links, y nach oben, Media-Box ggf. verschoben, z. B. bei Beschnitt).
// Port von `SyncTeXCoordinates` (swift/Sources/LatexEditor/Model/SyncTeX.swift). Rein und ohne Node- oder
// DOM-Importe: Main (Vektoren) und PDF-Ansicht im Renderer (W3-5) teilen dieselben Formeln.

export interface PdfPoint {
    readonly x: number;
    readonly y: number;
}

export function pdfRectFromSyncTeX(rect: PdfRect, mediaBox: PdfRect): PdfRect {
    const mediaTop = mediaBox.y + mediaBox.height;
    return { x: mediaBox.x + rect.x, y: mediaTop - (rect.y + rect.height), width: rect.width, height: rect.height };
}

export function syncTeXPointFromPdf(point: PdfPoint, mediaBox: PdfRect): PdfPoint {
    return { x: point.x - mediaBox.x, y: mediaBox.y + mediaBox.height - point.y };
}

/** Kleinstes Rechteck um alle (Vorwärtssuche: je PDF-Zeile eins; Swift liefert die Vereinigung) */
export function unionRect(rects: readonly PdfRect[]): PdfRect | null {
    if (rects.length === 0) return null;
    const minX = Math.min(...rects.map((rect) => rect.x));
    const minY = Math.min(...rects.map((rect) => rect.y));
    const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
    const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Media-Box aus dem `viewBox` von pdf.js (`[xMin, yMin, xMax, yMax]`); `null` bei unvollständigen Werten */
export function mediaBoxFromViewBox(viewBox: readonly number[]): PdfRect | null {
    const [xMin, yMin, xMax, yMax] = viewBox;
    if (xMin === undefined || yMin === undefined || xMax === undefined || yMax === undefined) return null;
    return { x: Math.min(xMin, xMax), y: Math.min(yMin, yMax), width: Math.abs(xMax - xMin), height: Math.abs(yMax - yMin) };
}

/** Liegt `inner` ganz in `outer`? (beide im selben Koordinatensystem, „PDF folgt Cursor“: Stelle schon sichtbar) */
export function containsRect(outer: PdfRect, inner: PdfRect): boolean {
    return inner.x >= outer.x && inner.y >= outer.y &&
        inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}
