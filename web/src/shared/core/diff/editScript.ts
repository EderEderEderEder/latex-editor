/** Welche Elemente aus `old` entfernt und welche in `new` eingefügt werden */
export interface EditScript {
    readonly removed: boolean[];
    readonly inserted: boolean[];
}

interface MatchedPair {
    readonly oldIndex: number;
    readonly newIndex: number;
}

const FIRST_STEP = 0;

function commonPrefixLength(old: readonly string[], next: readonly string[]): number {
    const limit = Math.min(old.length, next.length);
    let length = 0;
    while (length < limit && old[length] === next[length]) length += 1;
    return length;
}

function commonSuffixLength(old: readonly string[], next: readonly string[], maxLength: number): number {
    let length = 0;
    while (length < maxLength && old[old.length - 1 - length] === next[next.length - 1 - length]) length += 1;
    return length;
}

/** Indizes aus `from` bis `to`, deren Element in `other` vorkommt */
function candidateIndices(items: readonly string[], from: number, to: number, other: ReadonlySet<string>): number[] {
    const indices: number[] = [];
    for (let index = from; index < to; index += 1) {
        if (other.has(items[index] as string)) indices.push(index);
    }
    return indices;
}

/** Elemente der Teilmenge `indices` aus `items` */
function pick(items: readonly string[], indices: readonly number[]): string[] {
    return indices.map((index) => items[index] as string);
}

/**
 * Kürzestes Bearbeitungsskript (Myers O(ND)). Gemeinsamer Anfang und Ende sowie Elemente ohne Gegenstück auf der
 * anderen Seite werden vorab abgetrennt; das verkleinert Myers in der Praxis drastisch. Braucht Myers mehr als
 * `maxEdits` Schritte, gilt der ganze mittlere Bereich als ersetzt (korrekt, aber nicht minimal).
 */
export function editScript(old: readonly string[], next: readonly string[], maxEdits: number): EditScript {
    const removed = new Array<boolean>(old.length).fill(false);
    const inserted = new Array<boolean>(next.length).fill(false);
    const prefix = commonPrefixLength(old, next);
    const suffix = commonSuffixLength(old, next, Math.min(old.length, next.length) - prefix);
    const oldEnd = old.length - suffix;
    const newEnd = next.length - suffix;
    const oldCandidates = candidateIndices(old, prefix, oldEnd, new Set(next.slice(prefix, newEnd)));
    const newCandidates = candidateIndices(next, prefix, newEnd, new Set(old.slice(prefix, oldEnd)));
    removed.fill(true, prefix, oldEnd);
    inserted.fill(true, prefix, newEnd);
    for (const pair of matchedPairs(pick(old, oldCandidates), pick(next, newCandidates), maxEdits)) {
        removed[oldCandidates[pair.oldIndex] as number] = false;
        inserted[newCandidates[pair.newIndex] as number] = false;
    }
    return { removed, inserted };
}

/** Paare gleicher Elemente einer längsten gemeinsamen Teilfolge; ohne Treffer in `maxEdits` Schritten keine Paare */
function matchedPairs(a: readonly string[], b: readonly string[], maxEdits: number): MatchedPair[] {
    if (a.length === 0 || b.length === 0) return [];
    const limit = Math.min(a.length + b.length, maxEdits);
    const trace = findTrace(a, b, limit);
    return trace === null ? [] : backtrack(trace, a.length, b.length);
}

/** Der Pfeil wandert nach unten (Einfügen), wenn die Nachbardiagonale weiter vorn liegt */
function goesDown(k: number, step: number, lower: number, upper: number): boolean {
    return k === -step || (k !== step && lower < upper);
}

/**
 * Vorwärtslauf. `trace[d]` ist der Stand vor Schritt d für die Diagonalen −(d+1)…d+1; `null`, wenn das Ende
 * nicht in `limit` Schritten erreicht wird.
 */
function findTrace(a: readonly string[], b: readonly string[], limit: number): Int32Array[] | null {
    const offset = limit + 1;
    const furthest = new Int32Array(2 * limit + 3);
    const trace: Int32Array[] = [];
    for (let step = FIRST_STEP; step <= limit; step += 1) {
        trace.push(furthest.slice(offset - step - 1, offset + step + 2));
        if (advanceDiagonals(a, b, furthest, offset, step)) return trace;
    }
    return null;
}

function advanceDiagonals(a: readonly string[], b: readonly string[], furthest: Int32Array, offset: number, step: number): boolean {
    for (let k = -step; k <= step; k += 2) {
        const below = furthest[offset + k - 1] as number;
        const above = furthest[offset + k + 1] as number;
        let x = goesDown(k, step, below, above) ? above : below + 1;
        let y = x - k;
        while (x < a.length && y < b.length && a[x] === b[y]) {
            x += 1;
            y += 1;
        }
        furthest[offset + k] = x;
        if (x >= a.length && y >= b.length) return true;
    }
    return false;
}

/** Geht den Pfad rückwärts und sammelt die Diagonalen (gleiche Elemente) */
function backtrack(trace: readonly Int32Array[], n: number, m: number): MatchedPair[] {
    const pairs: MatchedPair[] = [];
    let x = n;
    let y = m;
    for (let step = trace.length - 1; step >= 0; step -= 1) {
        const snapshot = trace[step] as Int32Array;
        const valueAt = (diagonal: number): number => snapshot[diagonal + step + 1] as number;
        const k = x - y;
        const previousK = goesDown(k, step, valueAt(k - 1), valueAt(k + 1)) ? k + 1 : k - 1;
        const previousX = valueAt(previousK);
        const previousY = previousX - previousK;
        while (x > previousX && y > previousY) {
            x -= 1;
            y -= 1;
            pairs.push({ oldIndex: x, newIndex: y });
        }
        x = previousX;
        y = previousY;
    }
    return pairs.reverse();
}
