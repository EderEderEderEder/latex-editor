import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DirectoryNode, TreeNode } from '../../src/shared/contract';
import { currentPathPlatform } from '../../src/main/paths';
import {
    detectMainFile,
    existingRecentEntries,
    isBuildFileName,
    MAX_RECENT_PROJECTS,
    RECENT_FILE_NAME,
    RecentProjectsStore,
    scanProjectTree,
} from '../../src/main/project';

let base: string;

beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'project-')));
});

afterEach(async () => {
    await rm(base, { recursive: true, force: true });
});

async function put(relative: string, text = ''): Promise<void> {
    const path = join(base, relative);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, text);
}

function names(nodes: readonly TreeNode[]): string[] {
    return nodes.map((node) => node.name);
}

function child(tree: DirectoryNode, name: string): TreeNode {
    const found = tree.children.find((node) => node.name === name);
    if (found === undefined) throw new Error(`fehlt: ${name}`);
    return found;
}

describe('Dateibaum', () => {
    it('kennzeichnet Build-Dateien, lässt versteckte Einträge und node_modules weg', async () => {
        for (const name of ['main.tex', 'main.aux', 'main.synctex.gz', 'main.fdb_latexmk', 'refs.bib', '.versteckt.tex']) await put(name);
        await put('.git/config');
        await put('node_modules/x/index.js');
        const { tree, truncated } = await scanProjectTree(base);
        expect(truncated).toBe(false);
        expect(names(tree.children)).toEqual(['main.aux', 'main.fdb_latexmk', 'main.synctex.gz', 'main.tex', 'refs.bib']);
        const flags = tree.children.map((node) => [node.name, node.kind === 'file' ? node.isBuildFile : undefined]);
        expect(flags).toEqual([['main.aux', true], ['main.fdb_latexmk', true], ['main.synctex.gz', true], ['main.tex', false], ['refs.bib', false]]);
    });

    it('sortiert Ordner zuerst, natürlich und ohne Groß-/Kleinschreibung', async () => {
        for (const name of ['zeta.tex', 'Alpha.tex', 'chapters/kapitel10.tex', 'chapters/kapitel2.tex']) await put(name);
        const { tree } = await scanProjectTree(base);
        expect(names(tree.children)).toEqual(['chapters', 'Alpha.tex', 'zeta.tex']);
        expect(names((child(tree, 'chapters') as DirectoryNode).children)).toEqual(['kapitel2.tex', 'kapitel10.tex']);
    });

    it('folgt Symlinks nicht, auch nicht aus dem Projekt hinaus', async () => {
        const outside = join(base, 'Fremd');
        const project = join(base, 'Projekt');
        await mkdir(outside);
        await writeFile(join(outside, 'geheim.tex'), '');
        await mkdir(project);
        await symlink(outside, join(project, 'link'));
        await symlink(join(outside, 'geheim.tex'), join(project, 'datei.tex'));
        await symlink(join(base, 'gibtEsNicht'), join(project, 'kaputt'));
        await writeFile(join(project, 'echt.tex'), '');
        const { tree } = await scanProjectTree(project);
        expect(names(tree.children)).toEqual(['echt.tex']);
    });

    it('beachtet Tiefen- und Mengengrenze', async () => {
        await put('a/b/c/tief.tex');
        await put('oben.tex');
        const shallow = await scanProjectTree(base, { maxDepth: 2, maxEntries: 100 });
        expect(shallow.truncated).toBe(true);
        expect(((child(shallow.tree, 'a') as DirectoryNode).children[0] as DirectoryNode).children).toEqual([]);
        for (const index of [1, 2, 3, 4]) await put(`viele/f${index}.tex`);
        const limited = await scanProjectTree(base, { maxDepth: 10, maxEntries: 4 });
        expect(limited.truncated).toBe(true);
    });

    it('erkennt Build-Dateinamen nach den Swift-Regeln', () => {
        for (const name of ['a.AUX', 'a.log', 'a.toc', 'a.out', 'a.bbl', 'a.blg', 'a.fls', 'a.synctex(busy)', 'a.run.xml', 'x-blx.bib', 'r.bib.bak']) {
            expect(isBuildFileName(name), name).toBe(true);
        }
        for (const name of ['a.tex', 'refs.bib', 'logo.png', 'a.pdf', 'Makefile']) expect(isBuildFileName(name), name).toBe(false);
    });
});

describe('Hauptdatei', () => {
    async function detect(): Promise<string | null> {
        return detectMainFile((await scanProjectTree(base)).tree);
    }

    it('bevorzugt documentclass vor main.tex ohne', async () => {
        await put('main.tex', '\\chapter{X}');
        await put('thesis.tex', '% Kopf\n\n  \\documentclass[a4paper]{report}');
        expect(await detect()).toBe(join(base, 'thesis.tex'));
    });

    it('main.tex gewinnt auf oberster Ebene, flach schlägt tief', async () => {
        await put('anhang.tex', '\\documentclass{article}');
        await put('main.tex', '\\documentclass{article}');
        await put('sub/tiefer.tex', '\\documentclass{article}');
        expect(await detect()).toBe(join(base, 'main.tex'));
    });

    it('Kommentar zählt nicht, Fallback main.tex, sonst null', async () => {
        await put('main.tex', '% \\documentclass{article}');
        await put('other.tex', '%\\documentclass{article}');
        expect(await detect()).toBe(join(base, 'main.tex'));
        await rm(join(base, 'main.tex'));
        expect(await detect()).toBeNull();
    });

    it('\\% ist kein Kommentar', async () => {
        await put('x.tex', '\\documentclass{article}\\%');
        expect(await detect()).toBe(join(base, 'x.tex'));
    });
});

describe('Zuletzt geöffnet', () => {
    const platform = currentPathPlatform();
    let counter = 0;
    const clock = () => ({ now: () => new Date(1_700_000_000_000 + counter++ * 1000) });

    it('neueste zuerst, ohne Doppelte, höchstens zehn', async () => {
        const store = new RecentProjectsStore(join(base, 'data'), platform, clock());
        for (let index = 0; index < 12; index++) await store.add(join(base, `p${index}`));
        await store.add(join(base, 'p5'));
        const list = await store.list();
        expect(list).toHaveLength(MAX_RECENT_PROJECTS);
        expect(list[0]?.path).toBe(join(base, 'p5'));
        expect(list.filter((entry) => entry.path === join(base, 'p5'))).toHaveLength(1);
        expect(list[1]?.path).toBe(join(base, 'p11'));
    });

    it('legt eine defekte Datei beiseite und beginnt leer', async () => {
        const dir = join(base, 'data');
        await mkdir(dir);
        await writeFile(join(dir, RECENT_FILE_NAME), '{kaputt');
        const store = new RecentProjectsStore(dir, platform, clock());
        expect(await store.list()).toEqual([]);
        expect((await readdir(dir)).some((name) => name.startsWith('recent-projects.defekt-'))).toBe(true);
        await store.add(join(base, 'neu'));
        expect(await store.list()).toHaveLength(1);
    });

    it('filtert nicht mehr vorhandene Ordner heraus', async () => {
        const store = new RecentProjectsStore(join(base, 'data'), platform, clock());
        await mkdir(join(base, 'da'));
        await store.add(join(base, 'da'));
        await store.add(join(base, 'weg'));
        expect((await existingRecentEntries(store)).map((entry) => entry.path)).toEqual([join(base, 'da')]);
    });
});
