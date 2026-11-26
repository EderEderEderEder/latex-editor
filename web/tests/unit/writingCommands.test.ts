import { describe, expect, it, vi } from 'vitest';
import { buildMenuEntries, commandIdsOf } from '../../src/main/menuTemplate';
import type { CommandEntry, MenuEntry } from '../../src/main/menuTemplate';
import { WRITING_TEXTS, createCommandRegistry, runCommand } from '../../src/renderer/app/commands';
import type { CommandDeps } from '../../src/renderer/app/commands';
import type { StatusMessage } from '../../src/renderer/stores/status';

// Menübefehle „Großschreibung automatisch korrigieren“ und „Schreibhinweise anzeigen“ (W7-3)

function flatCommands(entries: readonly MenuEntry[]): CommandEntry[] {
    return entries.flatMap((entry) => {
        if (entry.kind === 'command') return [entry];
        return entry.kind === 'submenu' ? flatCommands(entry.submenu) : [];
    });
}

type WritingKey = 'autoCapitalize' | 'writingHints';

function setup(values: Record<WritingKey, boolean>, failWith?: Error) {
    const messages: StatusMessage[] = [];
    const set = vi.fn((key: WritingKey, value: boolean) => {
        if (failWith !== undefined) return Promise.reject(failWith);
        values[key] = value;
        return Promise.resolve();
    });
    const deps = {
        settings: { getState: () => ({ values, set }) },
        report: (message: StatusMessage) => messages.push(message),
    } as unknown as CommandDeps;
    return { deps, messages, set, values, registry: createCommandRegistry(deps) };
}

describe('Befehle für Schreibhilfen', () => {
    it('„Schreibhinweise anzeigen“ schaltet `writingHints` um und nennt den Zustand', async () => {
        const { deps, registry, set, values, messages } = setup({ autoCapitalize: true, writingHints: true });
        await runCommand(registry, 'edit.toggleWritingHints', deps.report);
        expect(set).toHaveBeenCalledWith('writingHints', false);
        await runCommand(registry, 'edit.toggleWritingHints', deps.report);
        expect(values.writingHints).toBe(true);
        expect(messages.map((message) => message.text)).toEqual([WRITING_TEXTS.hintsOff, WRITING_TEXTS.hintsOn]);
    });

    it('„Großschreibung automatisch korrigieren“ schaltet `autoCapitalize` um, ohne `writingHints` anzufassen', async () => {
        const { deps, registry, set, values, messages } = setup({ autoCapitalize: true, writingHints: true });
        await runCommand(registry, 'edit.toggleAutoCapitalize', deps.report);
        expect(set).toHaveBeenCalledOnce();
        expect(set).toHaveBeenCalledWith('autoCapitalize', false);
        expect(values.writingHints).toBe(true);
        expect(messages.map((message) => message.text)).toEqual([WRITING_TEXTS.capitalizeOff]);
    });

    it('meldet einen Fehler beim Speichern der Einstellung und nennt keinen neuen Zustand', async () => {
        const { deps, registry, messages } = setup({ autoCapitalize: true, writingHints: true }, new Error('Platte voll'));
        await runCommand(registry, 'edit.toggleWritingHints', deps.report);
        expect(messages).toEqual([{ text: 'Einstellung nicht gespeichert: Platte voll', kind: 'error' }]);
    });

    it('beide Befehle stehen im Menü Bearbeiten, ohne Kürzel', () => {
        for (const platform of ['win32', 'darwin']) {
            const entries = buildMenuEntries({ platform, isPackaged: true });
            const ids = commandIdsOf(entries);
            expect(ids).toContain('edit.toggleWritingHints');
            expect(ids).toContain('edit.toggleAutoCapitalize');
            const toggles = flatCommands(entries).filter((entry) => entry.commandId.startsWith('edit.toggle'));
            for (const entry of toggles) expect(entry.accelerator).toBeUndefined();
        }
    });
});
