import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppHandlers } from '../../src/main/handlers/appHandlers';
import type { DialogLike } from '../../src/main/handlers/dialogHandlers';
import {
    createSpellHandlers, SPELL_WORDS_BACKUP_SUFFIX, SPELL_WORDS_FILE_NAME, SPELL_WORDS_MESSAGES, UserWordStore,
} from '../../src/main/handlers/spellHandlers';
import { ARG_SCHEMAS } from '../../src/main/ipcValidation';
import { QuitTasks } from '../../src/main/lifecycle';
import { MACOS_PATHS } from '../../src/main/paths';
import { MAX_USER_WORD_LENGTH, MAX_USER_WORDS } from '../../src/shared/core/spelling/userWords';
import { IpcFailure } from '../../src/shared/ipcResult';
import { createPreloadStub } from '../support/preloadStub';

// Benutzerwörterbuch im Main (W7-2): Datei im `userData`-Ordner, atomar, Obergrenzen, Sicherung bei unlesbarer Datei.

let userData: string;

beforeEach(async () => {
    userData = await mkdtemp(join(tmpdir(), 'spell-words-'));
});

afterEach(async () => {
    await rm(userData, { recursive: true, force: true });
});

function storedFile(): string {
    return join(userData, SPELL_WORDS_FILE_NAME);
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

/** Zahl als Buchstabenfolge (`0` → `a`, `26` → `ba`), damit jedes Testwort gültig und verschieden ist */
function lettersOf(index: number): string {
    const digits = index.toString(ALPHABET.length);
    return [...digits].map((digit) => ALPHABET[Number.parseInt(digit, ALPHABET.length)]).join('');
}

async function failureOf(promise: Promise<unknown>): Promise<IpcFailure> {
    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IpcFailure);
    return error as IpcFailure;
}

describe('UserWordStore', () => {
    it('ohne Datei leer; aufgenommene Wörter sortiert, ohne Doppelte, als JSON gespeichert', async () => {
        const store = new UserWordStore(userData);
        expect(await store.words()).toEqual([]);
        expect(await store.addWord('Electron')).toEqual(['Electron']);
        expect(await store.addWord('Ablage')).toEqual(['Ablage', 'Electron']);
        expect(await store.addWord('Electron')).toEqual(['Ablage', 'Electron']);
        expect(JSON.parse(await readFile(storedFile(), 'utf8'))).toEqual({ version: 1, words: ['Ablage', 'Electron'] });
        expect(await new UserWordStore(userData).words()).toEqual(['Ablage', 'Electron']);
    });

    it('zwei gleichzeitige Aufnahmen gehen beide in die Datei', async () => {
        const store = new UserWordStore(userData);
        await Promise.all([store.addWord('Erstes'), store.addWord('Zweites')]);
        expect(await store.words()).toEqual(['Erstes', 'Zweites']);
    });

    it.each(['', 'zwei Wörter', 'mit1Ziffer', 'a'.repeat(MAX_USER_WORD_LENGTH + 1), '-Strich', 'Nul\0l'])('lehnt „%s“ ab', async (word) => {
        const failure = await failureOf(new UserWordStore(userData).addWord(word));
        expect(failure.error).toEqual({ kind: 'invalidInput', message: SPELL_WORDS_MESSAGES.invalid });
    });

    it(`höchstens ${MAX_USER_WORDS} Wörter`, async () => {
        const words = Array.from({ length: MAX_USER_WORDS }, (_, index) => `wort${lettersOf(index)}`);
        await writeFile(storedFile(), JSON.stringify({ version: 1, words }));
        const store = new UserWordStore(userData);
        expect(await store.words()).toHaveLength(MAX_USER_WORDS);
        const failure = await failureOf(store.addWord('Neues'));
        expect(failure.error).toEqual({ kind: 'invalidInput', message: SPELL_WORDS_MESSAGES.full });
    });

    it('unlesbare Datei: leer gelesen, vor dem Überschreiben gesichert; ungültige Einträge fallen weg', async () => {
        await writeFile(storedFile(), '{ kaputt');
        const store = new UserWordStore(userData);
        expect(await store.words()).toEqual([]);
        expect(await store.addWord('Haus')).toEqual(['Haus']);
        expect(await readFile(storedFile() + SPELL_WORDS_BACKUP_SUFFIX, 'utf8')).toBe('{ kaputt');
        await writeFile(storedFile(), JSON.stringify({ version: 1, words: ['Gut', 42, 'zwei Wörter', 'Gut'] }));
        expect(await store.words()).toEqual(['Gut']);
    });
});

describe('Verdrahtung und Vertrag', () => {
    it('createAppHandlers bindet `spell:words`/`spell:addWord` echt an den `userData`-Ordner', async () => {
        const dialog: DialogLike<object> = {
            showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
            showSaveDialog: () => Promise.resolve({ canceled: true }),
        };
        const { handlers } = createAppHandlers({
            userDataDir: userData, dialog, window: () => ({}), platform: MACOS_PATHS, quitTasks: new QuitTasks(),
            log: vi.fn(), confirmClose: vi.fn(),
        });
        expect(await handlers['spell:addWord']('Matura')).toEqual(['Matura']);
        expect(await handlers['spell:words']()).toEqual(['Matura']);
    });

    it('Argumentprüfung: kein Argument bzw. genau ein gültiges Wort', () => {
        expect(ARG_SCHEMAS['spell:words']).toHaveLength(0);
        const [isWord] = ARG_SCHEMAS['spell:addWord'];
        expect(isWord('Wort')).toBe(true);
        expect(isWord(42)).toBe(false);
        expect(isWord('a'.repeat(MAX_USER_WORD_LENGTH + 1))).toBe(false);
    });

    it('Stub antwortet wie der Main (Liste von Zeichenketten, Fehler `invalidInput`)', async () => {
        const main = createSpellHandlers(new UserWordStore(userData));
        const stub = createPreloadStub();
        const stubAdded = await stub.api.spell.addWord('Paradeiser');
        expect(stubAdded).toEqual({ ok: true, value: await main['spell:addWord']('Paradeiser') });
        expect(await stub.api.spell.words()).toEqual({ ok: true, value: await main['spell:words']() });
        const stubInvalid = await stub.api.spell.addWord('zwei Wörter');
        expect(stubInvalid.ok ? null : stubInvalid.error.kind).toBe('invalidInput');
    });
});
