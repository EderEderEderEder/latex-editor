import { useEffect, useState } from 'react';
import { EditorHost } from './editor/EditorHost';
import { getApi } from './ipc/api';

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

    return (
        <main>
            <h1>LatexEditor</h1>
            <p>{pingText}</p>
            {/* Vorläufig (W1-6): nur für den Sitzungstausch-Test; die Editor-Oberfläche baut W1-12. */}
            <EditorHost />
        </main>
    );
}
