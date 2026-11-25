// Öffnet einen `<dialog>` modal beim Einhängen. `showModal` macht den Rest der Seite unbedienbar (Fokusfalle) und
// gibt den Fokus beim Schließen an das vorher fokussierte Element zurück; Escape löst `cancel` aus.
import { useEffect, useRef } from 'react';
import type { RefObject, SyntheticEvent } from 'react';

export function useModalDialog(): RefObject<HTMLDialogElement | null> {
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const dialog = ref.current;
        if (dialog !== null && !dialog.open) dialog.showModal();
    }, []);
    return ref;
}

/** Escape wie „Abbrechen“; der Dialog schließt sich nicht selbst, sondern über den Zustand */
export function cancelHandler(cancel: () => void): (event: SyntheticEvent) => void {
    return (event) => {
        event.preventDefault();
        cancel();
    };
}
