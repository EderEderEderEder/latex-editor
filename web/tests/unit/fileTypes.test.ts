import { describe, expect, it } from 'vitest';
import {
    FILE_TYPE_GROUP_ORDER, NO_EXTENSION_TITLE, buildFileTypeSections, extensionKey, fileGlyphOf, isEditableTextFile,
} from '../../src/shared/core/fileTypes';

describe('Dateiarten', () => {
    it('liest die Endung klein und ohne Punkt', () => {
        expect(extensionKey('Main.TEX')).toBe('tex');
        expect(extensionKey('archiv.tar.gz')).toBe('gz');
        expect(extensionKey('Makefile')).toBe('');
        expect(extensionKey('.gitignore')).toBe('');
        expect(extensionKey('ende.')).toBe('');
    });

    it('ordnet Symbole nach Art zu', () => {
        expect(fileGlyphOf('a.tex')).toBe('tex');
        expect(fileGlyphOf('a.BIB')).toBe('bib');
        expect(fileGlyphOf('a.png')).toBe('image');
        expect(fileGlyphOf('a.pdf')).toBe('pdf');
        expect(fileGlyphOf('a.sty')).toBe('package');
        expect(fileGlyphOf('a.unbekannt')).toBe('other');
    });

    it('öffnet Textdateien im Editor, Binärdateien nicht', () => {
        for (const name of ['a.tex', 'a.bib', 'a.sty', 'notiz.md', 'daten.json', 'Makefile', 'tabelle.csv']) {
            expect(isEditableTextFile(name), name).toBe(true);
        }
        for (const name of ['a.png', 'a.pdf', 'a.zip', 'a.xlsx', 'a.docx', 'a.unbekannt']) {
            expect(isEditableTextFile(name), name).toBe(false);
        }
    });

    it('gruppiert das Typmenü in fester Reihenfolge, alphabetisch, mit Anzahl und ausgeblendeten Typen ohne Datei', () => {
        const counts = new Map([['tex', 3], ['bib', 1], ['png', 2], ['jpg', 1], ['', 1], ['xyz', 4]]);
        const sections = buildFileTypeSections(counts, new Set(['sty']));
        expect(sections.map((section) => section.title)).toEqual(['LaTeX', 'Literatur', 'Pakete und Klassen', 'Bilder', 'Sonstige']);
        const images = sections.find((section) => section.title === 'Bilder');
        expect(images?.entries.map((entry) => entry.extension)).toEqual(['jpg', 'png']);
        expect(sections[2]?.entries).toEqual([{ extension: 'sty', title: '.sty', count: 0 }]);
        const other = sections.at(-1);
        expect(other?.entries.map((entry) => entry.title)).toEqual([NO_EXTENSION_TITLE, '.xyz']);
    });

    it('listet jede Gruppe höchstens einmal in der Reihenfolge', () => {
        expect(new Set(FILE_TYPE_GROUP_ORDER).size).toBe(FILE_TYPE_GROUP_ORDER.length);
        expect(FILE_TYPE_GROUP_ORDER.slice(0, 2)).toEqual(['LaTeX', 'Literatur']);
        expect(FILE_TYPE_GROUP_ORDER.at(-1)).toBe('Sonstige');
    });
});
