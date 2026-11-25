// Bestätigung „In den Papierkorb legen?“ (Vorlage `showTrashAlert`): Der Eintrag geht in den Papierkorb (der Main
// sichert vorher eine Kopie) und lässt sich mit „Datei-Aktion rückgängig“ zurückholen. Enter bestätigt, Escape bricht ab.
import type { TrashQuestion } from '../../app/projectFileActionsPrompts';
import { cancelHandler, useModalDialog } from './useModalDialog';
import './dialogs.css';

export const CONFIRM_DELETE_TEXTS = { confirm: 'In den Papierkorb', cancel: 'Abbrechen' } as const;

const TITLE_ID = 'confirm-delete-title';
const DETAIL_ID = 'confirm-delete-detail';
const WARNING_PREFIXES = ['Achtung', 'Ungespeicherte'];

export interface ConfirmDeleteDialogProps {
    readonly question: TrashQuestion;
    readonly onAnswer: (confirmed: boolean) => void;
}

export function ConfirmDeleteDialog({ question, onAnswer }: ConfirmDeleteDialogProps) {
    const dialogRef = useModalDialog();
    return (
        <dialog
            ref={dialogRef}
            className="close-confirm file-action-dialog"
            role="alertdialog"
            aria-labelledby={TITLE_ID}
            aria-describedby={DETAIL_ID}
            onCancel={cancelHandler(() => onAnswer(false))}
        >
            <h2 id={TITLE_ID}>{question.title}</h2>
            <div id={DETAIL_ID} className="file-action-detail">
                {question.detail.map((line) => (
                    <p key={line} className={WARNING_PREFIXES.some((prefix) => line.startsWith(prefix)) ? 'file-action-warning' : undefined}>
                        {line}
                    </p>
                ))}
            </div>
            <div className="close-confirm-buttons">
                <button type="button" onClick={() => onAnswer(false)}>{CONFIRM_DELETE_TEXTS.cancel}</button>
                <button type="button" className="is-default" autoFocus onClick={() => onAnswer(true)}>{CONFIRM_DELETE_TEXTS.confirm}</button>
            </div>
        </dialog>
    );
}
