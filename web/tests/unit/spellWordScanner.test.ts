import { describe, expect, it } from 'vitest';
import { INITIAL_BIB_STATE } from '../../src/shared/core/bib/tokenizer';
import { isCheckableWord, scanSpellCandidates } from '../../src/shared/core/spelling/wordScanner';
import type { SpellCandidate } from '../../src/shared/core/spelling/wordScanner';

// Wortextraktion der Rechtschreibprüfung (W7-2): Syntaxfilter wie Swift, Sonderfälle wie die macOS-Prüfung.

function partWords(candidates: readonly SpellCandidate[]): string[] {
    return candidates.flatMap((candidate) => candidate.parts.map((part) => part.word));
}

function latexWords(text: string): string[] {
    return partWords(scanSpellCandidates(text, { language: 'latex' }));
}

describe('Wörter außerhalb der LaTeX-Syntax (wie Swift `spellingFilter`)', () => {
    it('Befehl, Formel und Kommentar fallen weg, Prosa-Argumente bleiben', () => {
        expect(latexWords('\\section{Einleitung} Text $x$ % Kommentar')).toEqual(['Einleitung', 'Text']);
    });

    it('Schlüssel-Argumente, optionale Argumente, Verbatim und Code fallen weg', () => {
        const text = '\\label{sec:einleitng} \\includegraphics[width=breit]{bilder/foto} \\verb|kaput| \\cite{knuth}';
        expect(latexWords(text)).toEqual([]);
        expect(latexWords('\\begin{lstlisting}\nvar fehlr = 1;\n\\end{lstlisting}\nDanach')).toEqual(['Danach']);
    });

    it('Formel über mehrere Zeilen: der Anfangszustand zählt', () => {
        const words = scanSpellCandidates('a + b\n\\]\nWeiter', { language: 'latex', startState: { math: 'bracket' } });
        expect(partWords(words)).toEqual(['Weiter']);
    });

    it('Lage ist absolut ab `offset`, auch über Zeilen', () => {
        const [first, second] = scanSpellCandidates('Haus\nBaum', { language: 'latex', offset: 100 });
        expect(first?.parts[0]).toEqual({ word: 'Haus', from: 100, to: 104 });
        expect(second?.parts[0]).toEqual({ word: 'Baum', from: 105, to: 109 });
    });

    it('Akzent-Befehle: kein Wortrest wie `uller` aus `M\\"uller`', () => {
        expect(latexWords('M\\"uller und Gr\\"o\\ss e')).toEqual(['und']);
    });
});

describe('Sonderfälle wie die Systemprüfung', () => {
    it.each([
        ['MP3 und H2O', ['und']],
        ['PDF und PDFs, LaTeX, iPhone', ['und']],
        ['Siehe https://example.org/pfad/seite und www.tugraz.at', ['Siehe', 'und']],
        ['Mail an max.muster@example.com schreiben', ['Mail', 'an', 'schreiben']],
        ['Datei main.tex und kapitel/einleitung.tex', ['Datei', 'und']],
        ['Variable file_name bleibt', ['Variable', 'bleibt']],
        ['a b c', []],
    ])('%s', (text, expected) => {
        expect(latexWords(text)).toEqual(expected);
    });

    it('Bindestrich-Wörter: Ganzes und Teile; Teile mit Ziffern oder Kürzel fehlen', () => {
        const [mail, player, pdf] = scanSpellCandidates('E-Mail-Adresse MP3-Spieler PDF-Datei', { language: 'latex' });
        expect(mail).toMatchObject({ text: 'E-Mail-Adresse', hyphenated: true });
        expect(mail?.parts.map((part) => part.word)).toEqual(['Mail', 'Adresse']);
        expect(player?.parts.map((part) => [part.word, part.from])).toEqual([['Spieler', 19]]);
        expect(pdf?.parts.map((part) => part.word)).toEqual(['Datei']);
    });

    it('Punkt nach dem Wort wird gemeldet (Abkürzungen wie `bzw.`)', () => {
        const [abbreviation, word] = scanSpellCandidates('bzw. Ende', { language: 'latex' });
        expect(abbreviation?.followedByDot).toBe(true);
        expect(word?.followedByDot).toBe(false);
    });

    it('isCheckableWord', () => {
        expect(isCheckableWord('Haus')).toBe(true);
        expect(isCheckableWord('größere')).toBe(true);
        expect(isCheckableWord('x')).toBe(false);
        expect(isCheckableWord('TCP')).toBe(false);
        expect(isCheckableWord('3D')).toBe(false);
    });
});

describe('BibTeX: nur Feldwerte (Tokenizer wie die Einfärbung)', () => {
    const entry = [
        'Freitext vor dem Eintrag',
        '@book{knuth1984,',
        '  title = {Das Tecbook},',
        '  publisher = "Verlag",',
        '}',
    ].join('\n');

    it('Eintragstyp, Schlüssel, Feldnamen und Text außerhalb fallen weg', () => {
        expect(partWords(scanSpellCandidates(entry, { language: 'bibtex' }))).toEqual(['Das', 'Tecbook', 'Verlag']);
    });

    it('Zustand mitten im Eintrag als Anfangszustand', () => {
        const words = scanSpellCandidates('  note = {Hinweis}', { language: 'bibtex', startState: { ...INITIAL_BIB_STATE, phase: 'fieldName', depth: 1 } });
        expect(partWords(words)).toEqual(['Hinweis']);
    });
});
