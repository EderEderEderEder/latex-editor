// Einfache Virtualisierung für Listen mit fester Zeilenhöhe: nur die sichtbaren Zeilen (plus Puffer) werden gerendert.

export interface VirtualWindowInput {
    readonly scrollTop: number;
    readonly viewportHeight: number;
    readonly rowHeight: number;
    readonly rowCount: number;
    /** Zusätzliche Zeilen über und unter dem Sichtbereich */
    readonly overscan: number;
}

export interface VirtualWindow {
    /** Erste gerenderte Zeile */
    readonly start: number;
    /** Hinter der letzten gerenderten Zeile */
    readonly end: number;
    readonly totalHeight: number;
}

export const TREE_OVERSCAN_ROWS = 8;

export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindow {
    const { scrollTop, viewportHeight, rowHeight, rowCount, overscan } = input;
    const totalHeight = rowCount * rowHeight;
    if (rowCount === 0 || rowHeight <= 0) return { start: 0, end: 0, totalHeight: 0 };
    const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
    const last = Math.ceil((Math.max(0, scrollTop) + Math.max(0, viewportHeight)) / rowHeight);
    return {
        start: Math.min(Math.max(0, first - overscan), rowCount),
        end: Math.min(rowCount, last + overscan),
        totalHeight,
    };
}

/** Neue Scrollposition, die Zeile `index` ganz in den Sichtbereich holt (unverändert, wenn sie schon sichtbar ist) */
export function scrollTopToReveal(
    index: number, view: { readonly scrollTop: number; readonly viewportHeight: number; readonly rowHeight: number },
): number {
    const top = index * view.rowHeight;
    const bottom = top + view.rowHeight;
    if (top < view.scrollTop) return top;
    if (bottom > view.scrollTop + view.viewportHeight) return Math.max(0, bottom - view.viewportHeight);
    return view.scrollTop;
}

/** Zeilenhöhe in Pixeln bei Schrift-Zoom der Oberfläche (Prozent) */
export function scaledRowHeight(basePx: number, zoomPercent: number): number {
    const percent = Number.isFinite(zoomPercent) && zoomPercent > 0 ? zoomPercent : 100;
    return Math.max(1, Math.round((basePx * percent) / 100));
}
