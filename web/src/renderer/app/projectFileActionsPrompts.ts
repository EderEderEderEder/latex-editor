// Offene Nachfragen der Datei-Aktionen (W2-9) als kleiner Store, wie `tabClosePrompt`: Die Abläufe in
// `projectFileActions.ts` fragen und warten, die Dialoge in `ui/dialogs/` zeigen die Frage und antworten.
// Je Platz (Namenseingabe, Bestätigung) höchstens eine Frage; eine zweite wird wie „Abbrechen“ beantwortet.
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import type { AbsolutePath } from '../../shared/contract';

export type NamePromptKind = 'newFile' | 'newFolder' | 'rename';

/** Namenseingabe: `validate` prüft beim Tippen, `submit` führt aus und liefert eine Fehlermeldung (Dialog bleibt offen) */
export interface NameQuestion {
    readonly kind: NamePromptKind;
    readonly title: string;
    readonly actionTitle: string;
    readonly placeholder: string;
    /** „in Projektordner“, „in chapters“ */
    readonly location: string;
    readonly initialName: string;
    /** Beim Umbenennen nur den Namen vor der Endung markieren */
    readonly selectsBaseName: boolean;
    validate(name: string): string | null;
    submit(name: string): Promise<string | null>;
}

export interface TrashQuestion {
    readonly title: string;
    readonly detail: readonly string[];
}

export type ReferenceChoice = 'update' | 'skip' | 'cancel';

export interface ReferenceQuestion {
    readonly title: string;
    readonly detail: string;
    /** „main.tex:17   chapters/einleitung  →  chapters/intro“ */
    readonly lines: readonly string[];
    /** „Nur umbenennen“ bzw. „Nur verschieben“ */
    readonly skipTitle: string;
}

export interface MoveTarget {
    readonly path: AbsolutePath;
    readonly label: string;
}

export interface MoveQuestion {
    readonly itemName: string;
    readonly targets: readonly MoveTarget[];
    readonly initialPath: AbsolutePath;
}

export type ConfirmQuestion =
    | { readonly kind: 'trash'; readonly question: TrashQuestion }
    | { readonly kind: 'references'; readonly question: ReferenceQuestion }
    | { readonly kind: 'move'; readonly question: MoveQuestion };

/** Zwei Plätze: Die Namenseingabe bleibt offen, während ihr `submit` z. B. nach den Verweisen fragt */
export interface FileActionPromptState {
    readonly name: NameQuestion | null;
    readonly confirm: ConfirmQuestion | null;
}

/** Was die Abläufe zum Fragen brauchen (in Tests durch Fakes ersetzt) */
export interface FileActionAsk {
    /** Wartet, bis der Dialog geschlossen ist (nach erfolgreichem `submit` oder Abbrechen) */
    askName(question: NameQuestion): Promise<void>;
    confirmTrash(question: TrashQuestion): Promise<boolean>;
    askReferenceUpdate(question: ReferenceQuestion): Promise<ReferenceChoice>;
    /** Zielordner oder `null` bei Abbrechen */
    askMoveTarget(question: MoveQuestion): Promise<AbsolutePath | null>;
}

export interface FileActionPrompts extends FileActionAsk {
    readonly store: StoreApi<FileActionPromptState>;
    closeName(): void;
    answerTrash(confirmed: boolean): void;
    answerReferences(choice: ReferenceChoice): void;
    answerMove(target: AbsolutePath | null): void;
}

type Resolver = (value: unknown) => void;

export function createFileActionPrompts(): FileActionPrompts {
    const store = createStore<FileActionPromptState>()(() => ({ name: null, confirm: null }));
    let nameResolver: (() => void) | null = null;
    let confirmResolver: Resolver | null = null;
    const askConfirm = <T>(confirm: ConfirmQuestion, cancelValue: T): Promise<T> => {
        if (confirmResolver !== null) return Promise.resolve(cancelValue);
        return new Promise<T>((resolve) => {
            confirmResolver = resolve as Resolver;
            store.setState({ confirm });
        });
    };
    const answer = (value: unknown): void => {
        const resolve = confirmResolver;
        confirmResolver = null;
        store.setState({ confirm: null });
        resolve?.(value);
    };
    return {
        store,
        askName: (question) => {
            if (nameResolver !== null) return Promise.resolve();
            return new Promise<void>((resolve) => {
                nameResolver = resolve;
                store.setState({ name: question });
            });
        },
        confirmTrash: (question) => askConfirm<boolean>({ kind: 'trash', question }, false),
        askReferenceUpdate: (question) => askConfirm<ReferenceChoice>({ kind: 'references', question }, 'cancel'),
        askMoveTarget: (question) => askConfirm<AbsolutePath | null>({ kind: 'move', question }, null),
        closeName: () => {
            const resolve = nameResolver;
            nameResolver = null;
            store.setState({ name: null });
            resolve?.();
        },
        answerTrash: (confirmed) => answer(confirmed),
        answerReferences: (choice) => answer(choice),
        answerMove: (target) => answer(target),
    };
}

export const fileActionPrompts = createFileActionPrompts();
