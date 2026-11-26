// Menüvorlage als reine Daten (ohne Electron), plattformabhängig; `menu.ts` macht daraus das Electron-Menü.
// Kürzel: `CommandOrControl` (Strg unter Windows/Linux, ⌘ unter macOS), nie Strg+Alt+Zeichen (AltGr!).
// Wer ein Kürzel ausführt, steht je Eintrag fest (sonst feuerte es doppelt):
// - Menü (`command` ohne `displayOnly`): der Accelerator löst `menu:command` aus (Strg+W, Strg+P, Strg+G, …).
// - Renderer (`displayOnly`): Der Tastenhandler im Renderer (`app/shortcuts.ts`) oder CodeMirror führt das Kürzel
//   aus; das Menü zeigt es nur an (`registerAccelerator: false`, wirkt auf macOS/Linux; unter Windows kommt der
//   Menü-Accelerator erst nach dem Renderer und entfällt, weil dieser `preventDefault` aufruft).

export type MenuRoleName =
    | 'cut' | 'copy' | 'paste' | 'selectAll' | 'quit' | 'minimize' | 'zoom' | 'front' | 'toggleDevTools' | 'appMenu';

export interface CommandEntry {
    readonly kind: 'command';
    readonly label: string;
    readonly commandId: string;
    readonly accelerator?: string;
    /** Das Kürzel führt der Renderer aus; das Menü zeigt es nur an */
    readonly displayOnly?: true;
}

export interface RoleEntry {
    readonly kind: 'role';
    readonly role: MenuRoleName;
    readonly label?: string;
}

export interface SeparatorEntry {
    readonly kind: 'separator';
}

export interface SubmenuEntry {
    readonly kind: 'submenu';
    readonly label: string;
    readonly role?: 'window' | 'help';
    readonly submenu: readonly MenuEntry[];
}

export type MenuEntry = CommandEntry | RoleEntry | SeparatorEntry | SubmenuEntry;

export interface MenuContext {
    /** `process.platform` */
    readonly platform: string;
    readonly isPackaged: boolean;
}

const SEPARATOR: SeparatorEntry = { kind: 'separator' };
const MOD = 'CommandOrControl';

function command(label: string, commandId: string, accelerator?: string, displayOnly?: true): CommandEntry {
    return { kind: 'command', label, commandId, accelerator, displayOnly };
}

function role(menuRole: MenuRoleName, label?: string): RoleEntry {
    return { kind: 'role', role: menuRole, label };
}

// Datei-Aktionen im Projekt (W2-9). Kürzel wie in Swift: ⇧⌘N „Neuer Ordner“; ⌥⌘Z / ⌥⇧⌘Z nur unter macOS
// (Strg+Alt+Z wäre unter Windows AltGr+Z), „Neue Datei im Projekt“ ohne Kürzel (Strg+N gehört „Neu …“).
function projectFileEntries(isMac: boolean): MenuEntry[] {
    const undo = isMac ? 'Alt+Command+Z' : undefined;
    const redo = isMac ? 'Alt+Shift+Command+Z' : undefined;
    return [
        command('Neue Datei im Projekt …', 'file.newProjectFile'),
        command('Neuer Ordner …', 'file.newFolder', `${MOD}+Shift+N`),
        SEPARATOR,
        command('Datei-Aktion rückgängig', 'file.undoFileAction', undo),
        command('Datei-Aktion wiederholen', 'file.redoFileAction', redo),
    ];
}

function fileMenu(isMac: boolean): SubmenuEntry {
    const quit: readonly MenuEntry[] = isMac ? [] : [SEPARATOR, role('quit', 'Beenden')];
    return {
        kind: 'submenu',
        label: 'Datei',
        submenu: [
            command('Projekt öffnen …', 'file.openProject', `${MOD}+Shift+O`),
            command('Datei öffnen …', 'file.openFile', `${MOD}+O`, true),
            command('Neu …', 'file.new', `${MOD}+N`),
            ...projectFileEntries(isMac),
            SEPARATOR,
            command('Speichern', 'file.save', `${MOD}+S`, true),
            command('Speichern unter …', 'file.saveAs', `${MOD}+Shift+S`, true),
            command('Alle speichern', 'file.saveAll'),
            SEPARATOR,
            command('Tab schließen', 'file.closeTab', `${MOD}+W`),
            ...quit,
        ],
    };
}

function editMenu(isMac: boolean): SubmenuEntry {
    const redo = isMac ? 'Shift+Command+Z' : 'Control+Y';
    const replace = isMac ? 'Alt+Command+F' : 'Control+H';
    return {
        kind: 'submenu',
        label: 'Bearbeiten',
        submenu: [
            command('Rückgängig', 'edit.undo', `${MOD}+Z`, true),
            command('Wiederholen', 'edit.redo', redo, true),
            SEPARATOR,
            role('cut', 'Ausschneiden'),
            role('copy', 'Kopieren'),
            role('paste', 'Einfügen'),
            role('selectAll', 'Alles auswählen'),
            SEPARATOR,
            command('Suchen …', 'edit.find', `${MOD}+F`, true),
            command('Ersetzen …', 'edit.replace', replace, true),
            SEPARATOR,
            // ⌃Leertaste wie Swift (auch unter Windows Strg+Leertaste); CodeMirror führt es aus
            command('Vervollständigen', 'edit.triggerCompletion', 'Control+Space', true),
            command('Automatische Vervollständigung (ein/aus)', 'edit.toggleAutoComplete'),
            command('Großschreibung automatisch korrigieren (ein/aus)', 'edit.toggleAutoCapitalize'),
            command('Schreibhinweise anzeigen (ein/aus)', 'edit.toggleWritingHints'),
            command('Rechtschreibung prüfen (ein/aus)', 'edit.toggleSpellCheck'),
            SEPARATOR,
            command('Gehe zu Zeile …', 'edit.gotoLine', `${MOD}+G`),
            command('Schnell öffnen …', 'edit.quickOpen', `${MOD}+P`),
        ],
    };
}

function viewMenu(): SubmenuEntry {
    return {
        kind: 'submenu',
        label: 'Ansicht',
        submenu: [
            command('Editor', 'view.mode.editor', `${MOD}+1`),
            command('Geteilt', 'view.mode.split', `${MOD}+2`),
            command('PDF', 'view.mode.pdf', `${MOD}+3`),
            SEPARATOR,
            command('Zoom größer', 'view.zoomIn', `${MOD}+Plus`, true),
            command('Zoom kleiner', 'view.zoomOut', `${MOD}+-`, true),
            command('Originalgröße', 'view.zoomReset', `${MOD}+0`, true),
            SEPARATOR,
            command('Zur PDF-Stelle springen', 'view.synctexForward', `${MOD}+J`),
            command('PDF folgt Cursor (ein/aus)', 'view.toggleFollowCursor'),
            SEPARATOR,
            command('Seitenleiste: Dateien', 'view.sidebarFiles'),
            command('Seitenleiste: Gliederung', 'view.sidebarOutline'),
            command('Seitenleiste: Meldungen', 'view.sidebarIssues'),
            SEPARATOR,
            command('Nächster Tab', 'view.nextTab', 'Control+Tab', true),
            command('Vorheriger Tab', 'view.previousTab', 'Control+Shift+Tab', true),
        ],
    };
}

function projectMenu(): SubmenuEntry {
    return {
        kind: 'submenu',
        label: 'Projekt',
        submenu: [
            command('Kompilieren', 'project.compile', `${MOD}+B`, true),
            command('Kompilieren abbrechen', 'project.cancel', `${MOD}+.`, true),
            command('Beim Speichern kompilieren (ein/aus)', 'project.toggleCompileOnSave'),
            command('Hilfsdateien löschen …', 'project.clean'),
            SEPARATOR,
            command('Meldungen anzeigen', 'project.showIssues'),
            command('Nächste Meldung', 'project.nextIssue', 'F8', true),
            command('Vorherige Meldung', 'project.previousIssue', 'Shift+F8', true),
        ],
    };
}

function windowMenu(isMac: boolean): SubmenuEntry {
    const macItems: readonly MenuEntry[] = isMac ? [role('zoom', 'Zoomen'), role('front', 'Alle nach vorne bringen')] : [];
    return { kind: 'submenu', label: 'Fenster', role: 'window', submenu: [role('minimize', 'Minimieren'), ...macItems] };
}

// Entwicklerwerkzeuge nur unverpackt (`devTools: !app.isPackaged`); verpackt bleibt die Hilfe ohne Einträge und entfällt.
function helpMenu(isPackaged: boolean): SubmenuEntry | null {
    if (isPackaged) return null;
    return { kind: 'submenu', label: 'Hilfe', role: 'help', submenu: [role('toggleDevTools', 'Entwicklerwerkzeuge')] };
}

export function buildMenuEntries(context: MenuContext): MenuEntry[] {
    const isMac = context.platform === 'darwin';
    const help = helpMenu(context.isPackaged);
    return [
        ...(isMac ? [role('appMenu')] : []),
        fileMenu(isMac),
        editMenu(isMac),
        viewMenu(),
        projectMenu(),
        windowMenu(isMac),
        ...(help === null ? [] : [help]),
    ];
}

/** Alle Befehls-IDs der Vorlage (rekursiv) */
export function commandIdsOf(entries: readonly MenuEntry[]): string[] {
    return entries.flatMap((entry) => {
        if (entry.kind === 'command') return [entry.commandId];
        return entry.kind === 'submenu' ? commandIdsOf(entry.submenu) : [];
    });
}
