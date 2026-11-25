import { describe, expect, it } from 'vitest';
import type { DirectoryNode } from '../../src/shared/contract';
import {
    fromRoot, locationText, mapPath, moveTargets, relativeToRoot, siblingNames, targetFolder, validateEntryName,
} from '../../src/renderer/app/projectFileActionsNames';
import { applyTextEdits, invertTextEdits, matchesEdits } from '../../src/renderer/app/projectFileActionsReferences';

// W2-9: Namensprüfung beim Tippen (wie `NameSheet.validationMessage`), Pfade im Baum, Gegenänderungen.

const MAC = { windows: false };
const WINDOWS = { windows: true };
const ROOT = '/p';

const TREE: DirectoryNode = {
    kind: 'directory', name: 'p', path: ROOT, children: [
        { kind: 'directory', name: 'kapitel', path: '/p/kapitel', children: [
            { kind: 'directory', name: 'alt', path: '/p/kapitel/alt', children: [] },
            { kind: 'file', name: 'einleitung.tex', path: '/p/kapitel/einleitung.tex' },
        ] },
        { kind: 'file', name: 'main.tex', path: '/p/main.tex' },
    ],
};

describe('Namensprüfung', () => {
    const newFile = { kind: 'newFile', platform: MAC, siblings: ['main.tex', 'Bild.png'] } as const;

    it('neue Datei: .tex wird ergänzt, belegte Namen (ohne Groß/klein) werden gemeldet', () => {
        expect(validateEntryName('kapitel', newFile)).toBeNull();
        expect(validateEntryName('main', newFile)).toBe('„main.tex“ existiert an dieser Stelle bereits.');
        expect(validateEntryName('MAIN.TEX', newFile)).toContain('existiert');
        expect(validateEntryName('bild.png', newFile)).toContain('existiert');
    });

    it('meldet unzulässige Namen mit den Texten aus fileNames', () => {
        expect(validateEntryName('', newFile)).toBe('Der Name darf nicht leer sein.');
        expect(validateEntryName('a/b', newFile)).toContain('„/“');
        expect(validateEntryName('.versteckt', newFile)).toContain('versteckte');
        expect(validateEntryName('nul.tex', { ...newFile, platform: WINDOWS })).toContain('Gerätename');
        expect(validateEntryName('nul.tex', newFile)).toBeNull();
        expect(validateEntryName('ende.', { ...newFile, platform: WINDOWS })).toContain('Punkt oder Leerzeichen');
    });

    it('Umbenennen behält die Endung, erlaubt reine Schreibweise und meldet Kollisionen', () => {
        const rename = {
            kind: 'rename', platform: MAC, siblings: ['einleitung.tex', 'fazit.tex'],
            original: { name: 'einleitung.tex', isDirectory: false },
        } as const;
        expect(validateEntryName('Einleitung', rename)).toBeNull();
        expect(validateEntryName('fazit', rename)).toContain('„fazit.tex“');
        expect(validateEntryName('intro', rename)).toBeNull();
    });
});

describe('Pfade im Baum', () => {
    it('Zielordner für „Neu“: gewählter Ordner, Ordner der gewählten Datei, sonst Wurzel', () => {
        expect(targetFolder(TREE, null)).toBe(ROOT);
        expect(targetFolder(TREE, '/p/kapitel')).toBe('/p/kapitel');
        expect(targetFolder(TREE, '/p/kapitel/einleitung.tex')).toBe('/p/kapitel');
        expect(targetFolder(TREE, '/p/fehlt.tex')).toBe(ROOT);
    });

    it('Ort, Geschwister, Ziele zum Verschieben (ohne den Ordner selbst und darin)', () => {
        expect(locationText(ROOT, ROOT)).toBe('in Projektordner');
        expect(locationText(ROOT, '/p/kapitel/alt')).toBe('in kapitel/alt');
        expect(siblingNames(TREE, '/p/kapitel')).toEqual(['alt', 'einleitung.tex']);
        expect(moveTargets(TREE, '/p/main.tex').map((target) => target.label)).toEqual(['Projektordner', 'kapitel', 'kapitel/alt']);
        expect(moveTargets(TREE, '/p/kapitel').map((target) => target.label)).toEqual(['Projektordner']);
    });

    it('relative Pfade und Umzug, auch mit Windows-Trennern', () => {
        expect(relativeToRoot('C:\\p', 'C:\\p\\kapitel\\a.tex')).toBe('kapitel/a.tex');
        expect(fromRoot('C:\\p', 'kapitel/a.tex')).toBe('C:\\p\\kapitel\\a.tex');
        expect(relativeToRoot(ROOT, '/pq/a.tex')).toBeNull();
        expect(mapPath('/p/kapitel/a.tex', '/p/kapitel', '/p/chapters')).toBe('/p/chapters/a.tex');
        expect(mapPath('/p/kapitel2/a.tex', '/p/kapitel', '/p/chapters')).toBe('/p/kapitel2/a.tex');
    });
});

describe('Gegenänderungen', () => {
    it('stellen den Text byte-gleich her, auch bei mehreren Änderungen verschiedener Länge', () => {
        const text = '\\input{a}\n\\input{bb}\n\\include{a}\n';
        const edits = [
            { from: 7, to: 8, insert: 'kapitel/neu', expected: 'a' },
            { from: 17, to: 19, insert: 'c', expected: 'bb' },
            { from: 30, to: 31, insert: 'x/y', expected: 'a' },
        ];
        expect(matchesEdits(text, edits)).toBe(true);
        const changed = applyTextEdits(text, edits);
        expect(changed).toBe('\\input{kapitel/neu}\n\\input{c}\n\\include{x/y}\n');
        const inverse = invertTextEdits(edits);
        expect(matchesEdits(changed, inverse)).toBe(true);
        expect(applyTextEdits(changed, inverse)).toBe(text);
        expect(matchesEdits(`%${changed}`, inverse)).toBe(false);
    });
});
