// Nachbau von MarkResolver (Swift): SyncTeX-Rechteck → Zeichen der Seite darin → Wörter suchen (3, 2, 1) →
// Zeilenrechtecke vom ersten bis zum letzten Zeichen. Ohne Treffer bleibt das SyncTeX-Rechteck (Precision.lines).
import type { MarkInput, MarkOutput, PageGeometry, Precision, Rect, Segment, SideInput } from "./types.mjs";

const RECT_TOLERANCE = 1;
const MAXIMUM_WORDS_MATCHED = 3;
const MINIMUM_LINE_HEIGHT = 8;
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u;

export interface Token {
    text: string;
    start: number;
    /** exklusiv */
    end: number;
}

interface CharRange {
    first: number;
    last: number;
}

export function normalizedWord(word: string): string {
    return word.normalize("NFKC").toLowerCase();
}

/** Wörter wie `MarkText.tokens`: Folgen aus Buchstaben, Ziffern und Kombinationszeichen */
export function tokens(text: string, offset = 0): Token[] {
    const result: Token[] = [];
    let start = -1;
    for (let index = 0; index <= text.length; index += 1) {
        const isWord = index < text.length && WORD_CHARACTER.test(text.charAt(index));
        if (isWord && start < 0) start = index;
        if (isWord || start < 0) continue;
        result.push({ text: normalizedWord(text.slice(start, index)), start: start + offset, end: index + offset });
        start = -1;
    }
    return result;
}

export function wordsOf(text: string): string[] {
    return tokens(text).map((token) => token.text);
}

function withMinimumHeight(rect: Rect): Rect {
    if (rect.height >= MINIMUM_LINE_HEIGHT) return rect;
    const grow = (MINIMUM_LINE_HEIGHT - rect.height) / 2;
    return { x: rect.x, y: rect.y - grow, width: rect.width, height: MINIMUM_LINE_HEIGHT };
}

function containsCenter(area: Rect, box: Rect): boolean {
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    return centerX >= area.x && centerX <= area.x + area.width && centerY >= area.y && centerY <= area.y + area.height;
}

export function charactersInside(geometry: PageGeometry, rect: Rect): CharRange | null {
    const area = { x: rect.x - RECT_TOLERANCE, y: rect.y - RECT_TOLERANCE, width: rect.width + 2 * RECT_TOLERANCE, height: rect.height + 2 * RECT_TOLERANCE };
    let first = -1;
    let last = -1;
    geometry.boxes.forEach((box, index) => {
        if (box === null || !containsCenter(area, box)) return;
        if (first < 0) first = index;
        last = index;
    });
    return first < 0 ? null : { first, last };
}

function hitsOf(found: Token[], wanted: string[]): number[] {
    const hits: number[] = [];
    for (let index = 0; index + wanted.length <= found.length; index += 1) {
        if (wanted.every((word, offset) => found[index + offset]?.text === word)) hits.push(index);
    }
    return hits;
}

/** Zuerst 3, dann 2, dann 1 Wort; ein einzelnes Wort nur, wenn es im Rechteck genau einmal vorkommt */
export function matchWords(geometry: PageGeometry, words: string[], isStart: boolean, range: CharRange): CharRange | null {
    const found = tokens(geometry.text.slice(range.first, range.last + 1), range.first);
    for (let count = Math.min(words.length, MAXIMUM_WORDS_MATCHED); count >= 1; count -= 1) {
        const wanted = isStart ? words.slice(0, count) : words.slice(words.length - count);
        const hits = hitsOf(found, wanted);
        if (hits.length === 0 || (count === 1 && hits.length > 1)) continue;
        const hit = isStart ? hits[0] : hits[hits.length - 1];
        const first = hit === undefined ? undefined : found[hit];
        const last = hit === undefined ? undefined : found[hit + count - 1];
        if (first && last) return { first: first.start, last: last.end - 1 };
    }
    return null;
}

interface SideResult {
    rect: Rect;
    characters: CharRange | null;
    matched: CharRange | null;
}

function side(geometry: PageGeometry | undefined, input: SideInput, isStart: boolean): SideResult {
    const rect = withMinimumHeight(input.rect);
    const characters = geometry ? charactersInside(geometry, rect) : null;
    const matched = geometry && characters ? matchWords(geometry, input.words, isStart, characters) : null;
    return { rect, characters, matched };
}

export type GeometryLookup = (pdf: string, page: number) => PageGeometry | undefined;

export function resolveMark(mark: MarkInput, geometryOf: GeometryLookup): MarkOutput {
    const start = side(geometryOf(mark.pdf, mark.start.page), mark.start, true);
    const end = side(geometryOf(mark.pdf, mark.end.page), mark.end, false);
    const precision: Precision = start.matched && end.matched ? "words" : "lines";
    const startIndex = (start.matched ?? start.characters)?.first;
    const endIndex = (end.matched ?? end.characters)?.last;
    const inOrder = mark.start.page < mark.end.page || (startIndex ?? 0) <= (endIndex ?? -1);
    if (startIndex !== undefined && endIndex !== undefined && inOrder) {
        const covered = coveredPieces(mark, geometryOf, startIndex, endIndex);
        const segments = covered.flatMap((piece) => lineSegments(piece.geometry, piece.page, piece.first, piece.last));
        const text = covered.map((piece) => piece.geometry.text.slice(piece.first, piece.last + 1)).join("\n");
        if (segments.length > 0) return { id: mark.id, precision, segments, text };
    }
    const lines = [{ page: mark.start.page, rect: start.rect }, { page: mark.end.page, rect: end.rect }];
    return { id: mark.id, precision: "lines", segments: lines, text: "" };
}

interface Piece {
    geometry: PageGeometry;
    page: number;
    first: number;
    last: number;
}

/** Vom Startzeichen bis zum Endzeichen, auch über Seitengrenzen */
function coveredPieces(mark: MarkInput, geometryOf: GeometryLookup, startIndex: number, endIndex: number): Piece[] {
    const pieces: Piece[] = [];
    for (let page = mark.start.page; page <= mark.end.page; page += 1) {
        const geometry = geometryOf(mark.pdf, page);
        if (!geometry) continue;
        const first = page === mark.start.page ? startIndex : 0;
        const last = page === mark.end.page ? endIndex : geometry.text.length - 1;
        pieces.push({ geometry, page, first, last });
    }
    return pieces;
}

function overlapsVertically(line: Rect, box: Rect): boolean {
    return box.y < line.y + line.height && box.y + box.height > line.y;
}

function union(a: Rect, b: Rect): Rect {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const right = Math.max(a.x + a.width, b.x + b.width);
    const bottom = Math.max(a.y + a.height, b.y + b.height);
    return { x, y, width: right - x, height: bottom - y };
}

/** Zeichen in Lesereihenfolge zu Zeilen bündeln: eine neue Zeile beginnt, wenn ein Zeichen die Zeile nicht mehr senkrecht überlappt */
export function lineSegments(geometry: PageGeometry, page: number, first: number, last: number): Segment[] {
    const lines: Rect[] = [];
    for (let index = first; index <= last; index += 1) {
        const box = geometry.boxes[index];
        if (!box || box.width <= 0 || geometry.text.charAt(index).trim() === "") continue;
        const current = lines[lines.length - 1];
        if (current && overlapsVertically(current, box)) {
            lines[lines.length - 1] = union(current, box);
        } else {
            lines.push(box);
        }
    }
    return lines.map((rect) => ({ page, rect }));
}
