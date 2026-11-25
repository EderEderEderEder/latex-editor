// Eintrag eines Kontextmenüs (Typ getrennt von der Komponente, damit `app/` ihn ohne JSX-Datei importieren kann)
export type ContextMenuItem =
    | {
        readonly kind: 'item';
        readonly label: string;
        /** Angezeigtes Kürzel (nur Anzeige, ausgeführt wird es anderswo) */
        readonly shortcut?: string;
        readonly disabled?: boolean;
        readonly onSelect: () => void;
    }
    | { readonly kind: 'separator' };
