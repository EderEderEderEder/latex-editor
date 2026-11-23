/**
 * Findet offensichtliche Syntaxfehler: nicht geschlossene oder überzählige Klammern `{ }`, `\begin`/`\end`, die nicht
 * zusammenpassen, und Formeln (`$ … $`, `$$ … $$`, `\( … \)`, `\[ … \]`), die nicht enden. Arbeitet auf Text, aus dem
 * Kommentare, `\verb` und Code schon entfernt sind (`scannable`). Port von `SyntaxChecker.swift`; Vorsicht vor
 * Fehlalarmen: Die Argumente von Definitionen (`\newcommand`, `\newenvironment` …) dürfen ein einzelnes `\begin`
 * oder `\end` enthalten. Offsets sind UTF-16 (wie JavaScript-Strings).
 */
import { scannable } from './masking';

export type Severity = 'hint' | 'warning' | 'error';

/** Eine Markierung im Text: Bereich (UTF-16, Ende exklusiv), Schwere und Erklärung (Tooltip) */
export interface TextMark {
    readonly severity: Severity;
    readonly start: number;
    readonly end: number;
    readonly message: string;
}

export const MAXIMUM_MARK_COUNT = 200;

/** Befehle, deren Argumente Code enthalten, der erst später gesetzt wird */
const DEFINITION_COMMANDS: ReadonlySet<string> = new Set([
    'newcommand', 'renewcommand', 'providecommand', 'DeclareRobustCommand', 'newcommandx', 'renewcommandx',
    'newenvironment', 'renewenvironment', 'NewDocumentCommand', 'RenewDocumentCommand', 'ProvideDocumentCommand',
    'DeclareDocumentCommand', 'NewDocumentEnvironment', 'RenewDocumentEnvironment', 'ProvideDocumentEnvironment',
    'NewEnviron', 'newtcolorbox', 'newtcbtheorem', 'def', 'gdef', 'edef', 'xdef',
]);
const PRIMITIVE_DEFINITIONS: ReadonlySet<string> = new Set(['def', 'gdef', 'edef', 'xdef']);
const MAXIMUM_DEFINITION_ARGUMENTS = 5;
const MAXIMUM_MARK_LENGTH = 24;

const BACKSLASH = 0x5c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const OPEN_PARENTHESIS = 0x28;
const CLOSE_PARENTHESIS = 0x29;
const DOLLAR = 0x24;
const NEWLINE = 0x0a;
const SPACE = 0x20;
const TAB = 0x09;
const STAR = 0x2a;
const AT_SIGN = 0x40;

type MathState = 'none' | 'dollar' | 'displayDollar' | 'parenthesis' | 'bracket';

const MATH_OPENERS: Readonly<Record<MathState, string>> = {
    none: '',
    dollar: '$',
    displayDollar: '$$',
    parenthesis: '\\(',
    bracket: '\\[',
};

interface OpenEnvironment {
    readonly name: string;
    readonly start: number;
    readonly end: number;
}

function isLetter(unit: number): boolean {
    return (unit >= 0x41 && unit <= 0x5a) || (unit >= 0x61 && unit <= 0x7a) || unit === AT_SIGN;
}

function isDigit(unit: number): boolean {
    return unit >= 0x30 && unit <= 0x39;
}

function isBlank(unit: number): boolean {
    return unit === SPACE || unit === TAB;
}

class CheckPass {
    readonly marks: TextMark[] = [];
    private readonly braces: number[] = [];
    private environments: OpenEnvironment[] = [];
    private math: MathState = 'none';
    private mathStart = 0;
    private ignoreEnvironmentsUntil = 0;
    private lineStarts: number[] | null = null;

    constructor(private readonly text: string) {}

    run(): void {
        let index = 0;
        while (index < this.text.length && this.marks.length < MAXIMUM_MARK_COUNT) {
            index = this.step(index);
        }
        this.finish();
    }

    private unit(index: number): number {
        return index < this.text.length ? this.text.charCodeAt(index) : -1;
    }

    private step(index: number): number {
        switch (this.text.charCodeAt(index)) {
            case BACKSLASH:
                return this.command(index);
            case OPEN_BRACE:
                this.braces.push(index);
                return index + 1;
            case CLOSE_BRACE:
                this.closeBrace(index);
                return index + 1;
            case DOLLAR:
                return this.dollar(index);
            case NEWLINE:
                return this.lineBreak(index);
            default:
                return index + 1;
        }
    }

    // Befehle

    private command(start: number): number {
        const next = start + 1;
        if (next >= this.text.length) return next;
        const unit = this.text.charCodeAt(next);
        if (!isLetter(unit)) {
            this.symbolCommand(unit, start);
            return next + 1;
        }
        let end = next;
        while (end < this.text.length && isLetter(this.text.charCodeAt(end))) end++;
        const name = this.text.slice(next, end);
        if (name === 'begin' || name === 'end') return this.environmentCommand(name === 'begin', start, end);
        if (DEFINITION_COMMANDS.has(name)) {
            const definitionEnd = this.definitionEnd(end, PRIMITIVE_DEFINITIONS.has(name));
            this.ignoreEnvironmentsUntil = Math.max(this.ignoreEnvironmentsUntil, definitionEnd);
        }
        return end;
    }

    private symbolCommand(unit: number, start: number): void {
        switch (unit) {
            case OPEN_PARENTHESIS:
                return this.openMath('parenthesis', start);
            case OPEN_BRACKET:
                return this.openMath('bracket', start);
            case CLOSE_PARENTHESIS:
                return this.closeMath('parenthesis', start, 2);
            case CLOSE_BRACKET:
                return this.closeMath('bracket', start, 2);
            default:
        }
    }

    /** `{name}` hinter `\begin` oder `\end`. Die Klammern sind in sich geschlossen und zählen nicht als Klammerpaar. */
    private environmentCommand(isBegin: boolean, commandStart: number, after: number): number {
        let open = after;
        while (open < this.text.length && isBlank(this.text.charCodeAt(open))) open++;
        if (this.unit(open) !== OPEN_BRACE) return after;
        const nameStart = open + 1;
        let close = nameStart;
        while (close < this.text.length && this.unit(close) !== CLOSE_BRACE && this.unit(close) !== NEWLINE) close++;
        if (this.unit(close) !== CLOSE_BRACE) return after;
        const name = this.text.slice(nameStart, close);
        if (commandStart >= this.ignoreEnvironmentsUntil) {
            const environment = { name, start: commandStart, end: close + 1 };
            if (isBegin) this.environments.push(environment);
            else this.endEnvironment(environment);
        }
        return close + 1;
    }

    private endEnvironment(end: OpenEnvironment): void {
        const match = this.environments.map((open) => open.name).lastIndexOf(end.name);
        if (match === -1) {
            this.add(end.start, end.end, `„\\end{${end.name}}“ hat kein passendes „\\begin{${end.name}}“.`);
            return;
        }
        for (const unclosed of this.environments.slice(match + 1)) {
            const line = this.lineNumber(end.start);
            this.add(
                unclosed.start,
                unclosed.end,
                `„\\begin{${unclosed.name}}“ wird nicht geschlossen, bevor „\\end{${end.name}}“ (Zeile ${line}) folgt.`,
            );
        }
        this.environments = this.environments.slice(0, match);
    }

    /** Ende der Argumente einer Definition: bis zu fünf `[…]`- oder `{…}`-Gruppen; bei `\def` bis zur ersten Gruppe */
    private definitionEnd(start: number, isPrimitive: boolean): number {
        let index = start;
        if (isPrimitive) {
            while (index < this.text.length && this.unit(index) !== OPEN_BRACE && this.unit(index) !== NEWLINE) index++;
            return this.unit(index) === OPEN_BRACE ? this.groupEnd(index) : index;
        }
        for (let argument = 0; argument < MAXIMUM_DEFINITION_ARGUMENTS; argument++) {
            while (index < this.text.length && (isBlank(this.unit(index)) || this.unit(index) === STAR)) index++;
            if (index >= this.text.length) break;
            const next = this.skipDefinitionArgument(index);
            if (next === null) return index;
            index = next;
        }
        return index;
    }

    /** Hinter dem Argument bei `index` (`{…}`, `[…]` oder `\name`); `null`, wenn dort keins beginnt */
    private skipDefinitionArgument(index: number): number | null {
        switch (this.unit(index)) {
            case OPEN_BRACE:
                return this.groupEnd(index);
            case OPEN_BRACKET: {
                const close = this.text.indexOf(']', index);
                return close === -1 ? this.text.length : close + 1;
            }
            case BACKSLASH: {
                // `\newcommand\foo{…}`: der Name ohne Klammern
                let end = index + 1;
                while (end < this.text.length && isLetter(this.text.charCodeAt(end))) end++;
                return end;
            }
            default:
                return null;
        }
    }

    private groupEnd(open: number): number {
        let depth = 0;
        let index = open;
        while (index < this.text.length) {
            const unit = this.text.charCodeAt(index);
            if (unit === BACKSLASH) {
                index += 2;
                continue;
            }
            if (unit === OPEN_BRACE) depth++;
            else if (unit === CLOSE_BRACE && --depth === 0) return index + 1;
            index++;
        }
        return this.text.length;
    }

    // Klammern

    private closeBrace(index: number): void {
        if (this.braces.pop() === undefined) this.add(index, index + 1, 'Schließende Klammer „}“ ohne öffnende.');
    }

    // Formeln

    private dollar(start: number): number {
        const isDouble = this.unit(start + 1) === DOLLAR;
        switch (this.math) {
            case 'none':
                this.openMath(isDouble ? 'displayDollar' : 'dollar', start);
                break;
            case 'dollar':
                this.math = 'none';
                return start + 1;
            case 'displayDollar':
                if (!isDouble) return start + 1;
                this.math = 'none';
                break;
            default:
        }
        return isDouble ? start + 2 : start + 1;
    }

    private openMath(kind: MathState, start: number): void {
        if (this.math !== 'none') return;
        this.math = kind;
        this.mathStart = start;
    }

    private closeMath(kind: MathState, start: number, length: number): void {
        if (this.math !== kind) {
            const closer = kind === 'parenthesis' ? '\\)' : '\\]';
            this.add(start, start + length, `„${closer}“ ohne öffnendes „${MATH_OPENERS[kind]}“.`);
            return;
        }
        this.math = 'none';
    }

    /** Eine Formel endet spätestens am Absatz: eine Leerzeile darin ist in LaTeX ein Fehler. */
    private lineBreak(index: number): number {
        let cursor = index + 1;
        while (cursor < this.text.length && isBlank(this.text.charCodeAt(cursor))) cursor++;
        if (this.unit(cursor) === NEWLINE && this.math !== 'none') this.reportOpenMath();
        return index + 1;
    }

    private reportOpenMath(): void {
        const opener = MATH_OPENERS[this.math];
        const end = this.withFollowingWord(this.mathStart, opener.length);
        this.add(this.mathStart, end, `Die Formel wird nicht geschlossen: „${opener}“ ohne passendes Ende vor dem Absatz.`);
        this.math = 'none';
    }

    // Ende

    private finish(): void {
        if (this.math !== 'none') this.reportOpenMath();
        for (const open of this.braces) {
            this.add(open, this.withFollowingWord(open, 1), 'Öffnende Klammer „{“ wird nicht geschlossen.');
        }
        for (const open of this.environments) {
            this.add(open.start, open.end, `„\\begin{${open.name}}“ wird nicht geschlossen.`);
        }
    }

    private add(start: number, end: number, message: string): void {
        this.marks.push({ severity: 'error', start, end, message });
    }

    /** Ein einzelnes Zeichen ist unterstrichen kaum zu sehen: das folgende Wort gehört mit zur Markierung */
    private withFollowingWord(start: number, length: number): number {
        let end = start + length;
        while (end < this.text.length && end - start < MAXIMUM_MARK_LENGTH && this.isWordUnit(end)) end++;
        return end;
    }

    private isWordUnit(index: number): boolean {
        const unit = this.text.charCodeAt(index);
        return isLetter(unit) || isDigit(unit);
    }

    /** 1-basierte Zeile; die Zeilenanfänge werden erst bei der ersten Meldung mit Zeilenangabe berechnet */
    private lineNumber(location: number): number {
        const starts = this.lineStarts ?? this.computeLineStarts();
        let low = 0;
        let high = starts.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if ((starts[middle] ?? 0) <= location) low = middle + 1;
            else high = middle;
        }
        return low;
    }

    private computeLineStarts(): number[] {
        const starts = [0];
        for (let index = 0; index < this.text.length; index++) {
            if (this.text.charCodeAt(index) === NEWLINE) starts.push(index + 1);
        }
        this.lineStarts = starts;
        return starts;
    }
}

/** Prüft schon maskierten Text (`scannable`); höchstens `MAXIMUM_MARK_COUNT` Markierungen, nach Position sortiert */
export function syntaxMarks(masked: string): TextMark[] {
    const pass = new CheckPass(masked);
    pass.run();
    return pass.marks.slice(0, MAXIMUM_MARK_COUNT).sort((a, b) => a.start - b.start);
}

/** Wie `syntaxMarks`, maskiert den Text selbst (Kommentare, `\verb` und Code zählen nicht) */
export function checkSyntax(text: string): TextMark[] {
    return syntaxMarks(scannable(text));
}
