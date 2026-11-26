/** Bereich in UTF-16-Einheiten (wie `NSRange`) */
export interface TextRange {
    readonly location: number;
    readonly length: number;
}

/** Klemmt auf `0...textLength`; ungültiger oder negativer Anfang ergibt den leeren Bereich am Textanfang */
export function clampRange(range: TextRange, textLength: number): TextRange {
    if (!Number.isFinite(range.location) || range.location < 0) return { location: 0, length: 0 };
    const limit = Math.max(textLength, 0);
    const start = Math.min(range.location, limit);
    const end = Math.min(Math.max(range.location + range.length, start), limit);
    return { location: start, length: end - start };
}

export function rangeEnd(range: TextRange): number {
    return range.location + range.length;
}
