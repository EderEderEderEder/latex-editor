// Dateibaum (W2-3): flache, virtualisierte Zeilenliste. Ordner- und Auswahlzustand liegen im Sidebar-Store.
// Einzelklick auf eine Datei öffnet sie als Vorschau-Tab, Doppelklick/Enter als festen Tab; Ordner klappen per Klick,
// Pfeile, Enter. Namensfilter und Dateitypen kommen aus dem Store (`FileFilterRow`).
import { useEffect, useMemo } from 'react';
import type { KeyboardEvent } from 'react';
import { buildTreeRows, countVisibleFiles } from '../../shared/core/fileTree';
import type { TreeRow } from '../../shared/core/fileTree';
import { openProjectFile } from '../app/projectFiles';
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
import { TreeViewport } from './TreeViewport';

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

function keyHandler(rows: readonly TreeRow[], selectedPath: string | null) {
    return (event: KeyboardEvent): void => {
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
    const onKeyDown = useMemo(() => keyHandler(rows, selectedPath), [rows, selectedPath]);
    if (rows.length === 0) return <FileTreeEmpty project={project} filter={text} hiddenCount={hidden.size} />;
    return (
        <TreeViewport
            rows={rows}
            rowHeight={scaledRowHeight(TREE_ROW_HEIGHT_PX, zoom)}
            selectedPath={selectedPath}
            openPath={activePath}
            onClickRow={clickRow}
            onDoubleClickRow={doubleClickRow}
            onKeyDown={onKeyDown}
        />
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
