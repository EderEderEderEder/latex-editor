// Knopf „Einfügen …“ in der Kopfzeile des Editors (öffnet das Einfügen-Fenster, Kürzel Strg/⌘+Umschalt+I)
import { openInsertDialogFromApp } from '../../app/insertRuntime';

export const INSERT_BUTTON_TEXTS = {
    group: 'Einfügen',
    label: 'Einfügen …',
    title: 'Tabelle, Bild, Code, Gleichung, Liste, Verweis oder Quelle einfügen (Strg+Umschalt+I)',
} as const;

export function InsertToolbarButton() {
    return (
        <div className="editor-toolbar-actions" role="toolbar" aria-label={INSERT_BUTTON_TEXTS.group}>
            <button type="button" onClick={() => openInsertDialogFromApp()} aria-keyshortcuts="Control+Shift+I" title={INSERT_BUTTON_TEXTS.title}>
                {INSERT_BUTTON_TEXTS.label}
            </button>
        </div>
    );
}
