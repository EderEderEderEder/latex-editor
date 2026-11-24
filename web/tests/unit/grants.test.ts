import { describe, expect, it, vi } from 'vitest';
import {
    checkImportSource,
    FILE_IMPORT_RULES,
    type FileStatLike,
    GRANT_MESSAGES,
    GrantStore,
    grantDroppedPaths,
    IMAGE_IMPORT_RULES,
    type ImportSourceDependencies,
} from '../../src/main/grants';
import { MACOS_PATHS, type RealpathFunction, WINDOWS_PATHS } from '../../src/main/paths';
import { IpcFailure } from '../../src/shared/ipcResult';

function sequentialIds(): () => string {
    let next = 0;
    return () => `grant-${next++}`;
}

function errorKind(action: () => unknown): string | null {
    try {
        action();
        return null;
    } catch (error) {
        return error instanceof IpcFailure ? error.error.kind : 'other';
    }
}

describe('GrantStore', () => {
    it('vergibt Kennungen mit Anzeigenamen; der Renderer sieht keinen Pfad', () => {
        const store = new GrantStore({ platform: WINDOWS_PATHS, createId: sequentialIds() });
        expect(store.grant('c:/Users/Max/Arbeit/', 'project')).toEqual({ grantId: 'grant-0', name: 'Arbeit' });
        expect(store.resolve('grant-0', 'project')).toBe('C:\\Users\\Max\\Arbeit');
    });

    it('unbekannte Kennung oder falsche Art ergibt forbiddenPath', () => {
        const store = new GrantStore({ platform: MACOS_PATHS, createId: sequentialIds() });
        store.grant('/Users/u/bild.png', 'importSource');
        expect(errorKind(() => store.resolve('grant-0', 'project'))).toBe('forbiddenPath');
        expect(errorKind(() => store.openProject('grant-0'))).toBe('forbiddenPath');
        expect(errorKind(() => store.resolve('erfunden', 'importSource'))).toBe('forbiddenPath');
    });

    it('openProject setzt das aktuelle Projekt nur aus einer Projekt-Gewährung', () => {
        const store = new GrantStore({ platform: MACOS_PATHS, createId: sequentialIds() });
        expect(errorKind(() => store.requireProject())).toBe('notFound');
        const { grantId } = store.grant('/Users/u/Projekt', 'project');
        expect(store.openProject(grantId)).toBe('/Users/u/Projekt');
        expect(store.currentProject).toBe('/Users/u/Projekt');
        store.closeProject();
        expect(store.currentProject).toBeNull();
    });

    it('assertInProject prüft gegen das Projekt des Main, nicht gegen eine Angabe des Renderers', async () => {
        const store = new GrantStore({ platform: MACOS_PATHS, createId: sequentialIds() });
        const identity: RealpathFunction = (target) => Promise.resolve(target);
        await expect(store.assertInProject('/Users/u/Projekt/a.tex', identity)).rejects.toThrow(GRANT_MESSAGES.noProject);
        store.openProject(store.grant('/Users/u/Projekt', 'project').grantId);
        await expect(store.assertInProject('/Users/u/Projekt/a.tex', identity)).resolves.toBe('/Users/u/Projekt/a.tex');
        await expect(store.assertInProject('/Users/u/.ssh/id_rsa', identity)).rejects.toThrow(IpcFailure);
    });

    it('älteste Kennungen verfallen bei Überschreiten der Obergrenze', () => {
        const store = new GrantStore({ platform: MACOS_PATHS, createId: sequentialIds(), maxGrants: 2 });
        ['/a', '/b', '/c'].forEach((path) => store.grant(path, 'project'));
        expect(errorKind(() => store.resolve('grant-0', 'project'))).toBe('forbiddenPath');
        expect(store.resolve('grant-2', 'project')).toBe('/c');
    });
});

const KILOBYTE = 1024;

function fakeFileSystem(files: Record<string, number>, links: Record<string, string> = {}): ImportSourceDependencies {
    const realpath = vi.fn<RealpathFunction>((target) => Promise.resolve(links[target] ?? target));
    const stat = (target: string): Promise<FileStatLike> => {
        const size = files[target];
        return Promise.resolve({ isFile: () => size !== undefined, size: size ?? 0 });
    };
    return { platform: MACOS_PATHS, realpath, stat };
}

describe('checkImportSource', () => {
    it('erlaubte Endung und Größe: liefert den aufgelösten Pfad', async () => {
        const fs = fakeFileSystem({ '/Users/u/Bild.PNG': KILOBYTE });
        await expect(checkImportSource('/Users/u/Bild.PNG', IMAGE_IMPORT_RULES, fs)).resolves.toBe('/Users/u/Bild.PNG');
    });

    it.each([
        ['/Users/u/.ssh/id_rsa', 'Dateityp nicht erlaubt'],
        ['/Users/u/skript.sh', 'Dateityp nicht erlaubt'],
        ['/Users/u/ordner.png', 'Keine Datei'],
        ['/Users/u/riesig.png', 'Datei zu groß'],
        ['/Users/u/tarnung.png', 'Dateityp nicht erlaubt'],
    ])('%s wird abgelehnt (%s)', async (path, message) => {
        const fs = fakeFileSystem(
            { '/Users/u/riesig.png': IMAGE_IMPORT_RULES.maxBytes + 1, '/Users/u/.ssh/id_rsa': KILOBYTE },
            { '/Users/u/tarnung.png': '/Users/u/.ssh/id_rsa' },
        );
        await expect(checkImportSource(path, IMAGE_IMPORT_RULES, fs)).rejects.toThrow(message);
    });

    it('UNC wird vor jedem Dateizugriff abgelehnt (kein SMB-Verbindungsaufbau)', async () => {
        const realpath = vi.fn<RealpathFunction>((target) => Promise.resolve(target));
        const deps: ImportSourceDependencies = { platform: WINDOWS_PATHS, realpath, stat: () => Promise.reject(new Error('x')) };
        await expect(checkImportSource('\\\\server\\share\\bild.png', IMAGE_IMPORT_RULES, deps)).rejects.toThrow('UNC');
        await expect(checkImportSource('\\\\?\\UNC\\server\\share\\a.png', IMAGE_IMPORT_RULES, deps)).rejects.toThrow('UNC');
        expect(realpath).not.toHaveBeenCalled();
    });

    it('Symlink auf einen Netzwerkpfad wird nach dem Auflösen abgelehnt', async () => {
        const deps: ImportSourceDependencies = {
            platform: WINDOWS_PATHS,
            realpath: () => Promise.resolve('\\\\server\\share\\bild.png'),
            stat: () => Promise.resolve({ isFile: () => true, size: 1 }),
        };
        await expect(checkImportSource('C:\\Bilder\\bild.png', IMAGE_IMPORT_RULES, deps)).rejects.toThrow('UNC');
    });
});

describe('grantDroppedPaths', () => {
    it('gewährt geprüfte Dateien als Importquelle, abgelehnte nur mit Namen', async () => {
        const store = new GrantStore({ platform: MACOS_PATHS, createId: sequentialIds() });
        const fs = fakeFileSystem({ '/Users/u/kapitel.tex': KILOBYTE, '/Users/u/.zshrc': KILOBYTE });
        const result = await grantDroppedPaths(store, ['/Users/u/kapitel.tex', '/Users/u/.zshrc'], fs);
        expect(result).toEqual({ granted: [{ grantId: 'grant-0', name: 'kapitel.tex' }], rejected: ['.zshrc'] });
        expect(store.resolve('grant-0', 'importSource')).toBe('/Users/u/kapitel.tex');
        expect(errorKind(() => store.openProject('grant-0'))).toBe('forbiddenPath');
        expect(FILE_IMPORT_RULES.extensions.has('.tex')).toBe(true);
    });
});

describe('GrantStore.resolveOneOf', () => {
    it('liefert den Pfad nur für eine der genannten Arten', () => {
        const store = new GrantStore({ platform: MACOS_PATHS, createId: sequentialIds() });
        store.grant('/Users/u/brief.tex', 'pickedFile');
        expect(store.resolveOneOf('grant-0', ['saveTarget', 'pickedFile'])).toBe('/Users/u/brief.tex');
        expect(errorKind(() => store.resolveOneOf('grant-0', ['saveTarget', 'importSource']))).toBe('forbiddenPath');
        expect(errorKind(() => store.resolveOneOf('erfunden', ['pickedFile']))).toBe('forbiddenPath');
    });
});
