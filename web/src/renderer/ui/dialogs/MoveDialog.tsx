// „Verschieben nach …“: Zielordner aus den Ordnern des Projekts wählen (Ziehen im Baum geht ohne diesen Dialog).
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { AbsolutePath } from '../../../shared/contract';
import type { MoveQuestion } from '../../app/projectFileActionsPrompts';
import { cancelHandler, useModalDialog } from './useModalDialog';
import './dialogs.css';

export const MOVE_DIALOG_TEXTS = {
    title: (name: string) => `„${name}“ verschieben`,
    target: 'Zielordner',
    move: 'Verschieben',
    cancel: 'Abbrechen',
} as const;

const TITLE_ID = 'move-dialog-title';
const SELECT_ID = 'move-dialog-target';

export interface MoveDialogProps {
    readonly question: MoveQuestion;
    readonly onAnswer: (target: AbsolutePath | null) => void;
}

export function MoveDialog({ question, onAnswer }: MoveDialogProps) {
    const dialogRef = useModalDialog();
    const [target, setTarget] = useState(question.initialPath);
    const isUnchanged = target === question.initialPath;
    const submit = (event: FormEvent): void => {
        event.preventDefault();
        if (!isUnchanged) onAnswer(target);
    };
    return (
        <dialog ref={dialogRef} className="close-confirm file-action-dialog" aria-labelledby={TITLE_ID} onCancel={cancelHandler(() => onAnswer(null))}>
            <form onSubmit={submit}>
                <h2 id={TITLE_ID}>{MOVE_DIALOG_TEXTS.title(question.itemName)}</h2>
                <label htmlFor={SELECT_ID}>{MOVE_DIALOG_TEXTS.target}</label>
                <select id={SELECT_ID} autoFocus value={target} onChange={(event) => setTarget(event.target.value)}>
                    {question.targets.map((option) => (
                        <option key={option.path} value={option.path}>{option.label}</option>
                    ))}
                </select>
                <div className="close-confirm-buttons">
                    <button type="button" onClick={() => onAnswer(null)}>{MOVE_DIALOG_TEXTS.cancel}</button>
                    <button type="submit" className="is-default" disabled={isUnchanged}>{MOVE_DIALOG_TEXTS.move}</button>
                </div>
            </form>
        </dialog>
    );
}
