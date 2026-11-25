// Rückfrage „Verweise auf … anpassen?“ (Vorlage `showReferenceUpdateAlert`) mit der Liste der Änderungen;
// drei Antworten: anpassen (Enter), nur umbenennen bzw. verschieben, abbrechen (Escape).
import type { ReferenceChoice, ReferenceQuestion } from '../../app/projectFileActionsPrompts';
import { cancelHandler, useModalDialog } from './useModalDialog';
import './dialogs.css';

export const REFERENCE_DIALOG_TEXTS = { update: 'Verweise anpassen', cancel: 'Abbrechen', list: 'Geplante Änderungen' } as const;

const TITLE_ID = 'reference-dialog-title';
const DETAIL_ID = 'reference-dialog-detail';

export interface ReferenceUpdateDialogProps {
    readonly question: ReferenceQuestion;
    readonly onAnswer: (choice: ReferenceChoice) => void;
}

export function ReferenceUpdateDialog({ question, onAnswer }: ReferenceUpdateDialogProps) {
    const dialogRef = useModalDialog();
    return (
        <dialog
            ref={dialogRef}
            className="close-confirm file-action-dialog"
            aria-labelledby={TITLE_ID}
            aria-describedby={DETAIL_ID}
            onCancel={cancelHandler(() => onAnswer('cancel'))}
        >
            <h2 id={TITLE_ID}>{question.title}</h2>
            <p id={DETAIL_ID}>{question.detail}</p>
            <pre className="reference-list" tabIndex={0} aria-label={REFERENCE_DIALOG_TEXTS.list}>{question.lines.join('\n')}</pre>
            <div className="close-confirm-buttons">
                <button type="button" onClick={() => onAnswer('cancel')}>{REFERENCE_DIALOG_TEXTS.cancel}</button>
                <button type="button" onClick={() => onAnswer('skip')}>{question.skipTitle}</button>
                <button type="button" className="is-default" autoFocus onClick={() => onAnswer('update')}>{REFERENCE_DIALOG_TEXTS.update}</button>
            </div>
        </dialog>
    );
}
