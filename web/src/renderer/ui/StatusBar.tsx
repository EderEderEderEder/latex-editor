import { useEffect } from 'react';
import { useCursorPosition } from '../app/useCursorPosition';
import { buildStatusBarTexts } from '../app/statusText';
import type { SessionView } from '../editor/session';
import { statusStore, useStatusStore } from '../stores/status';
import { useEditorStore } from '../stores/editor';

const INFO_MESSAGE_MS = 6000;

/** Meldungen vom Typ „Info“ verschwinden nach einer Weile, Fehler bleiben bis zur nächsten Meldung */
function useMessageTimeout(): void {
    const message = useStatusStore((state) => state.message);
    useEffect(() => {
        if (message === null || message.kind === 'error') return;
        const timer = setTimeout(() => statusStore.getState().clear(), INFO_MESSAGE_MS);
        return () => clearTimeout(timer);
    }, [message]);
}

export function StatusBar({ sessionView }: { readonly sessionView: SessionView | null }) {
    const position = useCursorPosition(sessionView);
    const info = useEditorStore((state) => (state.tabs.active === null ? undefined : state.files[state.tabs.active]));
    const message = useStatusStore((state) => state.message);
    useMessageTimeout();
    const texts = buildStatusBarTexts({
        name: info?.title ?? null,
        encoding: info?.encoding ?? 'utf8',
        eol: info?.eol ?? 'lf',
        position: info === undefined ? null : position,
    });
    return (
        <footer className="status-bar" aria-label="Statusleiste">
            <span className="status-position">{texts.position}</span>
            <span className="status-file">{texts.fileName}</span>
            <span className="status-format">{texts.format}</span>
            <span
                className={message?.kind === 'error' ? 'status-message is-error' : 'status-message'}
                role={message?.kind === 'error' ? 'alert' : 'status'}
            >
                {message?.text ?? ''}
            </span>
        </footer>
    );
}
