// Wörter für die Rechtschreibprüfung aus LaTeX- oder BibTeX-Text (W7-2, nach Spike S8 `words.ts`). Wie Swift
// (`EditorCoordinator.textView(_:didCheckTextIn:…)`, `LatexTextView.setSpellingState`) zählt ein Wort nicht, wenn ein
// Token des Tokenizers es überlappt: Befehl, Schlüssel-Argument, optionales Argument, Formel, Kommentar, Verbatim/Code;
// in BibTeX Eintragstyp, Schlüssel, Feldname und Text außerhalb der Einträge (geprüft werden nur Feldwerte).
// Wie die Systemprüfung von macOS bleiben außerdem ungeprüft: Wörter mit Ziffern (`MP3`), Großbuchstaben nach dem
// ersten Buchstaben (Kürzel `PDF`, `PDFs`, Namen wie `LaTeX`), URLs, E-Mail-Adressen, Dateinamen (`main.tex`),
// Bezeichner mit `_` und Wortreste an Akzent-Befehlen (`M\"uller`). Bindestrich-Wörter prüft der Aufrufer als Ganzes
// und, wenn das Ganze unbekannt ist, in Teilen (`E-Mail-Adresse`).
import { INITIAL_BIB_STATE, tokenizeBibLine } from '../bib/tokenizer';
import type { BibLexState } from '../bib/tokenizer';
import type { SyntaxLanguage } from '../language';
import { NORMAL_STATE, tokenizeLineWithOffset } from '../latex/tokenizer';
import type { LexState } from '../latex/tokenizer';

/** Tokenizer-Zustand am Anfang des Textes (LaTeX oder BibTeX, je nach Sprache) */
export type SpellStartState = LexState | BibLexState;

export interface WordPart {
    readonly word: string;
    readonly from: number;
    readonly to: number;
}

export interface SpellCandidate {
    /** Ganzes Wort samt Bindestrichen (`E-Mail-Adresse`); bei einfachen Wörtern gleich dem einzigen Teil */
    readonly text: string;
    /** Zu prüfende Teile; Teile mit Ziffern, Kürzel und Syntax fehlen */
    readonly parts: readonly WordPart[];
    readonly hyphenated: boolean;
    /** Folgt direkt ein Punkt? Abkürzungen stehen mit Punkt im Wörterbuch (`bzw.`) */
    readonly followedByDot: boolean;
}

export interface ScanOptions {
    readonly language: SyntaxLanguage;
    /** Lage des Textanfangs im Dokument (UTF-16); Ergebnisse sind absolut */
    readonly offset?: number;
    readonly startState?: SpellStartState;
}

/** Syntax-Bereich einer Zeile (absolut); `accent`: Akzent-/Sonderzeichen-Befehl wie `\"`, `\ss`, `\%` */
interface SyntaxSpan {
    readonly from: number;
    readonly to: number;
    readonly accent: boolean;
}

interface LineSyntax {
    readonly spans: readonly SyntaxSpan[];
    readonly state: SpellStartState;
}

const LINE_BREAK = '\n';
const HYPHEN = '-';
const DOT = '.';
const MINIMUM_WORD_LENGTH = 2;
/** Folge aus Buchstaben/Ziffern, Teile mit Bindestrich verbunden */
const CHUNK_PATTERN = /[\p{L}\p{M}\p{N}]+(?:-[\p{L}\p{M}\p{N}]+)*/gu;
const DIGIT_PATTERN = /\p{N}/u;
const UPPERCASE_PATTERN = /\p{Lu}/u;
/** Akzente und Sonderzeichen: `\"u`, `\'e`, `\ss`, `\o`, `\%`, `\&`; nicht `\\` (Zeilenumbruch) */
const ACCENT_COMMAND_PATTERN = /^\\(?:[^a-zA-Z\\]|ss|aa|AA|ae|AE|oe|OE|o|O|l|L|i|j)$/;
const SKIPPED_PATTERNS: readonly RegExp[] = [
    // URL mit Schema oder `www.`
    /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.)[^\s{}\\]+/giu,
    // E-Mail-Adresse
    /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu,
    // Dateiname mit Endung in Kleinbuchstaben (`main.tex`, `kapitel/einleitung.tex`)
    /(?<![\p{L}\p{N}])(?:[\p{L}\p{N}_-]+[/\\])*[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*\.[a-z][a-z0-9]{0,4}(?![\p{L}\p{N}])/gu,
    // Bezeichner mit Unterstrich (`file_name`)
    /[\p{L}\p{N}]*_[\p{L}\p{N}_]*/gu,
];

function latexLine(line: string, offset: number, state: LexState): LineSyntax {
    const result = tokenizeLineWithOffset(line, offset, state);
    const spans = result.tokens.map((token) => {
        const from = token.location;
        const to = from + token.length;
        const accent = token.kind === 'command' && ACCENT_COMMAND_PATTERN.test(line.slice(from - offset, to - offset));
        return { from, to, accent };
    });
    return { spans, state: result.state };
}

function bibLine(line: string, offset: number, state: BibLexState): LineSyntax {
    const result = tokenizeBibLine(line, offset, state);
    const spans = result.tokens.map((token) => ({
        from: token.from,
        to: token.to,
        accent: token.kind === 'command' && ACCENT_COMMAND_PATTERN.test(line.slice(token.from - offset, token.to - offset)),
    }));
    return { spans, state: result.state };
}

function isBibState(state: SpellStartState): state is BibLexState {
    return typeof state === 'object' && 'phase' in state;
}

function tokenizeSpellLine(language: SyntaxLanguage, line: string, offset: number, state: SpellStartState): LineSyntax {
    if (language === 'bibtex') return bibLine(line, offset, isBibState(state) ? state : INITIAL_BIB_STATE);
    return latexLine(line, offset, isBibState(state) ? NORMAL_STATE : state);
}

/** Bereiche (absolut), deren Wörter nie geprüft werden: URLs, E-Mail, Dateinamen, Bezeichner */
function skippedRanges(line: string, offset: number): [number, number][] {
    const ranges: [number, number][] = [];
    for (const pattern of SKIPPED_PATTERNS) {
        for (const match of line.matchAll(pattern)) {
            if (match[0].length > 0) ranges.push([offset + match.index, offset + match.index + match[0].length]);
        }
    }
    return ranges;
}

function overlaps(from: number, to: number, start: number, end: number): boolean {
    return start < to && end > from;
}

/** Wird dieser Teil geprüft? Länge, Ziffern, Großbuchstaben im Wortinneren */
export function isCheckableWord(word: string): boolean {
    if (word.length < MINIMUM_WORD_LENGTH || DIGIT_PATTERN.test(word)) return false;
    return !UPPERCASE_PATTERN.test(word.slice(1));
}

function isOutsideSyntax(part: WordPart, spans: readonly SyntaxSpan[]): boolean {
    return !spans.some((span) =>
        overlaps(part.from, part.to, span.from, span.to) || (span.accent && (span.to === part.from || span.from === part.to)));
}

function partsOf(chunk: string, from: number, spans: readonly SyntaxSpan[]): WordPart[] {
    const parts: WordPart[] = [];
    let start = from;
    for (const word of chunk.split(HYPHEN)) {
        const part = { word, from: start, to: start + word.length };
        if (isCheckableWord(word) && isOutsideSyntax(part, spans)) parts.push(part);
        start = part.to + HYPHEN.length;
    }
    return parts;
}

function candidatesInLine(line: string, offset: number, spans: readonly SyntaxSpan[]): SpellCandidate[] {
    const candidates: SpellCandidate[] = [];
    const skipped = skippedRanges(line, offset);
    for (const match of line.matchAll(CHUNK_PATTERN)) {
        const text = match[0];
        const from = offset + match.index;
        if (skipped.some(([start, end]) => overlaps(from, from + text.length, start, end))) continue;
        const parts = partsOf(text, from, spans);
        if (parts.length === 0) continue;
        const followedByDot = line[match.index + text.length] === DOT;
        candidates.push({ text, parts, hyphenated: text.includes(HYPHEN), followedByDot });
    }
    return candidates;
}

/** Zu prüfende Wörter des Textes (Zeilen mit `\n`), Lage absolut ab `offset` */
export function scanSpellCandidates(text: string, options: ScanOptions): SpellCandidate[] {
    const { language } = options;
    const candidates: SpellCandidate[] = [];
    let state: SpellStartState = options.startState ?? (language === 'bibtex' ? INITIAL_BIB_STATE : NORMAL_STATE);
    let offset = options.offset ?? 0;
    for (const line of text.split(LINE_BREAK)) {
        const syntax = tokenizeSpellLine(language, line, offset, state);
        candidates.push(...candidatesInLine(line, offset, syntax.spans));
        state = syntax.state;
        offset += line.length + LINE_BREAK.length;
    }
    return candidates;
}
