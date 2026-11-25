// Gemeinsame Typen des Spikes S2. Koordinaten immer in PDF-Punkten, Ursprung oben links der Seite, y nach unten
// (wie SyncTeX); die PDFKit-Referenz rechnet in dieselben Koordinaten um.

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SideInput {
    /** 1-basiert */
    page: number;
    rect: Rect;
    words: string[];
}

export interface MarkInput {
    id: string;
    /** Schlüssel des PDFs (`hgb` oder `test`) bzw. für die Referenz der absolute Pfad */
    pdf: string;
    start: SideInput;
    end: SideInput;
}

export interface Segment {
    page: number;
    rect: Rect;
}

export type Precision = "words" | "lines" | "orphaned";

export interface MarkOutput {
    id: string;
    precision: Precision;
    segments: Segment[];
    /** Der überdeckte Text (zur Prüfung der Wörter) */
    text: string;
}

/** Text einer Seite und je UTF-16-Zeichen sein Rechteck; `null` für eingefügte Trenner ohne Lage */
export interface PageGeometry {
    text: string;
    boxes: (Rect | null)[];
}

export type VariantName = "textLayer" | "uniform" | "fontMetrics" | "fontSpaces";

export interface PageTiming {
    pdf: string;
    page: number;
    /** `getTextContent` allein */
    textContentMs: number;
    /** Aufbau der Zeichenrechtecke aus dem Textinhalt (bei `textLayer` mit Rendern der Textebene) */
    geometryMs: number;
}

export interface VariantRun {
    variant: VariantName;
    outputs: MarkOutput[];
    /** je Wiederholung alle Seiten */
    timings: PageTiming[][];
    /** Zuordnung aller Markierungen, je Wiederholung (ms) */
    resolveMs: number[];
    notes: string[];
}

export interface SpikeRequest {
    pdfs: Record<string, string>;
    marks: MarkInput[];
    repetitions: number;
    scale: number;
    /** W3-3a: Seiten im Render-Worker von pdf.js zeichnen (OffscreenCanvas) statt im Hauptthread */
    workerRendering?: boolean;
}

export interface SpikeResponse {
    runs: VariantRun[];
    environment: Record<string, string>;
}

declare global {
    interface Window {
        spikeRun?: (request: SpikeRequest) => Promise<SpikeResponse>;
    }
}
