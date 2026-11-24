// Suche in der Datei (W1-12b): `@codemirror/search` mit deutschen Beschriftungen. Bewusst ohne `searchKeymap`:
// dessen Strg+D und Umschalt+Strg+L erzeugen mehrere Cursor (nicht gewünscht).
import { EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import type { Command } from '@codemirror/view';
import { closeSearchPanel, findNext, findPrevious, openSearchPanel, search } from '@codemirror/search';

export const GERMAN_SEARCH_PHRASES: Readonly<Record<string, string>> = {
    Find: 'Suchen',
    Replace: 'Ersetzen',
    next: 'weiter',
    previous: 'zurück',
    all: 'alle',
    'match case': 'Groß-/Kleinschreibung',
    regexp: 'Regulärer Ausdruck',
    'by word': 'Ganzes Wort',
    replace: 'ersetzen',
    'replace all': 'alle ersetzen',
    close: 'schließen',
    'current match': 'Aktueller Treffer',
    'on line': 'in Zeile',
    'replaced $ matches': '$ Treffer ersetzt',
    'replaced match on line $': 'Treffer in Zeile $ ersetzt',
};

const SEARCH_SCOPE = 'editor search-panel';
const REPLACE_FIELD_SELECTOR = 'input[name=replace]';

/** Strg+H: Suchleiste öffnen und in das Ersetzen-Feld springen (die Leiste hat beide Felder immer) */
export const openReplacePanel: Command = (view) => {
    openSearchPanel(view);
    (view.dom.querySelector(REPLACE_FIELD_SELECTOR) as { focus(): void } | null)?.focus();
    return true;
};

const SEARCH_KEYS = [
    { key: 'Mod-f', run: openSearchPanel, scope: SEARCH_SCOPE, preventDefault: true },
    { key: 'Mod-h', run: openReplacePanel, scope: SEARCH_SCOPE, preventDefault: true },
    { key: 'F3', run: findNext, shift: findPrevious, scope: SEARCH_SCOPE, preventDefault: true },
    { key: 'Mod-g', run: findNext, shift: findPrevious, scope: SEARCH_SCOPE, preventDefault: true },
    { key: 'Escape', run: closeSearchPanel, scope: SEARCH_SCOPE },
];

export function searchExtension(): Extension {
    return [
        search({ top: true }),
        EditorState.phrases.of(GERMAN_SEARCH_PHRASES),
        keymap.of(SEARCH_KEYS),
    ];
}
