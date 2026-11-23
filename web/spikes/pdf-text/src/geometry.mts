// Drei Wege von pdf.js zu Zeichenrechtecken einer Seite (läuft im Renderer):
//   textLayer   – gerenderte Textebene (`TextLayer`), je Zeichen `Range.getBoundingClientRect()`
//   uniform     – nur `getTextContent`: Transform + Breite / Zeichenzahl (gleich breite Zeichen je Textstück)
//   fontMetrics – `getTextContent` + Breiten der eingebetteten Schrift (Canvas `measureText`), auf die Stückbreite skaliert
import { TextLayer } from "pdfjs-dist";
import type { PDFPageProxy } from "pdfjs-dist";
import type { TextContent, TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";
import type { PageGeometry, Rect } from "./types.mjs";

/** Anteil der Schriftgröße über bzw. unter der Grundlinie (nur für die Varianten ohne DOM) */
const ASCENT = 0.75;
const DESCENT = 0.25;
const MEASURE_FONT_SIZE = 100;

export function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
    return "str" in item;
}

export function textItems(content: TextContent): TextItem[] {
    return content.items.filter(isTextItem);
}

class GeometryBuilder {
    text = "";
    boxes: (Rect | null)[] = [];

    add(character: string, box: Rect | null): void {
        this.text += character;
        for (let unit = 0; unit < character.length; unit += 1) this.boxes.push(box);
    }

    endItem(item: TextItem): void {
        if (item.hasEOL) this.add("\n", null);
    }

    result(): PageGeometry {
        return { text: this.text, boxes: this.boxes };
    }
}

interface ItemFrame {
    x: number;
    baseline: number;
    fontHeight: number;
}

/** Lage eines Textstücks in Koordinaten oben links (`view` = [x0, y0, x1, y1] der Seite) */
function frameOf(item: TextItem, view: number[]): ItemFrame {
    const [a, b, c, d, e, f] = item.transform as number[];
    const fontHeight = Math.hypot(c ?? 0, d ?? 0) || Math.hypot(a ?? 0, b ?? 0);
    return { x: (e ?? 0) - (view[0] ?? 0), baseline: (view[3] ?? 0) - (f ?? 0), fontHeight };
}

function boxAt(frame: ItemFrame, offset: number, width: number): Rect {
    return { x: frame.x + offset, y: frame.baseline - ASCENT * frame.fontHeight, width, height: (ASCENT + DESCENT) * frame.fontHeight };
}

/** Zeichenbreiten eines Stücks: `widthsOf` liefert relative Breiten, die auf `item.width` gestreckt werden */
function geometryFromWidths(content: TextContent, view: number[], widthsOf: (item: TextItem) => number[]): PageGeometry {
    const builder = new GeometryBuilder();
    for (const item of textItems(content)) {
        const frame = frameOf(item, view);
        const characters = Array.from(item.str);
        const widths = widthsOf(item);
        const total = widths.reduce((sum, width) => sum + width, 0);
        const scale = total > 0 ? item.width / total : 0;
        let offset = 0;
        characters.forEach((character, index) => {
            const width = (widths[index] ?? 0) * scale;
            builder.add(character, boxAt(frame, offset, width));
            offset += width;
        });
        builder.endItem(item);
    }
    return builder.result();
}

export function uniformGeometry(content: TextContent, view: number[]): PageGeometry {
    return geometryFromWidths(content, view, (item) => Array.from(item.str).map(() => 1));
}

export interface FontMetricsStats {
    measuredItems: number;
    fallbackItems: number;
    /** Summe der gemessenen Breiten / `item.width`, ≈ 1 bei passender Schrift */
    ratios: number[];
}

/** Braucht die eingebetteten Schriften im Dokument: Seite vorher ins Canvas rendern (`disableWorkerRendering`) */
export function fontMetricsGeometry(content: TextContent, view: number[], context: CanvasRenderingContext2D, stats: FontMetricsStats): PageGeometry {
    return geometryFromWidths(content, view, (item) => {
        const characters = Array.from(item.str);
        const fontReady = document.fonts.check(`${MEASURE_FONT_SIZE}px "${item.fontName}"`);
        if (!fontReady || characters.length === 0) {
            stats.fallbackItems += 1;
            return characters.map(() => 1);
        }
        context.font = `${MEASURE_FONT_SIZE}px "${item.fontName}"`;
        const widths = characters.map((character) => context.measureText(character).width);
        const total = widths.reduce((sum, width) => sum + width, 0);
        const fontHeight = frameOf(item, [0, 0, 0, 0]).fontHeight;
        if (item.width > 0) stats.ratios.push((total * fontHeight) / MEASURE_FONT_SIZE / item.width);
        stats.measuredItems += 1;
        return widths;
    });
}

/**
 * Wie `fontMetricsGeometry`, aber Glyphen in ihrer echten Breite (Schriftgröße aus dem Transform) und der Rest der
 * Stückbreite nur auf die Leerzeichen verteilt: TeX setzt Blocksatz über dehnbare Wortabstände, nicht über die Glyphen.
 */
export function fontSpacesGeometry(content: TextContent, view: number[], context: CanvasRenderingContext2D): PageGeometry {
    return geometryFromWidths(content, view, (item) => {
        const characters = Array.from(item.str);
        const font = `${MEASURE_FONT_SIZE}px "${item.fontName}"`;
        if (characters.length === 0 || !document.fonts.check(font)) return characters.map(() => 1);
        context.font = font;
        const [a, b] = item.transform as number[];
        const size = Math.hypot(a ?? 0, b ?? 0) / MEASURE_FONT_SIZE;
        const isSpace = characters.map((character) => character.trim() === "");
        const glyphs = characters.map((character, index) => (isSpace[index] ? 0 : context.measureText(character).width * size));
        const spaces = isSpace.filter(Boolean).length;
        const rest = item.width - glyphs.reduce((sum, width) => sum + width, 0);
        if (spaces === 0 || rest <= 0) return glyphs;
        return glyphs.map((width, index) => (isSpace[index] ? rest / spaces : width));
    });
}

function makeLayerContainer(host: HTMLElement, scale: number): HTMLDivElement {
    const container = document.createElement("div");
    container.className = "textLayer";
    container.style.setProperty("--scale-factor", String(scale));
    container.style.setProperty("--total-scale-factor", String(scale));
    container.style.setProperty("--scale-round-x", "1px");
    container.style.setProperty("--scale-round-y", "1px");
    host.append(container);
    return container;
}

function characterBox(range: Range, origin: DOMRect, scale: number): Rect | null {
    const client = range.getBoundingClientRect();
    if (client.width === 0 && client.height === 0) return null;
    return { x: (client.left - origin.left) / scale, y: (client.top - origin.top) / scale, width: client.width / scale, height: client.height / scale };
}

function measureSpans(items: TextItem[], spans: HTMLElement[], origin: DOMRect, scale: number): PageGeometry {
    const builder = new GeometryBuilder();
    const range = document.createRange();
    items.forEach((item, index) => {
        const node = spans[index]?.firstChild;
        for (let unit = 0; unit < item.str.length; unit += 1) {
            if (!node) {
                builder.add(item.str.charAt(unit), null);
                continue;
            }
            range.setStart(node, unit);
            range.setEnd(node, unit + 1);
            builder.add(item.str.charAt(unit), characterBox(range, origin, scale));
        }
        builder.endItem(item);
    });
    return builder.result();
}

export async function textLayerGeometry(page: PDFPageProxy, content: TextContent, host: HTMLElement, scale: number): Promise<PageGeometry> {
    const container = makeLayerContainer(host, scale);
    const layer = new TextLayer({ textContentSource: content, container, viewport: page.getViewport({ scale }) });
    await layer.render();
    const geometry = measureSpans(textItems(content), layer.textDivs, container.getBoundingClientRect(), scale);
    container.remove();
    return geometry;
}
