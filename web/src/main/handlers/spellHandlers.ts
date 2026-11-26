import * as fsp from 'node:fs/promises';
import { join } from 'node:path';
import { isValidUserWord, MAX_USER_WORDS, normalizeUserWords } from '../../shared/core/spelling/userWords';
import { IpcFailure } from '../../shared/ipcResult';
import type { IpcHandlers } from '../ipcHandlers';
import { readTextFile, writeTextFile } from '../textIo';

// Benutzerwörterbuch der Rechtschreibprüfung (W7-2): `<userData>/spelling-words.json`, atomar geschrieben
// (`writeTextFile`), höchstens `MAX_USER_WORDS` Wörter mit je höchstens `MAX_USER_WORD_LENGTH` Zeichen. Nie das
// Wörterbuch des Systems. Eine unlesbare Datei ergibt beim Lesen eine leere Liste; bevor ein neues Wort sie
// überschreibt, bleibt sie als Sicherung `….unlesbar.bak` liegen.

export const SPELL_WORDS_FILE_NAME = 'spelling-words.json';
export const SPELL_WORDS_BACKUP_SUFFIX = '.unlesbar.bak';
const SPELL_WORDS_VERSION = 1;
const JSON_INDENT = 4;
const SORT_LOCALE = 'de';

export const SPELL_WORDS_MESSAGES = {
    invalid: 'Ungültiges Wort für das Wörterbuch',
    full: `Benutzerwörterbuch ist voll (höchstens ${MAX_USER_WORDS} Wörter)`,
} as const;

export type SpellHandlers = Pick<IpcHandlers, 'spell:words' | 'spell:addWord'>;

interface LoadedWords {
    readonly words: readonly string[];
    /** `false`: Datei vorhanden, aber nicht lesbar (wird vor dem Überschreiben gesichert) */
    readonly readable: boolean;
}

function parseWords(text: string): LoadedWords {
    try {
        const raw: unknown = JSON.parse(text);
        if (typeof raw !== 'object' || raw === null || !('words' in raw) || !Array.isArray(raw.words)) {
            return { words: [], readable: false };
        }
        return { words: normalizeUserWords(raw.words as unknown[]), readable: true };
    } catch {
        return { words: [], readable: false };
    }
}

function invalidInput(message: string): IpcFailure {
    return new IpcFailure({ kind: 'invalidInput', message });
}

export class UserWordStore {
    private writing: Promise<unknown> = Promise.resolve();

    constructor(private readonly userDataDir: string) {}

    get filePath(): string {
        return join(this.userDataDir, SPELL_WORDS_FILE_NAME);
    }

    async words(): Promise<string[]> {
        return [...(await this.load()).words];
    }

    /** Hintereinander, damit zwei schnelle Aufnahmen sich nicht überschreiben */
    addWord(word: string): Promise<string[]> {
        const run = this.writing.then(() => this.append(word));
        this.writing = run.catch(() => undefined);
        return run;
    }

    private async append(word: string): Promise<string[]> {
        if (!isValidUserWord(word)) throw invalidInput(SPELL_WORDS_MESSAGES.invalid);
        const normalized = word.normalize('NFC');
        const loaded = await this.load();
        if (loaded.words.includes(normalized)) return [...loaded.words];
        if (loaded.words.length >= MAX_USER_WORDS) throw invalidInput(SPELL_WORDS_MESSAGES.full);
        if (!loaded.readable) await fsp.copyFile(this.filePath, this.filePath + SPELL_WORDS_BACKUP_SUFFIX);
        const words = [...loaded.words, normalized].sort((first, second) => first.localeCompare(second, SORT_LOCALE));
        await this.save(words);
        return words;
    }

    private async load(): Promise<LoadedWords> {
        try {
            return parseWords((await readTextFile(this.filePath)).text);
        } catch (error) {
            if (error instanceof IpcFailure && error.error.kind === 'notFound') return { words: [], readable: true };
            if (error instanceof IpcFailure && error.error.kind === 'invalidInput') return { words: [], readable: false };
            throw error;
        }
    }

    private async save(words: readonly string[]): Promise<void> {
        await fsp.mkdir(this.userDataDir, { recursive: true });
        const text = `${JSON.stringify({ version: SPELL_WORDS_VERSION, words }, null, JSON_INDENT)}\n`;
        await writeTextFile(this.filePath, text, 'utf8', 'lf');
    }
}

export function createSpellHandlers(store: UserWordStore): SpellHandlers {
    return {
        'spell:words': () => store.words(),
        'spell:addWord': (word) => store.addWord(word),
    };
}
