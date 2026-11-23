// Geöffnete Tabs (Port von `swift/Sources/LatexEditor/Editor/EditorTabs.swift`): Reihenfolge, aktiver Tab und
// höchstens ein Vorschau-Tab (kursiv), der beim nächsten Öffnen als Vorschau ersetzt wird, solange er nicht
// bearbeitet oder festgehalten wurde. Reine Logik ohne DOM; jede Funktion liefert bei „keine Änderung“ dasselbe Objekt.
// Diff-Tabs der Swift-Version kommen erst mit der Git-Ansicht; ein Tab ist hier der Pfad seiner Datei.

export type TabPath = string;

export interface TabsState {
    readonly items: readonly TabPath[];
    readonly preview: TabPath | null;
    readonly active: TabPath | null;
}

export interface OpenTabResult {
    readonly tabs: TabsState;
    /** Verdrängter Vorschau-Tab, damit seine Sitzung freigegeben werden kann */
    readonly replaced: TabPath | null;
}

export interface RelocateResult {
    readonly tabs: TabsState;
    /** Zuordnung alt → neu der betroffenen Tabs */
    readonly mapping: ReadonlyMap<TabPath, TabPath>;
}

export const EMPTY_TABS: TabsState = { items: [], preview: null, active: null };

const PATH_SEPARATORS = ['/', '\\'] as const;

function withChanges(tabs: TabsState, changes: Partial<TabsState>): TabsState {
    const next = { ...tabs, ...changes };
    const unchanged = next.items === tabs.items && next.preview === tabs.preview && next.active === tabs.active;
    return unchanged ? tabs : next;
}

/** Neue Tabs stehen rechts vom aktiven Tab (wie bei VS Code und Browsern). */
function insertionIndex(tabs: TabsState): number {
    const index = tabs.active === null ? -1 : tabs.items.indexOf(tabs.active);
    return index < 0 ? tabs.items.length : index + 1;
}

/**
 * Öffnet `path` und aktiviert ihn. Ein vorhandener Tab wird nur aktiviert; ein festes Öffnen
 * (`asPreview: false`) hält einen Vorschau-Tab fest.
 */
export function openTab(tabs: TabsState, path: TabPath, asPreview: boolean): OpenTabResult {
    if (tabs.items.includes(path)) {
        const preview = !asPreview && tabs.preview === path ? null : tabs.preview;
        return { tabs: withChanges(tabs, { active: path, preview }), replaced: null };
    }
    const previewIndex = tabs.preview === null ? -1 : tabs.items.indexOf(tabs.preview);
    if (asPreview && previewIndex >= 0) {
        const items = tabs.items.map((item, index) => (index === previewIndex ? path : item));
        return { tabs: { items, preview: path, active: path }, replaced: tabs.preview };
    }
    const items = [...tabs.items];
    items.splice(insertionIndex(tabs), 0, path);
    return { tabs: { items, preview: asPreview ? path : tabs.preview, active: path }, replaced: null };
}

export function activateTab(tabs: TabsState, path: TabPath): TabsState {
    if (!tabs.items.includes(path)) return tabs;
    return withChanges(tabs, { active: path });
}

/** Hält einen Vorschau-Tab fest (Bearbeitung oder Doppelklick). */
export function promoteTab(tabs: TabsState, path: TabPath): TabsState {
    return tabs.preview === path ? withChanges(tabs, { preview: null }) : tabs;
}

function stepActive(tabs: TabsState, offset: number): TabsState {
    const count = tabs.items.length;
    const index = tabs.active === null ? -1 : tabs.items.indexOf(tabs.active);
    if (count <= 1 || index < 0) return tabs;
    return withChanges(tabs, { active: tabs.items[(index + offset + count) % count] ?? null });
}

export function activateNextTab(tabs: TabsState): TabsState {
    return stepActive(tabs, 1);
}

export function activatePreviousTab(tabs: TabsState): TabsState {
    return stepActive(tabs, -1);
}

/** Schließt einen Tab; neuer aktiver Tab ist der rechte Nachbar, sonst der linke, sonst keiner. */
export function closeTab(tabs: TabsState, path: TabPath): TabsState {
    const index = tabs.items.indexOf(path);
    if (index < 0) return tabs;
    const items = tabs.items.filter((item) => item !== path);
    const preview = tabs.preview === path ? null : tabs.preview;
    if (tabs.active !== path) return { items, preview, active: tabs.active };
    const active = items.length === 0 ? null : (items[Math.min(index, items.length - 1)] ?? null);
    return { items, preview, active };
}

/** Schließt alle außer `path` (der aktiv wird). */
export function closeOtherTabs(tabs: TabsState, path: TabPath): TabsState {
    if (!tabs.items.includes(path)) return tabs;
    return { items: [path], active: path, preview: tabs.preview === path ? path : null };
}

export function closeAllTabs(tabs: TabsState): TabsState {
    return tabs.items.length === 0 ? tabs : EMPTY_TABS;
}

function isSameOrInside(path: TabPath, root: TabPath): boolean {
    return path === root || PATH_SEPARATORS.some((separator) => path.startsWith(root + separator));
}

function movedPath(path: TabPath, from: TabPath, to: TabPath): TabPath {
    return isSameOrInside(path, from) ? to + path.slice(from.length) : path;
}

/**
 * Folgt einer umbenannten oder verschobenen Datei bzw. einem Ordner: Position, Vorschau-Status und aktiver Tab
 * bleiben erhalten.
 */
export function relocateTabs(tabs: TabsState, from: TabPath, to: TabPath): RelocateResult {
    const mapping = new Map<TabPath, TabPath>();
    for (const item of tabs.items) {
        const moved = movedPath(item, from, to);
        if (moved !== item) mapping.set(item, moved);
    }
    if (mapping.size === 0) return { tabs, mapping };
    const move = (path: TabPath | null): TabPath | null => (path === null ? null : (mapping.get(path) ?? path));
    const items = tabs.items.map((item) => mapping.get(item) ?? item);
    return { tabs: { items, preview: move(tabs.preview), active: move(tabs.active) }, mapping };
}

/** Alle Tabs, deren Datei `path` selbst ist oder darunter (Ordner) liegt. */
export function tabsUnder(tabs: TabsState, path: TabPath): TabPath[] {
    return tabs.items.filter((item) => isSameOrInside(item, path));
}

/** Verschiebt `path` an die Position von `target`; der aktive Tab bleibt. */
export function moveTab(tabs: TabsState, path: TabPath, target: TabPath): TabsState {
    const from = tabs.items.indexOf(path);
    const to = tabs.items.indexOf(target);
    if (path === target || from < 0 || to < 0) return tabs;
    const items = tabs.items.filter((item) => item !== path);
    items.splice(to, 0, path);
    return { ...tabs, items };
}
