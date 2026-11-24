import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GrantStore } from '../../src/main/grants';
import { createFsHandlers, FS_MESSAGES, type FsHandlers } from '../../src/main/handlers/fsHandlers';
import { currentPathPlatform, WINDOWS_PATHS } from '../../src/main/paths';
import { hashBytes } from '../../src/main/textIo';
import { IpcFailure } from '../../src/shared/ipcResult';

// Latin-1 mit CRLF: „Grüße“ als einzelne Bytes, kein gültiges UTF-8.
const LATIN1_CRLF = Buffer.from('\\section{Gr\xfc\xdfe}\r\nZeile 2\r\n', 'latin1');
const UTF8_BOM_LF = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Ä\n', 'utf8')]);

let base: string;
let project: string;
let outside: string;
let grants: GrantStore;
let handlers: FsHandlers;

beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'fs-handlers-')));
    project = join(base, 'Projekt');
    outside = join(base, 'Fremd');
    await mkdir(project);
    await mkdir(outside);
    grants = new GrantStore({ platform: currentPathPlatform() });
    grants.openProject(grants.grant(project, 'project').grantId);
    handlers = createFsHandlers({ grants });
});

afterEach(async () => {
    await rm(base, { recursive: true, force: true });
});

async function errorKind(action: () => Promise<unknown>): Promise<string | null> {
    try {
        await action();
        return null;
    } catch (error) {
        return error instanceof IpcFailure ? error.error.kind : 'other';
    }
}

describe('Dateien im Projekt', () => {
    it('Latin-1 mit CRLF bleibt beim Lesen und Zurückschreiben byte-gleich', async () => {
        const file = join(project, 'main.tex');
        await writeFile(file, LATIN1_CRLF);
        const loaded = await handlers['fs:readText'](file);
        expect(loaded).toMatchObject({ path: file, encoding: 'latin1', eol: 'crlf', hash: hashBytes(LATIN1_CRLF) });
        expect(loaded.text).toBe('\\section{Grüße}\nZeile 2\n');
        await handlers['fs:writeText'](file, loaded.text, loaded.encoding, loaded.eol, loaded.hash);
        expect(await readFile(file)).toEqual(LATIN1_CRLF);
    });

    it('UTF-8 mit BOM bleibt byte-gleich', async () => {
        const file = join(project, 'bom.tex');
        await writeFile(file, UTF8_BOM_LF);
        const loaded = await handlers['fs:readText'](file);
        await handlers['fs:writeText'](file, loaded.text, loaded.encoding, loaded.eol, loaded.hash);
        expect(await readFile(file)).toEqual(UTF8_BOM_LF);
    });

    it('meldet einen Konflikt, wenn der erwartete Hash nicht mehr stimmt', async () => {
        const file = join(project, 'main.tex');
        await writeFile(file, 'alt\n');
        expect(await errorKind(() => handlers['fs:writeText'](file, 'neu\n', 'utf8', 'lf', hashBytes(Buffer.from('x'))))).toBe(
            'conflict',
        );
        expect(await readFile(file, 'utf8')).toBe('alt\n');
    });

    it('verweigert Pfade außerhalb des Projekts, auch über einen Symlink', async () => {
        const secret = join(outside, 'geheim.tex');
        await writeFile(secret, 'geheim');
        await symlink(secret, join(project, 'link.tex'));
        expect(await errorKind(() => handlers['fs:readText'](secret))).toBe('forbiddenPath');
        expect(await errorKind(() => handlers['fs:readText'](join(project, 'link.tex')))).toBe('forbiddenPath');
        expect(await errorKind(() => handlers['fs:writeText'](join(outside, 'neu.tex'), 'x', 'utf8', 'lf'))).toBe(
            'forbiddenPath',
        );
    });

    it('verweigert „..“, auch wenn der Pfad im Projekt bliebe', async () => {
        await writeFile(join(project, 'main.tex'), 'x');
        const escaping = `${project}/../Fremd/geheim.tex`;
        const staying = `${project}/kapitel/../main.tex`;
        await expect(handlers['fs:readText'](escaping)).rejects.toThrow(FS_MESSAGES.parentSegment);
        expect(await errorKind(() => handlers['fs:readText'](staying))).toBe('forbiddenPath');
    });

    it('ohne geöffnetes Projekt gilt kein Pfad', async () => {
        grants.closeProject();
        await writeFile(join(project, 'main.tex'), 'x');
        expect(await errorKind(() => handlers['fs:readText'](join(project, 'main.tex')))).toBe('notFound');
    });
});

describe('UNC-Pfade (Windows)', () => {
    it('werden ohne Dateizugriff verweigert', async () => {
        const windowsGrants = new GrantStore({ platform: WINDOWS_PATHS });
        windowsGrants.openProject(windowsGrants.grant('C:\\Projekt', 'project').grantId);
        const realpathSpy = vi.fn((target: string) => Promise.resolve(target));
        const windowsHandlers = createFsHandlers({ grants: windowsGrants, realpath: realpathSpy });
        expect(await errorKind(() => windowsHandlers['fs:readText']('\\\\server\\share\\main.tex'))).toBe('forbiddenPath');
        expect(await errorKind(() => windowsHandlers['fs:readText']('C:\\Projekt\\..\\Windows\\win.ini'))).toBe(
            'forbiddenPath',
        );
        expect(realpathSpy).not.toHaveBeenCalled();
    });
});

describe('Gewährte Einzeldateien (Kennung statt Pfad)', () => {
    it('liest und schreibt eine gewählte Datei über ihre GrantId, ohne den Pfad zu verraten', async () => {
        const file = join(outside, 'brief.tex');
        await writeFile(file, LATIN1_CRLF);
        const { grantId } = grants.grant(file, 'pickedFile');
        const loaded = await handlers['fs:readText'](grantId);
        expect(loaded.path).toBe(grantId);
        expect(loaded.name).toBe('brief.tex');
        expect(JSON.stringify(loaded)).not.toContain(outside);
        await handlers['fs:writeText'](grantId, `${loaded.text}neu\n`, loaded.encoding, loaded.eol, loaded.hash);
        expect(await readFile(file)).toEqual(Buffer.concat([LATIN1_CRLF, Buffer.from('neu\r\n', 'latin1')]));
    });

    it('schreibt ein neues Ziel aus „Speichern unter“', async () => {
        const target = join(outside, 'neu.tex');
        const { grantId } = grants.grant(target, 'saveTarget');
        const written = await handlers['fs:writeText'](grantId, 'Hallo\n', 'utf8', 'crlf');
        expect(await readFile(target)).toEqual(Buffer.from('Hallo\r\n'));
        expect(written.hash).toBe(hashBytes(Buffer.from('Hallo\r\n')));
    });

    it('verweigert unbekannte Kennungen, Projekt-Kennungen und das Schreiben in Drop-Quellen', async () => {
        const file = join(outside, 'bild.tex');
        await writeFile(file, 'x');
        const dropped = grants.grant(file, 'importSource').grantId;
        const projectGrant = grants.grant(outside, 'project').grantId;
        expect(await errorKind(() => handlers['fs:readText']('erfunden-123'))).toBe('forbiddenPath');
        expect(await errorKind(() => handlers['fs:readText'](projectGrant))).toBe('forbiddenPath');
        expect((await handlers['fs:readText'](dropped)).text).toBe('x');
        expect(await errorKind(() => handlers['fs:writeText'](dropped, 'y', 'utf8', 'lf'))).toBe('forbiddenPath');
    });
});

describe('Symlinks beim Schreiben (N2)', () => {
    it('eine gewählte Datei, die ein Symlink ist, bleibt ein Symlink; geschrieben wird das Ziel', async () => {
        const target = join(outside, 'echt.tex');
        const link = join(outside, 'verweis.tex');
        await writeFile(target, 'alt\n');
        await symlink(target, link);
        const { grantId } = grants.grant(link, 'pickedFile');
        const loaded = await handlers['fs:readText'](grantId);
        expect(loaded.name).toBe('verweis.tex');
        await handlers['fs:writeText'](grantId, 'neu\n', loaded.encoding, loaded.eol, loaded.hash);
        expect((await lstat(link)).isSymbolicLink()).toBe(true);
        expect(await readFile(target, 'utf8')).toBe('neu\n');
    });

    it('ein Symlink im Projekt, der hinaus zeigt, bleibt verboten (Prüfung unverändert)', async () => {
        const secret = join(outside, 'geheim.tex');
        await writeFile(secret, 'x');
        await symlink(secret, join(project, 'hinaus.tex'));
        expect(await errorKind(() => handlers['fs:writeText'](join(project, 'hinaus.tex'), 'y', 'utf8', 'lf'))).toBe('forbiddenPath');
        expect(await readFile(secret, 'utf8')).toBe('x');
    });

    it('ein Symlink im Projekt auf eine Projektdatei bleibt beim Speichern ein Symlink', async () => {
        const real = join(project, 'kapitel.tex');
        const link = join(project, 'kurz.tex');
        await writeFile(real, 'a\n');
        await symlink(real, link);
        const loaded = await handlers['fs:readText'](link);
        expect(loaded).toMatchObject({ path: link, name: 'kurz.tex' });
        await handlers['fs:writeText'](link, 'b\n', loaded.encoding, loaded.eol, loaded.hash);
        expect((await lstat(link)).isSymbolicLink()).toBe(true);
        expect(await readFile(real, 'utf8')).toBe('b\n');
    });
});

describe('fs:readMany', () => {
    it('liefert je Ziel ein eigenes Ergebnis in der gegebenen Reihenfolge', async () => {
        const inside = join(project, 'a.tex');
        await writeFile(inside, 'a');
        const items = await handlers['fs:readMany']([inside, join(outside, 'x.tex'), join(project, 'fehlt.tex')]);
        expect(items.map((item) => item.path)).toEqual([inside, join(outside, 'x.tex'), join(project, 'fehlt.tex')]);
        expect(items.map((item) => item.name)).toEqual(['a.tex', 'x.tex', 'fehlt.tex']);
        expect(items.map((item) => (item.result.ok ? 'ok' : item.result.error.kind))).toEqual([
            'ok',
            'forbiddenPath',
            'notFound',
        ]);
    });
});
