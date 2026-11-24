// Meldet Cursor- und Textänderungen des einen sichtbaren Views (für die Statusleiste). Kein Zustand, kein Text:
// die Hörer lesen bei Bedarf selbst aus `view.state`.
import type { Transaction } from '@codemirror/state';

type CursorListener = () => void;

const listeners = new Set<CursorListener>();

export function onCursorActivity(listener: CursorListener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Für `dispatchTransactions` des Views: meldet nur, wenn Auswahl oder Text betroffen sind */
export function notifyCursorActivity(transactions: readonly Transaction[]): void {
    if (!transactions.some((tr) => tr.selection !== undefined || tr.docChanged)) return;
    for (const listener of listeners) listener();
}
