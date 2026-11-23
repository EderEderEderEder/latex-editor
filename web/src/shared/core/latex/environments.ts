/**
 * Umgebungsnamen, deren Inhalt kein Fließtext ist. Gemeinsam für Tokenizer, Wortzähler und Verweisprüfung.
 * Reine Logik, ohne DOM und ohne Node-Importe.
 */

const VERBATIM_LIKE: ReadonlySet<string> = new Set(['verbatim', 'verbatim*', 'lstlisting', 'minted', 'comment', 'Verbatim']);
const MATH: ReadonlySet<string> = new Set([
    'equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*', 'gather', 'gather*', 'multline', 'multline*',
    'flalign', 'flalign*', 'eqnarray', 'eqnarray*', 'displaymath', 'math', 'split',
]);
const GRAPHICS: ReadonlySet<string> = new Set(['tikzpicture', 'pgfpicture']);
/** Sprachumgebungen der HgbThesis (`PythonCode`, `JavaCode` …) */
const CODE_SUFFIX = 'Code';
const MAXIMUM_NAME_LENGTH = 40;
const BEGIN_OPEN = '\\begin{';

/** Quelltext, der abgedruckt statt gesetzt wird (`%` oder `\ref` sind dort keine LaTeX-Befehle) */
export function isCodeEnvironment(name: string): boolean {
    return VERBATIM_LIKE.has(name) || (name.endsWith(CODE_SUFFIX) && name.length > CODE_SUFFIX.length);
}

export function isMathEnvironment(name: string): boolean {
    return MATH.has(name);
}

/** Inhalt zählt nicht als Text (Code, Formeln, Zeichnungen) */
export function skipsContent(name: string): boolean {
    return isCodeEnvironment(name) || isMathEnvironment(name) || GRAPHICS.has(name);
}

/**
 * Liegt `location` im Inhalt einer offenen Code-Umgebung? Sucht rückwärts nach dem letzten `\begin{…}` einer
 * Code-Umgebung ohne zugehöriges `\end`. Nur für seltene Einzelprüfungen gedacht (linear im Text).
 */
export function isInsideCode(text: string, location: number): boolean {
    let searchEnd = Math.min(location, text.length);
    while (searchEnd > 0) {
        const found = text.lastIndexOf(BEGIN_OPEN, searchEnd - BEGIN_OPEN.length);
        if (found === -1) return false;
        searchEnd = found;
        const nameStart = found + BEGIN_OPEN.length;
        const close = findNameClose(text, nameStart);
        if (close === -1) continue;
        const name = text.slice(nameStart, close);
        if (!isCodeEnvironment(name)) continue;
        return isEnvironmentOpenAt(text, name, close + 1, location);
    }
    return false;
}

function findNameClose(text: string, nameStart: number): number {
    const close = text.indexOf('}', nameStart);
    const windowEnd = Math.min(nameStart + MAXIMUM_NAME_LENGTH, text.length);
    return close === -1 || close >= windowEnd ? -1 : close;
}

function isEnvironmentOpenAt(text: string, name: string, bodyStart: number, location: number): boolean {
    if (bodyStart > location) return false;
    const endCommand = `\\end{${name}}`;
    const end = text.indexOf(endCommand, bodyStart);
    return end === -1 || end + endCommand.length > location;
}
