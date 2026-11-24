import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppHandlers } from '../../src/main/handlers/appHandlers';
import type { DialogLike } from '../../src/main/handlers/dialogHandlers';
import { createTabMemoryHandlers, TAB_MEMORY_DIRECTORY, TabMemoryStore } from '../../src/main/handlers/tabMemoryHandlers';
import { GrantStore } from '../../src/main/grants';
import { areArgsValid, isTabMemory } from '../../src/main/ipcValidation';
import { QuitTasks } from '../../src/main/lifecycle';
import { MACOS_PATHS, projectHash } from '../../src/main/paths';
import { TAB_MEMORY_VERSION } from '../../src/shared/contract';
import type { TabMemory } from '../../src/shared/contract';
import { IpcFailure } from '../../src/shared/ipcResult';

let userData: string;
let projects: string;

beforeEach(async () => {
    userData = await mkdtemp(join(tmpdir(), 'tabmemory-user-'));
    projects = await realpath(await mkdtemp(join(tmpdir(), 'tabmemory-projects-')));
});

afterEach(async () => {
    await rm(userData, { recursive: true, force: true });
    await rm(projects, { recursive: true, force: true });
});

function memory(...paths: string[]): TabMemory {
    return {
        version: TAB_MEMORY_VERSION,
        tabs: paths.map((path, index) => ({ path, isPreview: index === 0, anchor: index, head: index + 1, scrollTop: 10 * index })),
        active: paths.at(-1) ?? null,
    };
}

async function openProject(grants: GrantStore, name: string): Promise<string> {
    const root = join(projects, name);
    await mkdir(root, { recursive: true });
    grants.openProject(grants.grant(root, 'project').grantId);
    return root;
}

function setup() {
    const grants = new GrantStore({ platform: MACOS_PATHS });
    const handlers = createTabMemoryHandlers(new TabMemoryStore({ userDataDir: userData, grants }));
    return { grants, handlers };
}

async function storedFiles(): Promise<string[]> {
    return readdir(join(userData, TAB_MEMORY_DIRECTORY)).catch(() => []);
}

describe('Tab-Gedächtnis im Main', () => {
    it('ohne Projekt: Laden ergibt null, Speichern einen Fehler, nichts wird geschrieben', async () => {
        const { handlers } = setup();
        await expect(handlers['tabs:memoryLoad']()).resolves.toBeNull();
        const failure = await handlers['tabs:memorySave'](memory('a.tex')).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(IpcFailure);
        expect((failure as IpcFailure).error.kind).toBe('notFound');
        expect(await storedFiles()).toEqual([]);
    });

    it('speichert je Projekt in tabs/<Hash>.json und liest es zurück', async () => {
        const { handlers, grants } = setup();
        const root = await openProject(grants, 'arbeit');
        expect(await handlers['tabs:memoryLoad']()).toBeNull();
        await handlers['tabs:memorySave'](memory('main.tex', 'kapitel/eins.tex'));
        expect(await storedFiles()).toEqual([`${projectHash(root, MACOS_PATHS)}.json`]);
        expect(await handlers['tabs:memoryLoad']()).toEqual(memory('main.tex', 'kapitel/eins.tex'));
    });

    it('jedes Projekt hat sein eigenes Gedächtnis', async () => {
        const { handlers, grants } = setup();
        await openProject(grants, 'eins');
        await handlers['tabs:memorySave'](memory('a.tex'));
        await openProject(grants, 'zwei');
        expect(await handlers['tabs:memoryLoad']()).toBeNull();
        await handlers['tabs:memorySave'](memory('b.tex'));
        await openProject(grants, 'eins');
        expect((await handlers['tabs:memoryLoad']())?.tabs[0]?.path).toBe('a.tex');
        expect(await storedFiles()).toHaveLength(2);
    });

    it('eine beschädigte oder fremde Datei ergibt kein Gedächtnis statt eines Fehlers', async () => {
        const { handlers, grants } = setup();
        const root = await openProject(grants, 'arbeit');
        const file = join(userData, TAB_MEMORY_DIRECTORY, `${projectHash(root, MACOS_PATHS)}.json`);
        await mkdir(join(userData, TAB_MEMORY_DIRECTORY), { recursive: true });
        for (const content of ['{kaputt', '[]', JSON.stringify({ ...memory('a.tex'), version: 99 })]) {
            await writeFile(file, content);
            await expect(handlers['tabs:memoryLoad']()).resolves.toBeNull();
        }
    });

    it('lehnt ungültige Gedächtnisse ab und schreibt nichts', async () => {
        const { handlers, grants } = setup();
        await openProject(grants, 'arbeit');
        const bad = { ...memory('a.tex'), tabs: [{ ...memory('a.tex').tabs[0]!, path: '../geheim.tex' }] };
        const failure = await handlers['tabs:memorySave'](bad).catch((error: unknown) => error);
        expect((failure as IpcFailure).error.kind).toBe('invalidInput');
        expect(await storedFiles()).toEqual([]);
    });

    it('aufeinanderfolgende Speicherungen enden mit dem letzten Stand', async () => {
        const { handlers, grants } = setup();
        await openProject(grants, 'arbeit');
        const saves = [memory('a.tex'), memory('b.tex'), memory('c.tex')].map((entry) => handlers['tabs:memorySave'](entry));
        await Promise.all(saves);
        expect((await handlers['tabs:memoryLoad']())?.tabs[0]?.path).toBe('c.tex');
        const [name] = await storedFiles();
        expect(JSON.parse(await readFile(join(userData, TAB_MEMORY_DIRECTORY, name!), 'utf8'))).toEqual(memory('c.tex'));
    });
});

describe('Tab-Gedächtnis: Eingabeprüfung', () => {
    it('akzeptiert relative Pfade mit /, Umlauten und leerer Liste', () => {
        expect(isTabMemory(memory('a.tex', 'ünter/ordner/b.bib'))).toBe(true);
        expect(isTabMemory({ version: TAB_MEMORY_VERSION, tabs: [], active: null })).toBe(true);
    });

    it.each(['/etc/passwd', 'C:\\x.tex', 'C:/x.tex', '\\\\server\\x.tex', 'a/../b.tex', '..', 'a\\b.tex', '', 'a\0b'])(
        'lehnt den Pfad %j ab',
        (path) => {
            expect(isTabMemory(memory(path))).toBe(false);
        },
    );

    it('lehnt falsche Form ab: Version, Zusatzfelder, negative Zahlen, aktiver Tab absolut, zu viele Tabs', () => {
        const valid = memory('a.tex');
        const entry = valid.tabs[0]!;
        expect(isTabMemory({ ...valid, version: 2 })).toBe(false);
        expect(isTabMemory({ ...valid, extra: 1 })).toBe(false);
        expect(isTabMemory({ ...valid, active: '/a.tex' })).toBe(false);
        expect(isTabMemory({ ...valid, tabs: [{ ...entry, anchor: -1 }] })).toBe(false);
        expect(isTabMemory({ ...valid, tabs: [{ ...entry, anchor: 1.5 }] })).toBe(false);
        expect(isTabMemory({ ...valid, tabs: [{ ...entry, scrollTop: Number.NaN }] })).toBe(false);
        expect(isTabMemory({ ...valid, tabs: [{ ...entry, isPreview: 'ja' }] })).toBe(false);
        expect(isTabMemory({ ...valid, tabs: Array.from({ length: 201 }, () => entry) })).toBe(false);
    });

    it('die Kanäle prüfen ihre Argumente', () => {
        expect(areArgsValid('tabs:memoryLoad', [])).toBe(true);
        expect(areArgsValid('tabs:memoryLoad', ['/p'])).toBe(false);
        expect(areArgsValid('tabs:memorySave', [memory('a.tex')])).toBe(true);
        expect(areArgsValid('tabs:memorySave', [])).toBe(false);
        expect(areArgsValid('tabs:memorySave', ['{}'])).toBe(false);
    });
});

describe('Tab-Gedächtnis: Verdrahtung', () => {
    it('createAppHandlers registriert beide Kanäle echt, nicht als Platzhalter', async () => {
        const dialog: DialogLike<object> = {
            showOpenDialog: vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] })),
            showSaveDialog: vi.fn(() => Promise.resolve({ canceled: true })),
        };
        const { handlers, grants } = createAppHandlers({
            userDataDir: userData, dialog, window: () => ({}), platform: MACOS_PATHS, quitTasks: new QuitTasks(),
            log: vi.fn(), confirmClose: vi.fn(),
        });
        await expect(handlers['tabs:memoryLoad']()).resolves.toBeNull();
        await openProject(grants, 'arbeit');
        await handlers['tabs:memorySave'](memory('main.tex'));
        await expect(handlers['tabs:memoryLoad']()).resolves.toEqual(memory('main.tex'));
    });
});
