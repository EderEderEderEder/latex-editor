/**
 * LaTeX-Tokenizer, Port von `swift/Sources/LatexEditor/Syntax/LatexTokenizer.swift` (dort ist die Wahrheit).
 * Zeilenweise: eine Zeile (ohne Zeilenumbruch) ab einem Anfangszustand zerlegen; Ergebnis sind die Tokens und der
 * Zustand am Zeilenende, der Anfangszustand der nächsten Zeile. Positionen und Längen in UTF-16-Einheiten.
 * Reine Logik, ohne DOM und ohne Node-Importe. Keine regulären Ausdrücke: jede Zeile wird in einem Durchgang gelesen.
 */
import { isCodeEnvironment, isMathEnvironment } from './environments';

export type TokenKind =
    /** `\section`, `\\`, escapte Zeichen wie `\%` oder `\$` */
    | 'command'
    /** `{` `}` `[` `]` */
    | 'delimiter'
    /** Inhalt von `[...]` nach einem Befehl */
    | 'optionalArgument'
    /** Inhalt von Schlüssel-Argumenten (`\label{...}`, `\begin{...}`, ...), kein Fließtext */
    | 'keyArgument'
    | 'math'
    | 'comment'
    | 'verbatim';

export type MathDelimiter = 'dollar' | 'doubleDollar' | 'parenthesis' | 'bracket';

/**
 * Zustand am Zeilenende, kodiert wie in `shared/spec/README.md`: ohne Wert als Zeichenkette, mit Wert als Objekt
 * mit genau einem Schlüssel. Alles außer `'normal'` setzt sich in die nächste Zeile fort.
 */
export type LexState =
    | 'normal'
    | { readonly math: MathDelimiter }
    | { readonly mathEnvironment: string }
    | { readonly verbatimEnvironment: string };

export interface SyntaxToken {
    readonly kind: TokenKind;
    /** Absolute Position (`lineOffset` + Position in der Zeile) */
    readonly location: number;
    readonly length: number;
}

export interface LineTokens {
    readonly tokens: SyntaxToken[];
    /** Zustand am Zeilenende */
    readonly state: LexState;
}

export const NORMAL_STATE = 'normal' satisfies LexState;

/** Befehle, deren erstes {}-Argument kein Fließtext ist (Labels, Schlüssel, Pfade, Namen); Liste wie in Swift */
const KEY_ARGUMENT_COMMANDS: ReadonlySet<string> = new Set([
    'label', 'ref', 'eqref', 'pageref', 'autoref', 'cref', 'Cref', 'nameref', 'vref',
    'cite', 'citep', 'citet', 'citealp', 'parencite', 'textcite', 'autocite', 'footcite',
    'nocite', 'citeauthor', 'citeyear', 'fullcite',
    'end', 'usepackage', 'RequirePackage', 'documentclass',
    'input', 'include', 'includeonly', 'includegraphics', 'subfile', 'graphicspath',
    'bibliography', 'bibliographystyle', 'addbibresource',
    'url', 'href', 'hyperref',
    'newcommand', 'renewcommand', 'providecommand', 'newenvironment', 'renewenvironment',
    'DeclareMathOperator', 'lstinputlisting', 'inputminted',
    'setlength', 'addtolength', 'setcounter', 'addtocounter', 'numberwithin',
    'vspace', 'hspace', 'hypersetup', 'pagestyle', 'thispagestyle', 'pagenumbering',
    'definecolor', 'color', 'textcolor',
    'ac', 'acs', 'acl', 'acf', 'acp', 'Ac', 'acsp', 'aclp', 'acfp',
    'gls', 'Gls', 'glspl', 'Glspl', 'newacronym',
]);
const BEGIN_COMMAND = 'begin';
const VERB_COMMAND = 'verb';
const COMMENT_ENVIRONMENT = 'comment';

const BACKSLASH = 0x5c;
const PERCENT = 0x25;
const DOLLAR = 0x24;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const OPEN_PARENTHESIS = 0x28;
const CLOSE_PARENTHESIS = 0x29;
const STAR = 0x2a;
const SPACE = 0x20;
const TAB = 0x09;
const CARRIAGE_RETURN = 0x0d;
const AT = 0x40;
const LOWERCASE_A = 0x61;
const LOWERCASE_E = 0x65;
const LOWERCASE_Z = 0x7a;
const UPPERCASE_A = 0x41;
const UPPERCASE_Z = 0x5a;

const NO_POSITION = -1;
const SINGLE_DELIMITER_LENGTH = 1;
const DOUBLE_DELIMITER_LENGTH = 2;
/** Obergrenze je Zustandsart, damit ausgefallene Umgebungsnamen (`…Code`) den Speicher nicht füllen */
const MAXIMUM_INTERNED_STATES = 256;

// Zustände werden geteilt (eingefroren), damit Vergleiche meist schon an der Identität enden und Zeilen ohne
// Zustandswechsel nichts allozieren.
const MATH_STATES: Readonly<Record<MathDelimiter, LexState>> = {
    dollar: Object.freeze({ math: 'dollar' }),
    doubleDollar: Object.freeze({ math: 'doubleDollar' }),
    parenthesis: Object.freeze({ math: 'parenthesis' }),
    bracket: Object.freeze({ math: 'bracket' }),
};
const mathEnvironmentStates = new Map<string, LexState>();
const verbatimEnvironmentStates = new Map<string, LexState>();

function internedState(cache: Map<string, LexState>, name: string, create: (name: string) => LexState): LexState {
    const known = cache.get(name);
    if (known !== undefined) return known;
    const created = Object.freeze(create(name));
    if (cache.size < MAXIMUM_INTERNED_STATES) cache.set(name, created);
    return created;
}

function mathEnvironmentState(name: string): LexState {
    return internedState(mathEnvironmentStates, name, (environment) => ({ mathEnvironment: environment }));
}

function verbatimEnvironmentState(name: string): LexState {
    return internedState(verbatimEnvironmentStates, name, (environment) => ({ verbatimEnvironment: environment }));
}

/** Gleiche Bedeutung wie `state`, aber das geteilte Objekt (Zustände von außen, z. B. aus JSON) */
function canonicalState(state: LexState): LexState {
    if (typeof state === 'string') return NORMAL_STATE;
    if ('math' in state) return MATH_STATES[state.math];
    if ('mathEnvironment' in state) return mathEnvironmentState(state.mathEnvironment);
    return verbatimEnvironmentState(state.verbatimEnvironment);
}

/** Wertgleichheit zweier Zustände (für die Konvergenzprüfung „Endzustand gleich → Rest unverändert“) */
export function statesEqual(first: LexState, second: LexState): boolean {
    if (first === second) return true;
    if (typeof first === 'string' || typeof second === 'string') return false;
    if ('math' in first) return 'math' in second && first.math === second.math;
    if ('mathEnvironment' in first) {
        return 'mathEnvironment' in second && first.mathEnvironment === second.mathEnvironment;
    }
    return 'verbatimEnvironment' in second && first.verbatimEnvironment === second.verbatimEnvironment;
}

/** Mathe endet an einer Leerzeile (in TeX wäre sie dort ein Fehler); das begrenzt das Umfärben auf den Absatz */
export function endsAtBlankLine(state: LexState): boolean {
    return typeof state === 'object' && !('verbatimEnvironment' in state);
}

/** Tokenisiert eine Zeile ab `startState`; Positionen relativ zum Zeilenanfang */
export function tokenizeLine(line: string, startState: LexState = NORMAL_STATE): LineTokens {
    return tokenizeLineWithOffset(line, 0, startState);
}

/** Wie `tokenizeLine`, aber Positionen absolut (`lineOffset` + Position in der Zeile) */
export function tokenizeLineWithOffset(line: string, lineOffset: number, startState: LexState = NORMAL_STATE): LineTokens {
    const scanner = new LatexLineScanner(line, lineOffset, canonicalState(startState));
    scanner.run();
    return { tokens: scanner.tokens, state: scanner.state };
}

/** Zeilen nacheinander; der Endzustand jeder Zeile ist der Anfangszustand der nächsten */
export function tokenizeChain(lines: readonly string[], startState: LexState = NORMAL_STATE): LineTokens[] {
    const results: LineTokens[] = [];
    let state = startState;
    for (const line of lines) {
        const result = tokenizeLine(line, state);
        results.push(result);
        state = result.state;
    }
    return results;
}

// MARK: Hilfen auf Zeichenebene

function isLetter(code: number): boolean {
    return (code >= LOWERCASE_A && code <= LOWERCASE_Z) || (code >= UPPERCASE_A && code <= UPPERCASE_Z) || code === AT;
}

function letterRunEnd(line: string, start: number): number {
    let position = start;
    while (position < line.length && isLetter(line.charCodeAt(position))) position++;
    return position;
}

function skipSpaces(line: string, start: number): number {
    let position = start;
    while (position < line.length) {
        const code = line.charCodeAt(position);
        if (code !== SPACE && code !== TAB) break;
        position++;
    }
    return position;
}

function isBlankLine(line: string): boolean {
    for (let position = 0; position < line.length; position++) {
        const code = line.charCodeAt(position);
        if (code !== SPACE && code !== TAB && code !== CARRIAGE_RETURN) return false;
    }
    return true;
}

function endCommand(environment: string): string {
    return `\\end{${environment}}`;
}

// MARK: Zeilenscanner

class LatexLineScanner {
    readonly tokens: SyntaxToken[] = [];
    state: LexState;
    private index = 0;
    /** Beginn eines Mathe-Bereichs, der in dieser Zeile geöffnet wurde (inklusive Öffner) */
    private regionStart = NO_POSITION;
    private readonly count: number;

    constructor(private readonly line: string, private readonly lineOffset: number, state: LexState) {
        this.state = state;
        this.count = line.length;
    }

    run(): void {
        if (endsAtBlankLine(this.state) && isBlankLine(this.line)) {
            this.state = NORMAL_STATE;
            return;
        }
        while (this.index < this.count) {
            const state = this.state;
            if (state === NORMAL_STATE) this.scanNormal();
            else if ('verbatimEnvironment' in state) this.scanVerbatimEnvironment(state.verbatimEnvironment);
            else this.scanMath();
        }
    }

    // MARK: Normaler Text

    private scanNormal(): void {
        while (this.index < this.count) {
            const code = this.line.charCodeAt(this.index);
            if (code === PERCENT) {
                this.emitComment();
                return;
            }
            if (code === DOLLAR) {
                this.openDollarMath();
                return;
            }
            if (code === BACKSLASH) {
                this.scanBackslash();
                if (this.state !== NORMAL_STATE) return;
                continue;
            }
            if (code === OPEN_BRACE || code === CLOSE_BRACE) this.emit('delimiter', this.index, this.index + 1);
            this.index++;
        }
    }

    private emitComment(): void {
        this.emit('comment', this.index, this.count);
        this.index = this.count;
    }

    private openDollarMath(): void {
        const isDisplay = this.isCharacter(this.index + 1, DOLLAR);
        if (isDisplay) this.openMath('doubleDollar', DOUBLE_DELIMITER_LENGTH);
        else this.openMath('dollar', SINGLE_DELIMITER_LENGTH);
    }

    private openMath(delimiter: MathDelimiter, openerLength: number): void {
        this.regionStart = this.index;
        this.index += openerLength;
        this.state = MATH_STATES[delimiter];
    }

    private scanBackslash(): void {
        const start = this.index;
        const next = start + 1;
        if (next >= this.count) {
            this.emit('command', start, next);
            this.index = next;
            return;
        }
        const code = this.line.charCodeAt(next);
        if (isLetter(code)) {
            this.scanCommandWord(start);
            return;
        }
        if (code === OPEN_BRACKET) return this.openMath('bracket', DOUBLE_DELIMITER_LENGTH);
        if (code === OPEN_PARENTHESIS) return this.openMath('parenthesis', DOUBLE_DELIMITER_LENGTH);
        this.emit('command', start, next + 1);
        this.index = next + 1;
        // `\\[2mm]` ist ein Zeilenumbruch mit Abstand, keine Display-Mathe
        if (code === BACKSLASH) this.scanOptionalArguments();
    }

    private scanCommandWord(start: number): void {
        const nameEnd = letterRunEnd(this.line, start + 1);
        const name = this.line.slice(start + 1, nameEnd);
        if (name === VERB_COMMAND) {
            this.scanVerb(start, nameEnd);
            return;
        }
        const commandEnd = this.isCharacter(nameEnd, STAR) ? nameEnd + 1 : nameEnd;
        this.emit('command', start, commandEnd);
        this.index = commandEnd;
        if (name === BEGIN_COMMAND) {
            this.scanBeginArguments();
            return;
        }
        this.scanOptionalArguments();
        if (KEY_ARGUMENT_COMMANDS.has(name)) this.scanKeyArgument();
    }

    // MARK: Argumente

    private scanOptionalArguments(): void {
        let position = skipSpaces(this.line, this.index);
        while (this.isCharacter(position, OPEN_BRACKET)) {
            const contentEnd = this.findClosingBracket(position);
            this.emit('delimiter', position, position + 1);
            this.emit('optionalArgument', position + 1, contentEnd);
            this.index = contentEnd;
            if (!this.isCharacter(contentEnd, CLOSE_BRACKET)) return;
            this.emit('delimiter', contentEnd, contentEnd + 1);
            this.index = contentEnd + 1;
            position = skipSpaces(this.line, this.index);
        }
    }

    /** Liest `{...}` als Schlüssel-Argument; gibt den Inhaltsbeginn zurück, falls geschlossen, sonst `NO_POSITION` */
    private scanKeyArgument(): number {
        const position = skipSpaces(this.line, this.index);
        if (!this.isCharacter(position, OPEN_BRACE)) return NO_POSITION;
        const contentEnd = this.findClosingBrace(position);
        this.emit('delimiter', position, position + 1);
        this.emit('keyArgument', position + 1, contentEnd);
        this.index = contentEnd;
        if (!this.isCharacter(contentEnd, CLOSE_BRACE)) return NO_POSITION;
        this.emit('delimiter', contentEnd, contentEnd + 1);
        this.index = contentEnd + 1;
        return position + 1;
    }

    private scanBeginArguments(): void {
        const contentStart = this.scanKeyArgument();
        if (contentStart === NO_POSITION) return;
        // Index steht hinter der schließenden `}`
        const environment = this.line.slice(contentStart, this.index - 1);
        if (isMathEnvironment(environment)) {
            this.regionStart = this.index;
            this.state = mathEnvironmentState(environment);
        } else if (isCodeEnvironment(environment)) {
            this.scanOptionalArguments();
            this.state = verbatimEnvironmentState(environment);
        }
    }

    private scanVerb(start: number, afterName: number): void {
        const position = this.isCharacter(afterName, STAR) ? afterName + 1 : afterName;
        if (position >= this.count) {
            this.emit('verbatim', start, this.count);
            this.index = this.count;
            return;
        }
        const close = this.line.indexOf(this.line.charAt(position), position + 1);
        const end = close === NO_POSITION ? this.count : close + 1;
        this.emit('verbatim', start, end);
        this.index = end;
    }

    // MARK: Mathe

    private scanMath(): void {
        const start = this.regionStart === NO_POSITION ? this.index : this.regionStart;
        this.regionStart = NO_POSITION;
        while (this.index < this.count) {
            const code = this.line.charCodeAt(this.index);
            if (code === PERCENT) {
                this.emit('math', start, this.index);
                this.emitComment();
                return;
            }
            if (code === BACKSLASH) {
                if (this.scanMathBackslash(start)) return;
            } else if (code === DOLLAR && this.closeDollarMath(start)) {
                return;
            } else {
                this.index++;
            }
        }
        this.emit('math', start, this.count);
    }

    /** Verarbeitet `\...` in Mathe. Gibt `true` zurück, wenn der Mathe-Bereich dadurch endet. */
    private scanMathBackslash(start: number): boolean {
        const next = this.index + 1;
        if (next >= this.count) {
            this.index = next;
            return false;
        }
        const code = this.line.charCodeAt(next);
        if (this.closesBracketOrParenthesis(code)) {
            this.emit('math', start, next + 1);
            this.index = next + 1;
            this.state = NORMAL_STATE;
            return true;
        }
        if (!isLetter(code)) {
            this.index = next + 1;
            return false;
        }
        if (code === LOWERCASE_E && this.endsMathEnvironmentHere()) {
            this.emit('math', start, this.index);
            this.state = NORMAL_STATE;
            this.scanCommandWord(this.index);
            return true;
        }
        this.index = letterRunEnd(this.line, next);
        return false;
    }

    private closesBracketOrParenthesis(code: number): boolean {
        return (this.state === MATH_STATES.bracket && code === CLOSE_BRACKET)
            || (this.state === MATH_STATES.parenthesis && code === CLOSE_PARENTHESIS);
    }

    private endsMathEnvironmentHere(): boolean {
        const state = this.state;
        return typeof state === 'object' && 'mathEnvironment' in state
            && this.line.startsWith(endCommand(state.mathEnvironment), this.index);
    }

    private closeDollarMath(start: number): boolean {
        const closerLength = this.dollarCloserLength();
        if (closerLength === 0) return false;
        this.emit('math', start, this.index + closerLength);
        this.index += closerLength;
        this.state = NORMAL_STATE;
        return true;
    }

    private dollarCloserLength(): number {
        if (this.state === MATH_STATES.dollar) return SINGLE_DELIMITER_LENGTH;
        if (this.state === MATH_STATES.doubleDollar && this.isCharacter(this.index + 1, DOLLAR)) {
            return DOUBLE_DELIMITER_LENGTH;
        }
        return 0;
    }

    // MARK: Verbatim-Umgebungen

    private scanVerbatimEnvironment(environment: string): void {
        const kind: TokenKind = environment === COMMENT_ENVIRONMENT ? 'comment' : 'verbatim';
        const start = this.index;
        const end = this.line.indexOf(endCommand(environment), start);
        if (end === NO_POSITION) {
            this.emit(kind, start, this.count);
            this.index = this.count;
            return;
        }
        this.emit(kind, start, end);
        this.state = NORMAL_STATE;
        this.scanCommandWord(end);
    }

    // MARK: Klammersuche

    /**
     * Ende des Inhalts von `{` an `openedAt`: Position der passenden `}`, eines unescapten `%` oder das Zeilenende.
     * Geschlossen ist das Argument genau dann, wenn dort `}` steht.
     */
    private findClosingBrace(openedAt: number): number {
        let depth = 0;
        for (let position = openedAt; position < this.count; position++) {
            const code = this.line.charCodeAt(position);
            if (code === BACKSLASH) position++;
            else if (code === PERCENT) return position;
            else if (code === OPEN_BRACE) depth++;
            else if (code === CLOSE_BRACE && --depth === 0) return position;
        }
        return this.count;
    }

    /** Wie `findClosingBrace`, aber erste `]` auf Klammertiefe 0 nach `[` an `openedAt` */
    private findClosingBracket(openedAt: number): number {
        let depth = 0;
        for (let position = openedAt + 1; position < this.count; position++) {
            const code = this.line.charCodeAt(position);
            if (code === BACKSLASH) position++;
            else if (code === PERCENT) return position;
            else if (code === OPEN_BRACE) depth++;
            else if (code === CLOSE_BRACE) depth = Math.max(depth - 1, 0);
            else if (code === CLOSE_BRACKET && depth === 0) return position;
        }
        return this.count;
    }

    private isCharacter(position: number, code: number): boolean {
        return position < this.count && this.line.charCodeAt(position) === code;
    }

    private emit(kind: TokenKind, start: number, end: number): void {
        if (end <= start) return;
        this.tokens.push({ kind, location: this.lineOffset + start, length: end - start });
    }
}
