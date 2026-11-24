// Nachfrage beim Schließen des Fensters mit ungespeicherten Änderungen (K1): eigener modaler `<dialog>` statt
// `window.confirm`, weil es drei Antworten gibt. Die Abläufe stehen in `app/closeFlow.ts`.
import { useEffect, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { CLOSE_TEXTS, createCloseHandler } from '../app/closeFlow';
import type { CloseChoice } from '../app/closeFlow';
import { getApi } from '../ipc/api';
import { onMainEvent } from '../ipc/events';
import { editorStore } from '../stores/editor';
import { statusStore } from '../stores/status';

interface PendingQuestion {
    readonly names: readonly string[];
    readonly answer: (choice: CloseChoice) => void;
}

function useCloseRequests(): PendingQuestion | null {
    const [question, setQuestion] = useState<PendingQuestion | null>(null);
    useEffect(() => {
        const ask = (names: readonly string[]): Promise<CloseChoice> =>
            new Promise((resolve) => {
                setQuestion({
                    names,
                    answer: (choice) => {
                        setQuestion(null);
                        resolve(choice);
                    },
                });
            });
        const report = statusStore.getState().show;
        const handleClose = createCloseHandler({ api: getApi(), store: editorStore, report, ask });
        return onMainEvent('app:closeRequested', () => void handleClose());
    }, []);
    return question;
}

function UnsavedChangesPrompt({ question }: { readonly question: PendingQuestion }) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog !== null && !dialog.open) dialog.showModal();
    }, []);
    // Escape löst `cancel` aus: wie „Abbrechen“, das Fenster bleibt offen.
    const cancelByEscape = (event: SyntheticEvent): void => {
        event.preventDefault();
        question.answer('cancel');
    };
    return (
        <dialog ref={dialogRef} className="close-confirm" aria-labelledby="close-confirm-title" onCancel={cancelByEscape}>
            <h2 id="close-confirm-title">{CLOSE_TEXTS.title}</h2>
            <p>{CLOSE_TEXTS.changed(question.names)}</p>
            <div className="close-confirm-buttons">
                <button type="button" autoFocus onClick={() => question.answer('save')}>{CLOSE_TEXTS.save}</button>
                <button type="button" onClick={() => question.answer('discard')}>{CLOSE_TEXTS.discard}</button>
                <button type="button" onClick={() => question.answer('cancel')}>{CLOSE_TEXTS.cancel}</button>
            </div>
        </dialog>
    );
}

export function CloseConfirmDialog() {
    const question = useCloseRequests();
    return question === null ? null : <UnsavedChangesPrompt question={question} />;
}
