// Synthetische LaTeX-Testdokumente (deterministisch, keine echten Inhalte).

const RANDOM_SEED = 20261122;
const MIN_WORDS_PER_LINE = 10;
const MAX_EXTRA_WORDS = 6;
const MIN_PARAGRAPH_LINES = 3;
const MAX_EXTRA_PARAGRAPH_LINES = 4;
const PARAGRAPHS_PER_SECTION = 6;
const INLINE_SNIPPET_PROBABILITY = 0.12;
const BLOCK_PROBABILITY = 0.5;

const WORDS = [
    'die', 'Messung', 'zeigt', 'dass', 'das', 'Verfahren', 'unter', 'realen', 'Bedingungen',
    'stabil', 'bleibt', 'und', 'eine', 'Abweichung', 'von', 'weniger', 'als', 'zwei', 'Prozent',
    'aufweist', 'wobei', 'Ergebnisse', 'mit', 'dem', 'Modell', 'verglichen', 'werden', 'Daten',
    'Analyse', 'Kapitel', 'Abbildung', 'Grundlage', 'Ansatz', 'Systems', 'beschreibt', 'wird',
];

const INLINE_SNIPPETS = [
    '$x_i = \\alpha + \\beta t_i$', '\\cite{mueller2021}', '\\ref{fig:aufbau}', '\\textbf{wichtig}',
    '\\emph{nicht}', '$\\sum_{k=1}^{n} k^2$', '\\eqref{eq:modell}', '% Randnotiz',
    '\\footnote{Siehe Anhang.}', '$O(n \\log n)$', '\\SI{3.5}{\\milli\\second}',
];

const PREAMBLE = [
    '\\documentclass[11pt,a4paper]{report}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[ngerman]{babel}',
    '\\usepackage{amsmath,amssymb}',
    '\\usepackage{graphicx}',
    '\\usepackage{listings}',
    '\\usepackage{hyperref}',
    '% Synthetisches Testdokument für Spike S1',
    '\\newcommand{\\R}{\\mathbb{R}}',
    '\\begin{document}',
    '',
];

type Random = () => number;

function createRandom(seed: number): Random {
    let value = seed >>> 0;
    return () => {
        value = (value + 0x6d2b79f5) >>> 0;
        let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

function pick<T>(random: Random, items: readonly T[]): T {
    return items[Math.floor(random() * items.length)] as T;
}

function proseLine(random: Random): string {
    const count = MIN_WORDS_PER_LINE + Math.floor(random() * MAX_EXTRA_WORDS);
    const parts: string[] = [];
    for (let index = 0; index < count; index++) {
        parts.push(random() < INLINE_SNIPPET_PROBABILITY ? pick(random, INLINE_SNIPPETS) : pick(random, WORDS));
    }
    return parts.join(' ');
}

function paragraph(random: Random): string[] {
    const count = MIN_PARAGRAPH_LINES + Math.floor(random() * MAX_EXTRA_PARAGRAPH_LINES);
    const lines: string[] = [];
    for (let index = 0; index < count; index++) lines.push(proseLine(random));
    lines.push('');
    return lines;
}

function equationBlock(sectionIndex: number): string[] {
    return [
        '\\begin{equation}',
        `    \\label{eq:modell-${sectionIndex}}`,
        '    f(x) = \\int_0^\\infty e^{-t} \\, t^{x-1} \\, \\mathrm{d}t',
        '\\end{equation}',
        '',
    ];
}

function alignBlock(): string[] {
    return [
        '\\begin{align*}',
        '    a &= b + c \\\\',
        '    d &= \\frac{e}{f} % Zwischenschritt',
        '\\end{align*}',
        '',
    ];
}

function displayMathBlock(): string[] {
    return ['\\[', '    \\lim_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^n = e', '\\]', ''];
}

function listingBlock(): string[] {
    return [
        '\\begin{lstlisting}[language=Python]',
        'def mittelwert(werte):',
        '    return sum(werte) / len(werte)  # $ kein Mathe hier',
        '\\end{lstlisting}',
        '',
    ];
}

function figureBlock(sectionIndex: number): string[] {
    return [
        '\\begin{figure}[htb]',
        '    \\centering',
        '    \\includegraphics[width=0.8\\textwidth]{bilder/aufbau}',
        `    \\caption{Aufbau des Versuchs ${sectionIndex}}`,
        `    \\label{fig:aufbau-${sectionIndex}}`,
        '\\end{figure}',
        '',
    ];
}

function itemizeBlock(random: Random): string[] {
    return ['\\begin{itemize}', `    \\item ${proseLine(random)}`, `    \\item ${proseLine(random)}`, '\\end{itemize}', ''];
}

function commentBlock(): string[] {
    return ['\\begin{comment}', 'Alter Entwurf, wird nicht gesetzt: $a + b$', '\\end{comment}', ''];
}

const BLOCKS: ReadonlyArray<(random: Random, sectionIndex: number) => string[]> = [
    (_random, index) => equationBlock(index),
    () => alignBlock(),
    () => displayMathBlock(),
    () => listingBlock(),
    (_random, index) => figureBlock(index),
    (random) => itemizeBlock(random),
    () => commentBlock(),
];

function section(random: Random, sectionIndex: number): string[] {
    const lines = [`\\section{Abschnitt ${sectionIndex}}`, `\\label{sec:abschnitt-${sectionIndex}}`, ''];
    for (let index = 0; index < PARAGRAPHS_PER_SECTION; index++) {
        lines.push(...paragraph(random));
        if (random() < BLOCK_PROBABILITY) lines.push(...pick(random, BLOCKS)(random, sectionIndex));
    }
    return lines;
}

/** Erzeugt genau `lineCount` Zeilen (ohne abschließenden Zeilenumbruch). */
export function generateDocument(lineCount: number): string {
    const random = createRandom(RANDOM_SEED);
    const lines = [...PREAMBLE];
    for (let sectionIndex = 1; lines.length < lineCount - 1; sectionIndex++) {
        lines.push(...section(random, sectionIndex));
    }
    lines.length = lineCount - 1;
    lines.push('\\end{document}');
    return lines.join('\n');
}
