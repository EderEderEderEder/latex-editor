import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GrantStore } from '../../src/main/grants';
import { BACKUP_FOLDER_NAME, createFsOpsHandlers, type FsOpsHandlers } from '../../src/main/handlers/fsOpsHandlers';
import { currentPathPlatform } from '../../src/main/paths';
import { IpcFailure } from '../../src/shared/ipcResult';

const LATIN1_CRLF = Buffer.from('Gr\xfc\xdfe\r\nZeile\r\n', 'latin1');
const BINARY = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0d, 0x0a]);

let base: string;
let project: string;
let outside: string;
let userData: string;
let trashDir: string;
let grants: GrantStore;
let handlers: FsOpsHandlers;

beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'fs-ops-handlers-')));
    project = join(base, 'Projekt');
    outside = join(base, 'Fremd');
    userData = join(base, 'userData');
    trashDir = join(base, 'Papierkorb');
    await Promise.all([mkdir(project), mkdir(outside), mkdir(trashDir)]);
    grants = new GrantStore({ platform: currentPathPlatform() });
    grants.openProject(grants.grant(project, 'project').grantId);
    const trashItem = (path: string) => rename(path, join(trashDir, `${randomUUID()}-${basename(path)}`));
    handlers = createFsOpsHandlers({ grants, userDataDir: userData, trashItem });
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

describe('fs:import nur mit Gewährung', () => {
    it('kopiert gewährte Importquellen und gewählte Dateien byte-gleich', async () => {
        await writeFile(join(outside, 'bild.png'), BINARY);
        await writeFile(join(outside, 'refs.bib'), LATIN1_CRLF);
        const dropped = grants.grant(join(outside, 'bild.png'), 'importSource').grantId;
        const picked = grants.grant(join(outside, 'refs.bib'), 'pickedFile').grantId;
        const result = await handlers['fs:import']([dropped, picked], project);
        expect(result.paths).toEqual([join(project, 'bild.png'), join(project, 'refs.bib')]);
        expect(await readFile(join(project, 'bild.png'))).toEqual(BINARY);
        expect(await readFile(join(project, 'refs.bib'))).toEqual(LATIN1_CRLF);
    });

    it('verweigert unbekannte Kennungen, falsche Arten, Pfade statt Kennungen und fremde Endungen', async () => {
        await writeFile(join(outside, 'bild.png'), BINARY);
        await writeFile(join(outside, 'programm.exe'), BINARY);
        const saveTarget = grants.grant(join(outside, 'bild.png'), 'saveTarget').grantId;
        const exe = grants.grant(join(outside, 'programm.exe'), 'importSource').grantId;
        expect(await errorKind(() => handlers['fs:import'](['unbekannt'], project))).toBe('forbiddenPath');
        expect(await errorKind(() => handlers['fs:import']([saveTarget], project))).toBe('forbiddenPath');
        expect(await errorKind(() => handlers['fs:import']([join(outside, 'bild.png')], project))).toBe('forbiddenPath');
        expect(await errorKind(() => handlers['fs:import']([exe], project))).toBe('invalidInput');
        expect(await errorKind(() => handlers['fs:import']([], project))).toBe('invalidInput');
        expect(await readdir(project)).toEqual([]);
    });

    it('Ziel nur im Projekt, auch nicht über einen Symlink-Ordner', async () => {
        await writeFile(join(outside, 'bild.png'), BINARY);
        await symlink(outside, join(project, 'raus'));
        const grant = grants.grant(join(outside, 'bild.png'), 'importSource').grantId;
        expect(await errorKind(() => handlers['fs:import']([grant], outside))).toBe('forbiddenPath');
        expect(await errorKind(() => handlers['fs:import']([grant], join(project, 'raus')))).toBe('forbiddenPath');
        expect(await readdir(outside)).toEqual(['bild.png']);
    });
});

describe('Kanäle', () => {
    it('anlegen, umbenennen, verschieben, duplizieren, Papierkorb, Wiederherstellen', async () => {
        const created = await handlers['fs:create'](project, 'kapitel', 'file');
        await mkdir(join(project, 'teile'));
        const renamed = await handlers['fs:rename'](created.path, 'Kapitel');
        const moved = await handlers['fs:move'](renamed.path, join(project, 'teile'));
        expect(moved.path).toBe(join(project, 'teile', 'Kapitel.tex'));
        await writeFile(moved.path, LATIN1_CRLF);
        const copy = await handlers['fs:duplicate'](moved.path);
        expect(basename(copy.path)).toBe('Kapitel Kopie.tex');
        const token = await handlers['fs:trash'](moved.path);
        expect(await readdir(join(userData, BACKUP_FOLDER_NAME))).toEqual([token]);
        await handlers['fs:restore'](token);
        expect(await readFile(moved.path)).toEqual(LATIN1_CRLF);
    });

    it('ohne Projekt: notFound', async () => {
        grants.closeProject();
        expect(await errorKind(() => handlers['fs:create'](project, 'x', 'file'))).toBe('notFound');
        expect(await readdir(project)).toEqual([]);
    });

    it('Token aus einem anderen Projekt greift nicht ins neue', async () => {
        await writeFile(join(project, 'main.tex'), 'x');
        const token = await handlers['fs:trash'](join(project, 'main.tex'));
        grants.openProject(grants.grant(outside, 'project').grantId);
        expect(await errorKind(() => handlers['fs:restore'](token))).toBe('forbiddenPath');
        expect(await readdir(project)).toEqual([]);
    });
});
