import { describe, expect, it } from 'vitest';
import type { TreeRow } from '../../src/shared/core/fileTree';
import { treeKeyAction } from '../../src/renderer/app/treeNavigation';

function row(path: string, kind: 'file' | 'directory', depth: number, parentPath: string | null, isExpanded: boolean | null): TreeRow {
    return { path, name: path, label: path, kind, depth, isExpanded, isBuildFile: false, parentPath, position: 1, siblingCount: 1 };
}

const ROWS: TreeRow[] = [
    row('/p/a', 'directory', 0, '/p', true),
    row('/p/a/x.tex', 'file', 1, '/p/a', null),
    row('/p/b', 'directory', 0, '/p', false),
    row('/p/m.tex', 'file', 0, '/p', null),
];

describe('Tastatur im Dateibaum', () => {
    it('bewegt mit Pfeilen, Pos1 und Ende und klemmt an den Rändern', () => {
        expect(treeKeyAction(ROWS, 0, 'ArrowDown')).toEqual({ kind: 'focus', index: 1 });
        expect(treeKeyAction(ROWS, 0, 'ArrowUp')).toEqual({ kind: 'focus', index: 0 });
        expect(treeKeyAction(ROWS, 3, 'ArrowDown')).toEqual({ kind: 'focus', index: 3 });
        expect(treeKeyAction(ROWS, 2, 'Home')).toEqual({ kind: 'focus', index: 0 });
        expect(treeKeyAction(ROWS, 0, 'End')).toEqual({ kind: 'focus', index: 3 });
    });

    it('klappt mit Rechts auf, springt dann ins erste Kind', () => {
        expect(treeKeyAction(ROWS, 2, 'ArrowRight')).toEqual({ kind: 'toggle', path: '/p/b' });
        expect(treeKeyAction(ROWS, 0, 'ArrowRight')).toEqual({ kind: 'focus', index: 1 });
        expect(treeKeyAction(ROWS, 3, 'ArrowRight')).toBeNull();
    });

    it('klappt mit Links zu, sonst zum Elternordner', () => {
        expect(treeKeyAction(ROWS, 0, 'ArrowLeft')).toEqual({ kind: 'toggle', path: '/p/a' });
        expect(treeKeyAction(ROWS, 1, 'ArrowLeft')).toEqual({ kind: 'focus', index: 0 });
        expect(treeKeyAction(ROWS, 3, 'ArrowLeft')).toBeNull();
    });

    it('öffnet Dateien mit Enter fest und mit Leertaste als Vorschau, Ordner klappen um', () => {
        expect(treeKeyAction(ROWS, 3, 'Enter')).toEqual({ kind: 'open', path: '/p/m.tex', asPreview: false });
        expect(treeKeyAction(ROWS, 3, ' ')).toEqual({ kind: 'open', path: '/p/m.tex', asPreview: true });
        expect(treeKeyAction(ROWS, 2, 'Enter')).toEqual({ kind: 'toggle', path: '/p/b' });
    });

    it('ignoriert andere Tasten und ungültige Zeilen', () => {
        expect(treeKeyAction(ROWS, 0, 'a')).toBeNull();
        expect(treeKeyAction(ROWS, 9, 'ArrowDown')).toBeNull();
        expect(treeKeyAction([], 0, 'ArrowDown')).toBeNull();
    });
});
