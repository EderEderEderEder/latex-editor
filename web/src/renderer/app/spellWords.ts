// Zusatzwörter der Rechtschreibprüfung (W7-2): „Zum Wörterbuch hinzufügen“ (dauerhaft, Main speichert sie im
// `userData`-Ordner über `spell:words`/`spell:addWord`) und „Ignorieren“ (nur diese Sitzung, nur im Renderer).
// Hörer erfahren, welche Wörter neu als richtig gelten; Editor und Worker-Client richten sich danach.
import type { IpcResult } from '../../shared/contract';
import { isValidUserWord, MAX_USER_WORD_LENGTH } from '../../shared/core/spelling/userWords';
import type { StatusMessage } from '../stores/status';

export const SPELL_WORD_TEXTS = {
    loadFailed: (detail: string) => `Benutzerwörterbuch nicht lesbar: ${detail}`,
    addFailed: (detail: string) => `Wort nicht ins Wörterbuch aufgenommen: ${detail}`,
    invalid: `Nur Wörter aus Buchstaben (höchstens ${MAX_USER_WORD_LENGTH} Zeichen) lassen sich aufnehmen.`,
} as const;

/** Der Teil von `window.api.spell`, den die Wortliste braucht */
export interface SpellWordsApi {
    words(): Promise<IpcResult<string[]>>;
    addWord(word: string): Promise<IpcResult<string[]>>;
}

export interface SpellWordsChange {
    /** Wörter, die ab jetzt als richtig gelten */
    readonly accepted: readonly string[];
}

export type SpellWordsListener = (change: SpellWordsChange) => void;

export interface SpellWordsDeps {
    readonly api: () => SpellWordsApi;
    readonly report: (message: StatusMessage) => void;
}

export class SpellWords {
    private user: ReadonlySet<string> = new Set();
    private readonly ignored = new Set<string>();
    private readonly listeners = new Set<SpellWordsListener>();
    private loading: Promise<void> | null = null;

    constructor(private readonly deps: SpellWordsDeps) {}

    /** Benutzerwörter und ignorierte Wörter zusammen */
    all(): string[] {
        return [...this.user, ...this.ignored];
    }

    subscribe(listener: SpellWordsListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** Lädt die Benutzerwörter einmal je Sitzung; ein Fehler wird gemeldet, die Prüfung läuft ohne sie */
    ensureLoaded(): Promise<void> {
        this.loading ??= this.load();
        return this.loading;
    }

    ignore(word: string): void {
        this.ignored.add(word);
        this.notify([word]);
    }

    /** Nimmt ein Wort dauerhaft auf; `false`, wenn es nicht ging (Meldung in der Statusleiste) */
    async add(word: string): Promise<boolean> {
        if (!isValidUserWord(word)) {
            this.deps.report({ text: SPELL_WORD_TEXTS.invalid, kind: 'error' });
            return false;
        }
        const result = await this.request(() => this.deps.api().addWord(word));
        if (!result.ok) {
            this.deps.report({ text: SPELL_WORD_TEXTS.addFailed(result.error.message), kind: 'error' });
            return false;
        }
        this.user = new Set(result.value);
        this.notify([word]);
        return true;
    }

    private async load(): Promise<void> {
        const result = await this.request(() => this.deps.api().words());
        if (!result.ok) {
            this.deps.report({ text: SPELL_WORD_TEXTS.loadFailed(result.error.message), kind: 'error' });
            return;
        }
        this.user = new Set(result.value);
        if (this.user.size > 0) this.notify([...this.user]);
    }

    /** Auch eine geworfene Ausnahme (fehlendes `window.api`) wird zu einem Fehlerergebnis */
    private async request(run: () => Promise<IpcResult<string[]>>): Promise<IpcResult<string[]>> {
        try {
            return await run();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { ok: false, error: { kind: 'internal', message } };
        }
    }

    private notify(accepted: readonly string[]): void {
        for (const listener of this.listeners) listener({ accepted });
    }
}
