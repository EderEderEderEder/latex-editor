// Namenseingabe für „Neue Datei“, „Neuer Ordner“ und „Umbenennen“ (Vorlage `NameSheet.swift`): Prüfung beim Tippen,
// Fehlertext unter dem Feld, Enter führt aus, Escape bricht ab. Scheitert die Aktion im Main, bleibt der Dialog offen.
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { NameQuestion } from '../../app/projectFileActionsPrompts';
import { cancelHandler, useModalDialog } from './useModalDialog';
import './dialogs.css';

export const NAME_DIALOG_TEXTS = { cancel: 'Abbrechen', label: 'Name' } as const;

const TITLE_ID = 'name-dialog-title';
const LOCATION_ID = 'name-dialog-location';
const ERROR_ID = 'name-dialog-error';

export interface NameDialogProps {
    readonly question: NameQuestion;
    readonly onClose: () => void;
}

/** Beim Umbenennen nur den Namen vor der Endung markieren, sonst alles */
function useInitialSelection(question: NameQuestion) {
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        const input = inputRef.current;
        if (input === null) return;
        input.focus();
        const dot = question.initialName.lastIndexOf('.');
        const end = question.selectsBaseName && dot > 0 ? dot : question.initialName.length;
        input.setSelectionRange(0, end);
    }, [question]);
    return inputRef;
}

export function NameDialog({ question, onClose }: NameDialogProps) {
    const dialogRef = useModalDialog();
    const inputRef = useInitialSelection(question);
    const [name, setName] = useState(question.initialName);
    const [serverMessage, setServerMessage] = useState<string | null>(null);
    const [isBusy, setBusy] = useState(false);
    const validation = question.validate(name);
    const message = serverMessage ?? (name === '' ? null : validation);
    const submit = async (event: FormEvent): Promise<void> => {
        event.preventDefault();
        if (validation !== null || isBusy) return;
        setBusy(true);
        const error = await question.submit(name);
        setBusy(false);
        if (error === null) onClose();
        else setServerMessage(error);
    };
    const cancel = (): void => {
        if (!isBusy) onClose();
    };
    return (
        <dialog ref={dialogRef} className="close-confirm file-action-dialog" aria-labelledby={TITLE_ID} aria-describedby={LOCATION_ID} onCancel={cancelHandler(cancel)}>
            <form onSubmit={(event) => void submit(event)}>
                <h2 id={TITLE_ID}>{question.title}</h2>
                <p id={LOCATION_ID} className="file-action-location">{question.location}</p>
                <input
                    ref={inputRef}
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={NAME_DIALOG_TEXTS.label}
                    aria-invalid={message !== null}
                    aria-describedby={ERROR_ID}
                    placeholder={question.placeholder}
                    value={name}
                    onChange={(event) => {
                        setName(event.target.value);
                        setServerMessage(null);
                    }}
                />
                <p id={ERROR_ID} className="file-action-error" role="alert">{message ?? ''}</p>
                <div className="close-confirm-buttons">
                    <button type="button" onClick={cancel} disabled={isBusy}>{NAME_DIALOG_TEXTS.cancel}</button>
                    <button type="submit" className="is-default" disabled={validation !== null || isBusy}>{question.actionTitle}</button>
                </div>
            </form>
        </dialog>
    );
}
