// Minimaler Editor-Rahmen (W1-6): genau ein `EditorView`, der die aktive Sitzung des Editor-Stores zeigt und
// Sitzungen per `setState` tauscht. Die volle Oberfläche (Tabs, Speichern, Statusleiste) kommt mit W1-12.
import { useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import type { LineEnding } from '../../shared/contract';
import { editorStore } from '../stores/editor';
import type { EditorStore } from '../stores/editor';
import { SessionView, emptyEditorState } from './session';
import type { SelectionSnapshot } from './session';

declare global {
    interface ImportMetaEnv {
        /** Build-Konstante nur für E2E-Builds; im Paket nie gesetzt, der Testzugang fehlt dort ganz */
        readonly RENDERER_VITE_EDITOR_TEST_API?: string;
    }
    interface ImportMeta {
        readonly env: ImportMetaEnv;
    }
    interface Window {
        __editorTestApi?: EditorTestApi;
    }
}

/** Testzugang für Playwright (`tests/e2e/session.spec.ts`) */
export interface EditorTestApi {
    open(path: string, text: string, eol?: LineEnding, asPreview?: boolean): void;
    activate(path: string): void;
    close(path: string): void;
    activePath(): string | null;
    text(): string;
    selection(): SelectionSnapshot;
    select(anchor: number, head: number): void;
    isDirty(path: string): boolean;
}

const TEST_API_ENABLED = '1';
const TEST_HASH = '';
const TEST_MTIME = 0;
const HOST_STYLE = '.editor-host { height: 70vh; } .editor-host .cm-editor { height: 100%; }';

function createTestApi(store: EditorStore, sessionView: SessionView): EditorTestApi {
    const state = () => store.getState();
    return {
        open: (path, text, eol = 'lf', asPreview = false) =>
            state().open({ path, text, encoding: 'utf8', eol, hash: TEST_HASH, mtime: TEST_MTIME }, { asPreview }),
        activate: (path) => state().activate(path),
        close: (path) => state().close(path),
        activePath: () => state().tabs.active,
        text: () => sessionView.view.state.doc.toString(),
        selection: () => {
            const { anchor, head } = sessionView.view.state.selection.main;
            return { anchor, head };
        },
        select: (anchor, head) => {
            sessionView.session?.select({ anchor, head });
            sessionView.view.focus();
        },
        isDirty: (path) => state().files[path]?.isDirty ?? false,
    };
}

function installTestApi(store: EditorStore, sessionView: SessionView): () => void {
    if (import.meta.env.RENDERER_VITE_EDITOR_TEST_API !== TEST_API_ENABLED) return () => undefined;
    window.__editorTestApi = createTestApi(store, sessionView);
    return () => {
        delete window.__editorTestApi;
    };
}

export function EditorHost({ store = editorStore }: { readonly store?: EditorStore }) {
    const parentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const parent = parentRef.current;
        if (parent === null) return;
        const sessionView = new SessionView(new EditorView({ parent, state: emptyEditorState() }));
        const showActive = (): void => sessionView.show(store.getState().activeSession());
        showActive();
        // Abonnement statt React-Effekt: der View wechselt synchron, bevor der Store die alte Sitzung freigibt.
        const unsubscribe = store.subscribe(showActive);
        const removeTestApi = installTestApi(store, sessionView);
        return () => {
            removeTestApi();
            unsubscribe();
            sessionView.show(null);
            sessionView.view.destroy();
        };
    }, [store]);

    return (
        <>
            <style>{HOST_STYLE}</style>
            <div className="editor-host" ref={parentRef} />
        </>
    );
}
