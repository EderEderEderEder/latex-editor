// Virtualisierte Zeilenliste des Dateibaums: feste Zeilenhöhe, gerendert werden nur die sichtbaren Zeilen plus Puffer.
// Die Höhe des Rahmens kommt vom Layout (Flex), nie vom Inhalt; der Inhalt scrollt im Rahmen.
import { memo, useEffect, useRef } from 'react';
import type { DragEvent, KeyboardEvent, MouseEvent, RefObject } from 'react';
import { TREE_OVERSCAN_ROWS, scrollTopToReveal } from '../app/virtualWindow';
import type { TreeRow } from '../../shared/core/fileTree';
import { fileGlyphOf } from '../../shared/core/fileTypes';
import { FileIcon } from './FileIcon';
import { useVirtualWindow } from './useVirtualWindow';

const INDENT_PX = 14;
const BASE_PADDING_PX = 4;
const EXPANDED_MARK = '▾';
const COLLAPSED_MARK = '▸';
export const TREE_LABEL = 'Dateibaum';

export interface TreeViewportProps {
    readonly rows: readonly TreeRow[];
    readonly rowHeight: number;
    readonly selectedPath: string | null;
    /** Datei im sichtbaren Tab */
    readonly openPath: string | null;
    readonly onClickRow: (row: TreeRow) => void;
    readonly onDoubleClickRow: (row: TreeRow) => void;
    readonly onKeyDown: (event: KeyboardEvent) => void;
    /** Rechtsklick auf eine Zeile (`row`) oder auf die freie Fläche darunter (`null`, Projektordner) */
    readonly onContextMenu?: (row: TreeRow | null, event: MouseEvent) => void;
    /** Ziehen im Baum (Verschieben); `row` `null` = freie Fläche (Projektordner) */
    readonly drag?: TreeDragHandlers;
    /** Ordner, über dem gerade etwas schwebt (hervorgehoben); die Wurzel hebt den ganzen Baum hervor */
    readonly dropTargetPath?: string | null;
    readonly rootPath?: string;
}

export interface TreeDragHandlers {
    readonly onDragStart: (row: TreeRow, event: DragEvent) => void;
    readonly onDragOver: (row: TreeRow | null, event: DragEvent) => void;
    readonly onDrop: (row: TreeRow | null, event: DragEvent) => void;
    readonly onDragEnd: () => void;
}

interface RowViewProps {
    readonly row: TreeRow;
    readonly index: number;
    readonly rowHeight: number;
    readonly isSelected: boolean;
    readonly isOpen: boolean;
    readonly onClickRow: (row: TreeRow) => void;
    readonly onDoubleClickRow: (row: TreeRow) => void;
    readonly isDropTarget: boolean;
    readonly onContextMenu?: TreeViewportProps['onContextMenu'];
    readonly drag?: TreeDragHandlers;
}

function rowClassName(row: TreeRow, isSelected: boolean, isOpen: boolean, isDropTarget: boolean): string {
    const classes = ['file-tree-row', isSelected && 'is-selected', isOpen && 'is-open', row.isBuildFile && 'is-build'];
    return [...classes, isDropTarget && 'is-drop-target'].filter(Boolean).join(' ');
}

/** Ereignisse einer Zeile; sie gehen nicht weiter an die freie Fläche des Baums */
function rowEvents(row: TreeRow, props: Pick<RowViewProps, 'onContextMenu' | 'drag'>) {
    const { onContextMenu, drag } = props;
    return {
        draggable: drag !== undefined,
        onContextMenu: onContextMenu && ((event: MouseEvent) => {
            event.stopPropagation();
            onContextMenu(row, event);
        }),
        onDragStart: drag && ((event: DragEvent) => drag.onDragStart(row, event)),
        onDragOver: drag && ((event: DragEvent) => {
            event.stopPropagation();
            drag.onDragOver(row, event);
        }),
        onDrop: drag && ((event: DragEvent) => {
            event.stopPropagation();
            drag.onDrop(row, event);
        }),
        onDragEnd: drag?.onDragEnd,
    };
}

const TreeRowView = memo(function TreeRowView(props: RowViewProps) {
    const { row, index, rowHeight, isSelected, isOpen, isDropTarget, onClickRow, onDoubleClickRow } = props;
    const isFolder = row.kind === 'directory';
    return (
        <div
            id={`file-tree-row-${index}`}
            role="treeitem"
            className={rowClassName(row, isSelected, isOpen, isDropTarget)}
            aria-level={row.depth + 1}
            aria-posinset={row.position}
            aria-setsize={row.siblingCount}
            aria-expanded={row.isExpanded ?? undefined}
            aria-selected={isSelected}
            aria-current={isOpen ? 'true' : undefined}
            title={row.label}
            style={{ top: index * rowHeight, height: rowHeight, paddingLeft: row.depth * INDENT_PX + BASE_PADDING_PX }}
            onClick={() => onClickRow(row)}
            onDoubleClick={() => onDoubleClickRow(row)}
            {...rowEvents(row, props)}
        >
            <span className="file-tree-chevron" aria-hidden="true">
                {isFolder ? (row.isExpanded === true ? EXPANDED_MARK : COLLAPSED_MARK) : ''}
            </span>
            <FileIcon kind={isFolder ? 'folder' : fileGlyphOf(row.name)} />
            <span className="file-tree-label">{row.label}</span>
        </div>
    );
});

/** Hält die gewählte Zeile im Sichtbereich (Pfeiltasten, Auswahl über die offene Datei) */
function useRevealSelected(ref: RefObject<HTMLDivElement | null>, index: number, rowHeight: number): void {
    useEffect(() => {
        const element = ref.current;
        if (element === null || index < 0) return;
        const view = { scrollTop: element.scrollTop, viewportHeight: element.clientHeight, rowHeight };
        const next = scrollTopToReveal(index, view);
        if (next !== view.scrollTop) element.scrollTop = next;
    }, [ref, index, rowHeight]);
}

function rootEvents(props: TreeViewportProps) {
    const { onContextMenu, drag } = props;
    return {
        onContextMenu: onContextMenu && ((event: MouseEvent) => onContextMenu(null, event)),
        onDragOver: drag && ((event: DragEvent) => drag.onDragOver(null, event)),
        onDrop: drag && ((event: DragEvent) => drag.onDrop(null, event)),
    };
}

export function TreeViewport(props: TreeViewportProps) {
    const { rows, rowHeight, selectedPath, openPath } = props;
    const dropTargetPath = props.dropTargetPath ?? null;
    const ref = useRef<HTMLDivElement>(null);
    const visible = useVirtualWindow(ref, { rowHeight, rowCount: rows.length, overscan: TREE_OVERSCAN_ROWS });
    const selectedIndex = rows.findIndex((row) => row.path === selectedPath);
    useRevealSelected(ref, selectedIndex, rowHeight);
    const inWindow = selectedIndex >= visible.start && selectedIndex < visible.end;
    return (
        <div
            ref={ref}
            className={dropTargetPath !== null && dropTargetPath === props.rootPath ? 'file-tree is-drop-root' : 'file-tree'}
            role="tree"
            aria-label={TREE_LABEL}
            tabIndex={0}
            aria-activedescendant={inWindow ? `file-tree-row-${selectedIndex}` : undefined}
            onKeyDown={props.onKeyDown}
            {...rootEvents(props)}
        >
            <div className="file-tree-spacer" style={{ height: visible.totalHeight }}>
                {rows.slice(visible.start, visible.end).map((row, offset) => (
                    <TreeRowView
                        key={row.path}
                        row={row}
                        index={visible.start + offset}
                        rowHeight={rowHeight}
                        isSelected={row.path === selectedPath}
                        isOpen={row.path === openPath}
                        onClickRow={props.onClickRow}
                        onDoubleClickRow={props.onDoubleClickRow}
                        isDropTarget={row.path === dropTargetPath}
                        onContextMenu={props.onContextMenu}
                        drag={props.drag}
                    />
                ))}
            </div>
        </div>
    );
}
