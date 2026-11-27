import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { isJumpClick, isJumpModifier, jumpHitAt } from '../../src/renderer/editor/navigation';

// W4-13: Tasten und Treffer des Strg-Klicks (die Mausbehandlung selbst deckt `jump-targets.spec.ts` ab)
const NONE = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

describe('Sprungtaste', () => {
    it('Windows/Linux: nur Strg; macOS: nur ⌘', () => {
        expect(isJumpModifier({ ...NONE, ctrlKey: true }, false)).toBe(true);
        expect(isJumpModifier({ ...NONE, metaKey: true }, false)).toBe(false);
        expect(isJumpModifier({ ...NONE, metaKey: true }, true)).toBe(true);
        expect(isJumpModifier({ ...NONE, ctrlKey: true }, true)).toBe(false);
    });

    it('mit Alt, Umschalt oder beiden Tasten ist es kein Sprung (Mehrfachauswahl und Rechtsklick auf macOS bleiben)', () => {
        expect(isJumpModifier({ ...NONE, ctrlKey: true, altKey: true }, false)).toBe(false);
        expect(isJumpModifier({ ...NONE, ctrlKey: true, shiftKey: true }, false)).toBe(false);
        expect(isJumpModifier({ ...NONE, ctrlKey: true, metaKey: true }, false)).toBe(false);
        expect(isJumpModifier(NONE, false)).toBe(false);
    });

    it('nur die linke Maustaste springt', () => {
        expect(isJumpClick({ ...NONE, ctrlKey: true, button: 0 }, false)).toBe(true);
        expect(isJumpClick({ ...NONE, ctrlKey: true, button: 2 }, false)).toBe(false);
        expect(isJumpClick({ ...NONE, ctrlKey: true, button: 1 }, false)).toBe(false);
    });
});

describe('Treffer im Editorzustand', () => {
    const state = EditorState.create({ doc: 'Erste Zeile\nSiehe \\ref{fig:a} und \\input{kapitel/eins}\n' });

    it('liefert Ziel und Bereich in Dokumentpositionen der richtigen Zeile', () => {
        const refPosition = state.doc.toString().indexOf('fig:a') + 2;
        const hit = jumpHitAt(state, refPosition);
        expect(hit?.target).toEqual({ kind: 'label', key: 'fig:a' });
        expect(state.doc.sliceString(hit?.start ?? 0, hit?.end ?? 0)).toBe('fig:a');

        const inputPosition = state.doc.toString().indexOf('kapitel');
        const fileHit = jumpHitAt(state, inputPosition);
        expect(fileHit?.target).toEqual({ kind: 'file', path: 'kapitel/eins', command: 'input' });
        expect(state.doc.sliceString(fileHit?.start ?? 0, fileHit?.end ?? 0)).toBe('kapitel/eins');
    });

    it('Text ohne Ziel und die erste Zeile: kein Treffer', () => {
        expect(jumpHitAt(state, 3)).toBeNull();
        expect(jumpHitAt(state, state.doc.length)).toBeNull();
    });
});
