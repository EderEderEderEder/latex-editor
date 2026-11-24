import { describe, expect, it } from 'vitest';
import { matchShortcut } from '../../src/renderer/app/shortcuts';
import type { KeyInput } from '../../src/renderer/app/shortcuts';

const ctrl = (key: string, extra: Partial<KeyInput> = {}): KeyInput => ({
    key, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, ...extra,
});

describe('Tastenkürzel', () => {
    it('erkennt Öffnen, Speichern und Speichern unter', () => {
        expect(matchShortcut(ctrl('o'))).toEqual({ kind: 'open' });
        expect(matchShortcut(ctrl('s'))).toEqual({ kind: 'save' });
        expect(matchShortcut(ctrl('S', { shiftKey: true }))).toEqual({ kind: 'saveAs' });
    });

    it('akzeptiert auf macOS ⌘ statt Strg', () => {
        expect(matchShortcut(ctrl('s', { ctrlKey: false, metaKey: true }))).toEqual({ kind: 'save' });
    });

    it('erkennt Zoom mit Plus (auch als Gleichheitszeichen), Minus und Null', () => {
        expect(matchShortcut(ctrl('+', { shiftKey: true }))).toEqual({ kind: 'zoom', direction: 'in' });
        expect(matchShortcut(ctrl('='))).toEqual({ kind: 'zoom', direction: 'in' });
        expect(matchShortcut(ctrl('-'))).toEqual({ kind: 'zoom', direction: 'out' });
        expect(matchShortcut(ctrl('0'))).toEqual({ kind: 'zoom', direction: 'reset' });
    });

    it('Strg+Tab und Strg+Umschalt+Tab wechseln die Tabs, auch auf macOS nur mit Strg', () => {
        expect(matchShortcut(ctrl('Tab'))).toEqual({ kind: 'nextTab' });
        expect(matchShortcut(ctrl('Tab', { shiftKey: true }))).toEqual({ kind: 'previousTab' });
        expect(matchShortcut(ctrl('Tab', { ctrlKey: false, metaKey: true }))).toBeNull();
        expect(matchShortcut(ctrl('Tab', { ctrlKey: false }))).toBeNull();
        expect(matchShortcut(ctrl('Tab', { altKey: true }))).toBeNull();
        expect(matchShortcut(ctrl('Tab', { defaultPrevented: true }))).toBeNull();
    });

    it('ignoriert Tasten ohne Strg, mit Alt oder schon behandelte', () => {
        expect(matchShortcut(ctrl('s', { ctrlKey: false }))).toBeNull();
        expect(matchShortcut(ctrl('s', { altKey: true }))).toBeNull();
        expect(matchShortcut(ctrl('s', { defaultPrevented: true }))).toBeNull();
        expect(matchShortcut(ctrl('s', { metaKey: true }))).toBeNull();
        expect(matchShortcut(ctrl('f'))).toBeNull();
    });

    it('Strg+B kompiliert (nicht mit Umschalt: das ist Fett), Strg+Punkt bricht ab', () => {
        expect(matchShortcut(ctrl('b'))).toEqual({ kind: 'compile' });
        expect(matchShortcut(ctrl('b', { ctrlKey: false, metaKey: true }))).toEqual({ kind: 'compile' });
        expect(matchShortcut(ctrl('B', { shiftKey: true }))).toBeNull();
        expect(matchShortcut(ctrl('.'))).toEqual({ kind: 'cancelBuild' });
    });

    it('F8 und Umschalt+F8 springen zur nächsten und vorherigen Meldung, nur ohne Strg, Meta und Alt', () => {
        const key = (extra: Partial<KeyInput> = {}): KeyInput => ({ ...ctrl('F8', { ctrlKey: false }), ...extra });
        expect(matchShortcut(key())).toEqual({ kind: 'nextIssue' });
        expect(matchShortcut(key({ shiftKey: true }))).toEqual({ kind: 'previousIssue' });
        expect(matchShortcut(key({ ctrlKey: true }))).toBeNull();
        expect(matchShortcut(key({ metaKey: true }))).toBeNull();
        expect(matchShortcut(key({ altKey: true }))).toBeNull();
        expect(matchShortcut(key({ defaultPrevented: true }))).toBeNull();
    });
});
