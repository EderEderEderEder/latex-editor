import type { PdfRect } from '../shared/contract';

// Umrechnung zwischen SyncTeX-Koordinaten (PDF-Punkte, Ursprung oben links der Seite, y nach unten) und dem
// PDF-Benutzerraum (Ursprung unten links, y nach oben, Media-Box ggf. verschoben, z. B. bei Beschnitt).
// Port von `SyncTeXCoordinates` (swift/Sources/LatexEditor/Model/SyncTeX.swift). Ohne Node-Importe, damit die
// PDF-Ansicht im Renderer (W3-5) dieselben Formeln übernehmen kann.

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
