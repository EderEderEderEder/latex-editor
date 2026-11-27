import { describe, expect, it, vi } from 'vitest';
import { toElectronItem } from '../../src/main/menu';
import { buildMenuEntries, commandIdsOf } from '../../src/main/menuTemplate';
import type { CommandEntry, MenuEntry } from '../../src/main/menuTemplate';
import { createCommandRegistry } from '../../src/renderer/app/commands';
import { createEditorStore } from '../../src/renderer/stores/editor';
import { createOverlayStore } from '../../src/renderer/stores/overlays';
import { createSidebarStore } from '../../src/renderer/stores/sidebar';

// Befehle der Werkzeugleisten: EditorToolbar (Öffnen, Speichern, Speichern unter), BuildToolbar (Kompilieren,
// Abbrechen, Meldungen anzeigen, Beim Speichern kompilieren, Hilfsdateien löschen)
const TOOLBAR_COMMAND_IDS = [
    'file.openFile', 'file.save', 'file.saveAs',
    'project.compile', 'project.cancel', 'project.showIssues', 'project.toggleCompileOnSave', 'project.clean',
    'insert.open',
];

function allCommands(entries: readonly MenuEntry[]): CommandEntry[] {
    return entries.flatMap((entry) => {
        if (entry.kind === 'command') return [entry];
        return entry.kind === 'submenu' ? allCommands(entry.submenu) : [];
    });
}

function titles(entries: readonly MenuEntry[]): string[] {
    return entries.flatMap((entry) => (entry.kind === 'submenu' ? [entry.label] : []));
}

const win = { platform: 'win32', isPackaged: true };
const mac = { platform: 'darwin', isPackaged: true };

describe('Menüvorlage', () => {
    it('enthält jeden Werkzeugleisten-Befehl', () => {
        const ids = commandIdsOf(buildMenuEntries(win));
        for (const id of TOOLBAR_COMMAND_IDS) expect(ids).toContain(id);
    });

    it('hat keine doppelten Befehls-IDs und keine doppelten Kürzel', () => {
        const commands = allCommands(buildMenuEntries(win));
        const ids = commands.map((entry) => entry.commandId);
        expect(new Set(ids).size).toBe(ids.length);
        const accelerators = commands.flatMap((entry) => (entry.accelerator === undefined ? [] : [entry.accelerator]));
        expect(new Set(accelerators).size).toBe(accelerators.length);
    });

    it('kennt für jede Menü-ID einen Befehl im Register', () => {
        const registry = createCommandRegistry({
            fileActions: vi.fn(), tabClose: vi.fn(), projectFlow: vi.fn(), editor: createEditorStore(),
            build: { getState: vi.fn() }, overlays: createOverlayStore(), sidebar: createSidebarStore(),
            settings: { getState: vi.fn() }, activeView: () => null, focusEditor: vi.fn(), reveal: vi.fn(),
            report: vi.fn(), confirmClean: () => false,
        } as never);
        for (const platform of ['win32', 'darwin', 'linux']) {
            for (const isPackaged of [true, false]) {
                for (const id of commandIdsOf(buildMenuEntries({ platform, isPackaged }))) expect(registry.has(id)).toBe(true);
            }
        }
    });

    it('nutzt nie Alt mit einem Zeichen (AltGr) unter Windows und Linux', () => {
        for (const platform of ['win32', 'linux']) {
            for (const entry of allCommands(buildMenuEntries({ platform, isPackaged: false }))) {
                expect(entry.accelerator ?? '').not.toMatch(/(^|\+)Alt\+/);
            }
        }
    });

    it('nutzt CommandOrControl statt festem Strg oder ⌘ für Strg-Kürzel', () => {
        const save = allCommands(buildMenuEntries(win)).find((entry) => entry.commandId === 'file.save');
        expect(save?.accelerator).toBe('CommandOrControl+S');
        expect(save?.displayOnly).toBe(true);
    });

    it('Menü besitzt Strg+W, Strg+P und Strg+G (nicht nur angezeigt)', () => {
        const commands = allCommands(buildMenuEntries(win));
        for (const id of ['file.closeTab', 'edit.quickOpen', 'edit.gotoLine']) {
            expect(commands.find((entry) => entry.commandId === id)?.displayOnly).toBeUndefined();
        }
    });

    it('SyncTeX (W3-5): Strg/⌘+J besitzt das Menü, „PDF folgt Cursor“ ohne Kürzel', () => {
        const commands = allCommands(buildMenuEntries(win));
        const forward = commands.find((entry) => entry.commandId === 'view.synctexForward');
        expect(forward).toMatchObject({ accelerator: 'CommandOrControl+J', label: 'Zur PDF-Stelle springen' });
        expect(forward?.displayOnly).toBeUndefined();
        expect(commands.find((entry) => entry.commandId === 'view.toggleFollowCursor')?.accelerator).toBeUndefined();
    });

    it('Vervollständigung (W4-6): ⌃/Strg+Leertaste führt CodeMirror aus, der Schalter hat kein Kürzel', () => {
        for (const platform of [win, mac]) {
            const commands = allCommands(buildMenuEntries(platform));
            expect(commands.find((entry) => entry.commandId === 'edit.triggerCompletion'))
                .toMatchObject({ accelerator: 'Control+Space', displayOnly: true, label: 'Vervollständigen' });
            expect(commands.find((entry) => entry.commandId === 'edit.toggleAutoComplete')?.accelerator).toBeUndefined();
        }
    });

    it('Einfügen (W4-10): Menü mit allen Bausteinen, ⇧Strg/⌘+I gehört dem Menü, nie Strg+Alt', () => {
        const commands = allCommands(buildMenuEntries(win));
        const insert = commands.filter((entry) => entry.commandId.startsWith('insert.'));
        expect(insert.map((entry) => entry.commandId)).toEqual([
            'insert.open', 'insert.table', 'insert.image', 'insert.code', 'insert.equation', 'insert.list',
            'insert.reference', 'insert.citation', 'insert.source',
        ]);
        expect(insert[0]).toMatchObject({ accelerator: 'CommandOrControl+Shift+I', label: 'Einfügeoptionen …' });
        expect(insert[0]?.displayOnly).toBeUndefined();
        expect(insert.slice(1).every((entry) => entry.accelerator === undefined)).toBe(true);
    });

    it('Windows: kein App-Menü, Beenden in Datei; macOS: App-Menü, kein Beenden in Datei', () => {
        const winEntries = buildMenuEntries(win);
        const macEntries = buildMenuEntries(mac);
        expect(winEntries[0]).toMatchObject({ kind: 'submenu', label: 'Datei' });
        expect(JSON.stringify(winEntries)).toContain('"role":"quit"');
        expect(macEntries[0]).toEqual({ kind: 'role', role: 'appMenu' });
        expect(JSON.stringify(macEntries)).not.toContain('"role":"quit"');
    });

    it('Wiederholen und Ersetzen unterscheiden sich je Plattform', () => {
        const find = (platform: string, id: string) =>
            allCommands(buildMenuEntries({ platform, isPackaged: true })).find((entry) => entry.commandId === id)?.accelerator;
        expect(find('win32', 'edit.redo')).toBe('Control+Y');
        expect(find('darwin', 'edit.redo')).toBe('Shift+Command+Z');
        expect(find('win32', 'edit.replace')).toBe('Control+H');
    });

    it('DevTools nur unverpackt', () => {
        const hasDevTools = (isPackaged: boolean): boolean =>
            JSON.stringify(buildMenuEntries({ platform: 'win32', isPackaged })).includes('toggleDevTools');
        expect(hasDevTools(false)).toBe(true);
        expect(hasDevTools(true)).toBe(false);
        expect(titles(buildMenuEntries(win))).toEqual(['Datei', 'Bearbeiten', 'Ansicht', 'Einfügen', 'Projekt', 'Fenster']);
        expect(titles(buildMenuEntries({ platform: 'win32', isPackaged: false }))).toContain('Hilfe');
    });
});

describe('Electron-Umsetzung', () => {
    it('Befehl sendet seine ID, nur angezeigte Kürzel werden nicht registriert', () => {
        const send = vi.fn();
        const item = toElectronItem(
            { kind: 'command', label: 'Speichern', commandId: 'file.save', accelerator: 'CommandOrControl+S', displayOnly: true }, send,
        );
        expect(item.registerAccelerator).toBe(false);
        (item.click as () => void)();
        expect(send).toHaveBeenCalledWith('file.save');
        const owned = toElectronItem({ kind: 'command', label: 'Tab schließen', commandId: 'file.closeTab', accelerator: 'CommandOrControl+W' }, send);
        expect(owned.registerAccelerator).toBeUndefined();
    });
});
