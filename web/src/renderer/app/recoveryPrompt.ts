// Die offene Nachfrage „Ungespeicherte Änderungen wiederherstellen?“ als kleiner Store (wie `tabClosePrompt`): `ask`
// stellt die Frage und wartet, `ui/RecoveryDialog.tsx` zeigt sie und antwortet mit `answer`. Eine zweite Frage während
// einer offenen wird wie „Später“ beantwortet.
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import type { RecoveryItem } from '../../shared/contract';

/** later: nichts entschieden (Escape), die Sicherungen bleiben und werden beim nächsten Öffnen eines Projekts wieder angeboten */
export type RecoveryChoice = 'restore' | 'discard' | 'later';

export interface RecoveryQuestion {
    readonly items: readonly RecoveryItem[];
}

export interface RecoveryPromptState {
    readonly question: RecoveryQuestion | null;
}

export interface RecoveryPrompt {
    readonly store: StoreApi<RecoveryPromptState>;
    ask(items: readonly RecoveryItem[]): Promise<RecoveryChoice>;
    answer(choice: RecoveryChoice): void;
}

export function createRecoveryPrompt(): RecoveryPrompt {
    const store = createStore<RecoveryPromptState>()(() => ({ question: null }));
    let resolver: ((choice: RecoveryChoice) => void) | null = null;
    return {
        store,
        ask: (items) => {
            if (resolver !== null) return Promise.resolve('later');
            return new Promise((resolve) => {
                resolver = resolve;
                store.setState({ question: { items } });
            });
        },
        answer: (choice) => {
            const resolve = resolver;
            resolver = null;
            store.setState({ question: null });
            resolve?.(choice);
        },
    };
}

export const recoveryPrompt = createRecoveryPrompt();
