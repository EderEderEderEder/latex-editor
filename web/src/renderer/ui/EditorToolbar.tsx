import type { ReactNode } from 'react';
import { InsertToolbarButton } from './insert/InsertToolbarButton';

export interface EditorToolbarProps {
    readonly heading: ReactNode;
    readonly canSave: boolean;
    readonly onOpen: () => void;
    readonly onSave: () => void;
    readonly onSaveAs: () => void;
    /** Platz für die Kompilieren-Leiste rechts neben den Datei-Aktionen */
    readonly build?: ReactNode;
}

/** Kopfzeile: Überschrift links, Datei-Aktionen daneben (Kürzel Strg+O, Strg+S, Strg+Umschalt+S) */
export function EditorToolbar({ heading, canSave, onOpen, onSave, onSaveAs, build }: EditorToolbarProps) {
    return (
        <header className="editor-toolbar">
            {heading}
            <div className="editor-toolbar-actions" role="toolbar" aria-label="Datei">
                <button type="button" onClick={onOpen} aria-keyshortcuts="Control+O" title="Datei öffnen (Strg+O)">
                    Öffnen …
                </button>
                <button type="button" onClick={onSave} disabled={!canSave} aria-keyshortcuts="Control+S" title="Speichern (Strg+S)">
                    Speichern
                </button>
                <button
                    type="button"
                    onClick={onSaveAs}
                    disabled={!canSave}
                    aria-keyshortcuts="Control+Shift+S"
                    title="Speichern unter … (Strg+Umschalt+S)"
                >
                    Speichern unter …
                </button>
            </div>
            <InsertToolbarButton />
            {build}
        </header>
    );
}
