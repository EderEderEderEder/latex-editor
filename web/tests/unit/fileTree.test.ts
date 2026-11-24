import { describe, expect, it } from 'vitest';
import type { DirectoryNode, FileNode, TreeNode } from '../../src/shared/contract';
import {
    ancestorFolders, buildTreeRows, countFileTypes, countVisibleFiles, pruneChildren, sameTreeNode,
} from '../../src/shared/core/fileTree';
import type { TreeFilter } from '../../src/shared/core/fileTree';

const ROOT = '/p';

function file(path: string, isBuildFile = false): FileNode {
    const name = path.split('/').at(-1) ?? path;
    return isBuildFile ? { kind: 'file', name, path: `${ROOT}/${path}`, isBuildFile } : { kind: 'file', name, path: `${ROOT}/${path}` };
}

function folder(path: string, children: TreeNode[]): DirectoryNode {
    return { kind: 'directory', name: path.split('/').at(-1) ?? path, path: `${ROOT}/${path}`, children };
}

const TREE: DirectoryNode = {
    kind: 'directory', name: 'p', path: ROOT,
    children: [
        folder('bilder', [file('bilder/logo.png'), file('bilder/foto.jpg')]),
        folder('kapitel', [file('kapitel/eins.tex'), folder('kapitel/tief', [file('kapitel/tief/zwei.tex')])]),
        folder('leer', []),
        file('main.tex'),
        file('main.aux', true),
    ],
};

const NO_FILTER: TreeFilter = { text: '', hiddenExtensions: new Set(), showsBuildFiles: false, keepPath: null };
const expandedOf = (...paths: string[]) => new Set(paths.map((path) => `${ROOT}/${path}`));
const labels = (rows: { label: string }[]) => rows.map((row) => row.label);

describe('Dateibaum: Zeilen', () => {
    it('zeigt zugeklappte Ordner ohne Kinder und blendet Build-Dateien aus', () => {
        const rows = buildTreeRows(TREE, NO_FILTER, new Set());
        expect(labels(rows)).toEqual(['bilder', 'kapitel', 'leer', 'main.tex']);
        expect(rows.map((row) => row.isExpanded)).toEqual([false, false, false, null]);
    });

    it('legt aufgeklappte Ordner flach mit Tiefe, Position und Elternpfad', () => {
        const rows = buildTreeRows(TREE, NO_FILTER, expandedOf('kapitel', 'kapitel/tief'));
        expect(labels(rows)).toEqual(['bilder', 'kapitel', 'eins.tex', 'tief', 'zwei.tex', 'leer', 'main.tex']);
        const zwei = rows.find((row) => row.name === 'zwei.tex');
        expect(zwei).toMatchObject({ depth: 2, parentPath: `${ROOT}/kapitel/tief`, position: 1, siblingCount: 1 });
        const tief = rows.find((row) => row.name === 'tief');
        expect(tief).toMatchObject({ depth: 1, position: 2, siblingCount: 2, isExpanded: true });
    });

    it('zeigt Build-Dateien erst auf Wunsch und markiert sie', () => {
        const rows = buildTreeRows(TREE, { ...NO_FILTER, showsBuildFiles: true }, new Set());
        expect(rows.at(-1)).toMatchObject({ name: 'main.aux', isBuildFile: true });
    });

    it('blendet Dateitypen aus; Ordner, die dadurch leer würden, entfallen, wirklich leere bleiben', () => {
        const filter = { ...NO_FILTER, hiddenExtensions: new Set(['png', 'jpg']) };
        expect(labels(buildTreeRows(TREE, filter, new Set()))).toEqual(['kapitel', 'leer', 'main.tex']);
    });

    it('behält die offene Datei trotz ausgeblendetem Typ', () => {
        const filter = { ...NO_FILTER, hiddenExtensions: new Set(['png', 'jpg']), keepPath: `${ROOT}/bilder/logo.png` };
        const rows = buildTreeRows(TREE, filter, expandedOf('bilder'));
        expect(labels(rows)).toEqual(['bilder', 'logo.png', 'kapitel', 'leer', 'main.tex']);
    });

    it('filtert nach Namen als flache Liste mit relativem Pfad, ohne Beachtung der Groß-/Kleinschreibung', () => {
        const rows = buildTreeRows(TREE, { ...NO_FILTER, text: 'ZWEI' }, new Set());
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ label: 'kapitel/tief/zwei.tex', depth: 0, isExpanded: null, kind: 'file' });
        expect(labels(buildTreeRows(TREE, { ...NO_FILTER, text: '.tex' }, new Set()))).toEqual([
            'kapitel/eins.tex', 'kapitel/tief/zwei.tex', 'main.tex',
        ]);
    });

    it('findet im Namensfilter keine ausgeblendeten Dateien', () => {
        const filter = { ...NO_FILTER, text: 'logo', hiddenExtensions: new Set(['png']) };
        expect(buildTreeRows(TREE, filter, new Set())).toEqual([]);
    });

    it('gibt bei unveränderten Kindern dieselbe Liste zurück', () => {
        expect(pruneChildren(TREE.children, { ...NO_FILTER, showsBuildFiles: true })).toBe(TREE.children);
    });
});

describe('Dateibaum: Hilfen', () => {
    it('zählt Dateitypen ohne Build-Dateien', () => {
        expect(Object.fromEntries(countFileTypes(TREE))).toEqual({ png: 1, jpg: 1, tex: 3 });
        expect(countVisibleFiles(TREE)).toBe(5);
    });

    it('nennt die Ordner über einer Datei, `null` wenn sie fehlt', () => {
        expect(ancestorFolders(TREE, `${ROOT}/kapitel/tief/zwei.tex`)).toEqual([`${ROOT}/kapitel`, `${ROOT}/kapitel/tief`]);
        expect(ancestorFolders(TREE, `${ROOT}/main.tex`)).toEqual([]);
        expect(ancestorFolders(TREE, `${ROOT}/fehlt.tex`)).toBeNull();
    });

    it('vergleicht Bäume nach Inhalt', () => {
        const copy: DirectoryNode = JSON.parse(JSON.stringify(TREE)) as DirectoryNode;
        expect(sameTreeNode(TREE, copy)).toBe(true);
        const changed = { ...copy, children: [...copy.children.slice(1)] };
        expect(sameTreeNode(TREE, changed)).toBe(false);
        const buildFlag = { ...copy, children: copy.children.map((child) => (child.name === 'main.tex' ? { ...child, isBuildFile: true } : child)) };
        expect(sameTreeNode(TREE, buildFlag)).toBe(false);
    });

    it('legt einen Baum mit 5.000 Knoten schnell flach', () => {
        const files = Array.from({ length: 5000 }, (_, index) => file(`viele/datei-${index}.tex`));
        const big: DirectoryNode = { ...TREE, children: [folder('viele', files)] };
        const started = performance.now();
        const rows = buildTreeRows(big, NO_FILTER, expandedOf('viele'));
        expect(rows).toHaveLength(5001);
        expect(performance.now() - started).toBeLessThan(200);
    });
});
