// Gliederungsliste (W2-6): hierarchisch, aktueller Abschnitt hervorgehoben, Klick und Enter springen, Pfeiltasten
// nach WAI-ARIA-Baum (Hoch/Runter, Rechts/Links klappt auf/zu bzw. springt zum Kind/Elternknoten, Pos1/Ende).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { OUTLINE_LEVEL_TITLES, flattenOutlineTree } from '../../shared/core/latex/outline';
import type { OutlineNode, OutlineRow } from '../../shared/core/latex/outline';
import './outlineList.css';

export interface OutlineTarget {
    readonly file: string;
    readonly line: number;
}

export interface OutlineListProps {
    readonly tree: readonly OutlineNode[];
    readonly currentEntryId: string | null;
    readonly onSelect: (target: OutlineTarget) => void;
}

export const OUTLINE_EMPTY_TEXT = 'Keine Gliederung';
export const OUTLINE_UNTITLED = '(ohne Titel)';
export const OUTLINE_LABEL = 'Gliederung';

function fileName(path: string): string {
    return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

interface Navigation {
    readonly focusId: string | null;
    readonly toggle: string | null;
}

/** Ziel einer Taste: neue Fokus-Zeile und/oder Knoten zum Umschalten (`null`: Taste nicht behandelt) */
function navigate(rows: readonly OutlineRow[], index: number, key: string): Navigation | null {
    const row = rows[index];
    if (row === undefined) return null;
    const id = row.node.entry.id;
    switch (key) {
        case 'ArrowDown': return { focusId: rows[index + 1]?.node.entry.id ?? id, toggle: null };
        case 'ArrowUp': return { focusId: rows[index - 1]?.node.entry.id ?? id, toggle: null };
        case 'Home': return { focusId: rows[0]?.node.entry.id ?? id, toggle: null };
        case 'End': return { focusId: rows[rows.length - 1]?.node.entry.id ?? id, toggle: null };
        case 'ArrowRight':
            if (row.isExpanded === false) return { focusId: null, toggle: id };
            return { focusId: row.isExpanded === true ? rows[index + 1]?.node.entry.id ?? id : id, toggle: null };
        case 'ArrowLeft':
            if (row.isExpanded === true) return { focusId: null, toggle: id };
            return { focusId: row.parentId ?? id, toggle: null };
        default: return null;
    }
}

function toggled(collapsed: ReadonlySet<string>, id: string): Set<string> {
    const next = new Set(collapsed);
    if (!next.delete(id)) next.add(id);
    return next;
}

export function OutlineList({ tree, currentEntryId, onSelect }: OutlineListProps): React.JSX.Element {
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
    const [focusId, setFocusId] = useState<string | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const rows = useMemo(() => flattenOutlineTree(tree, collapsed), [tree, collapsed]);
    const tabStopId = rows.some((row) => row.node.entry.id === focusId) ? focusId : (currentEntryId ?? rows[0]?.node.entry.id ?? null);
    const select = (row: OutlineRow): void => onSelect({ file: row.node.entry.file, line: row.node.entry.line });

    useEffect(() => {
        const element = listRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
        element?.scrollIntoView?.({ block: 'nearest' });
    }, [currentEntryId]);

    const onKeyDown = (event: KeyboardEvent, index: number): void => {
        const row = rows[index];
        if (row === undefined) return;
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            select(row);
            return;
        }
        const move = navigate(rows, index, event.key);
        if (move === null) return;
        event.preventDefault();
        if (move.toggle !== null) setCollapsed((current) => toggled(current, move.toggle ?? ''));
        if (move.focusId === null) return;
        setFocusId(move.focusId);
        listRef.current?.querySelector<HTMLElement>(`[data-outline-id="${CSS.escape(move.focusId)}"]`)?.focus();
    };

    if (rows.length === 0) return <p className="outline-empty">{OUTLINE_EMPTY_TEXT}</p>;
    return (
        <div ref={listRef} className="outline-list" role="tree" aria-label={OUTLINE_LABEL}>
            {rows.map((row, index) => (
                <OutlineItem
                    key={row.node.entry.id}
                    row={row}
                    isCurrent={row.node.entry.id === currentEntryId}
                    isTabStop={row.node.entry.id === tabStopId}
                    onKeyDown={(event) => onKeyDown(event, index)}
                    onActivate={() => { setFocusId(row.node.entry.id); select(row); }}
                    onToggle={() => setCollapsed((current) => toggled(current, row.node.entry.id))}
                />
            ))}
        </div>
    );
}

interface OutlineItemProps {
    readonly row: OutlineRow;
    readonly isCurrent: boolean;
    readonly isTabStop: boolean;
    readonly onKeyDown: (event: KeyboardEvent) => void;
    readonly onActivate: () => void;
    readonly onToggle: () => void;
}

function OutlineItem({ row, isCurrent, isTabStop, onKeyDown, onActivate, onToggle }: OutlineItemProps): React.JSX.Element {
    const { entry, startsFile } = row.node;
    const title = entry.title === '' ? OUTLINE_UNTITLED : entry.title;
    const classes = ['outline-item', `outline-level-${entry.level}`, isCurrent ? 'is-current' : ''].join(' ').trim();
    return (
        <div
            className={classes}
            role="treeitem"
            data-outline-id={entry.id}
            aria-level={row.depth + 1}
            aria-expanded={row.isExpanded ?? undefined}
            aria-selected={isCurrent}
            aria-current={isCurrent ? 'true' : undefined}
            aria-posinset={row.position}
            aria-setsize={row.siblingCount}
            tabIndex={isTabStop ? 0 : -1}
            style={{ paddingLeft: `calc(${row.depth} * var(--outline-indent, 14px) + 4px)` }}
            title={`${OUTLINE_LEVEL_TITLES[entry.level]}: ${fileName(entry.file)}, Zeile ${entry.line}`}
            onClick={onActivate}
            onKeyDown={onKeyDown}
        >
            <span
                className={`outline-toggle${row.isExpanded === null ? ' is-leaf' : ''}`}
                aria-hidden="true"
                onClick={(event) => { event.stopPropagation(); if (row.isExpanded !== null) onToggle(); }}
            >
                {row.isExpanded === null ? '' : row.isExpanded ? '▾' : '▸'}
            </span>
            <span className="outline-title">{title}</span>
            {startsFile ? <span className="outline-file">{fileName(entry.file)}</span> : null}
        </div>
    );
}
