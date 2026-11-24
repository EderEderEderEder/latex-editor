import { useMemo } from 'react';
import type { AbsolutePath } from '../../shared/contract';
import { buildTabBarItems, closeConfirmationText } from '../app/tabBarData';
import { editorStore, useEditorStore } from '../stores/editor';

export interface EditorTabsProps {
    /** Nachfrage beim Schließen eines ungespeicherten Tabs; `true` = schließen */
    readonly confirmClose?: (text: string) => boolean;
}

/** Einfache Tab-Leiste: Vorschau-Tab kursiv, Punkt für „ungespeichert“, Schließen-Knopf je Tab */
export function EditorTabs({ confirmClose = (text) => window.confirm(text) }: EditorTabsProps) {
    const tabs = useEditorStore((state) => state.tabs);
    const files = useEditorStore((state) => state.files);
    const items = useMemo(() => buildTabBarItems(tabs, files), [tabs, files]);

    const close = (path: AbsolutePath, title: string, isDirty: boolean): void => {
        if (isDirty && !confirmClose(closeConfirmationText(title))) return;
        editorStore.getState().close(path);
    };

    return (
        <div className="editor-tabs" role="tablist" aria-label="Geöffnete Dateien">
            {items.map((item) => (
                <div key={item.path} className={item.isActive ? 'editor-tab is-active' : 'editor-tab'}>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={item.isActive}
                        className={item.isPreview ? 'editor-tab-title is-preview' : 'editor-tab-title'}
                        title={item.path}
                        onClick={() => editorStore.getState().activate(item.path)}
                        onDoubleClick={() => editorStore.getState().pin(item.path)}
                    >
                        {item.title}
                    </button>
                    {item.isDirty && <span className="tab-dirty" role="img" aria-label="Ungespeicherte Änderungen" />}
                    <button
                        type="button"
                        className="editor-tab-close"
                        aria-label={`„${item.title}“ schließen`}
                        onClick={() => close(item.path, item.title, item.isDirty)}
                    >
                        ×
                    </button>
                </div>
            ))}
        </div>
    );
}
