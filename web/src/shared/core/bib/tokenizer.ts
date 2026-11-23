// BibTeX-Tokenizer (Port von `BibTokenizer.swift`): eine Zeile samt Eingangszustand wird zu Tokens und
// Endzustand. Reine Logik ohne DOM, Node oder Electron. Offsets sind UTF-16-Einheiten wie bei JavaScript-Strings.
// Gefärbt werden Eintragstyp (`command`), Zitierschlüssel und @string-Makros (`keyArgument`), Feldnamen
// (`optionalArgument`), Klammern, Anführungszeichen, `=` und `#` (`delimiter`), LaTeX-Befehle in Werten
// (`command`) und Kommentare. Werte selbst bleiben ungefärbt (Fließtext für die Rechtschreibprüfung).

export type BibTokenKind = 'command' | 'delimiter' | 'optionalArgument' | 'keyArgument' | 'comment';

export interface BibToken {
    readonly kind: BibTokenKind;
    /** Absoluter Beginn (`lineOffset` + Position in der Zeile) */
    readonly from: number;
    /** Absolutes Ende, exklusiv */
    readonly to: number;
}

export type BibPhase = 'outside' | 'entryOpening' | 'key' | 'fieldName' | 'equals' | 'value' | 'comment';

/** `withoutKey`: `@string`, `@preamble` (ohne Zitierschlüssel) */
export type BibEntryKind = 'regular' | 'withoutKey' | 'comment';

/** Zustand am Zeilenende; Einträge und Werte gehen oft über mehrere Zeilen. Wird nie verändert, nur ersetzt. */
export interface BibLexState {
    readonly phase: BibPhase;
    readonly kind: BibEntryKind;
    /** Klammertiefe im Eintrag; die Klammer des Eintrags selbst ist 1 */
    readonly depth: number;
    readonly inQuotes: boolean;
    readonly closesWithParenthesis: boolean;
}

export interface BibLineResult {
    readonly tokens: BibToken[];
    readonly state: BibLexState;
}

/** Zustand vor der ersten Zeile und zwischen Einträgen */
export const INITIAL_BIB_STATE: BibLexState = Object.freeze({
    phase: 'outside',
    kind: 'regular',
    depth: 0,
    inQuotes: false,
    closesWithParenthesis: false,
});

const CHAR_AT = 0x40;
const CHAR_BACKSLASH = 0x5c;
const CHAR_OPEN_BRACE = 0x7b;
const CHAR_CLOSE_BRACE = 0x7d;
const CHAR_OPEN_PARENTHESIS = 0x28;
const CHAR_CLOSE_PARENTHESIS = 0x29;
const CHAR_QUOTE = 0x22;
const CHAR_COMMA = 0x2c;
const CHAR_EQUALS = 0x3d;
const CHAR_HASH = 0x23;
const CHAR_PERCENT = 0x25;
const CHAR_SPACE = 0x20;
const CHAR_TAB = 0x09;
const CHAR_CARRIAGE_RETURN = 0x0d;
const CHAR_LOWER_A = 0x61;
const CHAR_LOWER_Z = 0x7a;
const CHAR_UPPER_A = 0x41;
const CHAR_UPPER_Z = 0x5a;
const CHAR_ZERO = 0x30;
const CHAR_NINE = 0x39;

/** Zeichen in Schlüsseln und Feldnamen außer Buchstaben und Ziffern: `_-:.+/'` */
const NAME_SYMBOLS: ReadonlySet<number> = new Set([...'_-:.+/\''].map((symbol) => symbol.charCodeAt(0)));

const COMMENT_ENTRY_NAME = 'comment';
const WITHOUT_KEY_ENTRY_NAMES: ReadonlySet<string> = new Set(['string', 'preamble']);

function isLetter(code: number): boolean {
    return (code >= CHAR_LOWER_A && code <= CHAR_LOWER_Z) || (code >= CHAR_UPPER_A && code <= CHAR_UPPER_Z);
}

function isDigit(code: number): boolean {
    return code >= CHAR_ZERO && code <= CHAR_NINE;
}

function isWhitespace(code: number): boolean {
    return code === CHAR_SPACE || code === CHAR_TAB || code === CHAR_CARRIAGE_RETURN;
}

function isNameCharacter(code: number): boolean {
    return isLetter(code) || isDigit(code) || NAME_SYMBOLS.has(code);
}

function entryKindOf(name: string): BibEntryKind {
    const lowerCased = name.toLowerCase();
    if (lowerCased === COMMENT_ENTRY_NAME) return 'comment';
    return WITHOUT_KEY_ENTRY_NAMES.has(lowerCased) ? 'withoutKey' : 'regular';
}

export function bibStatesEqual(left: BibLexState, right: BibLexState): boolean {
    return left === right
        || (left.phase === right.phase
            && left.kind === right.kind
            && left.depth === right.depth
            && left.inQuotes === right.inQuotes
            && left.closesWithParenthesis === right.closesWithParenthesis);
}

/**
 * Tokenisiert eine Zeile (ohne Zeilenumbruch) ab `state`. `lineOffset` ist der absolute Beginn der Zeile im Text.
 * Bleibt der Zustand gleich, kommt dasselbe Objekt zurück (billiger Vergleich im Zeilen-Cache).
 */
export function tokenizeBibLine(line: string, lineOffset: number, state: BibLexState): BibLineResult {
    const scanner = new BibLineScanner(line, lineOffset, state);
    scanner.run();
    return { tokens: scanner.tokens, state: scanner.resultState(state) };
}

class BibLineScanner {
    readonly tokens: BibToken[] = [];
    private index = 0;
    private phase: BibPhase;
    private kind: BibEntryKind;
    private depth: number;
    private inQuotes: boolean;
    private closesWithParenthesis: boolean;

    constructor(private readonly line: string, private readonly lineOffset: number, state: BibLexState) {
        this.phase = state.phase;
        this.kind = state.kind;
        this.depth = state.depth;
        this.inQuotes = state.inQuotes;
        this.closesWithParenthesis = state.closesWithParenthesis;
    }

    resultState(previous: BibLexState): BibLexState {
        const current: BibLexState = {
            phase: this.phase,
            kind: this.kind,
            depth: this.depth,
            inQuotes: this.inQuotes,
            closesWithParenthesis: this.closesWithParenthesis,
        };
        return bibStatesEqual(previous, current) ? previous : current;
    }

    /** Jede Phase rückt mindestens ein Zeichen vor oder wechselt in eine Phase, die das tut. */
    run(): void {
        const count = this.line.length;
        while (this.index < count) {
            if (this.allowsLineComment() && this.consumeLineComment()) return;
            this.scanCurrentPhase();
        }
    }

    private scanCurrentPhase(): void {
        switch (this.phase) {
            case 'outside': return this.scanOutside();
            case 'entryOpening': return this.scanEntryOpening();
            case 'key': return this.scanKey();
            case 'fieldName': return this.scanFieldName();
            case 'equals': return this.scanEquals();
            case 'value': return this.depth > 1 || this.inQuotes ? this.scanValueText() : this.scanValueTopLevel();
            case 'comment': return this.scanCommentBody();
        }
    }

    /**
     * `%` bis zum Zeilenende ist ein Kommentar (auch ein auskommentierter Eintrag oder ein Feld darin), nur nicht
     * im Inhalt eines Werts: Dort ist es Text wie bei BibTeX. Der Zustand (Klammertiefe) bleibt unverändert.
     */
    private allowsLineComment(): boolean {
        switch (this.phase) {
            case 'comment': return false;
            case 'value': return this.depth <= 1 && !this.inQuotes;
            default: return true;
        }
    }

    /** Überspringt Leerraum; liefert `true`, wenn die Zeile damit zu Ende ist (Rest war Kommentar oder leer). */
    private consumeLineComment(): boolean {
        this.skipWhitespace();
        if (this.index >= this.line.length) return true;
        if (this.code() !== CHAR_PERCENT) return false;
        this.emit('comment', this.index, this.line.length);
        this.index = this.line.length;
        return true;
    }

    // MARK: Zwischen Einträgen

    private scanOutside(): void {
        const count = this.line.length;
        const start = this.index;
        while (this.index < count && this.code() !== CHAR_AT && this.code() !== CHAR_PERCENT) this.index += 1;
        this.emit('comment', start, this.index);
        if (this.index >= count || this.code() !== CHAR_AT) return;
        const nameStart = this.index + 1;
        let end = nameStart;
        while (end < count && isLetter(this.line.charCodeAt(end))) end += 1;
        if (end === nameStart) {
            this.emit('comment', this.index, this.index + 1);
            this.index += 1;
            return;
        }
        this.emit('command', this.index, end);
        this.kind = entryKindOf(this.line.slice(nameStart, end));
        this.phase = 'entryOpening';
        this.index = end;
    }

    private scanEntryOpening(): void {
        this.skipWhitespace();
        if (this.index >= this.line.length) return;
        const code = this.code();
        if (code !== CHAR_OPEN_BRACE && code !== CHAR_OPEN_PARENTHESIS) {
            this.resetState();
            return;
        }
        this.emitDelimiter();
        this.depth = 1;
        this.closesWithParenthesis = code === CHAR_OPEN_PARENTHESIS;
        this.phase = this.kind === 'regular' ? 'key' : this.kind === 'withoutKey' ? 'fieldName' : 'comment';
    }

    // MARK: Schlüssel und Felder

    private scanKey(): void {
        this.skipWhitespace();
        if (this.index >= this.line.length) return;
        const code = this.code();
        if (code === CHAR_COMMA) {
            this.index += 1;
            this.phase = 'fieldName';
        } else if (this.isEntryCloser(code)) {
            this.closeEntry();
        } else {
            const start = this.index;
            while (this.index < this.line.length && !this.endsKey(this.code())) this.index += 1;
            this.emit('keyArgument', start, this.index);
        }
    }

    private endsKey(code: number): boolean {
        return code === CHAR_COMMA || this.isEntryCloser(code) || isWhitespace(code);
    }

    private scanFieldName(): void {
        this.skipWhitespace();
        if (this.index >= this.line.length) return;
        const code = this.code();
        if (this.isEntryCloser(code)) {
            this.closeEntry();
        } else if (code === CHAR_OPEN_BRACE || code === CHAR_QUOTE) {
            // `@preamble{"…"}`: Wert ohne Namen
            this.phase = 'value';
        } else if (isNameCharacter(code)) {
            const start = this.index;
            while (this.index < this.line.length && isNameCharacter(this.code())) this.index += 1;
            this.emit('optionalArgument', start, this.index);
            this.phase = 'equals';
        } else {
            this.index += 1;
        }
    }

    private scanEquals(): void {
        this.skipWhitespace();
        if (this.index >= this.line.length) return;
        if (this.code() === CHAR_EQUALS) {
            this.emitDelimiter();
            this.phase = 'value';
        } else {
            this.phase = 'fieldName';
        }
    }

    // MARK: Werte

    /** Auf oberster Ebene des Werts: `{` oder `"` öffnet, `#` verkettet, Namen sind `@string`-Makros. */
    private scanValueTopLevel(): void {
        this.skipWhitespace();
        if (this.index >= this.line.length) return;
        const code = this.code();
        if (code === CHAR_OPEN_BRACE) {
            this.emitDelimiter();
            this.depth += 1;
        } else if (code === CHAR_QUOTE) {
            this.emitDelimiter();
            this.inQuotes = true;
        } else if (code === CHAR_HASH) {
            this.emitDelimiter();
        } else if (code === CHAR_COMMA) {
            this.index += 1;
            this.phase = 'fieldName';
        } else if (this.isEntryCloser(code)) {
            this.closeEntry();
        } else if (isLetter(code)) {
            this.scanMacroName();
        } else {
            this.index += 1;
        }
    }

    private scanMacroName(): void {
        const start = this.index;
        while (this.index < this.line.length && isNameCharacter(this.code())) this.index += 1;
        this.emit('keyArgument', start, this.index);
    }

    /** In `{…}` oder `"…"`: nur Klammern, das schließende `"` und LaTeX-Befehle werden gefärbt. */
    private scanValueText(): void {
        const count = this.line.length;
        while (this.index < count) {
            const code = this.code();
            if (code === CHAR_BACKSLASH) {
                this.emitCommand();
            } else if (code === CHAR_OPEN_BRACE) {
                this.emitDelimiter();
                this.depth += 1;
            } else if (code === CHAR_CLOSE_BRACE) {
                if (this.closeValueBrace()) return;
            } else if (code === CHAR_QUOTE && this.inQuotes && this.depth === 1) {
                this.emitDelimiter();
                this.inQuotes = false;
                return;
            } else {
                this.index += 1;
            }
        }
    }

    /** Liefert `true`, wenn der Wert (oder der kaputte Eintrag) damit endet und die Phase neu zu wählen ist. */
    private closeValueBrace(): boolean {
        if (this.depth <= 1) {
            // Kaputter Eintrag (Anführungszeichen nicht geschlossen): die Klammer beendet ihn
            this.closeEntry();
            return true;
        }
        this.emitDelimiter();
        this.depth -= 1;
        return this.depth === 1 && !this.inQuotes;
    }

    private emitCommand(): void {
        const count = this.line.length;
        const start = this.index;
        this.index += 1;
        if (this.index < count && isLetter(this.code())) {
            while (this.index < count && isLetter(this.code())) this.index += 1;
        } else if (this.index < count) {
            this.index += 1;
        }
        this.emit('command', start, this.index);
    }

    // MARK: @comment

    private scanCommentBody(): void {
        const count = this.line.length;
        const start = this.index;
        while (this.index < count) {
            const code = this.code();
            if (code === CHAR_OPEN_BRACE) {
                this.depth += 1;
            } else if (this.depth === 1 && this.isEntryCloser(code)) {
                this.emit('comment', start, this.index);
                this.closeEntry();
                return;
            } else if (code === CHAR_CLOSE_BRACE) {
                this.depth -= 1;
            }
            this.index += 1;
        }
        this.emit('comment', start, this.index);
    }

    // MARK: Hilfen

    private code(): number {
        return this.line.charCodeAt(this.index);
    }

    private isEntryCloser(code: number): boolean {
        return code === (this.closesWithParenthesis ? CHAR_CLOSE_PARENTHESIS : CHAR_CLOSE_BRACE);
    }

    private resetState(): void {
        this.phase = INITIAL_BIB_STATE.phase;
        this.kind = INITIAL_BIB_STATE.kind;
        this.depth = INITIAL_BIB_STATE.depth;
        this.inQuotes = INITIAL_BIB_STATE.inQuotes;
        this.closesWithParenthesis = INITIAL_BIB_STATE.closesWithParenthesis;
    }

    private closeEntry(): void {
        this.emitDelimiter();
        this.resetState();
    }

    private skipWhitespace(): void {
        while (this.index < this.line.length && isWhitespace(this.code())) this.index += 1;
    }

    private emitDelimiter(): void {
        this.emit('delimiter', this.index, this.index + 1);
        this.index += 1;
    }

    private emit(kind: BibTokenKind, start: number, end: number): void {
        if (end <= start) return;
        this.tokens.push({ kind, from: this.lineOffset + start, to: this.lineOffset + end });
    }
}
