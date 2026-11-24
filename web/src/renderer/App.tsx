import { useCallback, useEffect, useRef, useState } from 'react';
import { loadSettingsOnce } from './app/startup';
import { useOutlineSync } from './app/outlineSync';
import { useProjectSync } from './app/useProjectSync';
import type { SessionView } from './editor/session';
import { getApi } from './ipc/api';
import { useSettingsStore } from './stores/settings';
import { statusStore } from './stores/status';
import { EditorPane } from './ui/EditorPane';
import { Sidebar } from './ui/Sidebar';
import { SidebarShell } from './ui/SidebarShell';

const PING_PENDING = '…';

export function App() {
    const [pingText, setPingText] = useState(PING_PENDING);
    const [sessionView, setSessionView] = useState<SessionView | null>(null);
    const sessionViewRef = useRef<SessionView | null>(null);
    const handleSessionView = useCallback((next: SessionView | null): void => {
        sessionViewRef.current = next;
        setSessionView(next);
    }, []);
    const focusEditor = useCallback((): void => sessionViewRef.current?.view.focus(), []);

    useEffect(() => {
        let active = true;
        void getApi()
            .app.ping()
            .then((result) => {
                if (active) setPingText(result.ok ? result.value : result.error.message);
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        void loadSettingsOnce(useSettingsStore, (message) => statusStore.getState().show(message));
    }, []);

    useProjectSync();
    useOutlineSync(sessionView);

    return (
        <main>
            {/* Die Verbindungsprüfung bleibt für den Stub-Smoke-Test (`main p`), ohne Platz in der Oberfläche. */}
            <p hidden>{pingText}</p>
            <SidebarShell>
                <Sidebar onFocusEditor={focusEditor} />
            </SidebarShell>
            <EditorPane heading={<h1>LatexEditor</h1>} onSessionView={handleSessionView} />
        </main>
    );
}
