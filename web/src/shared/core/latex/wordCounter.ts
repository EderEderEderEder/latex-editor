/**
 * Zählt die Wörter des Fließtexts einer LaTeX-Datei – eine Näherung wie `texcount`, aber ohne Fremdwerkzeug:
 * Präambel, Kommentare, Formeln, Code, Befehle und ihre Schlüssel-Argumente (`\label`, `\ref`, `\cite`, Dateinamen …)
 * zählen nicht; der Text in `\textbf{…}`, Überschriften, Fußnoten und Beschriftungen schon. Port von `WordCounter.swift`
 * (dort ist die Wahrheit). Der Zähler arbeitet wie dort auf Unicode-Skalaren (Codepoints), nicht auf UTF-16-Einheiten.
 * Reine Logik, ohne DOM und ohne Node-Importe.
 */
import { skipsContent } from './environments';

const DOCUMENT_BEGIN = '\\begin{document}';
const DOCUMENT_END = '\\end{document}';

const NEWLINE = 0x0a;
const TAB = 0x09;
const SPACE = 0x20;
const DOLLAR = 0x24;
const PERCENT = 0x25;
const APOSTROPHE = 0x27;
const OPEN_PARENTHESIS = 0x28;
const CLOSE_PARENTHESIS = 0x29;
const STAR = 0x2a;
const COMMA = 0x2c;
const HYPHEN = 0x2d;
const PERIOD = 0x2e;
const SLASH = 0x2f;
const OPEN_BRACKET = 0x5b;
const BACKSLASH = 0x5c;
const CLOSE_BRACKET = 0x5d;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const TILDE = 0x7e;
const RIGHT_SINGLE_QUOTE = 0x2019;
const ASCII_LIMIT = 0x80;
const DIGIT_FIRST = 0x30;
const DIGIT_LAST = 0x39;
const UPPERCASE_FIRST = 0x41;
const UPPERCASE_LAST = 0x5a;
const LOWERCASE_FIRST = 0x61;
const LOWERCASE_LAST = 0x7a;
/** `\x` und `$$`: so viele Zeichen werden auf einmal übersprungen */
const PAIR_LENGTH = 2;
/** Länge von `\"{o}`: Akzentsymbol hinter dem Backslash fehlt hier, gezählt werden `{`, Buchstabe, `}` */
const ACCENT_ARGUMENT_LENGTH = 3;
const ACCENT_SYMBOLS: ReadonlySet<number> = new Set([...'"\'`^~=.'].map((symbol) => symbol.charCodeAt(0)));
const NON_ASCII_WORD_CHARACTER = /^[\p{Alphabetic}\p{N}]$/u;

/** Befehle, deren folgende Argumente (in `{…}`, davor `[…]`) kein Text sind: Befehl → Anzahl */
const COMMANDS_SKIPPING_ARGUMENTS: ReadonlyMap<string, number> = new Map(Object.entries({
    label: 1, ref: 1, eqref: 1, pageref: 1, autoref: 1, Autoref: 1, cref: 1, Cref: 1, vref: 1,
    nameref: 1, labelcref: 1, cpageref: 1, hyperref: 0,
    cite: 1, citep: 1, citet: 1, citealp: 1, citeauthor: 1, citeyear: 1, citetitle: 1, parencite: 1,
    Parencite: 1, textcite: 1, Textcite: 1, autocite: 1, footcite: 1, nocite: 1, fullcite: 1,
    input: 1, include: 1, includegraphics: 1, includepdf: 1, lstinputlisting: 1, subfile: 1,
    usepackage: 1, RequirePackage: 1, documentclass: 1, usetikzlibrary: 1,
    bibliography: 1, bibliographystyle: 1, addbibresource: 1, graphicspath: 1,
    url: 1, href: 1, hypersetup: 1, pagestyle: 1, thispagestyle: 1, geometry: 1, lstset: 1,
    captionsetup: 1, hyphenation: 1, pagenumbering: 1,
    setlength: 2, setcounter: 2, addtocounter: 2, rule: 2, hspace: 1, vspace: 1, textcolor: 1,
    color: 1, definecolor: 3, newcommand: 2, renewcommand: 2, providecommand: 2, DeclareMathOperator: 2,
    newenvironment: 3, renewenvironment: 3, newtheorem: 2, newcounter: 1,
}));
/** Setzt einen Buchstaben, auch ohne Leerzeichen davor oder danach: Stra\ss e */
const LETTER_COMMANDS: ReadonlySet<string> = new Set(['ss', 'ae', 'AE', 'oe', 'OE', 'aa', 'AA', 'o', 'O', 'l', 'L', 'i', 'j']);
/** `\c{c}`, `\v{s}` …: das Argument ist ein Buchstabe des Wortes */
const ACCENT_COMMANDS: ReadonlySet<string> = new Set(['u', 'v', 'H', 'c', 'k', 'r', 'b', 'd', 't']);
/** Umgebungen, deren erstes `{…}` Argument Spaltenformat oder Breite ist */
const ENVIRONMENTS_WITH_ARGUMENT: ReadonlySet<string> = new Set([
    'tabular', 'tabular*', 'tabularx', 'tabulary', 'longtable', 'array', 'supertabular', 'minipage', 'multicols', 'thebibliography',
]);

function isDigit(code: number): boolean {
    return code >= DIGIT_FIRST && code <= DIGIT_LAST;
}

function isAsciiLetter(code: number): boolean {
    return (code >= UPPERCASE_FIRST && code <= UPPERCASE_LAST) || (code >= LOWERCASE_FIRST && code <= LOWERCASE_LAST);
}

function isWordScalar(code: number): boolean {
    if (code < ASCII_LIMIT) return isAsciiLetter(code) || isDigit(code);
    return NON_ASCII_WORD_CHARACTER.test(String.fromCodePoint(code));
}

function codes(text: string): number[] {
    return Array.from(text, (character) => character.codePointAt(0) ?? 0);
}

/** Zwischen `\begin{document}` und `\end{document}`, falls vorhanden (Kapiteldateien: der ganze Text) */
function bodyOf(text: string): string {
    const begin = text.indexOf(DOCUMENT_BEGIN);
    const from = begin === -1 ? text : text.slice(begin + DOCUMENT_BEGIN.length);
    const end = from.indexOf(DOCUMENT_END);
    return end === -1 ? from : from.slice(0, end);
}

class Counter {
    private index = 0;
    private count = 0;
    private inWord = false;

    constructor(private readonly scalars: readonly number[]) {}

    run(): number {
        while (this.index < this.scalars.length) {
            const scalar = this.scalars[this.index] ?? 0;
            switch (scalar) {
                case PERCENT: this.skipLine(); break;
                case BACKSLASH: this.command(); break;
                case DOLLAR: this.skipDollarMath(); break;
                case OPEN_BRACE:
                case CLOSE_BRACE: this.index++; break;
                case TILDE: this.inWord = false; this.index++; break;
                default: this.plain(scalar);
            }
        }
        return this.count;
    }

    private at(position: number): number {
        return this.scalars[position] ?? -1;
    }

    private textBetween(start: number, end: number): string {
        return this.scalars.slice(start, end).map((scalar) => String.fromCodePoint(scalar)).join('');
    }

    // MARK: Zeichen

    private plain(scalar: number): void {
        if (isWordScalar(scalar)) this.startOrContinueWord();
        else if (!(this.inWord && this.joinsWord(scalar))) this.inWord = false;
        this.index++;
    }

    /** Bindestrich, Apostroph, Dezimalpunkt innerhalb eines Wortes */
    private joinsWord(scalar: number): boolean {
        const next = this.at(this.index + 1);
        if (next < 0 || !isWordScalar(next)) return false;
        if (scalar === HYPHEN || scalar === APOSTROPHE || scalar === RIGHT_SINGLE_QUOTE) return true;
        if (scalar !== PERIOD && scalar !== COMMA) return false;
        return this.index > 0 && isDigit(this.at(this.index - 1)) && isDigit(next);
    }

    private startOrContinueWord(): void {
        if (this.inWord) return;
        this.inWord = true;
        this.count++;
    }

    // MARK: Überspringen

    private skipLine(): void {
        while (this.index < this.scalars.length && this.at(this.index) !== NEWLINE) this.index++;
        this.inWord = false;
    }

    /** `$…$` und `$$…$$`; ein offenes `$` endet spätestens an einer Leerzeile (wie im Syntaxfärber) */
    private skipDollarMath(): void {
        this.inWord = false;
        const isDisplay = this.at(this.index + 1) === DOLLAR;
        this.index += isDisplay ? PAIR_LENGTH : 1;
        while (this.index < this.scalars.length) {
            const scalar = this.at(this.index);
            if (scalar === BACKSLASH) {
                this.index += PAIR_LENGTH;
            } else if (scalar === DOLLAR) {
                this.index += isDisplay && this.at(this.index + 1) === DOLLAR ? PAIR_LENGTH : 1;
                return;
            } else if (scalar === NEWLINE && this.isBlankLine(this.index + 1)) {
                return;
            } else {
                this.index++;
            }
        }
    }

    private isBlankLine(start: number): boolean {
        let position = start;
        while (this.at(position) === SPACE || this.at(position) === TAB) position++;
        return position >= this.scalars.length || this.at(position) === NEWLINE;
    }

    private skipUntil(terminator: readonly number[]): void {
        const found = this.find(terminator, this.index);
        this.index = found === -1 ? this.scalars.length : found + terminator.length;
    }

    private find(needle: readonly number[], start: number): number {
        for (let position = start; position + needle.length <= this.scalars.length; position++) {
            if (needle.every((code, offset) => this.at(position + offset) === code)) return position;
        }
        return -1;
    }

    /** Überspringt Leerraum, `[…]` und dann `count` Gruppen `{…}` */
    private skipArguments(count: number): void {
        let remaining = count;
        while (this.index < this.scalars.length) {
            const saved = this.index;
            this.skipSpaces();
            if (this.at(this.index) === OPEN_BRACKET) {
                this.skipGroup(OPEN_BRACKET, CLOSE_BRACKET);
            } else if (remaining > 0 && this.at(this.index) === OPEN_BRACE) {
                this.skipGroup(OPEN_BRACE, CLOSE_BRACE);
                remaining--;
            } else {
                this.index = saved;
                return;
            }
            if (remaining === 0 && this.at(this.index) !== OPEN_BRACKET) return;
        }
    }

    private skipSpaces(): void {
        while ([SPACE, TAB, NEWLINE].includes(this.at(this.index))) this.index++;
    }

    /** Steht an `open`; geht hinter das passende `close` (verschachtelt, `\{` zählt nicht) */
    private skipGroup(open: number, close: number): void {
        let depth = 0;
        while (this.index < this.scalars.length) {
            const scalar = this.at(this.index);
            if (scalar === BACKSLASH) {
                this.index += PAIR_LENGTH;
                continue;
            }
            this.index++;
            if (scalar === open) depth++;
            else if (scalar === close && --depth === 0) return;
        }
    }

    // MARK: Befehle

    private command(): void {
        this.index++;
        if (this.index >= this.scalars.length) return;
        const first = this.at(this.index);
        if (!isAsciiLetter(first)) {
            this.controlSymbol(first);
            return;
        }
        const start = this.index;
        while (isAsciiLetter(this.at(this.index))) this.index++;
        const name = this.textBetween(start, this.index);
        if (this.at(this.index) === STAR) this.index++;
        this.named(name);
    }

    private controlSymbol(symbol: number): void {
        this.index++;
        if (symbol === OPEN_PARENTHESIS) this.skipFormula(CLOSE_PARENTHESIS);
        else if (symbol === OPEN_BRACKET) this.skipFormula(CLOSE_BRACKET);
        else if (symbol === HYPHEN || symbol === SLASH) return;
        else if (symbol === BACKSLASH) this.skipLineBreakOption();
        else if (ACCENT_SYMBOLS.has(symbol)) this.joinAccentArgument();
        else this.inWord = false;
    }

    /** `\(…\)` und `\[…\]` */
    private skipFormula(closing: number): void {
        this.inWord = false;
        this.skipUntil([BACKSLASH, closing]);
    }

    /** `\\[1ex]` */
    private skipLineBreakOption(): void {
        this.inWord = false;
        if (this.at(this.index) === OPEN_BRACKET) this.skipGroup(OPEN_BRACKET, CLOSE_BRACKET);
    }

    /** `\"{o}`: Der Buchstabe gehört zum laufenden Wort */
    private joinAccentArgument(): void {
        if (this.at(this.index) !== OPEN_BRACE || this.at(this.index + 2) !== CLOSE_BRACE) return;
        const letter = this.at(this.index + 1);
        if (letter < 0 || !isWordScalar(letter)) return;
        this.startOrContinueWord();
        this.index += ACCENT_ARGUMENT_LENGTH;
    }

    private named(name: string): void {
        if (LETTER_COMMANDS.has(name)) {
            this.startOrContinueWord();
            return;
        }
        if (ACCENT_COMMANDS.has(name)) {
            this.skipSpaces();
            this.joinAccentArgument();
            return;
        }
        this.inWord = false;
        this.endingCommand(name);
    }

    /** Alle übrigen Befehle: Das Wort endet, Argumente ohne Text werden übersprungen */
    private endingCommand(name: string): void {
        if (name === 'begin') this.beginEnvironment();
        else if (name === 'end') this.skipGroupAfterSpaces();
        else if (name === 'verb') this.skipVerb();
        else if (name === 'def') this.skipDefinition();
        else if (COMMANDS_SKIPPING_ARGUMENTS.has(name)) this.skipArguments(COMMANDS_SKIPPING_ARGUMENTS.get(name) ?? 0);
        else if (this.at(this.index) === OPEN_BRACKET) this.skipGroup(OPEN_BRACKET, CLOSE_BRACKET);
    }

    private skipGroupAfterSpaces(): void {
        this.skipSpaces();
        if (this.at(this.index) === OPEN_BRACE) this.skipGroup(OPEN_BRACE, CLOSE_BRACE);
    }

    private beginEnvironment(): void {
        this.skipSpaces();
        if (this.at(this.index) !== OPEN_BRACE) return;
        const start = this.index + 1;
        this.skipGroup(OPEN_BRACE, CLOSE_BRACE);
        const name = this.textBetween(start, Math.max(start, this.index - 1));
        if (skipsContent(name)) this.skipUntil(codes(`\\end{${name}}`));
        else this.skipArguments(ENVIRONMENTS_WITH_ARGUMENT.has(name) ? 1 : 0);
    }

    /** `\verb|…|`: bis zum zweiten gleichen Begrenzer (oder Zeilenende) */
    private skipVerb(): void {
        if (this.at(this.index) === STAR) this.index++;
        if (this.index >= this.scalars.length) return;
        const delimiter = this.at(this.index);
        this.index++;
        while (this.index < this.scalars.length && this.at(this.index) !== delimiter && this.at(this.index) !== NEWLINE) this.index++;
        if (this.at(this.index) === delimiter) this.index++;
    }

    /** `\def\name#1{…}`: bis hinter die erste Gruppe (nicht über das Zeilenende) */
    private skipDefinition(): void {
        while (this.index < this.scalars.length && this.at(this.index) !== OPEN_BRACE && this.at(this.index) !== NEWLINE) this.index++;
        if (this.at(this.index) === OPEN_BRACE) this.skipGroup(OPEN_BRACE, CLOSE_BRACE);
    }
}

/** Wörter des Fließtexts (Körper zwischen `\begin{document}` und `\end{document}`, sonst der ganze Text) */
export function countWords(text: string): number {
    return new Counter(codes(bodyOf(text))).run();
}
