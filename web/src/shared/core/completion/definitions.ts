/**
 * Eigene Makros und Umgebungen aus Projektdateien (`.tex`, `.cls`, `.sty`) und die offenen Umgebungen vor dem
 * Cursor (für `\end{`). Kommentare zählen nie. Offsets sind UTF-16-Einheiten.
 */
import { isInComment, maskComments } from '../latex/comments';

/** `\newcommand{\x}`, `\newcommand\x`, `\def\x` …; interne Namen mit `@` (`\intern@x`) bleiben draußen */
const COMMAND_DEFINITION =
    /\\(?:newcommand|renewcommand|providecommand|DeclareRobustCommand|NewDocumentCommand|DeclareMathOperator|def)\*?\s*\{?\\([A-Za-z]+)(?![A-Za-z@])/g;
const ENVIRONMENT_DEFINITION =
    /\\(?:newenvironment|renewenvironment|NewDocumentEnvironment|lstnewenvironment|newtheorem|begin)\*?\s*\{([A-Za-z]+\*?)\}/g;
const BEGIN_OR_END = /\\(begin|end)\s*\{([^}]*)\}/g;
/** Weiter zurück wird nicht gesucht (eine Umgebung über Hunderttausende Zeichen ist kein Fall für `\end{`) */
const MAXIMUM_LOOK_BEHIND = 200_000;
const BEGIN = 'begin';

function firstGroups(expression: RegExp, text: string): Set<string> {
    const names = new Set<string>();
    for (const match of maskComments(text).matchAll(expression)) {
        const name = match[1];
        if (name !== undefined) names.add(name);
    }
    return names;
}

/** Namen (ohne `\`) der Befehle, die der Text definiert */
export function definedCommands(text: string): Set<string> {
    return firstGroups(COMMAND_DEFINITION, text);
}

/** Namen der Umgebungen, die der Text definiert oder benutzt (`\begin{name}`) */
export function definedEnvironments(text: string): Set<string> {
    return firstGroups(ENVIRONMENT_DEFINITION, text);
}

function lineStartOf(text: string, index: number): number {
    if (index === 0) return 0;
    return Math.max(text.lastIndexOf('\n', index - 1), text.lastIndexOf('\r', index - 1)) + 1;
}

/** Offene Umgebungen vor dem Cursor, außen zuerst; `end` schließt die innerste gleichnamige samt allem darüber */
export function openEnvironments(text: string, cursor: number = text.length): string[] {
    const start = Math.max(0, cursor - MAXIMUM_LOOK_BEHIND);
    const stack: string[] = [];
    for (const match of text.slice(start, cursor).matchAll(BEGIN_OR_END)) {
        const location = start + match.index;
        if (isInComment(text, lineStartOf(text, location), location)) continue;
        const name = match[2] ?? '';
        if (match[1] === BEGIN) {
            stack.push(name);
            continue;
        }
        const index = stack.lastIndexOf(name);
        if (index !== -1) stack.splice(index);
    }
    return stack;
}
