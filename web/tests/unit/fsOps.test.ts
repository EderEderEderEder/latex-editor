import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    copyName,
    FsOps,
    importName,
    MAX_FILE_NAME_LENGTH,
    MAX_WINDOWS_PATH_LENGTH,
    maxPathLength,
    newFileName,
    renamedFileName,
    type TrashItem,
    validateFileName,
} from '../../src/main/fsOps';
import { currentPathPlatform, LINUX_PATHS, MACOS_PATHS, WINDOWS_PATHS } from '../../src/main/paths';
import { IpcFailure } from '../../src/shared/ipcResult';

const LATIN1_CRLF = Buffer.from('\\section{Gr\xfc\xdfe}\r\nZeile 2\r\n', 'latin1');
const BINARY = Buffer.from([0x00, 0xff, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x80]);
const platform = currentPathPlatform();

let base: string;
let project: string;
let outside: string;
let trashDir: string;
let backupDir: string;
let trashCalls: string[];

const fakeTrash: TrashItem = async (path) => {
    trashCalls.push(path);
    await rename(path, join(trashDir, `${randomUUID()}-${basename(path)}`));
};

function makeOps(overrides: Partial<ConstructorParameters<typeof FsOps>[0]> = {}): FsOps {
    return new FsOps({ platform, projectRoot: () => project, backupDir, trashItem: fakeTrash, ...overrides });
}

beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'fs-ops-')));
    project = join(base, 'Projekt');
    outside = join(base, 'Fremd');
    trashDir = join(base, 'Papierkorb');
    backupDir = join(base, 'userData', 'Ablage');
    trashCalls = [];
    await Promise.all([mkdir(project), mkdir(outside), mkdir(trashDir)]);
});

afterEach(async () => {
    await rm(base, { recursive: true, force: true });
});

async function errorKind(action: () => Promise<unknown>): Promise<string | null> {
    try {
        await action();
        return null;
    } catch (error) {
        return error instanceof IpcFailure ? error.error.kind : `other: ${String(error)}`;
    }
}

async function exists(path: string): Promise<boolean> {
    return lstat(path).then(
        () => true,
        () => false,
    );
}

describe('validateFileName unter Windows', () => {
    const cases: Array<[string, string]> = [
        ['CON', 'deviceName'],
        ['con.tex', 'deviceName'],
        ['NUL.txt', 'deviceName'],
        ['Aux.bib', 'deviceName'],
        ['PRN', 'deviceName'],
        ['COM1', 'deviceName'],
        ['com9.log', 'deviceName'],
        ['LPT1.tex', 'deviceName'],
        ['COM¹', 'deviceName'],
        ['CON .tex', 'deviceName'],
        ['CONIN$', 'deviceName'],
        ['main.tex:x', 'alternateDataStream'],
        ['main.tex::$DATA', 'alternateDataStream'],
        ['kapitel.', 'trailingDotOrSpace'],
        ['kapitel ', 'trailingDotOrSpace'],
        ['a<b', 'reservedCharacter'],
        ['a>b', 'reservedCharacter'],
        ['a"b', 'reservedCharacter'],
        ['a|b', 'reservedCharacter'],
        ['a?b', 'reservedCharacter'],
        ['a*b', 'reservedCharacter'],
        ['a\\b', 'separator'],
        ['a/b', 'separator'],
        ['a\u0001b', 'controlCharacter'],
        ['a\u202eb', 'controlCharacter'],
        ['', 'empty'],
        ['   ', 'empty'],
        ['.', 'dotName'],
        ['..', 'dotName'],
        ['.latexmkrc', 'hidden'],
        ['x'.repeat(MAX_FILE_NAME_LENGTH + 1), 'tooLong'],
    ];
    it.each(cases)('lehnt %j ab (%s)', (name, problem) => {
        expect(validateFileName(name, WINDOWS_PATHS)).toBe(problem);
    });

    it.each(['CONTENT.tex', 'console.tex', 'COM10.tex', 'LPT0.tex', 'nullen.tex', 'Größe & Maß.tex', ' führend.tex'])(
        'nimmt %j an',
        (name) => {
            expect(validateFileName(name, WINDOWS_PATHS)).toBeNull();
        },
    );

    it('Höchstlänge ist erlaubt', () => {
        expect(validateFileName('x'.repeat(MAX_FILE_NAME_LENGTH), WINDOWS_PATHS)).toBeNull();
    });
});

describe('validateFileName unter macOS und Linux', () => {
    it.each([MACOS_PATHS, LINUX_PATHS])('Windows-Regeln gelten nicht, „:“ und „\\“ schon', (paths) => {
        expect(validateFileName('aux.tex', paths)).toBeNull();
        expect(validateFileName('kapitel.', paths)).toBeNull();
        expect(validateFileName('a<b', paths)).toBeNull();
        expect(validateFileName('a:b', paths)).toBe('reservedCharacter');
        expect(validateFileName('a\\b', paths)).toBe('separator');
        expect(validateFileName('a\nb', paths)).toBe('controlCharacter');
        expect(validateFileName('..', paths)).toBe('dotName');
        expect(validateFileName('.git', paths)).toBe('hidden');
    });
});

describe('Namensregeln wie Swift', () => {
    it('neue Datei ohne Endung bekommt .tex', () => {
        expect(newFileName('kapitel', platform)).toBe('kapitel.tex');
        expect(newFileName('refs.bib', platform)).toBe('refs.bib');
        expect(() => newFileName('a/b', platform)).toThrow(IpcFailure);
    });

    it('Umbenennen ohne Endung behält die bisherige, Ordner nicht', () => {
        expect(renamedFileName('intro', 'kapitel.tex', false, platform)).toBe('intro.tex');
        expect(renamedFileName('intro.txt', 'kapitel.tex', false, platform)).toBe('intro.txt');
        expect(renamedFileName('neu', 'ordner.v2', true, platform)).toBe('neu');
    });

    it('Kopie- und Importnamen', () => {
        expect(copyName('kapitel', '.tex', 1)).toBe('kapitel Kopie.tex');
        expect(copyName('kapitel', '.tex', 2)).toBe('kapitel Kopie 2.tex');
        expect(importName('bild', '.png', 1)).toBe('bild.png');
        expect(importName('bild', '.png', 3)).toBe('bild 3.png');
    });

    it('Pfadgrenze je Plattform', () => {
        expect(maxPathLength(WINDOWS_PATHS)).toBe(MAX_WINDOWS_PATH_LENGTH);
        expect(maxPathLength(MACOS_PATHS)).toBeGreaterThan(MAX_WINDOWS_PATH_LENGTH);
    });
});

describe('Anlegen', () => {
    it('legt Datei (mit .tex) und Ordner an; Rückgängig legt sie in den Papierkorb, Wiederholen holt sie zurück', async () => {
        const ops = makeOps();
        const file = await ops.create(project, 'kapitel', 'file');
        expect(file.path).toBe(join(project, 'kapitel.tex'));
        expect(await readFile(file.path, 'utf8')).toBe('');
        const folder = await ops.create(project, 'bilder', 'directory');
        expect((await lstat(folder.path)).isDirectory()).toBe(true);
        const redo = await ops.restore(file.undoToken);
        expect(await exists(file.path)).toBe(false);
        expect(trashCalls).toEqual([file.path]);
        await ops.restore(redo);
        expect(await exists(file.path)).toBe(true);
    });

    it('überschreibt nichts und legt bei unzulässigem Namen nichts an', async () => {
        const ops = makeOps();
        await writeFile(join(project, 'kapitel.tex'), 'Inhalt');
        expect(await errorKind(() => ops.create(project, 'kapitel.tex', 'file'))).toBe('alreadyExists');
        expect(await readFile(join(project, 'kapitel.tex'), 'utf8')).toBe('Inhalt');
        for (const name of ['a/b', '..', '.versteckt', 'a:b', 'x\u0000']) {
            expect(await errorKind(() => ops.create(project, name, 'file'))).toBe('invalidInput');
        }
        expect(await readdir(project)).toEqual(['kapitel.tex']);
    });

    it('nie außerhalb des Projekts, auch nicht über `..` oder einen Symlink-Ordner', async () => {
        const ops = makeOps();
        await symlink(outside, join(project, 'raus'));
        expect(await errorKind(() => ops.create(outside, 'x', 'file'))).toBe('forbiddenPath');
        expect(await errorKind(() => ops.create(join(project, '..', 'Fremd'), 'x', 'file'))).toBe('forbiddenPath');
        expect(await errorKind(() => ops.create(join(project, 'raus'), 'x', 'file'))).toBe('forbiddenPath');
        expect(await errorKind(() => ops.create('\\\\server\\share', 'x', 'file'))).toBe('invalidInput');
        expect(await readdir(outside)).toEqual([]);
    });

    it('ohne Projekt: notFound', async () => {
        const ops = makeOps({
            projectRoot: () => {
                throw new IpcFailure({ kind: 'notFound', message: 'Kein Projekt geöffnet' });
            },
        });
        expect(await errorKind(() => ops.create(project, 'x', 'file'))).toBe('notFound');
    });
});

describe('Umbenennen', () => {
    it('behält die Endung, Inhalt bleibt; Rückgängig benennt zurück', async () => {
        const ops = makeOps();
        await mkdir(join(project, 'chapters'));
        const source = join(project, 'chapters', 'alt.tex');
        await writeFile(source, LATIN1_CRLF);
        const result = await ops.rename(source, 'neu');
        expect(result.path).toBe(join(project, 'chapters', 'neu.tex'));
        expect(await readFile(result.path)).toEqual(LATIN1_CRLF);
        const redo = await ops.restore(result.undoToken);
        expect(await readdir(join(project, 'chapters'))).toEqual(['alt.tex']);
        await ops.restore(redo);
        expect(await readdir(join(project, 'chapters'))).toEqual(['neu.tex']);
    });

    it('nur Groß-/Kleinschreibung über einen Zwischennamen, ohne Reste', async () => {
        const ops = makeOps();
        await writeFile(join(project, 'einleitung.tex'), 'Inhalt');
        const result = await ops.rename(join(project, 'einleitung.tex'), 'Einleitung.tex');
        expect(await readdir(project)).toEqual(['Einleitung.tex']);
        expect(await readFile(result.path, 'utf8')).toBe('Inhalt');
        await ops.restore(result.undoToken);
        expect(await readdir(project)).toEqual(['einleitung.tex']);
    });

    it('verweigert belegte Namen, unzulässige Namen und den Projektordner', async () => {
        const ops = makeOps();
        await writeFile(join(project, 'a.tex'), 'A');
        await writeFile(join(project, 'b.tex'), 'B');
        expect(await errorKind(() => ops.rename(join(project, 'a.tex'), 'b.tex'))).toBe('alreadyExists');
        expect(await errorKind(() => ops.rename(join(project, 'a.tex'), 'x/y'))).toBe('invalidInput');
        expect(await errorKind(() => ops.rename(project, 'anders'))).toBe('forbiddenPath');
        expect(await errorKind(() => ops.rename(join(project, 'fehlt.tex'), 'x'))).toBe('notFound');
        expect(await readFile(join(project, 'b.tex'), 'utf8')).toBe('B');
    });

    it('ein Symlink nach außen ist tabu; einer nach innen wird selbst umbenannt', async () => {
        const ops = makeOps();
        await writeFile(join(outside, 'geheim.tex'), 'geheim');
        await writeFile(join(project, 'ziel.tex'), 'Ziel');
        await symlink(join(outside, 'geheim.tex'), join(project, 'raus.tex'));
        await symlink(join(project, 'ziel.tex'), join(project, 'innen.tex'));
        expect(await errorKind(() => ops.rename(join(project, 'raus.tex'), 'x'))).toBe('forbiddenPath');
        const result = await ops.rename(join(project, 'innen.tex'), 'verweis');
        expect((await lstat(result.path)).isSymbolicLink()).toBe(true);
        expect(await exists(join(project, 'ziel.tex'))).toBe(true);
    });
});

describe('Verschieben', () => {
    it('verschiebt; Rückgängig verschiebt zurück', async () => {
        const ops = makeOps();
        await mkdir(join(project, 'ziel'));
        await writeFile(join(project, 'a.tex'), BINARY);
        const result = await ops.move(join(project, 'a.tex'), join(project, 'ziel'));
        expect(result.path).toBe(join(project, 'ziel', 'a.tex'));
        await ops.restore(result.undoToken);
        expect(await readFile(join(project, 'a.tex'))).toEqual(BINARY);
    });

    it('nie in sich selbst, nie hinaus, nie über einen belegten Namen', async () => {
        const ops = makeOps();
        await mkdir(join(project, 'ordner', 'unter'), { recursive: true });
        await mkdir(join(project, 'ziel'));
        await writeFile(join(project, 'b.tex'), 'B');
        await writeFile(join(project, 'ziel', 'b.tex'), 'anders');
        expect(await errorKind(() => ops.move(join(project, 'ordner'), join(project, 'ordner', 'unter')))).toBe('invalidInput');
        expect(await errorKind(() => ops.move(join(project, 'ordner'), join(project, 'ordner')))).toBe('invalidInput');
        expect(await errorKind(() => ops.move(join(project, 'b.tex'), outside))).toBe('forbiddenPath');
        expect(await errorKind(() => ops.move(join(outside), project))).toBe('forbiddenPath');
        expect(await errorKind(() => ops.move(join(project, 'b.tex'), join(project, 'ziel')))).toBe('alreadyExists');
        expect(await errorKind(() => ops.move(project, join(project, 'ziel')))).toBe('forbiddenPath');
        expect(await readFile(join(project, 'ziel', 'b.tex'), 'utf8')).toBe('anders');
        expect(await readdir(outside)).toEqual([]);
    });
});

describe('Duplizieren', () => {
    it('„Kopie“, dann „Kopie 2“, byte-gleich, auch Ordner', async () => {
        const ops = makeOps();
        await writeFile(join(project, 'kapitel.tex'), LATIN1_CRLF);
        const first = await ops.duplicate(join(project, 'kapitel.tex'));
        const second = await ops.duplicate(join(project, 'kapitel.tex'));
        expect(basename(first.path)).toBe('kapitel Kopie.tex');
        expect(basename(second.path)).toBe('kapitel Kopie 2.tex');
        expect(await readFile(second.path)).toEqual(LATIN1_CRLF);
        await mkdir(join(project, 'bilder'));
        await writeFile(join(project, 'bilder', 'b.png'), BINARY);
        const folder = await ops.duplicate(join(project, 'bilder'));
        expect(await readFile(join(folder.path, 'b.png'))).toEqual(BINARY);
    });

    it('Fehler beim Platzieren lässt keine halbe Kopie zurück', async () => {
        const failingRename = async (): Promise<void> => {
            throw Object.assign(new Error('kaputt'), { code: 'EIO' });
        };
        const ops = makeOps({ rename: failingRename });
        await writeFile(join(project, 'kapitel.tex'), 'Inhalt');
        expect(await errorKind(() => ops.duplicate(join(project, 'kapitel.tex')))).toBe('io');
        expect(await readdir(project)).toEqual(['kapitel.tex']);
    });
});

describe('Importieren (Quellen schon geprüft)', () => {
    it('kopiert byte-gleich, nummeriert statt zu überschreiben', async () => {
        const ops = makeOps();
        await writeFile(join(outside, 'bild.png'), BINARY);
        await writeFile(join(project, 'bild.png'), 'alt');
        const result = await ops.importFiles([join(outside, 'bild.png'), join(outside, 'bild.png')], project);
        expect(result.paths.map((path) => basename(path))).toEqual(['bild 2.png', 'bild 3.png']);
        expect(await readFile(join(project, 'bild 2.png'))).toEqual(BINARY);
        expect(await readFile(join(project, 'bild.png'), 'utf8')).toBe('alt');
        await ops.restore(result.undoToken);
        expect((await readdir(project)).sort()).toEqual(['bild.png']);
    });

    it('scheitert eine Quelle, verschwinden auch die schon kopierten', async () => {
        const ops = makeOps();
        await writeFile(join(outside, 'a.png'), BINARY);
        const sources = [join(outside, 'a.png'), join(outside, 'fehlt.png')];
        expect(await errorKind(() => ops.importFiles(sources, project))).toBe('notFound');
        expect(await readdir(project)).toEqual([]);
    });
});

describe('Papierkorb und Wiederherstellen', () => {
    it('sichert byte-gleich in der Ablage, legt in den Papierkorb und stellt byte-gleich wieder her', async () => {
        const ops = makeOps();
        await mkdir(join(project, 'kapitel'));
        await writeFile(join(project, 'kapitel', 'latin1.tex'), LATIN1_CRLF);
        await writeFile(join(project, 'kapitel', 'bild.png'), BINARY);
        await symlink('latin1.tex', join(project, 'kapitel', 'verweis.tex'));
        const token = await ops.trash(join(project, 'kapitel'));
        expect(await exists(join(project, 'kapitel'))).toBe(false);
        expect(trashCalls).toEqual([join(project, 'kapitel')]);
        expect(await readdir(backupDir)).toEqual([token]);
        const redo = await ops.restore(token);
        expect(await readFile(join(project, 'kapitel', 'latin1.tex'))).toEqual(LATIN1_CRLF);
        expect(await readFile(join(project, 'kapitel', 'bild.png'))).toEqual(BINARY);
        expect(await readlink(join(project, 'kapitel', 'verweis.tex'))).toBe('latin1.tex');
        expect(await readdir(project)).toEqual(['kapitel']);
        expect(await readdir(backupDir)).toEqual([]);
        await ops.restore(redo);
        expect(await exists(join(project, 'kapitel'))).toBe(false);
    });

    it('Ziel vorhanden → conflict, nichts überschrieben; Token bleibt gültig', async () => {
        const ops = makeOps();
        await writeFile(join(project, 'main.tex'), LATIN1_CRLF);
        const token = await ops.trash(join(project, 'main.tex'));
        await writeFile(join(project, 'main.tex'), 'neu');
        expect(await errorKind(() => ops.restore(token))).toBe('conflict');
        expect(await readFile(join(project, 'main.tex'), 'utf8')).toBe('neu');
        expect(await readdir(project)).toEqual(['main.tex']);
        await rm(join(project, 'main.tex'));
        await ops.restore(token);
        expect(await readFile(join(project, 'main.tex'))).toEqual(LATIN1_CRLF);
        expect(await errorKind(() => ops.restore(token))).toBe('notFound');
    });

    it('stellt auch in einen inzwischen fehlenden Ordner wieder her', async () => {
        const ops = makeOps();
        await mkdir(join(project, 'a'));
        await writeFile(join(project, 'a', 'x.tex'), 'x');
        const token = await ops.trash(join(project, 'a', 'x.tex'));
        await rm(join(project, 'a'), { recursive: true });
        await ops.restore(token);
        expect(await readFile(join(project, 'a', 'x.tex'), 'utf8')).toBe('x');
    });

    it('scheitert der Papierkorb, bleibt das Original und die Ablage wird geräumt', async () => {
        const ops = makeOps({
            trashItem: async () => {
                throw new Error('Papierkorb voll');
            },
        });
        await writeFile(join(project, 'main.tex'), BINARY);
        expect(await errorKind(() => ops.trash(join(project, 'main.tex')))).toBe('io');
        expect(await readFile(join(project, 'main.tex'))).toEqual(BINARY);
        expect(await readdir(backupDir)).toEqual([]);
    });

    it('ohne Papierkorb: notImplemented, nichts passiert', async () => {
        const ops = makeOps({ trashItem: undefined });
        await writeFile(join(project, 'main.tex'), 'x');
        expect(await errorKind(() => ops.trash(join(project, 'main.tex')))).toBe('notImplemented');
        expect(await exists(join(project, 'main.tex'))).toBe(true);
        expect(await exists(backupDir)).toBe(false);
    });

    it('nie außerhalb des Projekts, nie der Projektordner, kein Symlink nach außen', async () => {
        const ops = makeOps();
        await writeFile(join(outside, 'geheim.tex'), 'geheim');
        await symlink(join(outside, 'geheim.tex'), join(project, 'raus.tex'));
        expect(await errorKind(() => ops.trash(join(outside, 'geheim.tex')))).toBe('forbiddenPath');
        expect(await errorKind(() => ops.trash(join(project, '..', 'Fremd', 'geheim.tex')))).toBe('forbiddenPath');
        expect(await errorKind(() => ops.trash(join(project, 'raus.tex')))).toBe('forbiddenPath');
        expect(await errorKind(() => ops.trash(project))).toBe('forbiddenPath');
        expect(await errorKind(() => ops.trash(base))).toBe('forbiddenPath');
        expect(trashCalls).toEqual([]);
        expect(await readFile(join(outside, 'geheim.tex'), 'utf8')).toBe('geheim');
    });

    it('unbekannter Token: notFound', async () => {
        expect(await errorKind(() => makeOps().restore('gibt-es-nicht'))).toBe('notFound');
    });
});
