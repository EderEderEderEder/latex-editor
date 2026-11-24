import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GrantStore } from '../../src/main/grants';
import { createFsHandlers } from '../../src/main/handlers/fsHandlers';
import { createProjectHandlers, type ProjectHandlers } from '../../src/main/handlers/projectHandlers';
import { currentPathPlatform } from '../../src/main/paths';
import { RecentProjectsStore } from '../../src/main/project';
import { IpcFailure } from '../../src/shared/ipcResult';

let base: string;
let grants: GrantStore;
let handlers: ProjectHandlers;

beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'project-handlers-')));
    const platform = currentPathPlatform();
    grants = new GrantStore({ platform });
    handlers = createProjectHandlers({ grants, recent: new RecentProjectsStore(join(base, 'data'), platform) });
});

afterEach(async () => {
    await rm(base, { recursive: true, force: true });
});

async function makeProject(name: string): Promise<string> {
    const dir = join(base, name);
    await mkdir(dir);
    await writeFile(join(dir, 'main.tex'), '\\documentclass{article}');
    return dir;
}

async function errorKind(action: () => Promise<unknown>): Promise<string | null> {
    try {
        await action();
        return null;
    } catch (error) {
        return error instanceof IpcFailure ? error.error.kind : 'other';
    }
}

describe('project:open', () => {
    it('setzt das aktuelle Projekt und liefert Baum und Hauptdatei', async () => {
        const dir = await makeProject('A');
        const info = await handlers['project:open'](grants.grant(dir, 'project').grantId);
        expect(info.root).toBe(dir);
        expect(info.mainFile).toBe(join(dir, 'main.tex'));
        expect(grants.currentProject).toBe(dir);
    });

    it('Projektwechsel ersetzt das Projekt; danach sind nur dessen Pfade für fs:readText erlaubt', async () => {
        const first = await makeProject('A');
        const second = await makeProject('B');
        const fs = createFsHandlers({ grants });
        await handlers['project:open'](grants.grant(first, 'project').grantId);
        expect((await fs['fs:readText'](join(first, 'main.tex'))).text).toContain('documentclass');
        await handlers['project:open'](grants.grant(second, 'project').grantId);
        expect((await fs['fs:readText'](join(second, 'main.tex'))).text).toContain('documentclass');
        expect(await errorKind(() => fs['fs:readText'](join(first, 'main.tex')))).toBe('forbiddenPath');
    });

    it('fremde oder falsche Kennung ist ein Fehler und ändert nichts', async () => {
        const dir = await makeProject('A');
        const picked = grants.grant(join(base, 'A', 'main.tex'), 'pickedFile').grantId;
        expect(await errorKind(() => handlers['project:open']('unbekannt-123'))).toBe('forbiddenPath');
        expect(await errorKind(() => handlers['project:open'](picked))).toBe('forbiddenPath');
        expect(grants.currentProject).toBeNull();
        expect(dir).toBeTruthy();
    });

    it('fehlender Ordner: notFound, bisheriges Projekt bleibt', async () => {
        const dir = await makeProject('A');
        await handlers['project:open'](grants.grant(dir, 'project').grantId);
        const gone = grants.grant(join(base, 'weg'), 'project').grantId;
        expect(await errorKind(() => handlers['project:open'](gone))).toBe('notFound');
        expect(grants.currentProject).toBe(dir);
    });
});

describe('project:recent', () => {
    it('liefert geöffnete Projekte mit Gewährung, neueste zuerst, ohne gelöschte', async () => {
        const first = await makeProject('A');
        const second = await makeProject('B');
        await handlers['project:open'](grants.grant(first, 'project').grantId);
        await handlers['project:open'](grants.grant(second, 'project').grantId);
        let recent = await handlers['project:recent']();
        expect(recent.map((entry) => entry.name)).toEqual(['B', 'A']);
        expect(grants.resolve(recent[0]?.grantId ?? '', 'project')).toBe(second);
        await rm(second, { recursive: true });
        recent = await handlers['project:recent']();
        expect(recent.map((entry) => entry.name)).toEqual(['A']);
        await handlers['project:open'](recent[0]?.grantId ?? '');
        expect(grants.currentProject).toBe(first);
    });
});

const DEMO_DIR = resolve(__dirname, '../../../shared/Testdaten/HgbDemo');

describe.skipIf(!existsSync(DEMO_DIR))('HgbDemo (Kopie)', () => {
    it('Baum und Hauptdatei main.tex', async () => {
        const copy = join(base, 'HgbDemo');
        await cp(DEMO_DIR, copy, { recursive: true });
        const info = await handlers['project:open'](grants.grant(copy, 'project').grantId);
        expect(info.mainFile).toBe(join(copy, 'main.tex'));
        const top = info.tree.children.map((node) => node.name);
        expect(top).toContain('chapters');
        expect(top).toContain('hgbthesis.cls');
        expect(top.indexOf('chapters')).toBeLessThan(top.indexOf('main.tex'));
    });
});
