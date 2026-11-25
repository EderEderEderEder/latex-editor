// Nachfrage „Ungespeicherte Änderungen wiederherstellen?“ (W2-14): modaler `<dialog>` im Stil von `CloseConfirmDialog`,
// gespeist aus `app/recoveryPrompt.ts`. Die Abläufe stehen in `app/recoveryOffer.ts`.
import { useEffect, useRef } from 'react';
import type { SyntheticEvent } from 'react';
import { useStore } from 'zustand';
import type { RecoveryItem } from '../../shared/contract';
import { RECOVERY_OFFER_TEXTS } from '../app/recoveryOffer';
import { recoveryPrompt } from '../app/recoveryPrompt';
import type { RecoveryQuestion } from '../app/recoveryPrompt';
import './recoveryDialog.css';

function itemNote(item: RecoveryItem): string | null {
    if (item.diskState === 'changed') return RECOVERY_OFFER_TEXTS.changed;
    return item.diskState === 'missing' ? RECOVERY_OFFER_TEXTS.missing : null;
}

function RecoveryListItem({ item }: { readonly item: RecoveryItem }) {
    const note = itemNote(item);
    return (
        <li>
            {RECOVERY_OFFER_TEXTS.entry(item.name, item.savedAt)}
            {note === null ? null : <span className="recovery-note">{note}</span>}
        </li>
    );
}

function RecoveryPrompt({ question }: { readonly question: RecoveryQuestion }) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog !== null && !dialog.open) dialog.showModal();
    }, []);
    // Escape entscheidet nichts: die Sicherungen bleiben und werden später wieder angeboten.
    const decideLater = (event: SyntheticEvent): void => {
        event.preventDefault();
        recoveryPrompt.answer('later');
    };
    return (
        <dialog ref={dialogRef} className="close-confirm recovery-confirm" aria-labelledby="recovery-title" onCancel={decideLater}>
            <h2 id="recovery-title">{RECOVERY_OFFER_TEXTS.title}</h2>
            <p>{RECOVERY_OFFER_TEXTS.intro}</p>
            <ul className="recovery-list">
                {question.items.map((item) => <RecoveryListItem key={item.path} item={item} />)}
            </ul>
            <p>{RECOVERY_OFFER_TEXTS.hint}</p>
            <div className="close-confirm-buttons">
                <button type="button" autoFocus onClick={() => recoveryPrompt.answer('restore')}>{RECOVERY_OFFER_TEXTS.restore}</button>
                <button type="button" onClick={() => recoveryPrompt.answer('discard')}>{RECOVERY_OFFER_TEXTS.discard}</button>
            </div>
        </dialog>
    );
}

export function RecoveryDialog() {
    const question = useStore(recoveryPrompt.store, (state) => state.question);
    return question === null ? null : <RecoveryPrompt question={question} />;
}
