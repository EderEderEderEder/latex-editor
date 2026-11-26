const LINE_FEED = '\n';

/** Anfangsoffsets aller Zeilen (durch `\n` getrennt); ein Text mit Schluss-`\n` hat eine leere letzte Zeile */
export function lineStartsOf(text: string): number[] {
    const starts = [0];
    for (let index = text.indexOf(LINE_FEED); index !== -1; index = text.indexOf(LINE_FEED, index + 1)) {
        starts.push(index + 1);
    }
    return starts;
}

/** 0-basierte Zeile eines Offsets (auf `0...text.length` geklemmt); ein `\n` gehört zu der Zeile, die es beendet */
export function lineContaining(starts: readonly number[], textLength: number, offset: number): number {
    const clamped = Math.min(Math.max(offset, 0), textLength);
    let line = 0;
    for (let index = 1; index < starts.length && starts[index]! <= clamped; index += 1) line = index;
    return line;
}

/** Ende der Zeile ohne ihr `\n` */
export function lineContentEnd(starts: readonly number[], textLength: number, line: number): number {
    return line + 1 < starts.length ? starts[line + 1]! - 1 : textLength;
}
