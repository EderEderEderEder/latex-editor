// Anwendungsmenü: macht aus der Vorlage (`menuTemplate.ts`) das Electron-Menü. Befehle nur der Renderer
// ausführen kann, gehen als `menu:command` an das Fenster; Rollen-Einträge nutzen Electron-Rollen.
import type { Menu, MenuItemConstructorOptions } from 'electron';
import { buildMenuEntries } from './menuTemplate';
import type { MenuContext, MenuEntry } from './menuTemplate';

export interface MenuDeps extends MenuContext {
    readonly menu: Pick<typeof Menu, 'buildFromTemplate' | 'setApplicationMenu'>;
    readonly sendCommand: (commandId: string) => void;
}

export function toElectronItem(entry: MenuEntry, sendCommand: (commandId: string) => void): MenuItemConstructorOptions {
    switch (entry.kind) {
        case 'separator':
            return { type: 'separator' };
        case 'role':
            return { role: entry.role, ...(entry.label === undefined ? {} : { label: entry.label }) };
        case 'submenu':
            return {
                label: entry.label,
                ...(entry.role === undefined ? {} : { role: entry.role }),
                submenu: entry.submenu.map((item) => toElectronItem(item, sendCommand)),
            };
        case 'command':
            return {
                label: entry.label,
                ...(entry.accelerator === undefined ? {} : { accelerator: entry.accelerator }),
                ...(entry.displayOnly === true ? { registerAccelerator: false } : {}),
                click: () => sendCommand(entry.commandId),
            };
    }
}

export function installApplicationMenu(deps: MenuDeps): void {
    const entries = buildMenuEntries({ platform: deps.platform, isPackaged: deps.isPackaged });
    const template = entries.map((entry) => toElectronItem(entry, deps.sendCommand));
    deps.menu.setApplicationMenu(deps.menu.buildFromTemplate(template));
}
