import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
    arePathsEqual,
    currentPathPlatform,
    fileUrlToPath,
    isInsideProject,
    isPathWithin,
    isUncPath,
    LINUX_PATHS,
    MACOS_PATHS,
    normalizeAbsolutePath,
    pathToFileUrl,
    projectHash,
    type RealpathFunction,
    resolveRealPath,
    WINDOWS_PATHS,
} from '../../src/main/paths';
import { IpcFailure } from '../../src/shared/ipcResult';

const SHA256_HEX_LENGTH = 64;

describe('normalizeAbsolutePath (Windows über path.win32)', () => {
    it.each([
        ['c:/Users\\Max/./Doku/../Arbeit/', 'C:\\Users\\Max\\Arbeit'],
        ['C:\\', 'C:\\'],
        ['d:\\a\\\\b', 'D:\\a\\b'],
        ['\\\\?\\C:\\Lang\\Pfad', 'C:\\Lang\\Pfad'],
        ['\\\\?\\UNC\\server\\share\\a', '\\\\server\\share\\a'],
        ['//server/share/a/../b', '\\\\server\\share\\b'],
        ['\\\\server\\share\\..\\..\\x', '\\\\server\\share\\x'],
    ])('%s → %s', (input, expected) => {
        expect(normalizeAbsolutePath(input, WINDOWS_PATHS)).toBe(expected);
    });

    it.each(['c:', 'C:relativ', '\\ohne\\laufwerk', 'relativ\\pfad', '\\\\.\\COM1', '\\\\?\\GLOBALROOT\\x', '', 'C:\\a\0b'])(
        'lehnt %j ab',
        (input) => {
            expect(() => normalizeAbsolutePath(input, WINDOWS_PATHS)).toThrow(IpcFailure);
        },
    );

    it('lehnt Nicht-Strings ab', () => {
        expect(() => normalizeAbsolutePath(42, WINDOWS_PATHS)).toThrow(IpcFailure);
    });
});

describe('normalizeAbsolutePath (POSIX)', () => {
    it.each([
        ['/a/b/../c/', '/a/c'],
        ['/', '/'],
        ['//doppelt//pfad', '/doppelt/pfad'],
        ['/a/./b', '/a/b'],
    ])('%s → %s', (input, expected) => {
        expect(normalizeAbsolutePath(input, LINUX_PATHS)).toBe(expected);
    });

    it('lehnt relative und Windows-Pfade ab', () => {
        expect(() => normalizeAbsolutePath('a/b', LINUX_PATHS)).toThrow(IpcFailure);
        expect(() => normalizeAbsolutePath('C:\\a', LINUX_PATHS)).toThrow(IpcFailure);
    });
});

describe('isPathWithin', () => {
    it('Windows: Groß-/Kleinschreibung egal, Laufwerk zählt', () => {
        expect(isPathWithin('C:\\Proj\\kapitel\\a.tex', 'c:\\proj', WINDOWS_PATHS)).toBe(true);
        expect(isPathWithin('c:/PROJ', 'C:\\Proj\\', WINDOWS_PATHS)).toBe(true);
        expect(isPathWithin('D:\\Proj\\a.tex', 'C:\\Proj', WINDOWS_PATHS)).toBe(false);
    });

    it('Windows: Namensvorsilbe und `..` führen nicht hinein', () => {
        expect(isPathWithin('C:\\Project2\\a.tex', 'C:\\Proj', WINDOWS_PATHS)).toBe(false);
        expect(isPathWithin('C:\\Proj\\..\\Andere\\a.tex', 'C:\\Proj', WINDOWS_PATHS)).toBe(false);
        expect(isPathWithin('C:\\Proj\\sub\\..\\a.tex', 'C:\\Proj', WINDOWS_PATHS)).toBe(true);
    });

    it('Windows: Laufwerkswurzel und UNC', () => {
        expect(isPathWithin('C:\\x\\y', 'C:\\', WINDOWS_PATHS)).toBe(true);
        expect(isPathWithin('\\\\server\\share\\..\\..\\x', '\\\\server\\share', WINDOWS_PATHS)).toBe(true);
        expect(isPathWithin('\\\\server\\andere\\x', '\\\\server\\share', WINDOWS_PATHS)).toBe(false);
        expect(isPathWithin('\\\\SERVER\\Share\\a.tex', '\\\\server\\share', WINDOWS_PATHS)).toBe(true);
    });

    it('Linux unterscheidet Groß-/Kleinschreibung, macOS nicht', () => {
        expect(isPathWithin('/home/u/Proj/a.tex', '/home/u/proj', LINUX_PATHS)).toBe(false);
        expect(isPathWithin('/Users/u/Proj/a.tex', '/Users/u/proj', MACOS_PATHS)).toBe(true);
        expect(isPathWithin('/home/u/proj/../geheim', '/home/u/proj', LINUX_PATHS)).toBe(false);
    });

    it('macOS: NFD- und NFC-Umlaute sind gleich', () => {
        const nfd = '/Users/u/U\u0308bung';
        const nfc = '/Users/u/\u00dcbung';
        expect(arePathsEqual(nfd, nfc, MACOS_PATHS)).toBe(true);
    });

    it('Linux und Windows: NFD und NFC sind verschiedene Namen (ext4, NTFS)', () => {
        expect(arePathsEqual('/home/u/U\u0308bung', '/home/u/\u00dcbung', LINUX_PATHS)).toBe(false);
        expect(arePathsEqual('C:\\U\u0308bung', 'C:\\\u00dcbung', WINDOWS_PATHS)).toBe(false);
    });
});

function fakeRealpath(links: Record<string, string>, existing: readonly string[]): RealpathFunction {
    return (target) => {
        const link = links[target];
        if (link !== undefined) return Promise.resolve(link);
        if (existing.includes(target)) return Promise.resolve(target);
        return Promise.reject(Object.assign(new Error('fehlt'), { code: 'ENOENT' }));
    };
}

describe('resolveRealPath / isInsideProject mit gefälschtem realpath (Windows)', () => {
    const realpath = fakeRealpath({ 'C:\\Proj\\link': 'D:\\Woanders', 'C:\\PROGRA~1': 'C:\\Program Files' }, [
        'C:\\',
        'C:\\Proj',
        'D:\\',
    ]);
    const options = { platform: WINDOWS_PATHS, realpath };

    it('hängt fehlende Teile an den nächsten vorhandenen Vorfahr', async () => {
        await expect(resolveRealPath('c:/proj/neu/datei.tex', options)).resolves.toBe('C:\\proj\\neu\\datei.tex');
        await expect(resolveRealPath('C:\\PROGRA~1\\x', options)).resolves.toBe('C:\\Program Files\\x');
    });

    it('Symlink aus dem Projekt hinaus zählt als außerhalb', async () => {
        await expect(isInsideProject('C:\\Proj\\link\\x.tex', 'C:\\Proj', options)).resolves.toBe(false);
        await expect(isInsideProject('C:\\Proj\\kapitel\\x.tex', 'c:\\proj', options)).resolves.toBe(true);
    });

    it('lexikalisch außerhalb: realpath wird gar nicht aufgerufen (kein SMB, kein autofs)', async () => {
        const spy = vi.fn<RealpathFunction>((target) => Promise.resolve(target));
        const spied = { platform: WINDOWS_PATHS, realpath: spy };
        await expect(isInsideProject('\\\\server\\share\\x.tex', 'C:\\Proj', spied)).resolves.toBe(false);
        await expect(isInsideProject('\\\\?\\UNC\\server\\s\\x', 'C:\\Proj', spied)).resolves.toBe(false);
        await expect(isInsideProject('D:\\Woanders\\x.tex', 'C:\\Proj', spied)).resolves.toBe(false);
        const macSpy = vi.fn<RealpathFunction>((target) => Promise.resolve(target));
        await expect(isInsideProject('/net/server/x.tex', '/Users/u/p', { platform: MACOS_PATHS, realpath: macSpy })).resolves.toBe(false);
        expect(spy).not.toHaveBeenCalled();
        expect(macSpy).not.toHaveBeenCalled();
    });

    it('UNC nur, wenn die Projektwurzel selbst UNC ist', async () => {
        const identity: RealpathFunction = (target) => Promise.resolve(target);
        const options = { platform: WINDOWS_PATHS, realpath: identity };
        await expect(isInsideProject('\\\\server\\share\\p\\a.tex', '\\\\server\\share\\p', options)).resolves.toBe(true);
        expect(isUncPath('\\\\server\\share', WINDOWS_PATHS)).toBe(true);
        expect(isUncPath('C:\\x', WINDOWS_PATHS)).toBe(false);
        expect(isUncPath('//server/share', LINUX_PATHS)).toBe(false);
    });

    it('andere Fehler als „fehlt“ werden weitergereicht', async () => {
        const denied: RealpathFunction = () => Promise.reject(Object.assign(new Error('verboten'), { code: 'EACCES' }));
        await expect(resolveRealPath('C:\\x', { platform: WINDOWS_PATHS, realpath: denied })).rejects.toThrow('verboten');
    });
});

describe('isInsideProject mit echtem Dateisystem (Temp-Ordner)', () => {
    let base = '';
    let project = '';

    beforeAll(async () => {
        base = await mkdtemp(join(tmpdir(), 'latexeditor-paths-'));
        project = join(base, 'projekt');
        await mkdir(join(project, 'kapitel'), { recursive: true });
        await mkdir(join(base, 'draussen'));
        await writeFile(join(project, 'kapitel', 'a.tex'), '');
        await symlink(join(base, 'draussen'), join(project, 'link'));
    });

    afterAll(async () => {
        if (base !== '') await rm(base, { recursive: true, force: true });
    });

    it('erkennt Dateien im Projekt, auch noch nicht vorhandene', async () => {
        await expect(isInsideProject(join(project, 'kapitel', 'a.tex'), project)).resolves.toBe(true);
        await expect(isInsideProject(join(project, 'neu', 'b.tex'), project)).resolves.toBe(true);
    });

    it('`..` und Symlinks führen nicht hinaus', async () => {
        await expect(isInsideProject(`${project}/../draussen/x.tex`, project)).resolves.toBe(false);
        await expect(isInsideProject(join(project, 'link', 'x.tex'), project)).resolves.toBe(false);
    });

    it('Projektpfad über einen Symlink ergibt denselben Hash wie das Ziel', async () => {
        const platform = currentPathPlatform();
        const viaLink = await resolveRealPath(join(project, 'link'));
        const direct = await resolveRealPath(join(base, 'draussen'));
        expect(projectHash(viaLink, platform)).toBe(projectHash(direct, platform));
    });
});

describe('projectHash', () => {
    it('Windows: gleicher Hash für Schreibvarianten', () => {
        const hash = projectHash('C:\\Proj', WINDOWS_PATHS);
        expect(hash).toHaveLength(SHA256_HEX_LENGTH);
        expect(projectHash('c:/proj/', WINDOWS_PATHS)).toBe(hash);
    });

    it('Linux: Groß-/Kleinschreibung ergibt verschiedene Hashes', () => {
        expect(projectHash('/home/Proj', LINUX_PATHS)).not.toBe(projectHash('/home/proj', LINUX_PATHS));
    });
});

describe('Pfad ↔ file:-URL', () => {
    it('Windows mit Leerzeichen und Umlaut', () => {
        const url = pathToFileUrl('c:\\Users\\Max\\Bachelor Arbeit\\ä.tex', WINDOWS_PATHS);
        expect(url).toBe('file:///C:/Users/Max/Bachelor%20Arbeit/%C3%A4.tex');
        expect(fileUrlToPath(url, WINDOWS_PATHS)).toBe('C:\\Users\\Max\\Bachelor Arbeit\\ä.tex');
    });

    it('Windows UNC', () => {
        const url = pathToFileUrl('\\\\server\\share\\a.tex', WINDOWS_PATHS);
        expect(url).toBe('file://server/share/a.tex');
        expect(fileUrlToPath(url, WINDOWS_PATHS)).toBe('\\\\server\\share\\a.tex');
    });

    it('POSIX', () => {
        const url = pathToFileUrl('/a b/c.tex', LINUX_PATHS);
        expect(url).toBe('file:///a%20b/c.tex');
        expect(fileUrlToPath(url, LINUX_PATHS)).toBe('/a b/c.tex');
    });

    it('lehnt fremde und unpassende URLs ab', () => {
        expect(() => fileUrlToPath('https://example.com/a.tex', LINUX_PATHS)).toThrow(IpcFailure);
        expect(() => fileUrlToPath('kein url', LINUX_PATHS)).toThrow(IpcFailure);
        expect(() => fileUrlToPath('file://server/share/a.tex', LINUX_PATHS)).toThrow(IpcFailure);
    });
});
