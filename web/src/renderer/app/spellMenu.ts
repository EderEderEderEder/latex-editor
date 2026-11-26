// Zeigt das Rechtschreib-Kontextmenü (W7-2) mit der App-Komponente `ui/ContextMenu.tsx` an einer Bildschirmstelle.
// Der Editor ist kein React-Baum; deshalb eine eigene kleine React-Wurzel am Ende von `<body>`, einmal angelegt.
// Angemeldet in `commandsRuntime.ts` (`setSpellMenuOpener`), damit `editor/spell.ts` ohne React-Komponenten auskommt.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { ContextMenu } from '../ui/ContextMenu';
import { SPELL_MENU_TEXTS } from './spellMenuItems';
import type { SpellMenuRequest } from './spellMenuItems';

const ROOT_CLASS = 'spell-menu-root';

let menuRoot: Root | null = null;
/** Jedes Öffnen bekommt eine neue Nummer: ein spätes Schließen eines alten Menüs schließt das neue nicht */
let generation = 0;

function root(): Root {
    if (menuRoot !== null) return menuRoot;
    const container = document.createElement('div');
    container.className = ROOT_CLASS;
    document.body.append(container);
    menuRoot = createRoot(container);
    return menuRoot;
}

export function showSpellMenu(request: SpellMenuRequest): void {
    generation += 1;
    const current = generation;
    const close = (): void => {
        if (current === generation) root().render(null);
    };
    root().render(createElement(ContextMenu, {
        key: current,
        x: request.x,
        y: request.y,
        label: SPELL_MENU_TEXTS.label,
        items: request.items,
        onClose: close,
        returnFocus: request.returnFocus,
    }));
}
