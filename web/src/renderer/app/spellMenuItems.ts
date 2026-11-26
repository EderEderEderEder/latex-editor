// Einträge des Rechtschreib-Kontextmenüs (W7-2): Vorschläge, „Ignorieren“, „Zum Wörterbuch hinzufügen“.
import { MAX_SUGGESTIONS } from '../../shared/core/spelling/spellChecker';
import { isValidUserWord } from '../../shared/core/spelling/userWords';
import type { ContextMenuItem } from '../ui/contextMenuItem';

export const SPELL_MENU_TEXTS = {
    label: 'Rechtschreibung',
    noSuggestions: 'Keine Vorschläge',
    ignore: 'Ignorieren',
    add: 'Zum Wörterbuch hinzufügen',
} as const;

/** Was `app/spellMenu.ts` zum Anzeigen braucht (Typ hier, damit der Editor ihn ohne React-Komponente kennt) */
export interface SpellMenuRequest {
    readonly x: number;
    readonly y: number;
    readonly items: readonly ContextMenuItem[];
    /** Bekommt nach dem Schließen den Fokus zurück (Editor) */
    readonly returnFocus: HTMLElement | null;
}

export interface SpellMenuActions {
    replace(suggestion: string): void;
    ignore(): void;
    add(): void;
}

const SEPARATOR: ContextMenuItem = { kind: 'separator' };

function suggestionItems(suggestions: readonly string[], actions: SpellMenuActions): ContextMenuItem[] {
    const unique = [...new Set(suggestions)].slice(0, MAX_SUGGESTIONS);
    if (unique.length === 0) return [{ kind: 'item', label: SPELL_MENU_TEXTS.noSuggestions, disabled: true, onSelect: () => undefined }];
    return unique.map((suggestion) => ({ kind: 'item', label: suggestion, onSelect: () => actions.replace(suggestion) }));
}

export function spellMenuItems(word: string, suggestions: readonly string[], actions: SpellMenuActions): ContextMenuItem[] {
    return [
        ...suggestionItems(suggestions, actions),
        SEPARATOR,
        { kind: 'item', label: SPELL_MENU_TEXTS.ignore, onSelect: () => actions.ignore() },
        { kind: 'item', label: SPELL_MENU_TEXTS.add, disabled: !isValidUserWord(word), onSelect: () => actions.add() },
    ];
}
