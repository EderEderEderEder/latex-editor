import { describe, expect, it, vi } from 'vitest';
import { buildMenuEntries, commandIdsOf } from '../../src/main/menuTemplate';
import { SPELL_TEXTS, createCommandRegistry, runCommand } from '../../src/renderer/app/commands';
import type { CommandDeps } from '../../src/renderer/app/commands';
import { SPELL_MENU_TEXTS, spellMenuItems } from '../../src/renderer/app/spellMenuItems';
import { SPELL_WORD_TEXTS, SpellWords } from '../../src/renderer/app/spellWords';
import type { SpellWordsApi } from '../../src/renderer/app/spellWords';
import type { StatusMessage } from '../../src/renderer/stores/status';
import type { IpcResult } from '../../src/shared/contract';
import { defaultSettings } from '../../src/shared/settingsSchema';

// Renderer-Seite der Rechtschreibung (W7-2): Zusatzwörter, Kontextmenü-Einträge, Menübefehl und Schalter.

function okResult(value: string[]): Promise<IpcResult<string[]>> {
    return Promise.resolve({ ok: true, value });
}

function setupWords(api: Partial<SpellWordsApi> = {}) {
    const messages: StatusMessage[] = [];
    const fullApi: SpellWordsApi = {
        words: api.words ?? (() => okResult(['Electron'])),
        addWord: api.addWord ?? ((word) => okResult(['Electron', word])),
    };
    const words = new SpellWords({ api: () => fullApi, report: (message) => messages.push(message) });
    const changes: string[][] = [];
    words.subscribe((change) => changes.push([...change.accepted]));
    return { words, messages, changes };
}

describe('SpellWords', () => {
    it('lädt die Benutzerwörter einmal und meldet sie als neu richtig', async () => {
        const load = vi.fn(() => okResult(['Electron']));
        const { words, changes } = setupWords({ words: load });
        await Promise.all([words.ensureLoaded(), words.ensureLoaded()]);
        expect(load).toHaveBeenCalledOnce();
        expect(words.all()).toEqual(['Electron']);
        expect(changes).toEqual([['Electron']]);
    });

    it('„Ignorieren“ gilt nur im Speicher, „Hinzufügen“ geht an den Main', async () => {
        const addWord = vi.fn((word: string) => okResult(['Electron', word]));
        const { words, changes } = setupWords({ addWord });
        words.ignore('Tipfehlr');
        expect(addWord).not.toHaveBeenCalled();
        expect(await words.add('Paradeiser')).toBe(true);
        expect(addWord).toHaveBeenCalledWith('Paradeiser');
        expect(words.all()).toEqual(['Electron', 'Paradeiser', 'Tipfehlr']);
        expect(changes).toEqual([['Tipfehlr'], ['Paradeiser']]);
    });

    it('Fehler werden gemeldet, nie geworfen; ungültige Wörter gehen nicht hinaus', async () => {
        const addWord = vi.fn(() => Promise.resolve<IpcResult<string[]>>({ ok: false, error: { kind: 'io', message: 'Platte voll' } }));
        const { words, messages } = setupWords({ addWord, words: () => Promise.reject(new Error('kein window.api')) });
        await words.ensureLoaded();
        expect(await words.add('Haus')).toBe(false);
        expect(await words.add('zwei Wörter')).toBe(false);
        expect(addWord).toHaveBeenCalledOnce();
        expect(messages.map((message) => message.text)).toEqual([
            SPELL_WORD_TEXTS.loadFailed('kein window.api'),
            SPELL_WORD_TEXTS.addFailed('Platte voll'),
            SPELL_WORD_TEXTS.invalid,
        ]);
    });
});

describe('Kontextmenü', () => {
    it('Vorschläge (höchstens sechs), Trenner, „Ignorieren“, „Zum Wörterbuch hinzufügen“', () => {
        const replace = vi.fn();
        const actions = { replace, ignore: vi.fn(), add: vi.fn() };
        const items = spellMenuItems('Fehlr', ['Fehler', 'Fehl', 'Fehler', 'a', 'b', 'c', 'd', 'e'], actions);
        const labels = items.map((item) => (item.kind === 'item' ? item.label : '—'));
        expect(labels).toEqual(['Fehler', 'Fehl', 'a', 'b', 'c', 'd', '—', SPELL_MENU_TEXTS.ignore, SPELL_MENU_TEXTS.add]);
        const first = items[0];
        if (first?.kind === 'item') first.onSelect();
        expect(replace).toHaveBeenCalledWith('Fehler');
    });

    it('ohne Vorschläge ein gesperrter Hinweis; ungültiges Wort sperrt „Hinzufügen“', () => {
        const items = spellMenuItems('x'.repeat(100), [], { replace: vi.fn(), ignore: vi.fn(), add: vi.fn() });
        expect(items[0]).toMatchObject({ label: SPELL_MENU_TEXTS.noSuggestions, disabled: true });
        expect(items.at(-1)).toMatchObject({ label: SPELL_MENU_TEXTS.add, disabled: true });
    });
});

describe('Schalter „Rechtschreibung prüfen“', () => {
    it('Standard an wie Swift (`checksSpelling`)', () => {
        expect(defaultSettings().checksSpelling).toBe(true);
    });

    it('Menübefehl schaltet `checksSpelling` um und nennt den Zustand', async () => {
        const values = { checksSpelling: true };
        const messages: StatusMessage[] = [];
        const set = vi.fn((key: string, value: boolean) => {
            if (key === 'checksSpelling') values.checksSpelling = value;
            return Promise.resolve();
        });
        const deps = {
            settings: { getState: () => ({ values, set }) },
            report: (message: StatusMessage) => messages.push(message),
        } as unknown as CommandDeps;
        const registry = createCommandRegistry(deps);
        await runCommand(registry, 'edit.toggleSpellCheck', deps.report);
        await runCommand(registry, 'edit.toggleSpellCheck', deps.report);
        expect(set.mock.calls).toEqual([['checksSpelling', false], ['checksSpelling', true]]);
        expect(messages.map((message) => message.text)).toEqual([SPELL_TEXTS.off, SPELL_TEXTS.on]);
    });

    it('steht im Menü Bearbeiten (Windows und macOS)', () => {
        for (const platform of ['win32', 'darwin']) {
            expect(commandIdsOf(buildMenuEntries({ platform, isPackaged: true }))).toContain('edit.toggleSpellCheck');
        }
    });
});
