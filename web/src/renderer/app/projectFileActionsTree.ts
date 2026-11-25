// Datei-Aktionen im Dateibaum (W2-9, Vorlage `FileTreeView.contextMenu`): Einträge des Kontextmenüs, Tasten (F2, Entf,
// Menü-Taste/Umschalt+F10, Strg+Z/Strg+Y für Datei-Aktionen) und Ziel beim Ziehen. Ohne DOM; `ui/FileTree.tsx` zeigt an.
import type { AbsolutePath } from '../../shared/contract';
import type { TreeRow } from '../../shared/core/fileTree';
import type { ContextMenuItem } from '../ui/contextMenuItem';
import {
    beginMove, beginNewEntry, beginRename, duplicateEntry, redoFileAction, trashEntry, undoFileAction,
} from './projectFileActions';
import type { ProjectFileActionDeps } from './projectFileActions';
import { copyEntryPath } from './projectFileActionsClipboard';
import { isSameOrInside, parentOf } from './projectFileActionsNames';

export const TREE_MENU_TEXTS = {
    label: 'Dateiaktionen',
    newFile: 'Neue Datei …',
    newFolder: 'Neuer Ordner …',
    rename: 'Umbenennen …',
    duplicate: 'Duplizieren',
    move: 'Verschieben nach …',
    trash: 'In den Papierkorb legen',
    copyPath: 'Pfad kopieren',
    renameKey: 'F2',
    trashKey: 'Entf',
} as const;

/** Eigener Datentyp beim Ziehen im Baum (fremde Drops, z. B. aus dem Explorer, bleiben unberührt) */
export const TREE_DRAG_TYPE = 'application/x-latexeditor-tree-path';

const SEPARATOR: ContextMenuItem = { kind: 'separator' };

type DepsFactory = () => ProjectFileActionDeps;

function item(label: string, onSelect: () => unknown, shortcut?: string): ContextMenuItem {
    return { kind: 'item', label, shortcut, onSelect: () => void onSelect() };
}

/** Ordner, in den „Neu“ anlegt bzw. in den ein Drop fällt: der Ordner selbst, sonst der Ordner der Datei */
export function folderOfRow(row: TreeRow | null, root: AbsolutePath): AbsolutePath {
    if (row === null) return root;
    return row.kind === 'directory' ? row.path : parentOf(row.path);
}

export function treeMenuItems(row: TreeRow | null, root: AbsolutePath, deps: DepsFactory): ContextMenuItem[] {
    const folder = folderOfRow(row, root);
    const create = [
        item(TREE_MENU_TEXTS.newFile, () => beginNewEntry(deps(), 'file', folder)),
        item(TREE_MENU_TEXTS.newFolder, () => beginNewEntry(deps(), 'directory', folder)),
    ];
    if (row === null) return create;
    const path = row.path;
    const duplicate = row.kind === 'file' ? [item(TREE_MENU_TEXTS.duplicate, () => duplicateEntry(deps(), path))] : [];
    return [
        ...create,
        SEPARATOR,
        item(TREE_MENU_TEXTS.rename, () => beginRename(deps(), path), TREE_MENU_TEXTS.renameKey),
        ...duplicate,
        item(TREE_MENU_TEXTS.move, () => beginMove(deps(), path)),
        SEPARATOR,
        item(TREE_MENU_TEXTS.trash, () => trashEntry(deps(), path), TREE_MENU_TEXTS.trashKey),
        SEPARATOR,
        item(TREE_MENU_TEXTS.copyPath, () => copyEntryPath(deps(), path)),
    ];
}

export interface TreeKeyInput {
    readonly key: string;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
    readonly shiftKey: boolean;
    readonly altKey: boolean;
}

export type TreeFileKey = 'undo' | 'redo' | 'menu' | 'rename' | 'trash';

/** Taste → Datei-Aktion im Baum (`null`: nicht für Datei-Aktionen) */
export function treeFileKey(event: TreeKeyInput): TreeFileKey | null {
    const key = event.key.toLowerCase();
    const command = (event.ctrlKey || event.metaKey) && !event.altKey;
    if (command && key === 'z') return event.shiftKey ? 'redo' : 'undo';
    if (event.ctrlKey && !event.metaKey && !event.altKey && key === 'y') return 'redo';
    if (event.key === 'ContextMenu' || (event.shiftKey && !command && event.key === 'F10')) return 'menu';
    // macOS: ⌘⌫ wie im Finder
    if (event.metaKey && !event.altKey && event.key === 'Backspace') return 'trash';
    if (command || event.altKey || event.shiftKey) return null;
    if (event.key === 'F2') return 'rename';
    if (event.key === 'Delete') return 'trash';
    return null;
}

/** Führt die Taste aus; `menu` öffnet die Oberfläche selbst. `true`, wenn die Taste behandelt ist */
export function runTreeFileKey(key: TreeFileKey, selected: AbsolutePath | null, deps: DepsFactory): boolean {
    switch (key) {
        case 'undo':
            void undoFileAction(deps());
            return true;
        case 'redo':
            void redoFileAction(deps());
            return true;
        case 'rename':
            if (selected === null) return false;
            void beginRename(deps(), selected);
            return true;
        case 'trash':
            if (selected === null) return false;
            void trashEntry(deps(), selected);
            return true;
        case 'menu':
            return false;
    }
}

/** Darf `source` in `folder` fallen? Nicht in den eigenen Ordner, nicht in sich selbst */
export function canDropInto(source: AbsolutePath, folder: AbsolutePath): boolean {
    return folder !== parentOf(source) && !isSameOrInside(folder, source);
}
