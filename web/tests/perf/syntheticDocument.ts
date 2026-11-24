// Synthetisches LaTeX-Testdokument für die Leistungsmessung: deterministisch aus festem Seed, kein echter Inhalt.

export const DOCUMENT_LINE_COUNT = 10_000;
/** Wort, das genau einmal weit hinten im Dokument steht (Ziel der Suche) */
export const SEARCH_TARGET = 'Zielmarkierung';
/** Zeile (1-basiert), in der `SEARCH_TARGET` steht */
export const SEARCH_TARGET_LINE = 9_500;
/** Dieses Label kommt zweimal vor (doppelte Labels prüft die Diagnose über die ganze Datei) */
export const DUPLICATE_LABEL = 'sec:doppelt';

const RANDOM_SEED = 20261124;
const MIN_WORDS_PER_LINE = 10;
const MAX_EXTRA_WORDS = 7;
const MIN_PARAGRAPH_LINES = 3;
const MAX_EXTRA_PARAGRAPH_LINES = 4;
const PARAGRAPHS_PER_SECTION = 5;
const SECTIONS_PER_CHAPTER = 4;
const INLINE_SNIPPET_PROBABILITY = 0.12;
const BLOCK_PROBABILITY = 0.55;
const COMMENT_LINE_PROBABILITY = 0.05;
const MIN_PROSE_LENGTH = 40;
const MIDDLE_OFFSET_INSIDE_LINE = 20;
/** Absichtlich nicht geschlossen: die Diagnose hat damit am Anfang des Dokuments eine echte Meldung zu verwalten */
const UNCLOSED_LINE = 'Vorwort \\textbf{nicht geschlossen und der Satz geht einfach weiter';
const DUPLICATE_LABEL_SECTIONS = [1, 2];

const WORDS = [
    'die', 'Messung', 'zeigt', 'dass', 'das', 'Verfahren', 'unter', 'realen', 'Bedingungen', 'stabil', 'bleibt',
    'und', 'eine', 'Abweichung', 'von', 'weniger', 'als', 'zwei', 'Prozent', 'aufweist', 'wobei', 'Ergebnisse',
    'mit', 'dem', 'Modell', 'verglichen', 'werden', 'Daten', 'Analyse', 'Kapitel', 'Grundlage', 'Ansatz',
];

const INLINE_SNIPPETS = [
    '$x_i = \\alpha + \\beta t_i$', '\\cite{mueller2021}', '\\ref{fig:aufbau-1}', '\\textbf{wichtig}', '\\emph{nicht}',
    '$\\sum_{k=1}^{n} k^2$', '\\eqref{eq:modell-1}', '% Randnotiz', '\\footnote{Siehe Anhang.}', '$O(n \\log n)$',
];

const PREAMBLE = [
    '\\documentclass[11pt,a4paper]{report}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[ngerman]{babel}',
    '\\usepackage{amsmath,amssymb}',
    '\\usepackage{graphicx}',
    '% Synthetisches Testdokument für die Leistungsmessung',
    '\\begin{document}',
    UNCLOSED_LINE,
    '',
];

type Random = () => number;
type BlockBuilder = (random: Random, sectionIndex: number) => string[];

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
    for (let index = 0; index < count; index++) {
        lines.push(random() < COMMENT_LINE_PROBABILITY ? `% ${proseLine(random)}` : proseLine(random));
    }
    lines.push('');
    return lines;
}

const BLOCKS: readonly BlockBuilder[] = [
    (_random, index) => [
        '\\begin{equation}',
        `    \\label{eq:modell-${index}}`,
        '    f(x) = \\int_0^\\infty e^{-t} \\, t^{x-1} \\, \\mathrm{d}t',
        '\\end{equation}',
        '',
    ],
    () => ['\\begin{align*}', '    a &= b + c \\\\', '    d &= \\frac{e}{f} % Zwischenschritt', '\\end{align*}', ''],
    () => ['\\[', '    \\lim_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^n = e', '\\]', ''],
    (_random, index) => [
        '\\begin{figure}[htb]',
        '    \\centering',
        '    \\includegraphics[width=0.8\\textwidth]{bilder/aufbau}',
        `    \\caption{Aufbau des Versuchs ${index}}`,
        `    \\label{fig:aufbau-${index}}`,
        '\\end{figure}',
        '',
    ],
    (random) => ['\\begin{itemize}', `    \\item ${proseLine(random)}`, `    \\item ${proseLine(random)}`, '\\end{itemize}', ''],
    () => ['\\begin{comment}', 'Alter Entwurf, wird nicht gesetzt: $a + b$', '\\end{comment}', ''],
];

function sectionHeading(sectionIndex: number): string[] {
    const level = sectionIndex % SECTIONS_PER_CHAPTER === 1 ? '\\chapter' : '\\section';
    const label = DUPLICATE_LABEL_SECTIONS.includes(sectionIndex) ? DUPLICATE_LABEL : `sec:abschnitt-${sectionIndex}`;
    return [`${level}{Abschnitt ${sectionIndex}}`, `\\label{${label}}`, ''];
}

function section(random: Random, sectionIndex: number): string[] {
    const lines = sectionHeading(sectionIndex);
    for (let index = 0; index < PARAGRAPHS_PER_SECTION; index++) {
        lines.push(...paragraph(random));
        if (random() < BLOCK_PROBABILITY) lines.push(...pick(random, BLOCKS)(random, sectionIndex));
    }
    return lines;
}

function plantSearchTarget(lines: string[]): void {
    const index = SEARCH_TARGET_LINE - 1;
    lines[index] = `${SEARCH_TARGET} ${lines[index]}`;
}

/** Genau `DOCUMENT_LINE_COUNT` Zeilen, ohne abschließenden Zeilenumbruch */
export function generateSyntheticDocument(): string {
    const random = createRandom(RANDOM_SEED);
    const lines = [...PREAMBLE];
    for (let sectionIndex = 1; lines.length < DOCUMENT_LINE_COUNT - 1; sectionIndex++) {
        lines.push(...section(random, sectionIndex));
    }
    lines.length = DOCUMENT_LINE_COUNT - 1;
    lines.push('\\end{document}');
    plantSearchTarget(lines);
    return lines.join('\n');
}

export interface DocumentLandmarks {
    /** Zeichenposition mitten in einer Fließtextzeile der Dokumentmitte */
    readonly middleProseOffset: number;
    /** Zeichenposition am Anfang dieser Zeile (für `$` vor dem ersten Wort) */
    readonly middleProseLineStart: number;
    /** Zeichenposition, an der `SEARCH_TARGET` beginnt */
    readonly searchTargetOffset: number;
}

function isProseLine(line: string): boolean {
    return line.length >= MIN_PROSE_LENGTH && /^[a-zA-Z]/.test(line);
}

/** Orte im Text, an denen die Messungen eingreifen */
export function findLandmarks(text: string): DocumentLandmarks {
    const lines = text.split('\n');
    let offset = 0;
    let middleLineStart = -1;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index] as string;
        if (middleLineStart < 0 && index >= lines.length / 2 && isProseLine(line)) middleLineStart = offset;
        offset += line.length + 1;
    }
    if (middleLineStart < 0) throw new Error('Keine Fließtextzeile in der Dokumentmitte gefunden');
    const searchTargetOffset = text.indexOf(SEARCH_TARGET);
    return {
        middleProseOffset: middleLineStart + MIDDLE_OFFSET_INSIDE_LINE,
        middleProseLineStart: middleLineStart,
        searchTargetOffset,
    };
}
