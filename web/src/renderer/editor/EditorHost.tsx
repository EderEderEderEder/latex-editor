// Editor-Rahmen (W1-6, W1-12b): genau ein `EditorView`, der die aktive Sitzung des Editor-Stores zeigt und
// Sitzungen per `setState` tauscht. Tabs, Kopfzeile und Statusleiste stehen in `ui/EditorPane.tsx`; hier wird
// außerdem die Darstellung (Einstellungen, Farbschema) mit dem View verbunden.
import { useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import type { LineEnding } from '../../shared/contract';
import { editorStore } from '../stores/editor';
import type { EditorStore } from '../stores/editor';
import { useSettingsStore } from '../stores/settings';
import { DARK_SCHEME_QUERY, connectAppearance } from './appearanceController';
import { domAppearanceHost } from './domAppearanceHost';
import { notifyCursorActivity } from './cursorEvents';
import { setGutterMarks } from './gutter';
import type { GutterMark } from './gutter';
import { SessionView, emptyEditorState, fileNameOfPath } from './session';
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
    setGutterMarks(marks: readonly GutterMark[]): void;
}

const TEST_API_ENABLED = '1';
const TEST_HASH = '';
const TEST_MTIME = 0;
const HOST_STYLE = '.editor-host .cm-editor { height: 100%; }';

function createTestApi(store: EditorStore, sessionView: SessionView): EditorTestApi {
    const state = () => store.getState();
    return {
        open: (path, text, eol = 'lf', asPreview = false) => {
            const name = fileNameOfPath(path);
            state().open({ path, name, text, encoding: 'utf8', eol, hash: TEST_HASH, mtime: TEST_MTIME }, { asPreview });
        },
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
        setGutterMarks: (marks) => sessionView.view.dispatch({ effects: setGutterMarks(marks) }),
    };
}

function installTestApi(store: EditorStore, sessionView: SessionView): () => void {
    if (import.meta.env.RENDERER_VITE_EDITOR_TEST_API !== TEST_API_ENABLED) return () => undefined;
    window.__editorTestApi = createTestApi(store, sessionView);
    return () => {
        delete window.__editorTestApi;
    };
}

export interface EditorHostProps {
    readonly store?: EditorStore;
    /** Meldet den `SessionView` nach dem Aufbau (für die Statusleiste) und `null` beim Abbau */
    readonly onSessionView?: (sessionView: SessionView | null) => void;
}

function createSessionView(parent: HTMLElement): SessionView {
    const view = new EditorView({
        parent,
        state: emptyEditorState(),
        dispatchTransactions: (transactions, target) => {
            target.update(transactions);
            notifyCursorActivity(transactions);
        },
    });
    return new SessionView(view);
}

/** Einstellungen und Systemfarbschema folgen; ein Wechsel zieht nur die sichtbare Sitzung nach */
function connectEditorAppearance(sessionView: SessionView): () => void {
    const host = domAppearanceHost(document, () => {
        sessionView.session?.syncAppearance();
        sessionView.view.requestMeasure();
    });
    return connectAppearance({
        host,
        settings: useSettingsStore,
        media: window.matchMedia(DARK_SCHEME_QUERY),
    });
}

export function EditorHost({ store = editorStore, onSessionView }: EditorHostProps) {
    const parentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const parent = parentRef.current;
        if (parent === null) return;
        const sessionView = createSessionView(parent);
        const disconnectAppearance = connectEditorAppearance(sessionView);
        onSessionView?.(sessionView);
        const showActive = (): void => sessionView.show(store.getState().activeSession());
        showActive();
        // Abonnement statt React-Effekt: der View wechselt synchron, bevor der Store die alte Sitzung freigibt.
        const unsubscribe = store.subscribe(showActive);
        const removeTestApi = installTestApi(store, sessionView);
        return () => {
            onSessionView?.(null);
            removeTestApi();
            unsubscribe();
            disconnectAppearance();
            sessionView.show(null);
            sessionView.view.destroy();
        };
    }, [store, onSessionView]);

    return (
        <>
            <style>{HOST_STYLE}</style>
            <div className="editor-host" ref={parentRef} />
        </>
    );
}
