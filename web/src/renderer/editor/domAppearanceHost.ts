// Schreibt die Darstellung ins Dokument: Variablen auf `:root` und die Syntaxfarben in ein eigenes `<style>`.
import type { AppearanceHost } from './appearanceController';

const SYNTAX_STYLE_ID = 'editor-syntax-css';

export function domAppearanceHost(doc: Document, onChanged: () => void): AppearanceHost {
    const style = doc.getElementById(SYNTAX_STYLE_ID) ?? doc.head.appendChild(doc.createElement('style'));
    style.id = SYNTAX_STYLE_ID;
    return {
        applySyntaxCss: (css) => {
            style.textContent = css;
        },
        applyCssVariables: (variables) => {
            for (const [name, value] of Object.entries(variables)) doc.documentElement.style.setProperty(name, value);
        },
        appearanceChanged: onChanged,
    };
}
