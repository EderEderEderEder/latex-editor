/**
 * Einklappen: zuklappbare Bereiche in einem .tex-Text finden (`scanFoldRegions`) und festhalten, welche davon
 * zugeklappt sind (`FoldState`). Port von `FoldRegions.swift` und `FoldState.swift` ohne Layout-Anteil.
 * Alle Positionen sind UTF-16-Einheiten (wie `String.length`), Zeilen 0-basiert. Zeilentrenner ist nur `\n`;
 * ein `\r` davor bleibt Teil des Zeileninhalts. Reine Logik, ohne DOM und ohne Node-Importe.
 */
import { isInComment as isCommentAt } from './comments';
import { isCodeEnvironment } from './environments';

/** Kapitel/Abschnitt, Kommentarblock (mehrere Zeilen am Stück) oder `\begin…\end`-Umgebung */
export type FoldKind = 'section' | 'comments' | { readonly environment: string };

/**
 * Die Kopfzeile bleibt sichtbar, die Zeilen `startLine + 1 … endLine` werden ausgeblendet.
 * `endLine` liegt immer hinter `startLine`.
 */
export interface FoldRegion {
    readonly kind: FoldKind;
    readonly startLine: number;
    readonly endLine: number;
}

export interface TextRange {
    readonly location: number;
    readonly length: number;
}

/**
 * Wie sich die Zeilen durch eine Bearbeitung verändert haben: Zeile `firstLine` ist inhaltlich geändert,
 * danach wurden `removedLineCount` alte Zeilen durch `insertedLineCount` neue ersetzt.
 */
export interface LineSplice {
    readonly firstLine: number;
    readonly removedLineCount: number;
    readonly insertedLineCount: number;
}

const NEWLINE = '\n';
const NEWLINE_CODE = 0x0a;
const CARRIAGE_RETURN_CODE = 0x0d;
const SPACE_CODE = 0x20;
const TAB_CODE = 0x09;
const PERCENT_CODE = 0x25;

function maxRange(range: TextRange): number {
    return range.location + range.length;
}

function sameRange(first: TextRange, second: TextRange): boolean {
    return first.location === second.location && first.length === second.length;
}

function rangeKey(range: TextRange): string {
    return `${range.location}:${range.length}`;
}

function unionRange(first: TextRange, second: TextRange): TextRange {
    const start = Math.min(first.location, second.location);
    return { location: start, length: Math.max(maxRange(first), maxRange(second)) - start };
}

function lineStartsIn(text: string, from: number, to: number): number[] {
    const starts: number[] = [];
    for (let index = from; index < to; index++) {
        if (text.charCodeAt(index) === NEWLINE_CODE) starts.push(index + 1);
    }
    return starts;
}

/** Zeilenanfänge als UTF-16-Offsets; Zeile 0 beginnt bei 0, nach jedem `\n` beginnt eine neue Zeile */
export class LineIndex {
    private lineStarts: number[];
    private textLength: number;

    constructor(text: string) {
        this.textLength = text.length;
        this.lineStarts = [0, ...lineStartsIn(text, 0, text.length)];
    }

    get lineCount(): number {
        return this.lineStarts.length;
    }

    get length(): number {
        return this.textLength;
    }

    start(line: number): number {
        return this.lineStarts[line] ?? this.textLength;
    }

    /** Ende des Zeileninhalts, vor dem abschließenden `\n` */
    contentEnd(line: number): number {
        const next = this.lineStarts[line + 1];
        return next === undefined ? this.textLength : next - 1;
    }

    contentRange(line: number): TextRange {
        const start = this.start(line);
        return { location: start, length: this.contentEnd(line) - start };
    }

    /** Zeile, in der `offset` liegt; ein `\n` gehört zur Zeile, die es beendet */
    lineContaining(offset: number): number {
        return this.firstIndexWithStartAbove(offset) - 1;
    }

    /** `newText` ist der Text nach der Bearbeitung, `editedRange` bezieht sich auf ihn, `delta` ist die Längenänderung */
    applyEdit(newText: string, editedRange: TextRange, delta: number): LineSplice {
        const oldEnd = maxRange(editedRange) - delta;
        const removedLower = this.firstIndexWithStartAbove(editedRange.location);
        const removedUpper = this.firstIndexWithStartAbove(oldEnd);
        const inserted = lineStartsIn(newText, editedRange.location, maxRange(editedRange));
        const after = this.lineStarts.slice(removedUpper).map((start) => start + delta);
        this.lineStarts = [...this.lineStarts.slice(0, removedLower), ...inserted, ...after];
        this.textLength += delta;
        return { firstLine: removedLower - 1, removedLineCount: removedUpper - removedLower, insertedLineCount: inserted.length };
    }

    private firstIndexWithStartAbove(offset: number): number {
        let low = 0;
        let high = this.lineStarts.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if ((this.lineStarts[middle] ?? 0) <= offset) low = middle + 1;
            else high = middle;
        }
        return low;
    }
}

/**
 * Zeichen, die beim Zuklappen verschwinden: vom Ende der Kopfzeile bis zum Ende der letzten Zeile (ohne deren
 * Zeilenumbruch). So bleibt alles auf einer Zeile und der Zeilenumbruch hinter dem Bereich beendet sie.
 */
export function hiddenRange(region: FoldRegion, lines: LineIndex): TextRange {
    const lastLine = lines.lineCount - 1;
    const headerEnd = lines.contentEnd(Math.min(region.startLine, lastLine));
    const regionEnd = lines.contentEnd(Math.min(region.endLine, lastLine));
    return { location: headerEnd, length: Math.max(0, regionEnd - headerEnd) };
}

function regionsEqual(first: readonly FoldRegion[], second: readonly FoldRegion[]): boolean {
    if (first.length !== second.length) return false;
    return first.every((region, index) => {
        const other = second[index];
        return other !== undefined && sameRegion(region, other);
    });
}

function sameRegion(first: FoldRegion, second: FoldRegion): boolean {
    return first.startLine === second.startLine && first.endLine === second.endLine && sameKind(first.kind, second.kind);
}

function sameKind(first: FoldKind, second: FoldKind): boolean {
    if (typeof first === 'string' || typeof second === 'string') return first === second;
    return first.environment === second.environment;
}

// MARK: Scanner

/** Befehle `\begin{x}`/`\end{x}` oder Gliederungsbefehl am Zeilenanfang (Leerraum davor erlaubt) */
const SCAN_PATTERN =
    /\\(begin|end)\{([A-Za-z0-9*@]+)\}|^[ \t]*\\(part|chapter|section|subsection|subsubsection|appendix|frontmatter|mainmatter|backmatter)(?![A-Za-z])/gm;
const SECTION_LEVELS: ReadonlyMap<string, number> = new Map([
    ['part', 0], ['chapter', 1], ['section', 2], ['subsection', 3], ['subsubsection', 4],
]);
/** `\appendix`, `\backmatter` … öffnen keinen Abschnitt, beenden aber alle offenen */
const NO_LEVEL = -1;
const ALL_LEVELS = Number.NEGATIVE_INFINITY;
const COMMENT_BLOCK_MINIMUM_LINES = 2;
const DOCUMENT_ENVIRONMENT = 'document';

interface OpenSection {
    readonly level: number;
    readonly line: number;
}

interface OpenEnvironment {
    readonly name: string;
    readonly line: number;
}

interface LineSpan {
    readonly first: number;
    readonly last: number;
}

class Scan {
    readonly regions: FoldRegion[] = [];
    private readonly sections: OpenSection[] = [];
    private readonly environments: OpenEnvironment[] = [];
    /** Zeilen von Code-Umgebungen: dort gibt es weder Überschriften noch Kommentare */
    private readonly codeSpans: LineSpan[] = [];
    private skipUntil = 0;

    constructor(private readonly text: string, private readonly lines: LineIndex) {}

    consume(match: RegExpExecArray): void {
        if (match.index < this.skipUntil) return;
        if (match[1] !== undefined) this.consumeEnvironmentCommand(match, match[1], match[2] ?? '');
        else this.consumeHeading(match, match[3] ?? '');
    }

    private isInComment(location: number): boolean {
        const lineStart = this.lines.start(this.lines.lineContaining(location));
        return isCommentAt(this.text, lineStart, location);
    }

    private consumeEnvironmentCommand(match: RegExpExecArray, command: string, name: string): void {
        if (this.isInComment(match.index)) return;
        const line = this.lines.lineContaining(match.index);
        if (command === 'end') this.closeEnvironment(name, line);
        else if (isCodeEnvironment(name)) this.consumeCode(name, match.index + match[0].length, line);
        else this.environments.push({ name, line });
    }

    private consumeCode(name: string, bodyStart: number, line: number): void {
        const endCommand = `\\end{${name}}`;
        const end = this.text.indexOf(endCommand, bodyStart);
        if (end === -1) {
            this.skipUntil = this.text.length;
            return;
        }
        const endLine = this.lines.lineContaining(end);
        this.codeSpans.push({ first: line, last: endLine });
        if (endLine > line) this.regions.push({ kind: { environment: name }, startLine: line, endLine });
        this.skipUntil = end + endCommand.length;
    }

    private closeEnvironment(name: string, line: number): void {
        if (name === DOCUMENT_ENVIRONMENT) this.closeSections(line, ALL_LEVELS);
        const index = this.lastOpenEnvironmentIndex(name);
        if (index === -1) return;
        const start = this.environments[index]?.line ?? line;
        this.environments.length = index;
        if (line > start) this.regions.push({ kind: { environment: name }, startLine: start, endLine: line });
    }

    private lastOpenEnvironmentIndex(name: string): number {
        for (let index = this.environments.length - 1; index >= 0; index--) {
            if (this.environments[index]?.name === name) return index;
        }
        return -1;
    }

    private consumeHeading(match: RegExpExecArray, name: string): void {
        const nameLocation = match.index + match[0].length - name.length;
        if (this.isInComment(nameLocation - 1)) return;
        const level = SECTION_LEVELS.get(name) ?? NO_LEVEL;
        const line = this.lines.lineContaining(match.index);
        this.closeSections(line, level === NO_LEVEL ? ALL_LEVELS : level);
        if (level !== NO_LEVEL) this.sections.push({ level, line });
    }

    /** Schließt offene Abschnitte ab `level`; sie enden an der letzten nicht leeren Zeile vor `line` */
    closeSections(line: number, level: number): void {
        for (let open = this.sections.at(-1); open !== undefined && open.level >= level; open = this.sections.at(-1)) {
            this.sections.pop();
            const end = this.lastNonBlankLine(line, open.line);
            if (end > open.line) this.regions.push({ kind: 'section', startLine: open.line, endLine: end });
        }
    }

    private lastNonBlankLine(before: number, floor: number): number {
        let candidate = before - 1;
        while (candidate > floor && this.firstNonSpace(candidate) === undefined) candidate--;
        return candidate;
    }

    /** Zeichencode des ersten Zeichens der Zeile, das kein Leerraum ist */
    private firstNonSpace(line: number): number | undefined {
        const end = this.lines.contentEnd(line);
        for (let position = this.lines.start(line); position < end; position++) {
            const code = this.text.charCodeAt(position);
            if (code !== SPACE_CODE && code !== TAB_CODE && code !== CARRIAGE_RETURN_CODE) return code;
        }
        return undefined;
    }

    addCommentBlocks(): void {
        let blockStart: number | undefined;
        let spanIndex = 0;
        for (let line = 0; line < this.lines.lineCount; line++) {
            while (spanIndex < this.codeSpans.length && (this.codeSpans[spanIndex]?.last ?? 0) < line) spanIndex++;
            const span = this.codeSpans[spanIndex];
            const inCode = span !== undefined && span.first <= line && line <= span.last;
            if (!inCode && this.firstNonSpace(line) === PERCENT_CODE) {
                blockStart ??= line;
                continue;
            }
            this.closeCommentBlock(blockStart, line);
            blockStart = undefined;
        }
        this.closeCommentBlock(blockStart, this.lines.lineCount);
    }

    private closeCommentBlock(start: number | undefined, endingBefore: number): void {
        if (start === undefined || endingBefore - start < COMMENT_BLOCK_MINIMUM_LINES) return;
        this.regions.push({ kind: 'comments', startLine: start, endLine: endingBefore - 1 });
    }
}

/** Nach Startzeile sortiert, pro Kopfzeile nur der größte Bereich */
function normalized(regions: readonly FoldRegion[]): FoldRegion[] {
    const sorted = [...regions].sort((a, b) => (a.startLine !== b.startLine ? a.startLine - b.startLine : b.endLine - a.endLine));
    return sorted.filter((region, index) => sorted[index - 1]?.startLine !== region.startLine);
}

/**
 * Zuklappbare Bereiche: Gliederungsbefehle (bis zur nächsten Überschrift gleicher oder höherer Ebene, spätestens
 * vor `\end{document}`, `\appendix` …), `\begin … \end` (verschachtelt) und Kommentarblöcke ab zwei Zeilen.
 * Kommentierte Befehle und der Inhalt von Code-Umgebungen zählen nicht; die Code-Umgebung selbst lässt sich zuklappen.
 */
export function scanFoldRegions(text: string): FoldRegion[] {
    const lines = new LineIndex(text);
    const scan = new Scan(text, lines);
    for (const match of text.matchAll(SCAN_PATTERN)) scan.consume(match);
    scan.closeSections(lines.lineCount, ALL_LEVELS);
    scan.addCommentBlocks();
    return normalized(scan.regions);
}

// MARK: Zustand

export interface FoldSelectionInput {
    readonly selection: TextRange;
    /** Cursorposition vor der Bewegung (erkennt den Schritt nach rechts von der Kopfzeile) */
    readonly previousLocation: number;
    readonly textLength: number;
}

function isStrictlyInside(range: TextRange, location: number): boolean {
    return range.location < location && location < maxRange(range);
}

function compareFolded(first: TextRange, second: TextRange): number {
    return first.location !== second.location ? first.location - second.location : second.length - first.length;
}

/** Binärsuche in einer nach Anfang sortierten Liste: erster Eintrag, der bei `location` oder dahinter beginnt */
function firstIndexAtOrAfter(ranges: readonly TextRange[], location: number): number {
    let low = 0;
    let high = ranges.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if ((ranges[middle]?.location ?? 0) < location) low = middle + 1;
        else high = middle;
    }
    return low;
}

/** Ein Bereich ohne Platz zum Ausblenden (Länge 0) lässt sich nicht zuklappen */
function isFoldable(range: TextRange): boolean {
    return range.length > 0;
}

/**
 * Zuklappbare Bereiche einer Datei und welche davon zugeklappt sind. Der Text bleibt unverändert; zugeklappt sind
 * nur Bereiche des Layouts (`hiddenRanges`). Zwischen zwei Prüfläufen führt `applyEdit` Bereiche und zugeklappte
 * Stellen mit den Bearbeitungen nach; eine Bearbeitung, die zugeklappten Text berührt, klappt ihn auf. Das
 * Entprellen und Ausführen der Prüfung (`scanFoldRegions`, dann `adopt`) liegt beim Aufrufer; `generation` zeigt ihm,
 * ob seit dem Start der Prüfung bearbeitet wurde.
 */
export class FoldState {
    /** Das Layout muss diese Zeichen neu aufbauen (ausgeblendet oder wieder sichtbar) */
    onHiddenChange: ((range: TextRange) => void) | null = null;
    /** Die Liste der Bereiche hat sich geändert (Zeilennummernleiste neu zeichnen) */
    onRegionsChange: (() => void) | null = null;

    private currentRegions: readonly FoldRegion[] = [];
    private foldedRanges: TextRange[] = [];
    private hidden: TextRange[] = [];
    private editCount = 0;

    /** Zuletzt gefundene Bereiche, nach Startzeile sortiert */
    get regions(): readonly FoldRegion[] {
        return this.currentRegions;
    }

    /** Zugeklappte Bereiche als ausgeblendete Zeichen; verschachtelte liegen ineinander */
    get folded(): readonly TextRange[] {
        return this.foldedRanges;
    }

    /** Vereinigung von `folded`, sortiert und ohne Überlappung */
    get hiddenRanges(): readonly TextRange[] {
        return this.hidden;
    }

    get hasFolds(): boolean {
        return this.foldedRanges.length > 0;
    }

    /** Zählt die Bearbeitungen; eine Prüfung ist veraltet, wenn sich der Wert seit ihrem Start geändert hat */
    get generation(): number {
        return this.editCount;
    }

    detach(): void {
        this.onHiddenChange = null;
        this.onRegionsChange = null;
    }

    // MARK: Abfragen

    /** Binärsuche: `regions` ist nach Startzeile sortiert, jede Zeile kommt höchstens einmal vor */
    region(startingAtLine: number): FoldRegion | undefined {
        let low = 0;
        let high = this.currentRegions.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if ((this.currentRegions[middle]?.startLine ?? 0) < startingAtLine) low = middle + 1;
            else high = middle;
        }
        const found = this.currentRegions[low];
        return found?.startLine === startingAtLine ? found : undefined;
    }

    isFolded(region: FoldRegion, lines: LineIndex): boolean {
        const range = hiddenRange(region, lines);
        return this.foldedRanges.some((folded) => sameRange(folded, range));
    }

    /** Innerster nicht zugeklappter Bereich, der die Zeile enthält (Kopfzeile eingeschlossen) */
    innermostOpenRegion(containingLine: number, lines: LineIndex): FoldRegion | undefined {
        for (let index = this.currentRegions.length - 1; index >= 0; index--) {
            const region = this.currentRegions[index];
            if (region === undefined || region.startLine > containingLine) continue;
            if (containingLine <= region.endLine && !this.isFolded(region, lines)) return region;
        }
        return undefined;
    }

    /** Binärsuche: Index des ersten ausgeblendeten Bereichs, der hinter `location` endet */
    firstHiddenRangeIndex(endingAfter: number): number {
        let low = 0;
        let high = this.hidden.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            const range = this.hidden[middle];
            if (range !== undefined && maxRange(range) <= endingAfter) low = middle + 1;
            else high = middle;
        }
        return low;
    }

    // MARK: Zu- und Aufklappen

    toggle(region: FoldRegion, lines: LineIndex): void {
        if (this.isFolded(region, lines)) this.unfold(region, lines);
        else this.fold(region, lines);
    }

    fold(region: FoldRegion, lines: LineIndex): void {
        const range = hiddenRange(region, lines);
        if (!isFoldable(range) || this.foldedRanges.some((folded) => sameRange(folded, range))) return;
        this.foldedRanges.push(range);
        this.foldedRanges.sort(compareFolded);
        this.updateHiddenRanges();
        this.onHiddenChange?.(range);
    }

    unfold(region: FoldRegion, lines: LineIndex): void {
        const range = hiddenRange(region, lines);
        this.remove((folded) => sameRange(folded, range));
    }

    /** Alle Bereiche, die in der Zeile beginnen (Cursor auf der zugeklappten Kopfzeile) */
    unfoldHeaderLine(line: number, lines: LineIndex): void {
        this.remove((folded) => lines.lineContaining(folded.location) === line);
    }

    /** Das Platzhalter-Feld hinter einer zugeklappten Kopfzeile: der äußerste Bereich, der dort beginnt */
    unfoldStartingAt(location: number): void {
        this.remove((folded) => folded.location === location);
    }

    /** Alles zuklappen, außer der Umgebung `document` (sonst bliebe von der Datei nur eine Zeile) */
    foldAll(lines: LineIndex): void {
        const known = new Set(this.foldedRanges.map(rangeKey));
        let changed = false;
        for (const region of this.currentRegions) {
            const range = hiddenRange(region, lines);
            if (isDocumentRegion(region) || !isFoldable(range) || known.has(rangeKey(range))) continue;
            known.add(rangeKey(range));
            this.foldedRanges.push(range);
            changed = true;
        }
        if (!changed) return;
        this.foldedRanges.sort(compareFolded);
        this.updateHiddenRanges();
        this.onHiddenChange?.({ location: 0, length: lines.length });
    }

    unfoldAll(): void {
        this.remove(() => true);
    }

    private remove(shouldRemove: (range: TextRange) => boolean): void {
        const removed = this.foldedRanges.filter(shouldRemove);
        const first = removed[0];
        if (first === undefined) return;
        const lastEnd = Math.max(...removed.map(maxRange));
        this.foldedRanges = this.foldedRanges.filter((range) => !shouldRemove(range));
        this.updateHiddenRanges();
        this.onHiddenChange?.({ location: first.location, length: lastEnd - first.location });
    }

    private updateHiddenRanges(): void {
        const merged: TextRange[] = [];
        for (const range of this.foldedRanges) {
            const last = merged.at(-1);
            if (last !== undefined && range.location <= maxRange(last)) merged[merged.length - 1] = unionRange(last, range);
            else merged.push(range);
        }
        this.hidden = merged;
    }

    // MARK: Cursor

    /**
     * Der Cursor soll nie in ausgeblendetem Text stehen. Hinter dem Ausgeblendeten (Ende der Zeile) rückt er an das
     * Ende der Kopfzeile; ein Schritt nach rechts vom Ende der Kopfzeile springt hinter den Bereich. Alles, was
     * mitten hinein führt (Suche, Gehe zu Zeile, Fehlerliste), klappt auf. Bei einer Auswahl klappt nur auf, wessen
     * Rand mitten im Ausgeblendeten liegt. `null`: Auswahl bleibt, wie sie ist (gegebenenfalls nach dem Aufklappen).
     */
    adjustedSelection(input: FoldSelectionInput): TextRange | null {
        if (!this.hasFolds) return null;
        const { selection, previousLocation, textLength } = input;
        if (selection.length > 0) {
            this.remove((range) => isStrictlyInside(range, selection.location) || isStrictlyInside(range, maxRange(selection)));
            return null;
        }
        const location = selection.location;
        const hidden = this.hidden.find((range) => range.location < location && location <= maxRange(range));
        if (hidden !== undefined) {
            if (location === maxRange(hidden)) return { location: hidden.location, length: 0 };
            if (location === hidden.location + 1 && previousLocation === hidden.location) {
                return { location: Math.min(maxRange(hidden) + 1, textLength), length: 0 };
            }
        }
        this.remove((range) => isStrictlyInside(range, location));
        return null;
    }

    // MARK: Bearbeitungen

    /**
     * Führt Bereiche und zugeklappte Stellen nach einer Textänderung nach. `editedRange` bezieht sich auf den neuen
     * Text, `splice` kommt aus `LineIndex.applyEdit`, `lines` ist der Zeilenindex nach der Bearbeitung. Pro Tastendruck
     * bleibt das billig: Die Bereiche ändern sich nur, wenn sich die Zahl der Zeilen ändert.
     */
    applyEdit(editedRange: TextRange, delta: number, splice: LineSplice, lines: LineIndex): void {
        this.editCount++;
        if (splice.insertedLineCount !== splice.removedLineCount) {
            this.shiftRegions(splice, editedRange, delta, lines);
            this.onRegionsChange?.();
        }
        this.shiftFolded(editedRange, delta, lines.length);
    }

    private shiftRegions(splice: LineSplice, editedRange: TextRange, delta: number, lines: LineIndex): void {
        // Steht das Eingefügte (mit Zeilenumbruch) am Anfang einer Zeile, rückt auch deren alter Inhalt nach unten
        const insertsAboveFirstLine = delta === editedRange.length && delta > 0
            && splice.insertedLineCount > splice.removedLineCount
            && editedRange.location === lines.start(splice.firstLine);
        const effective = insertsAboveFirstLine ? { ...splice, firstLine: splice.firstLine - 1 } : splice;
        this.currentRegions = this.currentRegions.flatMap((region) => shiftedRegion(region, effective));
    }

    /**
     * Eine Einfügung am Anfang des Ausgeblendeten (Ende der Kopfzeile) schiebt es nach hinten, eine Änderung am Ende
     * lässt es stehen; alles dazwischen klappt auf.
     */
    private shiftFolded(editedRange: TextRange, delta: number, textLength: number): void {
        if (!this.hasFolds) return;
        const oldEnd = maxRange(editedRange) - delta;
        const index = this.firstHiddenRangeIndex(editedRange.location);
        const first = this.hidden[index];
        if (first !== undefined && first.location < oldEnd) {
            this.dropTouched(editedRange, delta, textLength);
            return;
        }
        if (delta === 0) return;
        this.foldedRanges = shiftedFrom(this.foldedRanges, oldEnd, delta);
        this.hidden = shiftedFrom(this.hidden, oldEnd, delta);
    }

    private dropTouched(editedRange: TextRange, delta: number, textLength: number): void {
        const oldStart = editedRange.location;
        const oldEnd = maxRange(editedRange) - delta;
        const touched = this.foldedRanges.filter((range) => oldEnd > range.location && oldStart < maxRange(range));
        this.foldedRanges = this.foldedRanges
            .filter((range) => !touched.includes(range))
            .map((range) => (range.location >= oldEnd ? { location: range.location + delta, length: range.length } : range));
        this.updateHiddenRanges();
        const dropped = touched.reduce((all, range) => unionRange(all, range));
        const start = Math.min(Math.max(Math.min(dropped.location, editedRange.location), 0), textLength);
        const end = Math.min(Math.max(maxRange(dropped) + delta, maxRange(editedRange)), textLength);
        this.onHiddenChange?.({ location: start, length: Math.max(0, end - start) });
    }

    // MARK: Prüfen

    /** Übernimmt das Ergebnis einer Prüfung; zugeklappte Stellen, zu denen es keinen Bereich mehr gibt, klappen auf */
    adopt(newRegions: readonly FoldRegion[], lines: LineIndex): void {
        const valid = new Set(newRegions.map((region) => rangeKey(hiddenRange(region, lines))));
        this.remove((range) => !valid.has(rangeKey(range)));
        if (regionsEqual(newRegions, this.currentRegions)) return;
        this.currentRegions = newRegions;
        this.onRegionsChange?.();
    }
}

function isDocumentRegion(region: FoldRegion): boolean {
    return typeof region.kind === 'object' && region.kind.environment === DOCUMENT_ENVIRONMENT;
}

/** Alle Einträge ab `location` (sortiert nach Anfang) um `delta` verschoben */
function shiftedFrom(ranges: TextRange[], location: number, delta: number): TextRange[] {
    const first = firstIndexAtOrAfter(ranges, location);
    return ranges.map((range, index) => (index < first ? range : { location: range.location + delta, length: range.length }));
}

function shiftedRegion(region: FoldRegion, splice: LineSplice): FoldRegion[] {
    const startLine = shiftedLine(region.startLine, splice);
    const endLine = shiftedLine(region.endLine, splice);
    return endLine > startLine ? [{ kind: region.kind, startLine, endLine }] : [];
}

function shiftedLine(line: number, splice: LineSplice): number {
    if (line <= splice.firstLine) return line;
    if (line > splice.firstLine + splice.removedLineCount) return line + splice.insertedLineCount - splice.removedLineCount;
    return Math.min(line, splice.firstLine + splice.insertedLineCount);
}
