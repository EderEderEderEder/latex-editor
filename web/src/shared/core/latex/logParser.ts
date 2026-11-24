/**
 * Auswertung des LaTeX-Logs (mit `-file-line-error` und `max_print_line=10000` erzeugt) und des Biber-Logs.
 * Port von `LatexLogParser` und `BiberLogParser` (Swift): Fehler, Warnungen und Box-Warnungen; die Datei zu
 * Meldungen ohne Pfad ergibt sich aus dem Dateistapel der `(./datei.tex … )`-Klammern.
 *
 * Arbeitet auf Bytes: Zeilen sind Bereiche im `Uint8Array`, nur Meldungstexte werden zu Strings. Logs haben
 * schnell 100.000 Zeilen und mehrere MB. Text kann UTF-8 oder Latin-1 (oder gemischt) sein.
 */
import type { BuildIssue } from '../../contract';

export interface LogIssue extends BuildIssue {
    /** Laufende Nummer ab 0 (Biber-Meldungen ab `firstId`) */
    readonly id: number;
    /** Kontext aus dem Log, z. B. `l.3 Ein \undefiniert`; sonst null */
    readonly detail: string | null;
}

const NEWLINE = 10;
const CARRIAGE_RETURN = 13;
const SPACE = 32;
const OPEN_PARENTHESIS = 40;
const CLOSE_PARENTHESIS = 41;
const DOT = 46;
const SLASH = 47;
const COLON = 58;
const ASCII_LIMIT = 0x80;
const FILE_EXTENSION_MAX_LENGTH = 8;
const ERROR_CONTEXT_LOOKAHEAD = 12;
const NO_FILE = -1;
// Erste Bytes von `LaTeX …`, `pdfTeX …`, `Package …`, `Class …` bzw. `Overfull`, `Underfull`
const WARNING_FIRST_BYTES: ReadonlySet<number> = new Set([...'LpPC'].map((letter) => letter.charCodeAt(0)));
const BOX_FIRST_BYTES: ReadonlySet<number> = new Set([...'OU'].map((letter) => letter.charCodeAt(0)));
const ASCII_FAST_PATH_MAX_LENGTH = 256;
const UTF8_CONTINUATION_COUNT = 3;
const INPUT_LINE_MARKER = ' on input line ';
const BIBER_PREFIX = 'Biber: ';

function ascii(text: string): Uint8Array {
    return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

const ERROR_PREFIX = ascii('! ');
const CONTEXT_PREFIX = ascii('l.');
const OVERFULL_PREFIX = ascii('Overfull \\');
const UNDERFULL_PREFIX = ascii('Underfull \\');
const LATEX_WARNING = ascii('LaTeX Warning: ');
const FONT_WARNING = ascii('LaTeX Font Warning: ');
const PDFTEX_WARNING = ascii('pdfTeX warning');
const WARNING_MARKER = ascii(' Warning: ');
const WARNING_OWNERS = [ascii('Package '), ascii('Class ')];
const LINES_MARKER = ascii(' at lines ');
const DETECTED_MARKER = ascii(' detected at line ');
const FOLLOW_UP_ERRORS = ['Emergency stop.', '==> Fatal error occurred'];
const BIBER_MARKERS: readonly { readonly marker: Uint8Array; readonly severity: 'error' | 'warning' }[] = [
    { marker: ascii('> ERROR - '), severity: 'error' },
    { marker: ascii('> WARN - '), severity: 'warning' },
];

// ---------- Byte-Hilfen ----------

function isDigit(byte: number): boolean {
    return byte >= 0x30 && byte <= 0x39;
}

function isLetter(byte: number): boolean {
    return (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x41 && byte <= 0x5a);
}

function hasPatternAt(bytes: Uint8Array, pattern: Uint8Array, at: number, end: number): boolean {
    if (at < 0 || at + pattern.length > end) return false;
    for (let offset = 0; offset < pattern.length; offset += 1) {
        if (bytes[at + offset] !== pattern[offset]) return false;
    }
    return true;
}

/** Erstes Vorkommen im Bereich `[from, end)` oder -1 */
function indexOfPattern(bytes: Uint8Array, pattern: Uint8Array, from: number, end: number): number {
    const first = pattern[0];
    for (let position = from; position + pattern.length <= end; position += 1) {
        if (bytes[position] === first && hasPatternAt(bytes, pattern, position, end)) return position;
    }
    return -1;
}

// `Buffer.prototype.indexOf` ist ein langsamer JS-Umweg; der native Typed-Array-Aufruf ist je Zeile um ein Vielfaches schneller.
const nativeIndexOf = Uint8Array.prototype.indexOf;

function indexOfByte(bytes: Uint8Array, byte: number, from: number): number {
    return nativeIndexOf.call(bytes, byte, from);
}

function digitRunEnd(bytes: Uint8Array, from: number, end: number): number {
    let position = from;
    while (position < end && isDigit(bytes[position] as number)) position += 1;
    return position;
}

/** Zahl aus lauter Ziffern im Bereich; null bei leerem Bereich */
function parseDigits(bytes: Uint8Array, from: number, to: number): number | null {
    if (to <= from) return null;
    let value = 0;
    for (let position = from; position < to; position += 1) value = value * 10 + ((bytes[position] as number) - 0x30);
    return value;
}

// ---------- Text (UTF-8, Rückfall Latin-1) ----------

const strictDecoder = new TextDecoder('utf-8', { fatal: true });
const lenientDecoder = new TextDecoder('utf-8');

function sequenceLength(lead: number): number {
    if (lead >= 0xf0 && lead <= 0xf4) return UTF8_CONTINUATION_COUNT + 1;
    if (lead >= 0xe0) return UTF8_CONTINUATION_COUNT;
    return lead >= 0xc2 ? UTF8_CONTINUATION_COUNT - 1 : 1;
}

function decodeSequenceAt(bytes: Uint8Array, start: number, end: number): { text: string; length: number } | null {
    const length = sequenceLength(bytes[start] as number);
    if (length === 1 || start + length > end) return null;
    try {
        return { text: strictDecoder.decode(bytes.subarray(start, start + length)), length };
    } catch {
        return null;
    }
}

/** Gemischte Bytes: gültige UTF-8-Folgen bleiben, jedes andere Byte >= 0x80 gilt als Latin-1 */
function decodeMixed(bytes: Uint8Array, start: number, end: number): string {
    let text = '';
    let position = start;
    while (position < end) {
        const byte = bytes[position] as number;
        const sequence = byte < ASCII_LIMIT ? null : decodeSequenceAt(bytes, position, end);
        text += sequence === null ? String.fromCharCode(byte) : sequence.text;
        position += sequence === null ? 1 : sequence.length;
    }
    return text;
}

/** Kurze reine ASCII-Bereiche (die Regel): ohne `TextDecoder`, dessen Aufruf je Meldung teuer ist */
function decodeShortAscii(bytes: Uint8Array, start: number, end: number): string | null {
    if (end - start > ASCII_FAST_PATH_MAX_LENGTH) return null;
    for (let position = start; position < end; position += 1) {
        if ((bytes[position] as number) >= ASCII_LIMIT) return null;
    }
    return String.fromCharCode.apply(null, bytes.subarray(start, end) as unknown as number[]);
}

export function decodeLogText(bytes: Uint8Array, start: number, end: number): string {
    if (end <= start) return '';
    const ascii = decodeShortAscii(bytes, start, end);
    if (ascii !== null) return ascii;
    const slice = bytes.subarray(start, end);
    try {
        return strictDecoder.decode(slice);
    } catch {
        return decodeMixed(bytes, start, end);
    }
}

// ---------- Pfade ----------

const WINDOWS_DRIVE = /^[A-Za-z]:/;

function rootOf(path: string): string {
    if (WINDOWS_DRIVE.test(path)) return path.slice(0, 2);
    return path.startsWith('//') ? '//' : path.startsWith('/') ? '/' : '';
}

function isAbsolutePath(path: string): boolean {
    return path.startsWith('/') || path.startsWith('\\') || WINDOWS_DRIVE.test(path);
}

function resolveSegments(rest: string): string[] {
    const segments: string[] = [];
    for (const segment of rest.split('/')) {
        if (segment === '' || segment === '.') continue;
        if (segment === '..') segments.pop();
        else segments.push(segment);
    }
    return segments;
}

/** Absoluter, lexikalisch bereinigter Pfad (`.`/`..`); Windows-Laufwerke mit `\`, sonst `/` */
export function resolveLogPath(path: string, baseDirectory: string): string {
    const joined = (isAbsolutePath(path) ? path : `${baseDirectory}/${path}`).replace(/\\/g, '/');
    const root = rootOf(joined);
    const segments = resolveSegments(joined.slice(root.length));
    if (WINDOWS_DRIVE.test(root)) return `${root}\\${segments.join('\\')}`;
    return root + segments.join('/');
}

// ---------- Erkennungsregeln je Zeile (Bereich `[start, end)`) ----------

interface FileLineError {
    readonly pathEnd: number;
    readonly line: number;
    readonly messageStart: number;
}

interface WarningStart {
    readonly messageStart: number;
    /** Fortsetzungszeilen beginnen mit diesem Präfix, z. B. `(hyperref)` */
    readonly continuation: Uint8Array;
}

/** `lower..upper` endet auf `.` plus 1 bis 8 Buchstaben oder Ziffern */
function hasFileExtension(bytes: Uint8Array, lower: number, upper: number): boolean {
    let extensionLength = 0;
    for (let position = upper - 1; position > lower; position -= 1) {
        const byte = bytes[position] as number;
        if (byte === DOT) return extensionLength > 0 && extensionLength <= FILE_EXTENSION_MAX_LENGTH;
        if (!isLetter(byte) && !isDigit(byte)) return false;
        extensionLength += 1;
    }
    return false;
}

function nextColonInLine(bytes: Uint8Array, from: number, end: number): number {
    let position = from;
    while (position < end && bytes[position] !== COLON) position += 1;
    return position;
}

/** `./chapters/kapitel.tex:3: Undefined control sequence.`; `firstColon`: erster Doppelpunkt ab `start` (evtl. hinter der Zeile) */
function findFileLineError(bytes: Uint8Array, start: number, end: number, firstColon: number): FileLineError | null {
    if (start >= end || firstColon >= end) return null;
    const first = bytes[start] as number;
    if (first !== DOT && first !== SLASH && !isLetter(first)) return null;
    for (let colon = firstColon; colon < end; colon = nextColonInLine(bytes, colon + 1, end)) {
        const digitsEnd = digitRunEnd(bytes, colon + 1, end);
        const isSeparated = digitsEnd + 1 < end && bytes[digitsEnd] === COLON && bytes[digitsEnd + 1] === SPACE;
        if (digitsEnd === colon + 1 || !isSeparated || !hasFileExtension(bytes, start, colon)) continue;
        const line = parseDigits(bytes, colon + 1, digitsEnd);
        if (line !== null) return { pathEnd: colon, line, messageStart: digitsEnd + 2 };
    }
    return null;
}

function findOwnerWarning(bytes: Uint8Array, start: number, end: number): WarningStart | null {
    for (const owner of WARNING_OWNERS) {
        if (!hasPatternAt(bytes, owner, start, end)) continue;
        const nameStart = start + owner.length;
        const marker = indexOfPattern(bytes, WARNING_MARKER, nameStart, end);
        if (marker <= nameStart) continue;
        const name = bytes.subarray(nameStart, marker);
        if (name.includes(SPACE)) continue;
        const continuation = Uint8Array.of(OPEN_PARENTHESIS, ...name, CLOSE_PARENTHESIS);
        return { messageStart: marker + WARNING_MARKER.length, continuation };
    }
    return null;
}

function findWarningStart(bytes: Uint8Array, start: number, end: number): WarningStart | null {
    if (hasPatternAt(bytes, LATEX_WARNING, start, end)) {
        return { messageStart: start + LATEX_WARNING.length, continuation: ascii('(LaTeX)') };
    }
    if (hasPatternAt(bytes, FONT_WARNING, start, end)) {
        return { messageStart: start + FONT_WARNING.length, continuation: ascii('(Font)') };
    }
    if (hasPatternAt(bytes, PDFTEX_WARNING, start, end)) return { messageStart: start, continuation: ascii('(pdfTeX)') };
    return findOwnerWarning(bytes, start, end);
}

/** `… in paragraph at lines 10--11` → 10, `… detected at line 12` → 12 */
function findBadBoxLine(bytes: Uint8Array, start: number, end: number): number | null {
    for (const marker of [LINES_MARKER, DETECTED_MARKER]) {
        const found = indexOfPattern(bytes, marker, start, end);
        if (found < 0) continue;
        const digitsStart = found + marker.length;
        return parseDigits(bytes, digitsStart, digitRunEnd(bytes, digitsStart, end));
    }
    return null;
}

/** `l.3 Ein \undefiniert` → 3 */
function findContextLineNumber(bytes: Uint8Array, start: number, end: number): number | null {
    if (!hasPatternAt(bytes, CONTEXT_PREFIX, start, end)) return null;
    const digitsStart = start + CONTEXT_PREFIX.length;
    return parseDigits(bytes, digitsStart, digitRunEnd(bytes, digitsStart, end));
}

/** Ende eines Tokens nach `(`: bis Leerzeichen oder Klammer */
function tokenEnd(bytes: Uint8Array, from: number, end: number): number {
    let position = from;
    while (position < end) {
        const byte = bytes[position] as number;
        if (byte === SPACE || byte === OPEN_PARENTHESIS || byte === CLOSE_PARENTHESIS) break;
        position += 1;
    }
    return position;
}

/** `./main.tex`, `/usr/…/article.cls`: kein `(Font)`, `(hyperref)` oder Satztext */
function looksLikeFile(bytes: Uint8Array, from: number, to: number): boolean {
    for (let position = from; position < to; position += 1) {
        if (bytes[position] === SLASH) return hasFileExtension(bytes, from, to);
    }
    return false;
}

/** Trennt „… on input line 7.“ ab und liefert die Zeile */
function splitInputLine(message: string): { text: string; line: number | null } {
    const marker = message.lastIndexOf(INPUT_LINE_MARKER);
    if (marker < 0) return { text: message, line: null };
    const digits = /^\d+/.exec(message.slice(marker + INPUT_LINE_MARKER.length));
    if (digits === null) return { text: message, line: null };
    return { text: message.slice(0, marker), line: Number(digits[0]) };
}

// ---------- Parser ----------

interface ErrorContext {
    readonly line: number;
    readonly text: string;
}

/** Erste Stelle eines Bytes ab einer Position (Puffer-Länge, wenn keine); sucht nur weiter, wenn die letzte überholt ist */
class NextByteFinder {
    private known = -1;

    constructor(
        private readonly bytes: Uint8Array,
        private readonly byte: number,
    ) {}

    from(position: number): number {
        if (this.known >= position) return this.known;
        const found = indexOfByte(this.bytes, this.byte, position);
        this.known = found < 0 ? this.bytes.length : found;
        return this.known;
    }
}

class LatexLogScanner {
    private readonly starts: number[] = [];
    private readonly ends: number[] = [];
    // Dateistapel als Byte-Bereiche; Klammern ohne Datei haben `NO_FILE` (Text erst bei einer Meldung)
    private readonly stackStarts: number[] = [];
    private readonly stackEnds: number[] = [];
    private readonly stackNames: (string | undefined)[] = [];
    private readonly resolvedPaths = new Map<string, string>();
    private readonly issues: LogIssue[] = [];
    private index = 0;
    // Nächste Stellen von `:`, `(`, `)` im ganzen Puffer: Zeilen ohne diese Zeichen kosten nur einen Vergleich
    private readonly nextColon: NextByteFinder;
    private readonly nextOpen: NextByteFinder;
    private readonly nextClose: NextByteFinder;

    constructor(
        private readonly bytes: Uint8Array,
        private readonly baseDirectory: string,
    ) {
        this.nextColon = new NextByteFinder(bytes, COLON);
        this.nextOpen = new NextByteFinder(bytes, OPEN_PARENTHESIS);
        this.nextClose = new NextByteFinder(bytes, CLOSE_PARENTHESIS);
        this.splitLines();
    }

    run(): LogIssue[] {
        while (this.index < this.starts.length) this.scanLine();
        return this.withoutFollowUpErrors();
    }

    /** Zeilen ohne `\n` und ohne ein `\r` davor; die letzte Zeile ohne Umbruch zählt mit */
    private splitLines(): void {
        const { bytes } = this;
        let start = 0;
        while (start <= bytes.length) {
            const newline = indexOfByte(bytes, NEWLINE, start);
            const lineEnd = newline < 0 ? bytes.length : newline;
            const hasCarriageReturn = lineEnd > start && bytes[lineEnd - 1] === CARRIAGE_RETURN;
            this.starts.push(start);
            this.ends.push(hasCarriageReturn ? lineEnd - 1 : lineEnd);
            if (newline < 0) return;
            start = newline + 1;
        }
    }

    private scanLine(): void {
        const { bytes } = this;
        const start = this.starts[this.index] as number;
        const end = this.ends[this.index] as number;
        const fileError = findFileLineError(bytes, start, end, this.nextColon.from(start));
        if (fileError !== null) return this.addError(decodeLogText(bytes, fileError.messageStart, end), fileError, start);
        if (hasPatternAt(bytes, ERROR_PREFIX, start, end)) {
            return this.addError(decodeLogText(bytes, start + ERROR_PREFIX.length, end), null, start);
        }
        const first = start < end ? (bytes[start] as number) : 0;
        const warning = WARNING_FIRST_BYTES.has(first) ? findWarningStart(bytes, start, end) : null;
        if (warning !== null) return this.addWarning(warning, end);
        if (BOX_FIRST_BYTES.has(first) && this.isBadBoxLine(start, end)) return this.addBadBox(start, end);
        this.trackFiles(start, end);
        this.index += 1;
    }

    private isBadBoxLine(start: number, end: number): boolean {
        return hasPatternAt(this.bytes, OVERFULL_PREFIX, start, end) || hasPatternAt(this.bytes, UNDERFULL_PREFIX, start, end);
    }

    // Fehler

    private addError(message: string, fileError: FileLineError | null, start: number): void {
        const context = this.consumeErrorContext();
        const path = fileError === null ? this.currentFile() : decodeLogText(this.bytes, start, fileError.pathEnd);
        this.append('error', message, path, fileError?.line ?? context?.line ?? null, context?.text ?? null);
    }

    /**
     * Überspringt den Fehlerblock bis einschließlich der `l.<n>`-Zeile und der Folgezeile (Rest der Quellzeile).
     * Dort steht Nutzertext, dessen Klammern den Dateistapel nicht verfälschen dürfen.
     */
    private consumeErrorContext(): ErrorContext | null {
        this.index += 1;
        const last = Math.min(this.index + ERROR_CONTEXT_LOOKAHEAD, this.starts.length);
        for (let candidate = this.index; candidate < last; candidate += 1) {
            const start = this.starts[candidate] as number;
            const end = this.ends[candidate] as number;
            const line = findContextLineNumber(this.bytes, start, end);
            if (line === null) continue;
            this.index = Math.min(candidate + 2, this.starts.length);
            return { line, text: decodeLogText(this.bytes, start, end).trim() };
        }
        return null;
    }

    // Warnungen und Boxen

    private addWarning(warning: WarningStart, firstEnd: number): void {
        const { bytes } = this;
        let message = decodeLogText(bytes, warning.messageStart, firstEnd);
        this.index += 1;
        while (this.index < this.starts.length) {
            const start = this.starts[this.index] as number;
            const end = this.ends[this.index] as number;
            if (!hasPatternAt(bytes, warning.continuation, start, end)) break;
            message += ` ${decodeLogText(bytes, start + warning.continuation.length, end).trim()}`;
            this.index += 1;
        }
        const { text, line } = splitInputLine(message);
        this.append('warning', text, this.currentFile(), line, null);
    }

    private addBadBox(start: number, end: number): void {
        const message = decodeLogText(this.bytes, start, end);
        this.append('badBox', message, this.currentFile(), findBadBoxLine(this.bytes, start, end), null);
        this.index += 1;
        // Box-Inhalt bis zur Leerzeile enthält Satztext und wird nicht auf Klammern untersucht.
        while (this.index < this.starts.length && this.ends[this.index] !== this.starts[this.index]) this.index += 1;
    }

    // Dateistapel

    private trackFiles(start: number, end: number): void {
        let position = start;
        while (position < end) {
            const open = this.nextOpen.from(position);
            const close = this.nextClose.from(position);
            if (Math.min(open, close) >= end) return;
            if (close < open) {
                this.popToken();
                position = close + 1;
            } else {
                const tokenStop = tokenEnd(this.bytes, open + 1, end);
                this.pushToken(open + 1, tokenStop);
                position = Math.max(tokenStop, open + 1);
            }
        }
    }

    private popToken(): void {
        this.stackStarts.pop();
        this.stackEnds.pop();
        this.stackNames.pop();
    }

    private pushToken(from: number, to: number): void {
        const isFile = looksLikeFile(this.bytes, from, to);
        this.stackStarts.push(isFile ? from : NO_FILE);
        this.stackEnds.push(isFile ? to : NO_FILE);
        this.stackNames.push(undefined);
    }

    private currentFile(): string | null {
        for (let depth = this.stackStarts.length - 1; depth >= 0; depth -= 1) {
            const start = this.stackStarts[depth] as number;
            if (start === NO_FILE) continue;
            const name = this.stackNames[depth] ?? decodeLogText(this.bytes, start, this.stackEnds[depth] as number);
            this.stackNames[depth] = name;
            return name;
        }
        return null;
    }

    // Ergebnis

    private append(severity: LogIssue['severity'], message: string, path: string | null, line: number | null, detail: string | null): void {
        this.issues.push({
            id: this.issues.length,
            severity,
            message: message.trim(),
            file: path === null ? null : this.resolve(path),
            line,
            detail,
        });
    }

    private resolve(path: string): string {
        const known = this.resolvedPaths.get(path);
        if (known !== undefined) return known;
        const resolved = resolveLogPath(path, this.baseDirectory);
        this.resolvedPaths.set(path, resolved);
        return resolved;
    }

    /** Folgefehler („Emergency stop“, „Fatal error occurred“) nur behalten, wenn es keine eigentliche Ursache gibt */
    private withoutFollowUpErrors(): LogIssue[] {
        const isFollowUp = (issue: LogIssue): boolean =>
            issue.severity === 'error' && FOLLOW_UP_ERRORS.some((prefix) => issue.message.startsWith(prefix));
        const hasRealError = this.issues.some((issue) => issue.severity === 'error' && !isFollowUp(issue));
        // Die Nummern bleiben wie vergeben (wie in Swift), auch wenn Folgefehler wegfallen.
        return hasRealError ? this.issues.filter((issue) => !isFollowUp(issue)) : this.issues;
    }
}

function toBytes(input: string | Uint8Array): Uint8Array {
    return typeof input === 'string' ? new TextEncoder().encode(input) : input;
}

/** Meldungen aus einem LaTeX-Log; `baseDirectory` löst relative Pfade im Log auf (Ordner der Hauptdatei) */
export function parseLog(input: string | Uint8Array, baseDirectory: string): LogIssue[] {
    return new LatexLogScanner(toBytes(input), baseDirectory).run();
}

/** Wie `parseLog`, liest die Zeilen aber direkt aus dem Puffer (z. B. `Buffer` aus `readFile`) ohne Gesamt-String */
export function parseLogBytes(buffer: Uint8Array, baseDirectory: string): LogIssue[] {
    return new LatexLogScanner(buffer, baseDirectory).run();
}

// ---------- Biber ----------

function biberIssueOfLine(bytes: Uint8Array, start: number, end: number, id: number): LogIssue | null {
    for (const { marker, severity } of BIBER_MARKERS) {
        const found = indexOfPattern(bytes, marker, start, end);
        if (found < 0) continue;
        const message = BIBER_PREFIX + decodeLogText(bytes, found + marker.length, end);
        return { id, severity, message, file: null, line: null, detail: null };
    }
    return null;
}

/** Warnungen und Fehler aus der Biber-Logdatei (`main.blg`); die Nummern beginnen bei `firstId` */
export function parseBiberLog(input: string | Uint8Array, firstId: number): LogIssue[] {
    const bytes = toBytes(input);
    const issues: LogIssue[] = [];
    let start = 0;
    while (start <= bytes.length) {
        const newline = indexOfByte(bytes, NEWLINE, start);
        const lineEnd = newline < 0 ? bytes.length : newline;
        const end = lineEnd > start && bytes[lineEnd - 1] === CARRIAGE_RETURN ? lineEnd - 1 : lineEnd;
        const issue = biberIssueOfLine(bytes, start, end, firstId + issues.length);
        if (issue !== null) issues.push(issue);
        if (newline < 0) break;
        start = newline + 1;
    }
    return issues;
}
