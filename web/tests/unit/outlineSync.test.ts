import { describe, expect, it, vi } from 'vitest';
import { OUTLINE_SYNC_START, syncOutline } from '../../src/renderer/app/outlineSync';

function outline() {
    return { updateCursor: vi.fn(), requestRefresh: vi.fn() };
}

describe('Gliederung folgt dem Editor', () => {
    it('meldet die Cursorzeile, parst aber beim ersten Abgleich und beim Tabwechsel nicht neu', () => {
        const target = outline();
        const doc = {};
        const first = syncOutline(target, OUTLINE_SYNC_START, { path: '/p/a.tex', line: 3, doc });
        expect(target.updateCursor).toHaveBeenCalledWith('/p/a.tex', 3);
        expect(target.requestRefresh).not.toHaveBeenCalled();
        syncOutline(target, first, { path: '/p/b.tex', line: 1, doc: {} });
        expect(target.requestRefresh).not.toHaveBeenCalled();
    });

    it('parst neu, wenn sich in derselben Datei der Text geändert hat, nicht bei bloßer Cursorbewegung', () => {
        const target = outline();
        const doc = {};
        const memory = syncOutline(target, OUTLINE_SYNC_START, { path: '/p/a.tex', line: 1, doc });
        const moved = syncOutline(target, memory, { path: '/p/a.tex', line: 2, doc });
        expect(target.requestRefresh).not.toHaveBeenCalled();
        syncOutline(target, moved, { path: '/p/a.tex', line: 2, doc: {} });
        expect(target.requestRefresh).toHaveBeenCalledTimes(1);
    });

    it('vergisst alles ohne sichtbare Datei', () => {
        const target = outline();
        expect(syncOutline(target, { path: '/p/a.tex', doc: {} }, null)).toBe(OUTLINE_SYNC_START);
        expect(target.updateCursor).not.toHaveBeenCalled();
    });
});
