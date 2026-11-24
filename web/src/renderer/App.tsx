import { useEffect, useState } from 'react';
import { loadSettingsOnce } from './app/startup';
import { getApi } from './ipc/api';
import { useSettingsStore } from './stores/settings';
import { statusStore } from './stores/status';
import { EditorPane } from './ui/EditorPane';

const PING_PENDING = '…';

export function App() {
    const [pingText, setPingText] = useState(PING_PENDING);

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

    return (
        <main>
            {/* Die Verbindungsprüfung bleibt für den Stub-Smoke-Test (`main p`), ohne Platz in der Oberfläche. */}
            <p hidden>{pingText}</p>
            <EditorPane heading={<h1>LatexEditor</h1>} />
        </main>
    );
}
