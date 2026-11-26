import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GrantStore } from '../../src/main/grants';
import { createImportHandlers, type ImportHandlers } from '../../src/main/handlers/importHandlers';
import { currentPathPlatform } from '../../src/main/paths';
import { hashBytes } from '../../src/main/textIo';
import { IpcFailure } from '../../src/shared/ipcResult';

const ENTRY = '@misc{neu,\n\ttitle={Neu}\n}\n';
const LATIN1_ORIGINAL = '@book{alt, author={Müller, A}, title={Größe}, date={2000}}\n';
const BOM = '﻿';

let base: string;
let project: string;
let userData: string;
let handlers: ImportHandlers;

beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'bib-append-')));
    project = join(base, 'Projekt');
    userData = join(base, 'userData');
    await mkdir(project);
    const grants = new GrantStore({ platform: currentPathPlatform() });
    grants.openProject(grants.grant(project, 'project').grantId);
    handlers = createImportHandlers({ grants, userDataDir: userData });
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

const bibPath = () => join(project, 'literatur.bib');

describe('bib:append', () => {
    it('erhält eine Latin-1-Datei (Alt-Inhalt byte-gleich, Kodierung bleibt)', async () => {
        await writeFile(bibPath(), Buffer.from(LATIN1_ORIGINAL, 'latin1'));
        const result = await handlers['bib:append'](bibPath(), ENTRY);
        const bytes = await readFile(bibPath());
        expect(bytes.subarray(0, LATIN1_ORIGINAL.length)).toEqual(Buffer.from(LATIN1_ORIGINAL, 'latin1'));
        expect(bytes.toString('latin1')).toBe(`${LATIN1_ORIGINAL}\n${ENTRY}`);
        expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toThrow();
        expect(result).toMatchObject({ path: bibPath(), created: false, hash: hashBytes(bytes) });
        expect(result.mtime).toBeGreaterThan(0);
    });

    it('erhält BOM und CRLF', async () => {
        await writeFile(bibPath(), `${BOM}@book{a,\r\n}\r\n`);
        await handlers['bib:append'](bibPath(), ENTRY);
        expect(await readFile(bibPath(), 'utf8')).toBe(`${BOM}@book{a,\r\n}\r\n\r\n@misc{neu,\r\n\ttitle={Neu}\r\n}\r\n`);
    });

    it('legt fehlende .bib (samt Ordner) an und meldet created', async () => {
        const target = join(project, 'lit', 'neu.bib');
        const result = await handlers['bib:append'](target, ENTRY);
        expect(result.created).toBe(true);
        expect(await readFile(target, 'utf8')).toBe(ENTRY);
        expect(result.hash).toBe(hashBytes(Buffer.from(ENTRY)));
    });

    it('lässt eine unlesbare .bib unverändert', async () => {
        await writeFile(bibPath(), LATIN1_ORIGINAL);
        await chmod(bibPath(), 0o000);
        try {
            if (process.platform !== 'win32' && process.getuid?.() !== 0) {
                expect(await errorKind(() => handlers['bib:append'](bibPath(), ENTRY))).toBe('forbiddenPath');
            }
        } finally {
            await chmod(bibPath(), 0o644);
        }
        expect(await readFile(bibPath(), 'utf8')).toBe(LATIN1_ORIGINAL);
    });

    it('lehnt nicht darstellbare Zeichen in Latin-1 ab, ohne die Datei zu ändern', async () => {
        await writeFile(bibPath(), Buffer.from(LATIN1_ORIGINAL, 'latin1'));
        const before = await readFile(bibPath());
        expect(await errorKind(() => handlers['bib:append'](bibPath(), '@misc{x, title={Łódź}}\n'))).toBe('invalidInput');
        expect(await readFile(bibPath())).toEqual(before);
        expect((await readdir(project)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    });

    it('verweigert Pfade außerhalb des Projekts, mit „..“, per Symlink und andere Endungen', async () => {
        expect(await errorKind(() => handlers['bib:append'](join(base, 'fremd.bib'), ENTRY))).toBe('forbiddenPath');
        expect(await errorKind(() => handlers['bib:append'](`${project}/../fremd.bib`, ENTRY))).toBe('forbiddenPath');
        await symlink(base, join(project, 'fluchtweg'));
        expect(await errorKind(() => handlers['bib:append'](join(project, 'fluchtweg', 'x.bib'), ENTRY))).toBe('forbiddenPath');
        expect(await errorKind(() => handlers['bib:append'](join(project, 'main.tex'), ENTRY))).toBe('invalidInput');
        expect(await readdir(base)).not.toContain('x.bib');
    });

    it('schreibt durch einen Symlink im Projekt auf das Ziel, ohne den Link zu ersetzen', async () => {
        const real = join(project, 'echt.bib');
        await writeFile(real, '@book{a,\n}\n');
        await symlink(real, bibPath());
        await handlers['bib:append'](bibPath(), ENTRY);
        expect(await readFile(real, 'utf8')).toContain('@misc{neu');
        expect((await readFile(bibPath(), 'utf8'))).toBe(await readFile(real, 'utf8'));
    });
});

describe('bib:undo', () => {
    it('stellt die alte Datei byte-gleich wieder her und lässt die Sicherung liegen', async () => {
        const original = Buffer.from(LATIN1_ORIGINAL, 'latin1');
        await writeFile(bibPath(), original);
        const { undoToken } = await handlers['bib:append'](bibPath(), ENTRY);
        const backups = await readdir(join(userData, 'Ablage', undoToken));
        expect(backups).toEqual(['literatur.bib']);
        await handlers['bib:undo'](undoToken);
        expect(await readFile(bibPath())).toEqual(original);
        expect(await readdir(join(userData, 'Ablage', undoToken))).toEqual(['literatur.bib']);
        expect(await errorKind(() => handlers['bib:undo'](undoToken))).toBe('notFound');
    });

    it('verweigert Rückgängig, wenn die Datei inzwischen geändert wurde', async () => {
        await writeFile(bibPath(), '@book{a,\n}\n');
        const { undoToken } = await handlers['bib:append'](bibPath(), ENTRY);
        await writeFile(bibPath(), 'vom Nutzer geändert\n');
        expect(await errorKind(() => handlers['bib:undo'](undoToken))).toBe('conflict');
        expect(await readFile(bibPath(), 'utf8')).toBe('vom Nutzer geändert\n');
    });

    it('nimmt eine angelegte Datei zurück und hebt ihren Inhalt in der Ablage auf', async () => {
        const { undoToken } = await handlers['bib:append'](bibPath(), ENTRY);
        await handlers['bib:undo'](undoToken);
        expect(await readdir(project)).toEqual([]);
        expect(await readFile(join(userData, 'Ablage', undoToken, 'literatur.bib'), 'utf8')).toBe(ENTRY);
    });
});
