// „Gehe zu Zeile“ (Strg+G): kleiner modaler `<dialog>` im Stil von `CloseConfirmDialog`.
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, SyntheticEvent } from 'react';
import { parseLineInput } from '../app/lineInput';
import './quickOpen.css';

export interface GotoLineProps {
    /** Zeilenzahl des aktiven Dokuments (obere Grenze) */
    readonly lineCount: number;
    readonly onGoto: (line: number, column?: number) => void;
    readonly onClose: () => void;
}

const TEXTS = {
    title: 'Gehe zu Zeile',
    label: 'Zeilennummer',
    count: (lineCount: number): string => `von ${lineCount}`,
    go: 'Springen',
    cancel: 'Abbrechen',
} as const;

export function GotoLine({ lineCount, onGoto, onClose }: GotoLineProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [text, setText] = useState('');
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog !== null && !dialog.open) dialog.showModal();
    }, []);
    const submit = (event: FormEvent): void => {
        event.preventDefault();
        const result = parseLineInput(text, lineCount);
        if (!result.ok) {
            setError(result.error);
            return;
        }
        onGoto(result.line, result.column);
    };
    const cancel = (event: SyntheticEvent): void => {
        event.preventDefault();
        onClose();
    };
    return (
        <dialog ref={dialogRef} className="close-confirm goto-line" aria-labelledby="goto-line-title" onCancel={cancel}>
            <form onSubmit={submit}>
                <h2 id="goto-line-title">{TEXTS.title}</h2>
                <div className="goto-line-row">
                    <input
                        type="text"
                        inputMode="numeric"
                        autoFocus
                        autoComplete="off"
                        aria-label={TEXTS.label}
                        aria-invalid={error !== null}
                        aria-describedby="goto-line-error"
                        value={text}
                        placeholder={TEXTS.label}
                        onChange={(event) => {
                            setText(event.target.value);
                            setError(null);
                        }}
                    />
                    <span className="goto-line-count">{TEXTS.count(lineCount)}</span>
                </div>
                <p id="goto-line-error" className="goto-line-error" role="alert">{error ?? ''}</p>
                <div className="close-confirm-buttons">
                    <button type="button" onClick={onClose}>{TEXTS.cancel}</button>
                    <button type="submit">{TEXTS.go}</button>
                </div>
            </form>
        </dialog>
    );
}
