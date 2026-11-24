import { useMemo } from 'react';
import { buildTabBarItems, closeConfirmationText } from '../app/tabBarData';
import type { TabBarItem } from '../app/tabBarData';
import { editorStore, useEditorStore } from '../stores/editor';

export interface EditorTabsProps {
    /** Nachfrage beim Schließen eines ungespeicherten Tabs; `true` = schließen */
    readonly confirmClose?: (text: string) => boolean;
}

interface EditorTabProps {
    readonly item: TabBarItem;
    readonly onClose: (item: TabBarItem) => void;
}

function EditorTabTitle({ item }: { readonly item: TabBarItem }) {
    return (
        <button
            type="button"
            role="tab"
            aria-selected={item.isActive}
            className={item.isPreview ? 'editor-tab-title is-preview' : 'editor-tab-title'}
            title={item.hint}
            onClick={() => editorStore.getState().activate(item.path)}
            onDoubleClick={() => editorStore.getState().pin(item.path)}
        >
            {item.title}
        </button>
    );
}

function EditorTab({ item, onClose }: EditorTabProps) {
    return (
        <div className={item.isActive ? 'editor-tab is-active' : 'editor-tab'}>
            <EditorTabTitle item={item} />
            {item.isDirty && <span className="tab-dirty" role="img" aria-label="Ungespeicherte Änderungen" />}
            <button
                type="button"
                className="editor-tab-close"
                aria-label={`„${item.title}“ schließen`}
                onClick={() => onClose(item)}
            >
                ×
            </button>
        </div>
    );
}

/** Einfache Tab-Leiste: Vorschau-Tab kursiv, Punkt für „ungespeichert“, Schließen-Knopf je Tab */
export function EditorTabs({ confirmClose = (text) => window.confirm(text) }: EditorTabsProps) {
    const tabs = useEditorStore((state) => state.tabs);
    const files = useEditorStore((state) => state.files);
    const items = useMemo(() => buildTabBarItems(tabs, files), [tabs, files]);

    const close = (item: TabBarItem): void => {
        if (item.isDirty && !confirmClose(closeConfirmationText(item.title))) return;
        editorStore.getState().close(item.path);
    };

    return (
        <div className="editor-tabs" role="tablist" aria-label="Geöffnete Dateien">
            {items.map((item) => (
                <EditorTab key={item.path} item={item} onClose={close} />
            ))}
        </div>
    );
}
