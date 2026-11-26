import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GrantStore } from '../../src/main/grants';
import { createImportHandlers, type ImportHandlers } from '../../src/main/handlers/importHandlers';
import { currentPathPlatform } from '../../src/main/paths';
import { IpcFailure } from '../../src/shared/ipcResult';

const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02]);
const MEGABYTE = 1024 * 1024;

let base: string;
let project: string;
let outside: string;
let grants: GrantStore;
let handlers: ImportHandlers;

beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'image-import-')));
    project = join(base, 'Projekt');
    outside = join(base, 'Downloads');
    await Promise.all([mkdir(project), mkdir(outside)]);
    grants = new GrantStore({ platform: currentPathPlatform() });
    grants.openProject(grants.grant(project, 'project').grantId);
    handlers = createImportHandlers({ grants, userDataDir: join(base, 'userData') });
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

async function granted(name: string, content: Buffer, dir = outside): Promise<string> {
    const path = join(dir, name);
    await writeFile(path, content);
    return grants.grant(path, 'importSource').grantId;
}

describe('image:import', () => {
    it('kopiert mit bereinigtem Namen ins Bilderverzeichnis und legt es an', async () => {
        const grantId = await granted('Mein Foto (1).PNG', PNG_A);
        const result = await handlers['image:import'](grantId, join(project, 'images'));
        expect(result).toEqual({ relPath: 'images/Mein-Foto-1.png', reused: false });
        expect(await readFile(join(project, 'images', 'Mein-Foto-1.png'))).toEqual(PNG_A);
        expect(await readFile(join(outside, 'Mein Foto (1).PNG'))).toEqual(PNG_A);
    });

    it('verwendet gleichen Inhalt weiter, nummeriert anderen Inhalt und überschreibt nie', async () => {
        const first = await handlers['image:import'](await granted('a.png', PNG_A), join(project, 'images'));
        const again = await handlers['image:import'](await granted('a.png', PNG_A), join(project, 'images'));
        expect(again).toEqual({ relPath: first.relPath, reused: true });
        const otherDir = join(outside, 'anderswo');
        await mkdir(otherDir);
        const second = await handlers['image:import'](await granted('a.png', PNG_B, otherDir), join(project, 'images'));
        expect(second).toEqual({ relPath: 'images/a-2.png', reused: false });
        const third = await handlers['image:import'](await granted('a.png', Buffer.from('C'), otherDir), join(project, 'images'));
        expect(third.relPath).toBe('images/a-3.png');
        expect(await readFile(join(project, 'images', 'a.png'))).toEqual(PNG_A);
        expect(await readdir(join(project, 'images'))).toHaveLength(3);
    });

    it('nimmt eine Datei, die schon im Bilderverzeichnis liegt, unverändert', async () => {
        await mkdir(join(project, 'images'));
        const grantId = await granted('schon da.png', PNG_A, join(project, 'images'));
        expect(await handlers['image:import'](grantId, join(project, 'images'))).toEqual({
            relPath: 'images/schon da.png',
            reused: true,
        });
        expect(await readdir(join(project, 'images'))).toEqual(['schon da.png']);
    });

    it('lehnt nicht erlaubte Endungen ab und legt nichts an', async () => {
        const grantId = await granted('Foto.heic', PNG_A);
        expect(await errorKind(() => handlers['image:import'](grantId, join(project, 'images')))).toBe('invalidInput');
        const svg = await granted('logo.svg', PNG_A);
        expect(await errorKind(() => handlers['image:import'](svg, join(project, 'images')))).toBe('invalidInput');
        expect(await readdir(project)).toEqual([]);
    });

    it('lehnt zu große Dateien ab', async () => {
        const grantId = await granted('riesig.png', Buffer.alloc(51 * MEGABYTE));
        expect(await errorKind(() => handlers['image:import'](grantId, join(project, 'images')))).toBe('invalidInput');
        expect(await readdir(project)).toEqual([]);
    });

    it('verlangt eine Gewährung statt eines nackten Pfads', async () => {
        await writeFile(join(outside, 'a.png'), PNG_A);
        expect(await errorKind(() => handlers['image:import'](join(outside, 'a.png'), join(project, 'images')))).toBe('forbiddenPath');
        expect(await errorKind(() => handlers['image:import']('unbekannt-123', join(project, 'images')))).toBe('forbiddenPath');
        const projectGrant = grants.grant(join(outside, 'a.png'), 'saveTarget').grantId;
        expect(await errorKind(() => handlers['image:import'](projectGrant, join(project, 'images')))).toBe('forbiddenPath');
    });

    it('verweigert Zielordner außerhalb des Projekts, mit „..“ und per Symlink', async () => {
        const grantId = await granted('a.png', PNG_A);
        expect(await errorKind(() => handlers['image:import'](grantId, join(outside, 'images')))).toBe('forbiddenPath');
        expect(await errorKind(() => handlers['image:import'](grantId, `${project}/images/../../Downloads`))).toBe('forbiddenPath');
        await symlink(outside, join(project, 'fluchtweg'));
        expect(await errorKind(() => handlers['image:import'](grantId, join(project, 'fluchtweg')))).toBe('forbiddenPath');
        expect(await readdir(outside)).toEqual(['a.png']);
    });

    it('prüft die Quelle nach dem Auflösen von Symlinks erneut (Endung)', async () => {
        await writeFile(join(outside, 'geheim.txt'), 'x');
        await symlink(join(outside, 'geheim.txt'), join(outside, 'harmlos.png'));
        const grantId = grants.grant(join(outside, 'harmlos.png'), 'importSource').grantId;
        expect(await errorKind(() => handlers['image:import'](grantId, join(project, 'images')))).toBe('invalidInput');
    });

    it('lehnt UNC-Quellen vor jedem Dateizugriff ab', async () => {
        const result = await handlers['drop:grant']([String.raw`\\server\freigabe\a.png`, join(outside, 'fehlt.png')]);
        expect(result.granted).toEqual([]);
        expect(result.rejected).toHaveLength(2);
    });
});

describe('drop:grant', () => {
    it('gewährt erlaubte Dateien als Importquelle und nennt abgelehnte nur mit Namen', async () => {
        await Promise.all([writeFile(join(outside, 'a.png'), PNG_A), writeFile(join(outside, 'b.exe'), 'x')]);
        const result = await handlers['drop:grant']([join(outside, 'a.png'), join(outside, 'b.exe')]);
        expect(result.granted.map((item) => item.name)).toEqual(['a.png']);
        expect(result.rejected).toEqual(['b.exe']);
        const imported = await handlers['image:import'](result.granted[0]?.grantId ?? '', join(project, 'images'));
        expect(imported.relPath).toBe('images/a.png');
    });
});

describe('Rechte', () => {
    it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('meldet einen nicht beschreibbaren Bilderordner als Fehler', async () => {
        const images = join(project, 'images');
        await mkdir(images);
        await chmod(images, 0o500);
        try {
            const grantId = await granted('a.png', PNG_A);
            expect(await errorKind(() => handlers['image:import'](grantId, images))).not.toBeNull();
            expect(await readdir(images)).toEqual([]);
        } finally {
            await chmod(images, 0o700);
        }
    });
});
