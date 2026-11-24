import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { GERMAN_SEARCH_PHRASES, searchExtension } from '../../src/renderer/editor/search';

describe('Suche in der Datei', () => {
    it('übersetzt die Beschriftungen der Suchleiste ins Deutsche', () => {
        const state = EditorState.create({ extensions: [searchExtension()] });
        expect(state.phrase('Find')).toBe('Suchen');
        expect(state.phrase('replace all')).toBe('alle ersetzen');
        expect(state.phrase('match case')).toBe('Groß-/Kleinschreibung');
        expect(state.phrase('replaced $ matches', 3)).toBe('3 Treffer ersetzt');
    });

    it('übersetzt jede Phrase, die die Suchleiste benutzt (keine leeren Werte)', () => {
        for (const [english, german] of Object.entries(GERMAN_SEARCH_PHRASES)) {
            expect(german.length, english).toBeGreaterThan(0);
            expect(german, english).not.toBe(english);
        }
    });
});
