// Dateibaum (W2-3): flache, virtualisierte Zeilenliste. Ordner- und Auswahlzustand liegen im Sidebar-Store.
// Einzelklick auf eine Datei öffnet sie als Vorschau-Tab, Doppelklick/Enter als festen Tab; Ordner klappen per Klick,
// Pfeile, Enter. Namensfilter und Dateitypen kommen aus dem Store (`FileFilterRow`). Datei-Aktionen (W2-9):
// Kontextmenü (Rechtsklick, Menü-Taste, Umschalt+F10), F2, Entf, Strg+Z/Strg+Y und Ziehen in einen Ordner.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react';
import { buildTreeRows, countVisibleFiles } from '../../shared/core/fileTree';
import type { TreeRow } from '../../shared/core/fileTree';
import { openProjectFile } from '../app/projectFiles';
import { moveEntry } from '../app/projectFileActions';
import { projectFileActionDeps } from '../app/projectFileActionsRuntime';
import { canDropInto, folderOfRow, runTreeFileKey, TREE_DRAG_TYPE, TREE_MENU_TEXTS, treeFileKey, treeMenuItems } from '../app/projectFileActionsTree';
import { projectFileDeps } from '../app/projectRuntime';
import { revealInTree } from '../app/treeReveal';
import { treeKeyAction } from '../app/treeNavigation';
import type { TreeKeyAction } from '../app/treeNavigation';
import { scaledRowHeight } from '../app/virtualWindow';
import { useEditorStore } from '../stores/editor';
import { projectStore, useProjectStore } from '../stores/project';
import type { ProjectView } from '../stores/project';
import { useSettingsStore } from '../stores/settings';
import { sidebarStore, useSidebarStore } from '../stores/sidebar';
import { ContextMenu } from './ContextMenu';
import { TreeViewport } from './TreeViewport';
import type { TreeDragHandlers } from './TreeViewport';

const TREE_ROW_HEIGHT_PX = 24;
export const FILE_TREE_TEXTS = {
    emptyFolder: 'Keine Dateien zu zeigen.',
    allHidden: 'Alle Dateien sind durch den Typfilter ausgeblendet.',
    showAllTypes: 'Alle Dateitypen zeigen',
    noMatches: (filter: string, hiddenTypes: number) => {
        const base = `Keine Treffer für „${filter}“.`;
        if (hiddenTypes === 0) return base;
        return `${base} ${hiddenTypes === 1 ? 'Ein Dateityp ist' : `${hiddenTypes} Dateitypen sind`} ausgeblendet.`;
    },
} as const;

function clickRow(row: TreeRow): void {
    const sidebar = sidebarStore.getState();
    sidebar.select(row.path);
    if (row.kind === 'directory') sidebar.toggleFolder(row.path);
    else void openProjectFile(projectFileDeps(), row.path, true);
}

function doubleClickRow(row: TreeRow): void {
    if (row.kind === 'file') void openProjectFile(projectFileDeps(), row.path, false);
}

function runTreeAction(action: TreeKeyAction, rows: readonly TreeRow[]): void {
    const sidebar = sidebarStore.getState();
    switch (action.kind) {
        case 'focus':
            sidebar.select(rows[action.index]?.path ?? null);
            return;
        case 'toggle':
            sidebar.select(action.path);
            sidebar.toggleFolder(action.path);
            return;
        case 'open':
            sidebar.select(action.path);
            void openProjectFile(projectFileDeps(), action.path, action.asPreview);
    }
}

function keyHandler(rows: readonly TreeRow[], selectedPath: string | null, openMenu: (row: TreeRow | null) => void) {
    return (event: KeyboardEvent): void => {
        if (handleFileKey(event, rows, selectedPath, openMenu)) return;
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const found = rows.findIndex((row) => row.path === selectedPath);
        const action = treeKeyAction(rows, Math.max(found, 0), event.key);
        if (action === null) return;
        event.preventDefault();
        // Ohne Auswahl wählt die erste Taste zuerst die oberste Zeile
        if (found < 0) sidebarStore.getState().select(rows[0]?.path ?? null);
        else runTreeAction(action, rows);
    };
}

/** Datei-Aktionen per Taste (F2, Entf, Menü-Taste, Strg+Z); `true`, wenn behandelt */
function handleFileKey(
    event: KeyboardEvent, rows: readonly TreeRow[], selectedPath: string | null, openMenu: (row: TreeRow | null) => void,
): boolean {
    const key = treeFileKey(event);
    if (key === null) return false;
    const selected = rows.find((row) => row.path === selectedPath) ?? null;
    if (key === 'menu') openMenu(selected);
    const handled = key === 'menu' || runTreeFileKey(key, selected?.path ?? null, projectFileActionDeps);
    if (handled) event.preventDefault();
    return handled;
}

interface TreeMenuState {
    readonly x: number;
    readonly y: number;
    readonly row: TreeRow | null;
    readonly returnFocus: HTMLElement | null;
}

const TREE_SELECTOR = '.file-tree';
const MENU_OFFSET_PX = 16;

/** Kontextmenü per Rechtsklick oder per Taste (dann an der gewählten Zeile) */
function useTreeMenu(rows: readonly TreeRow[]) {
    const [menu, setMenu] = useState<TreeMenuState | null>(null);
    const openAtEvent = useCallback((row: TreeRow | null, event: MouseEvent): void => {
        event.preventDefault();
        if (row !== null) sidebarStore.getState().select(row.path);
        const returnFocus = (event.currentTarget as HTMLElement).closest<HTMLElement>(TREE_SELECTOR);
        setMenu({ x: event.clientX, y: event.clientY, row, returnFocus });
    }, []);
    const openAtRow = useCallback((row: TreeRow | null): void => {
        const tree = document.querySelector<HTMLElement>(TREE_SELECTOR);
        const index = row === null ? -1 : rows.indexOf(row);
        const anchor = document.getElementById(`file-tree-row-${index}`) ?? tree;
        const box = anchor?.getBoundingClientRect();
        setMenu({ x: (box?.left ?? 0) + MENU_OFFSET_PX, y: box?.bottom ?? 0, row, returnFocus: tree });
    }, [rows]);
    const close = useCallback((): void => setMenu(null), []);
    return { menu, openAtEvent, openAtRow, close };
}

type DropTargetSetter = (path: string | null) => void;

function createDragHandlers(rootPath: string, dragged: { current: string | null }, setDropTarget: DropTargetSetter): TreeDragHandlers {
    const targetOf = (row: TreeRow | null, event: DragEvent): string | null => {
        const source = dragged.current;
        if (source === null || !event.dataTransfer.types.includes(TREE_DRAG_TYPE)) return null;
        const folder = folderOfRow(row, rootPath);
        return canDropInto(source, folder) ? folder : null;
    };
    const finish = (): void => {
        dragged.current = null;
        setDropTarget(null);
    };
    return {
        onDragStart: (row, event) => {
            dragged.current = row.path;
            event.dataTransfer.setData(TREE_DRAG_TYPE, row.path);
            event.dataTransfer.effectAllowed = 'move';
        },
        onDragOver: (row, event) => {
            const folder = targetOf(row, event);
            setDropTarget(folder);
            if (folder === null) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
        },
        onDrop: (row, event) => {
            const [folder, source] = [targetOf(row, event), dragged.current];
            finish();
            if (folder === null || source === null) return;
            event.preventDefault();
            void moveEntry(projectFileActionDeps(), source, folder);
        },
        onDragEnd: finish,
    };
}

/** Ziehen im Baum: Eintrag in einen Ordner (Datei als Ziel = ihr Ordner, freie Fläche = Projektordner) */
function useTreeDrag(rootPath: string): { drag: TreeDragHandlers; dropTarget: string | null } {
    const dragged = useRef<string | null>(null);
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const drag = useMemo(() => createDragHandlers(rootPath, dragged, setDropTarget), [rootPath]);
    return { drag, dropTarget };
}

/** Zeigt die Datei des aktiven Tabs im Baum, sobald sie wechselt oder das Projekt geladen ist */
function useRevealActiveFile(project: ProjectView | null, activePath: string | null): void {
    const root = project?.root;
    useEffect(() => {
        revealInTree(sidebarStore, projectStore.getState().current, activePath);
    }, [root, activePath]);
}

function EmptyNotice({ text, action }: { readonly text: string; readonly action?: { label: string; run: () => void } }) {
    return (
        <div className="sidebar-notice" role="status">
            <span>{text}</span>
            {action && (
                <button type="button" onClick={action.run}>
                    {action.label}
                </button>
            )}
        </div>
    );
}

export function FileTree({ project }: { readonly project: ProjectView }) {
    const expanded = useSidebarStore((state) => state.expandedFolders);
    const hidden = useSidebarStore((state) => state.hiddenExtensions);
    const showsBuildFiles = useSidebarStore((state) => state.showsBuildFiles);
    const text = useSidebarStore((state) => state.fileFilter);
    const selectedPath = useSidebarStore((state) => state.selectedPath);
    const activePath = useEditorStore((state) => state.tabs.active);
    const zoom = useSettingsStore((state) => state.values.interfaceZoom);
    const rows = useMemo(
        () => buildTreeRows(project.tree, { text, hiddenExtensions: hidden, showsBuildFiles, keepPath: activePath }, expanded),
        [project.tree, text, hidden, showsBuildFiles, activePath, expanded],
    );
    useRevealActiveFile(project, activePath);
    const treeMenu = useTreeMenu(rows);
    const { drag, dropTarget } = useTreeDrag(project.root);
    const onKeyDown = useMemo(() => keyHandler(rows, selectedPath, treeMenu.openAtRow), [rows, selectedPath, treeMenu.openAtRow]);
    if (rows.length === 0) return <FileTreeEmpty project={project} filter={text} hiddenCount={hidden.size} />;
    return (
        <>
            <TreeViewport
                rows={rows}
                rowHeight={scaledRowHeight(TREE_ROW_HEIGHT_PX, zoom)}
                selectedPath={selectedPath}
                openPath={activePath}
                onClickRow={clickRow}
                onDoubleClickRow={doubleClickRow}
                onKeyDown={onKeyDown}
                onContextMenu={treeMenu.openAtEvent}
                drag={drag}
                dropTargetPath={dropTarget}
                rootPath={project.root}
            />
            {treeMenu.menu !== null && (
                <ContextMenu
                    x={treeMenu.menu.x}
                    y={treeMenu.menu.y}
                    label={TREE_MENU_TEXTS.label}
                    items={treeMenuItems(treeMenu.menu.row, project.root, projectFileActionDeps)}
                    onClose={treeMenu.close}
                    returnFocus={treeMenu.menu.returnFocus}
                />
            )}
        </>
    );
}

function FileTreeEmpty({ project, filter, hiddenCount }: { project: ProjectView; filter: string; hiddenCount: number }) {
    if (filter.trim() !== '') return <EmptyNotice text={FILE_TREE_TEXTS.noMatches(filter.trim(), hiddenCount)} />;
    if (countVisibleFiles(project.tree) === 0 && hiddenCount === 0) return <EmptyNotice text={FILE_TREE_TEXTS.emptyFolder} />;
    const showAll = (): void => sidebarStore.getState().showAllExtensions();
    return <EmptyNotice text={FILE_TREE_TEXTS.allHidden} action={{ label: FILE_TREE_TEXTS.showAllTypes, run: showAll }} />;
}

export function useProjectFileCount(): number {
    return useProjectStore((state) => (state.current === null ? 0 : countVisibleFiles(state.current.tree)));
}
