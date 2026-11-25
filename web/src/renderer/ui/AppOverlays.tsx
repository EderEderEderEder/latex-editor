// Die modalen Dialoge „Schnell öffnen“ (Strg+P) und „Gehe zu Zeile“ (Strg+G); welcher offen ist, steht im Overlay-Store.
import { useMemo } from 'react';
import { quickOpenFilesOf } from '../app/quickOpenFiles';
import { gotoLine } from '../app/gotoLine';
import { openProjectFile } from '../app/projectFiles';
import { projectFileDeps } from '../app/projectRuntime';
import { editorStore, useEditorStore } from '../stores/editor';
import { overlayStore, useOverlayStore } from '../stores/overlays';
import { useProjectStore } from '../stores/project';
import { GotoLine } from './GotoLine';
import { QuickOpen } from './QuickOpen';

export interface AppOverlaysProps {
    readonly focusEditor: () => void;
}

function QuickOpenOverlay({ focusEditor }: AppOverlaysProps) {
    const project = useProjectStore((state) => state.current);
    const tabs = useEditorStore((state) => state.tabs.items);
    const list = useMemo(() => quickOpenFilesOf(project, tabs), [project, tabs]);
    const open = (relativePath: string): void => {
        const absolute = list.absolutePaths.get(relativePath);
        overlayStore.getState().close();
        if (absolute === undefined) return;
        void openProjectFile(projectFileDeps(), absolute, false).then(focusEditor);
    };
    return <QuickOpen files={list.files} onOpen={open} onClose={() => overlayStore.getState().close()} />;
}

function GotoLineOverlay({ focusEditor }: AppOverlaysProps) {
    const session = editorStore.getState().activeSession();
    if (session === null) return null;
    const go = (line: number, column?: number): void => {
        overlayStore.getState().close();
        gotoLine(session, line, column);
        focusEditor();
    };
    return <GotoLine lineCount={session.state.doc.lines} onGoto={go} onClose={() => overlayStore.getState().close()} />;
}

export function AppOverlays({ focusEditor }: AppOverlaysProps) {
    const active = useOverlayStore((state) => state.active);
    if (active === 'quickOpen') return <QuickOpenOverlay focusEditor={focusEditor} />;
    if (active === 'gotoLine') return <GotoLineOverlay focusEditor={focusEditor} />;
    return null;
}
