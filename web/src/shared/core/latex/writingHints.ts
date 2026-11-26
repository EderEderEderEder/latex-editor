/**
 * Schreibhinweise im Fließtext (blau gepunktet unterstrichen, Erklärung im Tooltip). Kein Fehler: LaTeX kompiliert
 * trotzdem. Port von `WritingHints.swift` (dort ist die Wahrheit): einfache, verlässliche Regeln statt einer
 * Grammatikprüfung. Geprüft wird nur Fließtext: nicht in der Präambel, nicht in Befehlen, Schlüsseln, Optionen, Mathe,
 * Kommentaren, Code und `\verb`. Reine Logik, UTF-16-Positionen.
 *
 * Die Ausdrücke sind ICU-Ausdrücke aus Swift in JavaScript-Schreibweise (Flag `u`): `\d` ist dort `\p{Nd}`, `\s` die
 * Klasse `ICU_SPACE`, `^`/`$` im Mehrzeilenmodus `ICU_LINE_START`/`ICU_LINE_END`.
 */
import { fixingTwoInitialCapitals, isAllLowercase, startsSentence } from './capitalization';
import { scannable } from './masking';
import { ICU_LINE_START, ICU_SPACE } from './references';
import { type LexState, NORMAL_STATE, type SyntaxToken, tokenizeLineWithOffset } from './tokenizer';

export type WritingHintKind =
    | 'repeatedWord'
    | 'spaceBeforePunctuation'
    | 'missingSpace'
    | 'multipleSpaces'
    | 'abbreviationSpacing'
    | 'ellipsis'
    | 'straightQuote'
    | 'lowercaseSentenceStart'
    | 'twoInitialCapitals';

/** Ein Hinweis; der Bereich ist UTF-16 mit exklusivem Ende */
export interface WritingHint {
    readonly kind: WritingHintKind;
    readonly start: number;
    readonly end: number;
    readonly message: string;
}

export const MAXIMUM_HINT_COUNT = 1_000;
const DOCUMENT_BEGIN = '\\begin{document}';
/** Ersatz für `$` im Mehrzeilenmodus von ICU: Textende oder vor einem Zeilenende (nicht mitten in `\r\n`) */
const ICU_LINE_END = '(?:(?![^])|(?=[\\v\\f\\r\\u0085\\u2028\\u2029])|(?<!\\r)(?=\\n))';
const SPACE = ICU_SPACE;
const STRAIGHT_QUOTE_MESSAGE = 'Gerade Anführungszeichen: besser \\enquote{…} oder „…“.';
const STRAIGHT_QUOTE_BEFORE_LETTER = /^"\p{L}/u;

interface Rule {
    readonly kind: WritingHintKind;
    readonly pattern: RegExp;
    /** 0 = ganzer Treffer. Die Gruppe steht am Ende des Treffers (danach nur Vorausschau), so ergibt sich ihr Anfang. */
    readonly group: number;
    /** Meldung zum Treffer; `null` verwirft ihn. `groupStart` ist absolut im Gesamttext. */
    readonly message: (match: RegExpExecArray, groupStart: number, masked: string) => string | null;
}

function upperFirst(word: string): string {
    const [first = ''] = Array.from(word);
    return first.toUpperCase() + word.slice(first.length);
}

const RULES: readonly Rule[] = [
    {
        kind: 'repeatedWord',
        pattern: /(?<![\p{L}\\])(\p{L}{2,})(?:[ \t]+|[ \t]*\n[ \t]*)(\1)(?!\p{L})/giu,
        group: 2,
        message: (match) => `„${match[2]}“ steht zweimal hintereinander.`,
    },
    {
        kind: 'spaceBeforePunctuation',
        pattern: /(?<=[\p{L}\}])[ \t]+(?=[,;:!?]|\.(?![.\p{Nd}]))/gu,
        group: 0,
        message: () => 'Leerzeichen vor dem Satzzeichen.',
    },
    {
        kind: 'missingSpace',
        pattern: /(?<=\p{L})[,;](?=\p{L})|(?<=\p{Ll}\p{Ll})\.(?=\p{Lu}\p{Ll})/gu,
        group: 0,
        message: (match) => `Nach „${match[0]}“ fehlt ein Leerzeichen.`,
    },
    {
        kind: 'multipleSpaces',
        pattern: /(?<=[\p{L}\p{Nd}.,;:!?)\}])[ ]{2,}(?=[\p{L}\p{Nd}(\\])/gu,
        group: 0,
        message: () => 'Mehrere Leerzeichen hintereinander (im PDF wirkt nur eines).',
    },
    {
        kind: 'abbreviationSpacing',
        pattern: /(?<![\p{L}\\.])(\p{L})\.( ?)(\p{L})\.(?!\p{L})/gu,
        group: 0,
        message: abbreviationMessage,
    },
    {
        kind: 'ellipsis',
        pattern: /(?<![.\\])\.\.\.(?!\.)/gu,
        group: 0,
        message: () => 'Auslassungspunkte mit \\dots setzen (gleichmäßige Abstände).',
    },
    {
        kind: 'straightQuote',
        pattern: new RegExp(
            `(?:${ICU_LINE_START}|(?<=[${SPACE}(]))"(?=\\p{L})|(?<=[\\p{L}.,!?])"(?=[${SPACE}.,;:!?)]|${ICU_LINE_END})`, 'gu',
        ),
        group: 0,
        message: () => STRAIGHT_QUOTE_MESSAGE,
    },
    {
        kind: 'lowercaseSentenceStart',
        pattern: new RegExp(
            `(?:[.!?](?:[ \\t]+\\n?|\\n)[ \\t]*|\\n[ \\t]*\\n[${SPACE}]*)(\\p{Ll}\\p{L}*)(?![\\p{L}\\p{Nd}\\\\{])`, 'gu',
        ),
        group: 1,
        message: lowercaseSentenceMessage,
    },
    {
        kind: 'twoInitialCapitals',
        pattern: /(?<![\p{L}\\])\p{Lu}\p{Lu}\p{Ll}+(?!\p{L})/gu,
        group: 0,
        message: (match) => {
            const fixed = fixingTwoInitialCapitals(match[0]);
            return fixed === null ? null : `Zwei Großbuchstaben am Wortanfang: „${fixed}“?`;
        },
    },
];

function abbreviationMessage(match: RegExpExecArray): string | null {
    const [, first = '', , second = ''] = match;
    // Zwei Großbuchstaben sind meist Initialen („J. R.“)
    if (first.toLowerCase() !== first) return null;
    return `Abkürzung mit schmalem Abstand setzen: ${first}.\\,${second}.`;
}

function lowercaseSentenceMessage(match: RegExpExecArray, groupStart: number, masked: string): string | null {
    const word = match[1] ?? '';
    if (!isAllLowercase(word) || !startsSentence(masked, groupStart)) return null;
    return `Satzanfang klein geschrieben: „${upperFirst(word)}“?`;
}

/** Tokens des Syntaxfärbers zeilenweise bei Bedarf (Zustand läuft von oben nach unten), mit Zwischenspeicher */
class TokenIndex {
    private readonly lineStarts: number[] = [0];
    private readonly tokensByLine: SyntaxToken[][] = [];
    private state: LexState = NORMAL_STATE;

    constructor(private readonly text: string) {
        for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) this.lineStarts.push(index + 1);
    }

    /** Berührt ein Token den Bereich (Anfang inklusive, Ende exklusive)? */
    overlaps(start: number, end: number): boolean {
        const lastLine = this.lineOf(Math.max(start, end - 1));
        this.tokenizeThrough(lastLine);
        for (let line = this.lineOf(start); line <= lastLine; line++) {
            const touching = (this.tokensByLine[line] ?? []).some((token) => token.location < end && token.location + token.length > start);
            if (touching) return true;
        }
        return false;
    }

    private lineOf(offset: number): number {
        let low = 0;
        let high = this.lineStarts.length;
        while (low < high) {
            const middle = (low + high) >> 1;
            if ((this.lineStarts[middle] ?? 0) <= offset) low = middle + 1;
            else high = middle;
        }
        return low - 1;
    }

    private tokenizeThrough(lastLine: number): void {
        while (this.tokensByLine.length <= lastLine) {
            const line = this.tokensByLine.length;
            const start = this.lineStarts[line] ?? 0;
            const next = this.lineStarts[line + 1];
            const content = this.text.slice(start, next === undefined ? this.text.length : next - 1);
            const result = tokenizeLineWithOffset(content, start, this.state);
            this.tokensByLine.push(result.tokens);
            this.state = result.state;
        }
    }
}

/** Nicht maskiert (kein Kommentar/Code) und kein Syntax-Token (Befehl, Schlüssel, Mathe …) */
function isProse(text: string, masked: string, tokens: TokenIndex, start: number, end: number): boolean {
    if (end <= start || text.slice(start, end) !== masked.slice(start, end)) return false;
    return !tokens.overlaps(start, end);
}

function groupStartOf(match: RegExpExecArray, group: number): number {
    if (group === 0) return match.index;
    return match.index + match[0].length - (match[group] ?? '').length;
}

/**
 * Gesucht wird ab `bodyStart` im ganzen Text: Rückblicke sehen wie bei `NSRegularExpression` auch den Text davor
 * (z. B. das `}` von `\begin{document}`).
 */
function hintsOfRule(rule: Rule, text: string, masked: string, bodyStart: number, tokens: TokenIndex): WritingHint[] {
    const hints: WritingHint[] = [];
    rule.pattern.lastIndex = bodyStart;
    for (let match = rule.pattern.exec(masked); match !== null; match = rule.pattern.exec(masked)) {
        const start = groupStartOf(match, rule.group);
        const end = start + (match[rule.group] ?? '').length;
        if (!isProse(text, masked, tokens, start, end)) continue;
        const message = rule.message(match, start, masked);
        if (message !== null) hints.push({ kind: rule.kind, start, end, message });
    }
    return hints;
}

/** `^` trifft in Swift auch am Anfang des Suchbereichs: ein `"` direkt hinter `\begin{document}` vor einem Buchstaben */
function quoteAtBodyStart(masked: string, bodyStart: number, text: string, tokens: TokenIndex): WritingHint[] {
    if (bodyStart === 0 || !STRAIGHT_QUOTE_BEFORE_LETTER.test(masked.slice(bodyStart, bodyStart + 3))) return [];
    if (!isProse(text, masked, tokens, bodyStart, bodyStart + 1)) return [];
    return [{ kind: 'straightQuote', start: bodyStart, end: bodyStart + 1, message: STRAIGHT_QUOTE_MESSAGE }];
}

/**
 * Alle Hinweise eines .tex-Texts, nach Position sortiert (höchstens `MAXIMUM_HINT_COUNT`). `masked` darf der Aufrufer
 * mitgeben, wenn er `scannable(text)` ohnehin schon hat. Geprüft wird ab dem Ende von `\begin{document}`.
 */
export function writingHints(text: string, masked: string = scannable(text)): WritingHint[] {
    const begin = masked.indexOf(DOCUMENT_BEGIN);
    const bodyStart = begin === -1 ? 0 : begin + DOCUMENT_BEGIN.length;
    const tokens = new TokenIndex(text);
    const hints = [
        ...RULES.flatMap((rule) => hintsOfRule(rule, text, masked, bodyStart, tokens)),
        ...quoteAtBodyStart(masked, bodyStart, text, tokens),
    ];
    hints.sort((first, second) => first.start - second.start);
    return hints.slice(0, MAXIMUM_HINT_COUNT);
}
