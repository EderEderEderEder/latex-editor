import { describe, expect, it } from 'vitest';
import {
    fileCandidates,
    joinNormalized,
    jumpTargetAt,
    jumpTargetInLine,
    MAXIMUM_JUMP_LINE_LENGTH,
    type JumpTarget,
} from '../../src/shared/core/jumpTargets';
import { loadSpec } from '../support/specVectors';

// Vektoren `shared/spec/misc.json`, Gruppe JumpTargetTests (op `jumpTarget`): `marked` mit `|` als Klickstelle oder `text` + `location`.
interface VectorInput {
    readonly op: string;
    readonly marked?: string;
    readonly text?: string;
    readonly location?: number;
}

interface VectorExpect {
    readonly target?: Record<string, string> | null;
    readonly rangeText?: string;
}

const CLICK_MARK = '|';
const cases = loadSpec('misc').cases.filter((specCase) => (specCase.input as VectorInput).op === 'jumpTarget');

function toVectorTarget(target: JumpTarget): Record<string, string> {
    return target.kind === 'file' ? { file: target.path } : { [target.kind]: target.key };
}

function locate(input: VectorInput): { text: string; location: number } {
    if (input.marked === undefined) return { text: input.text ?? '', location: input.location ?? 0 };
    return { text: input.marked.replace(CLICK_MARK, ''), location: input.marked.indexOf(CLICK_MARK) };
}

describe('jumpTarget (Testvektoren misc.json)', () => {
    it('enthält die 18 Fälle der Swift-Tests', () => {
        expect(cases).toHaveLength(18);
    });

    it.each(cases)('$id: $name', (specCase) => {
        const { text, location } = locate(specCase.input as VectorInput);
        const expected = specCase.expect as VectorExpect;
        const hit = jumpTargetAt(text, location);
        if (expected.target !== undefined) expect(hit === null ? null : toVectorTarget(hit.target)).toEqual(expected.target);
        if (expected.rangeText !== undefined) expect(hit === null ? null : text.slice(hit.start, hit.end)).toBe(expected.rangeText);
    });
});

function at(marked: string): { target: JumpTarget; range: string } | null {
    const location = marked.indexOf(CLICK_MARK);
    const text = marked.replace(CLICK_MARK, '');
    const hit = jumpTargetAt(text, location);
    return hit === null ? null : { target: hit.target, range: text.slice(hit.start, hit.end) };
}

describe('Strg-Klick-Ziele: Reihenfolge und Randfälle', () => {
    it('erkennt alle Verweisbefehle und Zitatbefehle', () => {
        expect(at('\\eqref{eq:a|b}')?.target).toEqual({ kind: 'label', key: 'eq:ab' });
        expect(at('\\autoref*{sec:a|b}')?.target).toEqual({ kind: 'label', key: 'sec:ab' });
        expect(at('\\parencite[S.~3]{kn|uth}')?.target).toEqual({ kind: 'citation', key: 'knuth' });
        expect(at('\\hyperref[sec:a|b]{Text}')?.target).toEqual({ kind: 'label', key: 'sec:ab' });
    });

    it('Abkürzungen: Verwendung ist ein Ziel, die Definition nicht', () => {
        expect(at('\\gls{ap|i}')?.target).toEqual({ kind: 'acronym', key: 'api' });
        expect(at('\\newacronym{ap|i}{API}{Schnittstelle}')).toBeNull();
    });

    it('Dateien: includegraphics mit Optionen, bibliography als Liste, addbibresource', () => {
        expect(at('\\includegraphics[width=.5\\textwidth]{bilder/ve|rlauf}')?.target)
            .toEqual({ kind: 'file', path: 'bilder/verlauf', command: 'includegraphics' });
        expect(at('\\bibliography{eins, zw|ei, drei}')).toEqual({
            target: { kind: 'file', path: 'zwei', command: 'bibliography' }, range: 'zwei',
        });
        expect(at('\\addbibresource{lit|eratur.bib}')?.target).toEqual({ kind: 'file', path: 'literatur.bib', command: 'addbibresource' });
    });

    it('Dateipfade: der Bereich ohne umgebenden Leerraum, leerer Pfad ist kein Ziel', () => {
        expect(at('\\input{ ka|p/eins }')?.range).toBe('kap/eins');
        expect(at('\\input{|}')).toBeNull();
    });

    it('ein Verweis hat Vorrang vor einem Dateipfad derselben Zeile; Kommentar und \\verb zählen nicht', () => {
        expect(at('\\input{a} \\ref{b|}')?.target).toEqual({ kind: 'label', key: 'b' });
        expect(at('\\verb|\\ref{x|}|')).toBeNull();
        expect(at('\\ref{a} % \\input{da|tei}')).toBeNull();
    });

    it('nur die Zeile der Klickstelle zählt; die Stelle hinter dem Text gehört zur letzten Zeile', () => {
        expect(jumpTargetAt('\\ref{a}\nText', 6)?.target).toEqual({ kind: 'label', key: 'a' });
        expect(jumpTargetAt('\\ref{a}\nText', 8)).toBeNull();
        expect(jumpTargetAt('Text\n\\ref{a}', 11)?.target).toEqual({ kind: 'label', key: 'a' });
        expect(jumpTargetAt('Text\n\\ref{a}', 12)).toBeNull();
        expect(jumpTargetAt('\\ref{a}\n', 10)).toBeNull();
    });

    it('ungültige Spalten und zu lange Zeilen: kein Ziel', () => {
        expect(jumpTargetInLine('\\ref{a}', -1)).toBeNull();
        expect(jumpTargetInLine('\\ref{a}', 99)).toBeNull();
        expect(jumpTargetInLine(`\\ref{a}${' '.repeat(MAXIMUM_JUMP_LINE_LENGTH)}`, 5)).toBeNull();
        expect(jumpTargetAt('\\ref{a}', -1)).toBeNull();
    });

    it('Umlaute und Emoji vor dem Ziel verschieben den Bereich nicht', () => {
        const text = 'Größe 😀 \\cite{müller}';
        const hit = jumpTargetAt(text, text.indexOf('müller') + 2);
        expect(hit === null ? null : text.slice(hit.start, hit.end)).toBe('müller');
    });
});

describe('Dateien zu einem Pfad im Text', () => {
    const LOOKUP = { bases: ['/p', '/p/kapitel'], graphicsDirectories: ['bilder/'] };

    it('joinNormalized löst . und .. auf und lässt die Wurzel stehen', () => {
        expect(joinNormalized('/p/kapitel', '../bilder/./a.png')).toBe('/p/bilder/a.png');
        expect(joinNormalized('C:/proj', 'a//b')).toBe('C:/proj/a/b');
        expect(joinNormalized('/p', '../../x')).toBe('/x');
    });

    it('input/include: erst der Pfad, dann mit .tex; Hauptordner vor dem Ordner der Datei', () => {
        const target = { kind: 'file', path: 'eins', command: 'input' } as const;
        expect(fileCandidates(target, LOOKUP)).toEqual(['/p/eins', '/p/eins.tex', '/p/kapitel/eins', '/p/kapitel/eins.tex']);
    });

    it('bibliography: .bib wird ergänzt, mit Endung bleibt der Pfad', () => {
        const bare = { kind: 'file', path: 'lit', command: 'bibliography' } as const;
        expect(fileCandidates(bare, { bases: ['/p'], graphicsDirectories: [] })).toEqual(['/p/lit.bib', '/p/lit']);
        expect(fileCandidates({ ...bare, path: 'lit.bib' }, { bases: ['/p'], graphicsDirectories: [] })).toEqual(['/p/lit.bib']);
    });

    it('includegraphics: mit und ohne Endung, auch in den \\graphicspath-Ordnern', () => {
        const target = { kind: 'file', path: 'verlauf.png', command: 'includegraphics' } as const;
        const candidates = fileCandidates(target, { bases: ['/p'], graphicsDirectories: ['bilder/'] });
        expect(candidates[0]).toBe('/p/verlauf.png');
        expect(candidates).toContain('/p/bilder/verlauf.png');
        expect(candidates).toContain('/p/verlauf.png.pdf');
        const bare = fileCandidates({ ...target, path: 'verlauf' }, { bases: ['/p'], graphicsDirectories: [] });
        expect(bare[0]).toBe('/p/verlauf.pdf');
    });

    it('absolute Pfade und Rückwärtsstriche: nur der Pfad selbst', () => {
        expect(fileCandidates({ kind: 'file', path: '/x/a', command: 'input' }, LOOKUP)).toEqual(['/x/a', '/x/a.tex']);
        expect(fileCandidates({ kind: 'file', path: 'kapitel\\a', command: 'input' }, { bases: ['/p'], graphicsDirectories: [] }))
            .toEqual(['/p/kapitel/a', '/p/kapitel/a.tex']);
    });
});
