// Tastatur im Dateibaum (WAI-ARIA-Baum): Pfeile, Pos1/Ende, Rechts/Links klappt auf/zu bzw. springt zum Kind/Elternknoten.
import type { TreeRow } from '../../shared/core/fileTree';

export type TreeKeyAction =
    | { readonly kind: 'focus'; readonly index: number }
    | { readonly kind: 'toggle'; readonly path: string }
    | { readonly kind: 'open'; readonly path: string; readonly asPreview: boolean };

/** Aktion zu einer Taste auf Zeile `index` (`null`: Taste nicht behandelt) */
export function treeKeyAction(rows: readonly TreeRow[], index: number, key: string): TreeKeyAction | null {
    const row = rows[index];
    if (row === undefined) return null;
    const last = rows.length - 1;
    switch (key) {
        case 'ArrowDown': return { kind: 'focus', index: Math.min(index + 1, last) };
        case 'ArrowUp': return { kind: 'focus', index: Math.max(index - 1, 0) };
        case 'Home': return { kind: 'focus', index: 0 };
        case 'End': return { kind: 'focus', index: last };
        case 'ArrowRight': return rightAction(rows, index, row);
        case 'ArrowLeft': return leftAction(rows, index, row);
        case 'Enter': return enterAction(row);
        case ' ': return row.kind === 'file' ? { kind: 'open', path: row.path, asPreview: true } : { kind: 'toggle', path: row.path };
        default: return null;
    }
}

function rightAction(rows: readonly TreeRow[], index: number, row: TreeRow): TreeKeyAction | null {
    if (row.isExpanded === null) return null;
    if (!row.isExpanded) return { kind: 'toggle', path: row.path };
    const next = rows[index + 1];
    return next !== undefined && next.parentPath === row.path ? { kind: 'focus', index: index + 1 } : null;
}

function leftAction(rows: readonly TreeRow[], index: number, row: TreeRow): TreeKeyAction | null {
    if (row.isExpanded === true) return { kind: 'toggle', path: row.path };
    const parentIndex = rows.findIndex((candidate, at) => at < index && candidate.path === row.parentPath);
    return parentIndex < 0 ? null : { kind: 'focus', index: parentIndex };
}

function enterAction(row: TreeRow): TreeKeyAction {
    return row.kind === 'file' ? { kind: 'open', path: row.path, asPreview: false } : { kind: 'toggle', path: row.path };
}
