import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useCursorPosition } from '../app/useCursorPosition';
import { useWordCounts } from '../app/useWordCounts';
import { buildStatusBarTexts } from '../app/statusText';
import type { SessionView } from '../editor/session';
import { statusStore, useStatusStore } from '../stores/status';
import { useEditorStore } from '../stores/editor';

const INFO_MESSAGE_MS = 6000;

/**
 * Wortzahlen am rechten Rand hinter der Meldung. Ziffern gleich breit, rechtsbündig, Breite unabhängig vom Inhalt
 * (kein Verschieben bei anderer Zahl). Die Meldung behält immer ihre Mindestbreite: Wird es eng, gibt zuerst die
 * Wortzone nach (Auslassung), nie die Meldung (im halben Fenster reicht der Platz sonst nicht für alle Zonen).
 */
const NUMBER_ZONE_STYLE: CSSProperties = {
    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
};
const WORDS_ZONE_STYLE: CSSProperties = { ...NUMBER_ZONE_STYLE, flex: '0 1 6.5em' };
const SELECTION_ZONE_STYLE: CSSProperties = { ...NUMBER_ZONE_STYLE, flex: '0 1 11em' };
const MESSAGE_STYLE: CSSProperties = { flex: '0 1 auto', minWidth: '8em' };
const BAR_STYLE: CSSProperties = { overflow: 'hidden' };
const SELECTION_WORDS_HELP = 'Wörter der Auswahl';
const FILE_WORDS_HELP = 'Wörter dieser Datei. Näherung: Fließtext ohne Befehle, Formeln, Kommentare und Code.';

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
    const { fileWords, selectionWords } = useWordCounts(sessionView);
    useMessageTimeout();
    const texts = buildStatusBarTexts({
        name: info?.title ?? null,
        encoding: info?.encoding ?? 'utf8',
        eol: info?.eol ?? 'lf',
        position: info === undefined ? null : position,
        fileWords,
        selectionWords,
    });
    return (
        <footer className="status-bar" aria-label="Statusleiste" style={BAR_STYLE}>
            <span className="status-position">{texts.position}</span>
            <span className="status-file">{texts.fileName}</span>
            <span className="status-format">{texts.format}</span>
            <span
                className={message?.kind === 'error' ? 'status-message is-error' : 'status-message'}
                role={message?.kind === 'error' ? 'alert' : 'status'}
                style={MESSAGE_STYLE}
            >
                {message?.text ?? ''}
            </span>
            {texts.selectionWords === '' ? null : (
                <span className="status-selection-words" style={SELECTION_ZONE_STYLE} title={SELECTION_WORDS_HELP}>
                    {texts.selectionWords}
                </span>
            )}
            <span className="status-words" style={WORDS_ZONE_STYLE} title={FILE_WORDS_HELP}>
                {texts.words}
            </span>
        </footer>
    );
}
