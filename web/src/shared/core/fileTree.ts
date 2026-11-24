// Dateibaum als flache Zeilenliste (Vorlage: `FileTreeView`, `FileNode.hidingFileTypes`): Dateitypen und Build-Dateien
// ausblenden, nach Namen filtern, nur aufgeklappte Ordner zeigen. Reine Logik ohne DOM; der Baum selbst bleibt unverändert.
import type { AbsolutePath, DirectoryNode, FileNode, TreeNode } from '../contract';
import { extensionKey } from './fileTypes';

export interface TreeFilter {
    /** Teil des Dateinamens (ohne Beachtung der Groß-/Kleinschreibung); leer: kein Namensfilter */
    readonly text: string;
    readonly hiddenExtensions: ReadonlySet<string>;
    readonly showsBuildFiles: boolean;
    /** Datei, die trotz Typfilter sichtbar bleibt (die offene), damit sie nicht aus dem Baum verschwindet */
    readonly keepPath: AbsolutePath | null;
}

export interface TreeRow {
    readonly path: AbsolutePath;
    readonly name: string;
    /** Anzeige: der Name, im Namensfilter der Pfad relativ zum Projekt */
    readonly label: string;
    readonly kind: 'file' | 'directory';
    /** 0-basiert */
    readonly depth: number;
    /** `null` bei Dateien */
    readonly isExpanded: boolean | null;
    readonly isBuildFile: boolean;
    readonly parentPath: AbsolutePath | null;
    /** 1-basiert unter den Geschwistern (für `aria-posinset`) */
    readonly position: number;
    readonly siblingCount: number;
}

const PATH_SEPARATOR = /[\\/]/;

export function isFileShown(file: FileNode, filter: TreeFilter): boolean {
    if (file.path === filter.keepPath) return true;
    if (file.isBuildFile === true && !filter.showsBuildFiles) return false;
    return !filter.hiddenExtensions.has(extensionKey(file.name));
}

/**
 * Kinder ohne ausgeblendete Dateien. Ordner, die dadurch leer würden, entfallen mit; wirklich leere Ordner bleiben.
 * Ohne Änderung kommt dieselbe Liste zurück.
 */
export function pruneChildren(children: readonly TreeNode[], filter: TreeFilter): readonly TreeNode[] {
    const kept: TreeNode[] = [];
    for (const node of children) {
        if (node.kind === 'file') {
            if (isFileShown(node, filter)) kept.push(node);
            continue;
        }
        const inner = pruneChildren(node.children, filter);
        if (inner.length === 0 && node.children.length > 0) continue;
        kept.push(inner === node.children ? node : { ...node, children: inner });
    }
    return kept.length === children.length && kept.every((node, index) => node === children[index]) ? children : kept;
}

function rowOf(node: TreeNode, extra: Pick<TreeRow, 'label' | 'depth' | 'isExpanded' | 'parentPath' | 'position' | 'siblingCount'>): TreeRow {
    return {
        path: node.path,
        name: node.name,
        kind: node.kind,
        isBuildFile: node.kind === 'file' && node.isBuildFile === true,
        ...extra,
    };
}

function flattenInto(
    rows: TreeRow[], children: readonly TreeNode[], expanded: ReadonlySet<AbsolutePath>, depth: number, parentPath: AbsolutePath,
): void {
    children.forEach((node, index) => {
        const isExpanded = node.kind === 'directory' ? expanded.has(node.path) : null;
        rows.push(rowOf(node, {
            label: node.name, depth, isExpanded, parentPath, position: index + 1, siblingCount: children.length,
        }));
        if (node.kind === 'directory' && isExpanded === true) flattenInto(rows, node.children, expanded, depth + 1, node.path);
    });
}

/** Zeilen der Ordnerstruktur ohne die Wurzel; zugeklappte Ordner zeigen ihre Kinder nicht */
export function flattenTree(children: readonly TreeNode[], expanded: ReadonlySet<AbsolutePath>, rootPath: AbsolutePath): TreeRow[] {
    const rows: TreeRow[] = [];
    flattenInto(rows, children, expanded, 0, rootPath);
    return rows;
}

export function collectFiles(children: readonly TreeNode[]): FileNode[] {
    const files: FileNode[] = [];
    const visit = (nodes: readonly TreeNode[]): void => {
        for (const node of nodes) {
            if (node.kind === 'file') files.push(node);
            else visit(node.children);
        }
    };
    visit(children);
    return files;
}

function relativeLabel(root: AbsolutePath, file: FileNode): string {
    const prefix = root.replace(/[\\/]+$/, '');
    if (!file.path.startsWith(prefix) || !PATH_SEPARATOR.test(file.path.charAt(prefix.length))) return file.name;
    return file.path.slice(prefix.length + 1).replace(/\\/g, '/');
}

/** Namensfilter: flache Liste der passenden Dateien mit relativem Pfad (wie in der Swift-Version) */
function matchRows(root: DirectoryNode, visible: readonly TreeNode[], text: string): TreeRow[] {
    const needle = text.toLowerCase();
    const matches = collectFiles(visible).filter((file) => file.name.toLowerCase().includes(needle));
    return matches.map((file, index) => rowOf(file, {
        label: relativeLabel(root.path, file), depth: 0, isExpanded: null, parentPath: root.path,
        position: index + 1, siblingCount: matches.length,
    }));
}

export function buildTreeRows(root: DirectoryNode, filter: TreeFilter, expanded: ReadonlySet<AbsolutePath>): TreeRow[] {
    const visible = pruneChildren(root.children, filter);
    const text = filter.text.trim();
    return text === '' ? flattenTree(visible, expanded, root.path) : matchRows(root, visible, text);
}

/** Endungen aller Dateien (ohne Build-Dateien) mit Anzahl, für das Typmenü */
export function countFileTypes(root: DirectoryNode): Map<string, number> {
    const counts = new Map<string, number>();
    for (const file of collectFiles(root.children)) {
        if (file.isBuildFile === true) continue;
        const extension = extensionKey(file.name);
        counts.set(extension, (counts.get(extension) ?? 0) + 1);
    }
    return counts;
}

/** Ordner von der Wurzel (ohne sie) bis zur Datei, zum Aufklappen; `null`, wenn die Datei nicht im Baum steht */
export function ancestorFolders(root: DirectoryNode, targetPath: AbsolutePath): AbsolutePath[] | null {
    const search = (nodes: readonly TreeNode[], trail: AbsolutePath[]): AbsolutePath[] | null => {
        for (const node of nodes) {
            if (node.path === targetPath) return trail;
            if (node.kind !== 'directory') continue;
            const found = search(node.children, [...trail, node.path]);
            if (found !== null) return found;
        }
        return null;
    };
    return search(root.children, []);
}

export function sameTreeNode(a: TreeNode, b: TreeNode): boolean {
    if (a === b) return true;
    if (a.kind !== b.kind || a.path !== b.path || a.name !== b.name) return false;
    if (a.kind === 'file' && b.kind === 'file') return (a.isBuildFile === true) === (b.isBuildFile === true);
    if (a.kind !== 'directory' || b.kind !== 'directory' || a.children.length !== b.children.length) return false;
    return a.children.every((child, index) => sameTreeNode(child, b.children[index] as TreeNode));
}

/** Anzahl der Dateien (ohne Build-Dateien), für die Statistikzeile */
export function countVisibleFiles(root: DirectoryNode): number {
    return collectFiles(root.children).filter((file) => file.isBuildFile !== true).length;
}
