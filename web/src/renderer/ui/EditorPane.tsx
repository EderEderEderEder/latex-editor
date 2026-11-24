// Editor-Rahmen (W1-12b): Kopfzeile, Tab-Leiste, Editor und Statusleiste. Der Text lebt nur in den Sitzungen;
// hier stehen Aktionen und Tastenkürzel, die den Editor-Store und den IPC-Vertrag benutzen.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { saveActiveFile, saveActiveFileAs, openFilesFromDialog } from '../app/fileActions';
import type { FileActionDeps } from '../app/fileActions';
import { matchShortcut } from '../app/shortcuts';
import type { ShortcutAction } from '../app/shortcuts';
import { scrollMemory } from '../app/scrollMemory';
import { connectScrollMemory } from '../app/scrollTracking';
import { installTabMemoryTestApi } from '../app/tabMemoryRuntime';
import { changeEditorZoom } from '../app/zoom';
import { EditorHost } from '../editor/EditorHost';
import type { SessionView } from '../editor/session';
import { getApi } from '../ipc/api';
import { editorStore, useEditorStore } from '../stores/editor';
import { useSettingsStore } from '../stores/settings';
import { statusStore } from '../stores/status';
import { CloseConfirmDialog } from './CloseConfirmDialog';
import { EditorToolbar } from './EditorToolbar';
import { PathBar } from './PathBar';
import { StatusBar } from './StatusBar';
import { TabBar } from './TabBar';
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
        case 'nextTab':
            editorStore.getState().activateNext();
            return;
        case 'previousTab':
            editorStore.getState().activatePrevious();
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

/** Merkt die Scrollposition des gezeigten Tabs für das Tab-Gedächtnis und stellt eine wiederhergestellte ein */
function useScrollMemory(sessionView: SessionView | null): void {
    useEffect(() => {
        if (sessionView === null) return undefined;
        return connectScrollMemory({ sessionView, store: editorStore, memory: scrollMemory });
    }, [sessionView]);
}

export interface EditorPaneProps {
    readonly heading: ReactNode;
    /** Meldet den `SessionView` nach außen (Seitenleiste: Gliederung folgt dem Cursor); muss stabil sein */
    readonly onSessionView?: (sessionView: SessionView | null) => void;
}

export function EditorPane({ heading, onSessionView }: EditorPaneProps) {
    const [sessionView, setSessionView] = useState<SessionView | null>(null);
    const handleSessionView = useCallback(
        (next: SessionView | null): void => {
            setSessionView(next);
            onSessionView?.(next);
        },
        [onSessionView],
    );
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
    useScrollMemory(sessionView);
    useEffect(installTabMemoryTestApi, []);
    return (
        <section className="editor-pane" aria-label="Editor">
            <EditorToolbar
                heading={heading}
                canSave={hasActiveTab}
                onOpen={actions.open}
                onSave={actions.save}
                onSaveAs={actions.saveAs}
            />
            <TabBar />
            <PathBar />
            <EditorHost onSessionView={handleSessionView} />
            <StatusBar sessionView={sessionView} />
            <CloseConfirmDialog />
        </section>
    );
}
