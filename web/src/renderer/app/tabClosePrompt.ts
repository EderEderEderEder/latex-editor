// Die offene Nachfrage „Tab mit Änderungen schließen“ als kleiner Store: `ask` stellt die Frage und wartet, die
// Oberfläche (`ui/TabCloseDialog.tsx`) zeigt sie und antwortet mit `answer`. Eine zweite Frage während einer offenen
// wird wie „Abbrechen“ beantwortet.
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import type { TabCloseChoice } from './tabClose';

export interface TabCloseQuestion {
    readonly name: string;
}

export interface TabClosePromptState {
    readonly question: TabCloseQuestion | null;
}

export interface TabClosePrompt {
    readonly store: StoreApi<TabClosePromptState>;
    ask(name: string): Promise<TabCloseChoice>;
    answer(choice: TabCloseChoice): void;
}

export function createTabClosePrompt(): TabClosePrompt {
    const store = createStore<TabClosePromptState>()(() => ({ question: null }));
    let resolver: ((choice: TabCloseChoice) => void) | null = null;
    return {
        store,
        ask: (name) => {
            if (resolver !== null) return Promise.resolve('cancel');
            return new Promise((resolve) => {
                resolver = resolve;
                store.setState({ question: { name } });
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

export const tabClosePrompt = createTabClosePrompt();
