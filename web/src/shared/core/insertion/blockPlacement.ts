import { clampRange, rangeEnd, type TextRange } from './textRange';

const LINE_FEED = '\n';
const CARRIAGE_RETURN_LINE_FEED = '\r\n';

// In Swift ist `\r\n` ein einzelnes Zeichen und kein Zeilenende im Sinn von `hasSuffix("\n")`
function endsWithLineFeed(text: string): boolean {
    return text.endsWith(LINE_FEED) && !text.endsWith(CARRIAGE_RETURN_LINE_FEED);
}

/**
 * Setzt einen Block (endet mit Zeilenumbruch) sauber in eine Zeile ein: mitten in einer Zeile beginnt er in einer neuen,
 * folgt direkt ein Zeilenumbruch, entfällt der letzte des Blocks. Ergebnis ist der einzusetzende Text.
 */
export function adjustBlock(block: string, text: string, range: TextRange): string {
    const clamped = clampRange(range, text.length);
    const atLineStart = clamped.location === 0 || text.charAt(clamped.location - 1) === LINE_FEED;
    const result = atLineStart ? block : LINE_FEED + block;
    const end = rangeEnd(clamped);
    const followedByLineFeed = end < text.length && text.charAt(end) === LINE_FEED;
    return followedByLineFeed && endsWithLineFeed(result) ? result.slice(0, -1) : result;
}
