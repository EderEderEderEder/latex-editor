import { describe, expect, it } from 'vitest';
import {
    duplicateLabelEntries,
    duplicateLabelMarks,
    findDuplicateLabels,
    type LabelEntry,
} from '../../src/shared/core/latex/duplicateLabels';
import { scannable } from '../../src/shared/core/latex/masking';
import { syntaxMarks } from '../../src/shared/core/latex/syntaxChecker';

const FILE_A = '/tmp/a.tex';
const FILE_B = '/tmp/b.tex';

describe('Doppelte Labels', () => {
    it('beide Stellen warnen, Meldung nennt die andere', () => {
        const labels: LabelEntry[] = [
            { label: 'x', file: FILE_A, line: 1 },
            { label: 'x', file: FILE_B, line: 7 },
            { label: 'y', file: FILE_A, line: 2 },
        ];
        const duplicates = findDuplicateLabels(labels);
        expect([...duplicates.keys()]).toEqual(['x']);
        const text = '\\label{x}\n\\label{y}\n';
        const marks = duplicateLabelMarks(text, FILE_A, duplicates);
        expect(marks).toHaveLength(1);
        expect(marks[0]?.severity).toBe('warning');
        expect(text.slice(marks[0]?.start, marks[0]?.end)).toBe('x');
        expect(marks[0]?.message).toContain('b.tex, Zeile 7');
    });

    it('zwei Labels derselben Datei verweisen aufeinander', () => {
        const duplicates = findDuplicateLabels([
            { label: 'x', file: FILE_A, line: 1 },
            { label: 'x', file: FILE_A, line: 3 },
        ]);
        const marks = duplicateLabelMarks('\\label{x}\n\n\\label{x}', FILE_A, duplicates);
        const referencedLines = marks.map((mark) => (mark.message.includes('Zeile 3') ? 3 : mark.message.includes('Zeile 1') ? 1 : 0));
        expect(referencedLines).toEqual([3, 1]);
    });

    it('mehr als zwei Stellen nennen die Gesamtzahl', () => {
        const duplicates = findDuplicateLabels([
            { label: 'x', file: FILE_A, line: 1 },
            { label: 'x', file: FILE_B, line: 2 },
            { label: 'x', file: FILE_B, line: 5 },
        ]);
        const [mark] = duplicateLabelMarks('\\label{x}', FILE_A, duplicates);
        expect(mark?.message).toContain('insgesamt 3 Stellen');
    });

    it('Kommentare zählen nicht, ohne Duplikate keine Markierung', () => {
        const duplicates = findDuplicateLabels([
            { label: 'x', file: FILE_A, line: 1 },
            { label: 'x', file: FILE_B, line: 1 },
        ]);
        expect(duplicateLabelMarks(scannable('% \\label{x}\n'), FILE_A, duplicates)).toEqual([]);
        expect(duplicateLabelMarks('\\label{x}', FILE_A, new Map())).toEqual([]);
    });

    it('Syntaxfehler und doppelte Labels pro Datei (Store-Fall ohne Store)', () => {
        const syntaxText = '\\textbf{a\n';
        expect(syntaxMarks(scannable(syntaxText))).toHaveLength(1);
        const duplicates = findDuplicateLabels([
            { label: 'l', file: FILE_A, line: 1 },
            { label: 'l', file: FILE_A, line: 2 },
        ]);
        const labelled = '\\label{l}\n\\label{l}\n';
        expect(duplicateLabelMarks(scannable(labelled), '/tmp/zwei.tex', duplicates)).toHaveLength(2);
    });

    it('Seitenleiste: mehrfach definierte Labels aus dem Index, sortiert', () => {
        const entries = duplicateLabelEntries([
            { label: 'd', file: '/p/a.tex', line: 5 },
            { label: 'e', file: '/p/a.tex', line: 2 },
            { label: 'd', file: '/p/a.tex', line: 1 },
        ]);
        expect(entries.map((entry) => entry.line)).toEqual([1, 5]);
    });
});
