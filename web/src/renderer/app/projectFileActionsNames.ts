// Datei-Aktionen (W2-9): Pfade im Projektbaum und Namensprüfung beim Tippen (Vorlage `NameSheet.validationMessage`).
// Die Namensregeln selbst stehen in `shared/core/fileNames.ts`; der Main prüft beim Ausführen noch einmal.
import type { AbsolutePath, DirectoryNode, TreeNode } from '../../shared/contract';
import { assertValidFileName, newFileName, renamedFileName } from '../../shared/core/fileNames';
import type { NamePlatform } from '../../shared/core/fileNames';
import { IpcFailure } from '../../shared/ipcResult';
import type { MoveTarget, NamePromptKind } from './projectFileActionsPrompts';

const BACKSLASH = '\\';
const SLASH = '/';
const SEPARATORS = /[\\/]/;
const ALL_BACKSLASHES = /\\/g;

export const NAME_TEXTS = {
    alreadyExists: (name: string) => `„${name}“ existiert an dieser Stelle bereits.`,
    projectFolder: 'in Projektordner',
    inFolder: (relative: string) => `in ${relative}`,
    rootTarget: 'Projektordner',
} as const;

// ---------- Pfade (native Form wie im Baum, Windows mit `\`) ----------

function separatorOf(path: string): string {
    return path.includes(BACKSLASH) && !path.includes(SLASH) ? BACKSLASH : SLASH;
}

export function nameOf(path: string): string {
    return path.split(SEPARATORS).at(-1) ?? path;
}

export function parentOf(path: string): string {
    const cut = Math.max(path.lastIndexOf(SLASH), path.lastIndexOf(BACKSLASH));
    return cut <= 0 ? path : path.slice(0, cut);
}

export function childOf(directory: string, name: string): string {
    return `${directory}${separatorOf(directory)}${name}`;
}

export function isSameOrInside(path: string, base: string): boolean {
    return path === base || path.startsWith(base + SLASH) || path.startsWith(base + BACKSLASH);
}

/** Neuer Ort von `path`, wenn `from` nach `to` gezogen ist (Datei selbst oder darunter); sonst unverändert */
export function mapPath(path: string, from: string, to: string): string {
    return isSameOrInside(path, from) ? to + path.slice(from.length) : path;
}

/** Pfad relativ zur Projektwurzel mit `/` (`""` = Wurzel); `null`, wenn er nicht im Projekt liegt */
export function relativeToRoot(root: string, path: string): string | null {
    if (path === root) return '';
    if (!isSameOrInside(path, root)) return null;
    return path.slice(root.length + 1).replace(ALL_BACKSLASHES, SLASH);
}

/** Absoluter Pfad zu einem Pfad relativ zur Wurzel (mit `/`), im Trenner der Wurzel */
export function fromRoot(root: string, relative: string): string {
    if (relative === '') return root;
    return childOf(root, relative.split(SLASH).join(separatorOf(root)));
}

export function findNode(tree: DirectoryNode, path: string): TreeNode | null {
    if (tree.path === path) return tree;
    for (const child of tree.children) {
        if (child.path === path) return child;
        if (child.kind === 'directory' && isSameOrInside(path, child.path)) return findNode(child, path);
    }
    return null;
}

export function isDirectoryPath(tree: DirectoryNode, path: string): boolean {
    return findNode(tree, path)?.kind === 'directory';
}

/** Ordner für „Neu“: der gewählte Ordner, sonst der Ordner der gewählten Datei, sonst die Wurzel (Swift `targetFolder`) */
export function targetFolder(tree: DirectoryNode, selected: AbsolutePath | null): AbsolutePath {
    if (selected === null) return tree.path;
    const node = findNode(tree, selected);
    if (node === null) return tree.path;
    return node.kind === 'directory' ? node.path : parentOf(node.path);
}

/** „in Projektordner“ oder „in chapters/bilder“ */
export function locationText(root: string, folder: string): string {
    const relative = relativeToRoot(root, folder);
    if (relative === null || relative === '') return NAME_TEXTS.projectFolder;
    return NAME_TEXTS.inFolder(relative);
}

/** Alle Ordner des Projekts als Ziele zum Verschieben (Wurzel zuerst), ohne `excluded` und was darin liegt */
export function moveTargets(tree: DirectoryNode, excluded: AbsolutePath): MoveTarget[] {
    const targets: MoveTarget[] = [{ path: tree.path, label: NAME_TEXTS.rootTarget }];
    const visit = (node: DirectoryNode): void => {
        for (const child of node.children) {
            if (child.kind !== 'directory' || isSameOrInside(child.path, excluded)) continue;
            targets.push({ path: child.path, label: relativeToRoot(tree.path, child.path) ?? child.name });
            visit(child);
        }
    };
    visit(tree);
    return targets;
}

// ---------- Namensprüfung ----------

export interface NameContext {
    readonly kind: NamePromptKind;
    readonly platform: NamePlatform;
    /** Namen der Einträge im Zielordner */
    readonly siblings: readonly string[];
    /** Beim Umbenennen: bisheriger Name und ob es ein Ordner ist */
    readonly original?: { readonly name: string; readonly isDirectory: boolean };
}

/** Vergleich wie auf NTFS/APFS: Groß-/Kleinschreibung und Unicode-Form zählen nicht */
function collisionKey(name: string): string {
    return name.normalize('NFC').toLowerCase();
}

/** Endgültiger Name (mit ergänzter Endung); wirft `IpcFailure` mit der Meldung aus `fileNames` */
export function finalName(raw: string, context: NameContext): string {
    const { kind, platform, original } = context;
    if (kind === 'newFile') return newFileName(raw, platform);
    if (kind === 'newFolder' || original === undefined) return assertValidFileName(raw, platform);
    return renamedFileName(raw, original.name, original.isDirectory, platform);
}

function collision(name: string, context: NameContext): string | null {
    const key = collisionKey(name);
    // Reine Änderung der Schreibweise beim Umbenennen trifft den Eintrag selbst
    const originalKey = context.original === undefined ? null : collisionKey(context.original.name);
    if (key === originalKey) return null;
    return context.siblings.some((sibling) => collisionKey(sibling) === key) ? NAME_TEXTS.alreadyExists(name) : null;
}

/** Fehlermeldung zum eingegebenen Namen oder `null`, wenn er passt */
export function validateEntryName(raw: string, context: NameContext): string | null {
    try {
        return collision(finalName(raw, context), context);
    } catch (error) {
        if (error instanceof IpcFailure) return error.error.message;
        throw error;
    }
}

export function siblingNames(tree: DirectoryNode, folder: AbsolutePath): string[] {
    const node = findNode(tree, folder);
    return node?.kind === 'directory' ? node.children.map((child) => child.name) : [];
}
