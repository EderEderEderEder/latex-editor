// Wegwerf-Tokenizer für Spike S1: ähnelt dem Swift-`LatexTokenizer` (Zeile für Zeile,
// Zustand am Zeilenende), ist aber bewusst vereinfacht. Beide Varianten (StreamLanguage
// und ViewPlugin) benutzen denselben Schritt `scanToken`, damit der Vergleich fair ist.

export type TokenKind = 'command' | 'delimiter' | 'keyArgument' | 'math' | 'comment' | 'verbatim';

/**
 * Zustand als kurze Zeichenkette (billig zu vergleichen und zu kopieren):
 * `n` normal, `m$` `m$$` `m(` `m[` offene Mathe, `e:<name>` Mathe-Umgebung,
 * `v:<name>` Verbatim-Umgebung, `c:<name>` Kommentar-Umgebung.
 * Nur innerhalb einer Zeile: `k` (Befehl mit Schlüssel-Argument gelesen), `K` (in `{…}`).
 */
export type LexState = string;

export const NORMAL_STATE: LexState = 'n';
const KEY_PENDING_STATE: LexState = 'k';
const KEY_INSIDE_STATE: LexState = 'K';

export interface ScanResult {
    end: number;
    kind: TokenKind | null;
    state: LexState;
}

export interface LineToken {
    from: number;
    to: number;
    kind: TokenKind;
}

const CHAR_BACKSLASH = 92;
const CHAR_PERCENT = 37;
const CHAR_DOLLAR = 36;
const CHAR_OPEN_BRACE = 123;
const CHAR_CLOSE_BRACE = 125;
const CHAR_OPEN_BRACKET = 91;
const CHAR_CLOSE_BRACKET = 93;
const CHAR_OPEN_PAREN = 40;
const CHAR_CLOSE_PAREN = 41;
const CHAR_STAR = 42;

const KEY_ARGUMENT_COMMANDS = new Set([
    'label', 'ref', 'eqref', 'pageref', 'autoref', 'cref', 'cite', 'citep', 'citet',
    'end', 'usepackage', 'documentclass', 'input', 'include', 'includegraphics',
    'bibliography', 'addbibresource', 'url', 'href', 'newcommand', 'setlength',
]);

const MATH_ENVIRONMENTS = new Set([
    'equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline',
    'multline*', 'flalign', 'flalign*', 'eqnarray', 'displaymath', 'math',
]);

const VERBATIM_ENVIRONMENTS = new Set(['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted']);
const COMMENT_ENVIRONMENT = 'comment';

const shared: ScanResult = { end: 0, kind: null, state: NORMAL_STATE };

function result(end: number, kind: TokenKind | null, state: LexState): ScanResult {
    shared.end = end;
    shared.kind = kind;
    shared.state = state;
    return shared;
}

function isLetter(code: number): boolean {
    return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 64;
}

function isSpecial(code: number): boolean {
    return code === CHAR_BACKSLASH || code === CHAR_PERCENT || code === CHAR_DOLLAR
        || code === CHAR_OPEN_BRACE || code === CHAR_CLOSE_BRACE
        || code === CHAR_OPEN_BRACKET || code === CHAR_CLOSE_BRACKET;
}

function isBlank(line: string): boolean {
    return line.trim().length === 0;
}

function endsAtBlankLine(state: LexState): boolean {
    return state.startsWith('m') || state.startsWith('e:');
}

/** Anfangszustand einer Zeile: eine Leerzeile beendet offene Mathe (wie in Swift). */
export function beginLine(line: string, state: LexState): LexState {
    return endsAtBlankLine(state) && isBlank(line) ? NORMAL_STATE : state;
}

/** Zeilen-interne Zustände gelten nicht über das Zeilenende hinaus. */
export function endLine(state: LexState): LexState {
    return state === KEY_PENDING_STATE || state === KEY_INSIDE_STATE ? NORMAL_STATE : state;
}

/** Liest genau ein Token ab `pos` (oder einen Lauf ohne Token, `kind === null`). Immer `end > pos`. */
export function scanToken(line: string, pos: number, state: LexState): ScanResult {
    if (state === NORMAL_STATE) return scanNormal(line, pos);
    if (state === KEY_PENDING_STATE) return scanKeyPending(line, pos);
    if (state === KEY_INSIDE_STATE) return scanKeyInside(line, pos);
    if (state.startsWith('v:')) return scanRawEnvironment(line, pos, state, 'verbatim');
    if (state.startsWith('c:')) return scanRawEnvironment(line, pos, state, 'comment');
    return scanMath(line, pos, state);
}

function scanNormal(line: string, pos: number): ScanResult {
    const code = line.charCodeAt(pos);
    if (code === CHAR_PERCENT) return result(line.length, 'comment', NORMAL_STATE);
    if (code === CHAR_BACKSLASH) return scanBackslash(line, pos);
    if (code === CHAR_DOLLAR) {
        const isDisplay = line.charCodeAt(pos + 1) === CHAR_DOLLAR;
        return result(pos + (isDisplay ? 2 : 1), 'math', isDisplay ? 'm$$' : 'm$');
    }
    if (isSpecial(code)) return result(pos + 1, 'delimiter', NORMAL_STATE);
    let end = pos + 1;
    while (end < line.length && !isSpecial(line.charCodeAt(end))) end++;
    return result(end, null, NORMAL_STATE);
}

function scanBackslash(line: string, pos: number): ScanResult {
    const next = line.charCodeAt(pos + 1);
    if (next === CHAR_OPEN_BRACKET) return result(pos + 2, 'math', 'm[');
    if (next === CHAR_OPEN_PAREN) return result(pos + 2, 'math', 'm(');
    if (!isLetter(next)) return result(Math.min(pos + 2, line.length), 'command', NORMAL_STATE);
    let nameEnd = pos + 1;
    while (nameEnd < line.length && isLetter(line.charCodeAt(nameEnd))) nameEnd++;
    const name = line.slice(pos + 1, nameEnd);
    if (line.charCodeAt(nameEnd) === CHAR_STAR) nameEnd++;
    if (name === 'begin') return scanBegin(line, pos, nameEnd);
    const followedByBrace = line.charCodeAt(nameEnd) === CHAR_OPEN_BRACE;
    const state = followedByBrace && KEY_ARGUMENT_COMMANDS.has(name) ? KEY_PENDING_STATE : NORMAL_STATE;
    return result(nameEnd, 'command', state);
}

/** `\begin{name}` als ein Token; der Umgebungsname bestimmt den Folgezustand. */
function scanBegin(line: string, pos: number, nameEnd: number): ScanResult {
    if (line.charCodeAt(nameEnd) !== CHAR_OPEN_BRACE) return result(nameEnd, 'command', NORMAL_STATE);
    const close = line.indexOf('}', nameEnd + 1);
    if (close < 0) return result(line.length, 'command', NORMAL_STATE);
    const environment = line.slice(nameEnd + 1, close);
    return result(close + 1, 'command', stateAfterBegin(environment));
}

function stateAfterBegin(environment: string): LexState {
    if (MATH_ENVIRONMENTS.has(environment)) return `e:${environment}`;
    if (VERBATIM_ENVIRONMENTS.has(environment)) return `v:${environment}`;
    if (environment === COMMENT_ENVIRONMENT) return `c:${environment}`;
    return NORMAL_STATE;
}

function scanKeyPending(line: string, pos: number): ScanResult {
    if (line.charCodeAt(pos) === CHAR_OPEN_BRACE) return result(pos + 1, 'delimiter', KEY_INSIDE_STATE);
    return scanNormal(line, pos);
}

function scanKeyInside(line: string, pos: number): ScanResult {
    if (line.charCodeAt(pos) === CHAR_CLOSE_BRACE) return result(pos + 1, 'delimiter', NORMAL_STATE);
    const close = line.indexOf('}', pos);
    const end = close < 0 ? line.length : close;
    return result(end, 'keyArgument', close < 0 ? NORMAL_STATE : KEY_INSIDE_STATE);
}

function scanRawEnvironment(line: string, pos: number, state: LexState, kind: TokenKind): ScanResult {
    const closer = `\\end{${state.slice(2)}}`;
    const close = line.indexOf(closer, pos);
    if (close === pos) return result(pos + closer.length, 'command', NORMAL_STATE);
    if (close < 0) return result(line.length, kind, state);
    return result(close, kind, state);
}

function scanMath(line: string, pos: number, state: LexState): ScanResult {
    if (line.charCodeAt(pos) === CHAR_PERCENT) return result(line.length, 'comment', state);
    let index = pos;
    while (index < line.length) {
        const code = line.charCodeAt(index);
        if (code === CHAR_PERCENT) return result(index, 'math', state);
        const closeEnd = mathCloseEnd(line, index, code, state);
        if (closeEnd > 0) return result(closeEnd, 'math', NORMAL_STATE);
        index += code === CHAR_BACKSLASH ? 2 : 1;
    }
    return result(line.length, 'math', state);
}

/** Ende des schließenden Mathe-Begrenzers an `index` oder 0, wenn dort keiner steht. */
function mathCloseEnd(line: string, index: number, code: number, state: LexState): number {
    if (code === CHAR_DOLLAR) {
        if (state === 'm$') return index + 1;
        if (state === 'm$$' && line.charCodeAt(index + 1) === CHAR_DOLLAR) return index + 2;
        return 0;
    }
    if (code !== CHAR_BACKSLASH) return 0;
    const next = line.charCodeAt(index + 1);
    if (state === 'm[' && next === CHAR_CLOSE_BRACKET) return index + 2;
    if (state === 'm(' && next === CHAR_CLOSE_PAREN) return index + 2;
    if (!state.startsWith('e:')) return 0;
    const closer = `\\end{${state.slice(2)}}`;
    return line.startsWith(closer, index) ? index + closer.length : 0;
}

/** Ganze Zeile zerlegen; gibt den Endzustand zurück. `out === null`: nur Zustand berechnen. */
export function tokenizeLine(line: string, start: LexState, out: LineToken[] | null): LexState {
    let state = beginLine(line, start);
    let pos = 0;
    while (pos < line.length) {
        const scanned = scanToken(line, pos, state);
        if (out !== null && scanned.kind !== null) out.push({ from: pos, to: scanned.end, kind: scanned.kind });
        pos = scanned.end;
        state = scanned.state;
    }
    return endLine(state);
}
