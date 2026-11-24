import { describe, expect, it, vi } from 'vitest';
import type { DirectoryNode } from '../../src/shared/contract';
import { revealInTree } from '../../src/renderer/app/treeReveal';
import type { ProjectView } from '../../src/renderer/stores/project';
import { createSidebarStore } from '../../src/renderer/stores/sidebar';

const TREE: DirectoryNode = {
    kind: 'directory', name: 'p', path: '/p',
    children: [
        { kind: 'directory', name: 'a', path: '/p/a', children: [
            { kind: 'directory', name: 'b', path: '/p/a/b', children: [{ kind: 'file', name: 'x.tex', path: '/p/a/b/x.tex' }] },
        ] },
        { kind: 'file', name: 'main.tex', path: '/p/main.tex' },
    ],
};
const PROJECT: ProjectView = { root: '/p', name: 'p', tree: TREE, mainFile: '/p/main.tex', truncated: false };

describe('Offene Datei im Baum zeigen', () => {
    it('klappt die Ordner darüber auf und wählt die Datei', () => {
        const sidebar = createSidebarStore();
        expect(revealInTree(sidebar, PROJECT, '/p/a/b/x.tex')).toBe(true);
        expect([...sidebar.getState().expandedFolders]).toEqual(['/p/a', '/p/a/b']);
        expect(sidebar.getState().selectedPath).toBe('/p/a/b/x.tex');
    });

    it('schreibt nichts, wenn alles schon so ist', () => {
        const sidebar = createSidebarStore();
        revealInTree(sidebar, PROJECT, '/p/a/b/x.tex');
        const listener = vi.fn();
        sidebar.subscribe(listener);
        revealInTree(sidebar, PROJECT, '/p/a/b/x.tex');
        expect(listener).not.toHaveBeenCalled();
    });

    it('lässt die Seitenleiste für Dateien außerhalb des Baums unverändert', () => {
        const sidebar = createSidebarStore();
        const listener = vi.fn();
        sidebar.subscribe(listener);
        expect(revealInTree(sidebar, PROJECT, 'grant-1')).toBe(false);
        expect(revealInTree(sidebar, null, '/p/main.tex')).toBe(false);
        expect(revealInTree(sidebar, PROJECT, null)).toBe(false);
        expect(listener).not.toHaveBeenCalled();
    });
});
