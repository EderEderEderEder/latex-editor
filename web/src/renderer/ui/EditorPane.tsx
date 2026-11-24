// Editor-Rahmen (W1-12b): Kopfzeile, Tab-Leiste, Editor und Statusleiste. Der Text lebt nur in den Sitzungen;
// hier stehen Aktionen und Tastenkürzel, die den Editor-Store und den IPC-Vertrag benutzen.
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { saveActiveFile, saveActiveFileAs, openFilesFromDialog } from '../app/fileActions';
import type { FileActionDeps } from '../app/fileActions';
import { matchShortcut } from '../app/shortcuts';
import type { ShortcutAction } from '../app/shortcuts';
import { changeEditorZoom } from '../app/zoom';
import { EditorHost } from '../editor/EditorHost';
import type { SessionView } from '../editor/session';
import { getApi } from '../ipc/api';
import { editorStore, useEditorStore } from '../stores/editor';
import { useSettingsStore } from '../stores/settings';
import { statusStore } from '../stores/status';
import { EditorTabs } from './EditorTabs';
import { EditorToolbar } from './EditorToolbar';
import { StatusBar } from './StatusBar';
import './editorPane.css';

function fileActionDeps(): FileActionDeps {
    return { api: getApi(), store: editorStore, report: (message) => statusStore.getState().show(message) };
}

function runShortcut(action: ShortcutAction): void {
    const deps = fileActionDeps();
    switch (action.kind) {
        case 'open':
            void openFilesFromDialog(deps);
            return;
        case 'save':
            void saveActiveFile(deps);
            return;
        case 'saveAs':
            void saveActiveFileAs(deps);
            return;
        case 'zoom':
            void changeEditorZoom(useSettingsStore, action.direction, (text) => statusStore.getState().show({ text, kind: 'error' }));
    }
}

function useWindowShortcuts(): void {
    useEffect(() => {
        const handle = (event: KeyboardEvent): void => {
            const action = matchShortcut(event);
            if (action === null) return;
            event.preventDefault();
            runShortcut(action);
        };
        window.addEventListener('keydown', handle);
        return () => window.removeEventListener('keydown', handle);
    }, []);
}

export function EditorPane({ heading }: { readonly heading: ReactNode }) {
    const [sessionView, setSessionView] = useState<SessionView | null>(null);
    const hasActiveTab = useEditorStore((state) => state.tabs.active !== null);
    const actions = useMemo(
        () => ({
            open: () => runShortcut({ kind: 'open' }),
            save: () => runShortcut({ kind: 'save' }),
            saveAs: () => runShortcut({ kind: 'saveAs' }),
        }),
        [],
    );
    useWindowShortcuts();
    return (
        <section className="editor-pane" aria-label="Editor">
            <EditorToolbar
                heading={heading}
                canSave={hasActiveTab}
                onOpen={actions.open}
                onSave={actions.save}
                onSaveAs={actions.saveAs}
            />
            <EditorTabs />
            <EditorHost onSessionView={setSessionView} />
            <StatusBar sessionView={sessionView} />
        </section>
    );
}
