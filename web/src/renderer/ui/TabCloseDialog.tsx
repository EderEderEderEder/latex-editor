// Nachfrage beim Schließen eines Tabs mit Änderungen: modaler `<dialog>` im Stil von `CloseConfirmDialog`,
// gespeist aus `app/tabClosePrompt.ts`.
import { useEffect, useRef } from 'react';
import type { SyntheticEvent } from 'react';
import { useStore } from 'zustand';
import { TAB_CLOSE_TEXTS } from '../app/tabClose';
import { tabClosePrompt } from '../app/tabClosePrompt';
import type { TabCloseQuestion } from '../app/tabClosePrompt';

function TabClosePrompt({ question }: { readonly question: TabCloseQuestion }) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog !== null && !dialog.open) dialog.showModal();
    }, []);
    // Escape löst `cancel` aus: wie „Abbrechen“, der Tab bleibt offen.
    const cancelByEscape = (event: SyntheticEvent): void => {
        event.preventDefault();
        tabClosePrompt.answer('cancel');
    };
    return (
        <dialog ref={dialogRef} className="close-confirm tab-close-confirm" aria-labelledby="tab-close-title" onCancel={cancelByEscape}>
            <h2 id="tab-close-title">{TAB_CLOSE_TEXTS.title}</h2>
            <p>{TAB_CLOSE_TEXTS.question(question.name)}</p>
            <div className="close-confirm-buttons">
                <button type="button" autoFocus onClick={() => tabClosePrompt.answer('save')}>{TAB_CLOSE_TEXTS.save}</button>
                <button type="button" onClick={() => tabClosePrompt.answer('discard')}>{TAB_CLOSE_TEXTS.discard}</button>
                <button type="button" onClick={() => tabClosePrompt.answer('cancel')}>{TAB_CLOSE_TEXTS.cancel}</button>
            </div>
        </dialog>
    );
}

export function TabCloseDialog() {
    const question = useStore(tabClosePrompt.store, (state) => state.question);
    return question === null ? null : <TabClosePrompt question={question} />;
}
