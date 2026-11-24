// Tab schließen (W2-4): ein ungespeicherter Tab fragt nach (Speichern / Nicht speichern / Abbrechen), Vorbild Swift
// `closeTab`. Reine Logik gegen Store und `fileActions`; die Frage zeigt `ui/TabCloseDialog.tsx` über `tabClosePrompt`.
import type { EditorStore } from '../stores/editor';
import { saveFile } from './fileActions';
import type { FileActionDeps } from './fileActions';

export type TabCloseChoice = 'save' | 'discard' | 'cancel';
/** closed: Tab ist zu (oder war schon zu); kept: Tab bleibt offen */
export type TabCloseOutcome = 'closed' | 'kept';

export interface TabCloseDeps extends FileActionDeps {
    /** Zeigt die Nachfrage mit dem Namen der Datei */
    readonly ask: (name: string) => Promise<TabCloseChoice>;
}

export const TAB_CLOSE_TEXTS = {
    title: 'Ungespeicherte Änderungen',
    question: (name: string) => `„${name}“ hat ungespeicherte Änderungen. Vor dem Schließen speichern?`,
    save: 'Speichern',
    discard: 'Nicht speichern',
    cancel: 'Abbrechen',
} as const;

// Je Store die Tabs mit offener Nachfrage: ein zweiter Schließen-Klick auf denselben Tab fragt nicht doppelt.
const askingTabs = new WeakMap<EditorStore, Set<string>>();

function askingSet(store: EditorStore): Set<string> {
    const existing = askingTabs.get(store);
    if (existing !== undefined) return existing;
    const created = new Set<string>();
    askingTabs.set(store, created);
    return created;
}

function isOpen(store: EditorStore, path: string): boolean {
    return store.getState().tabs.items.includes(path);
}

function isDirty(store: EditorStore, path: string): boolean {
    return store.getState().files[path]?.isDirty === true;
}

async function chooseAndSave(deps: TabCloseDeps, path: string): Promise<TabCloseChoice> {
    const name = deps.store.getState().files[path]?.title ?? path;
    const choice = await deps.ask(name);
    if (choice !== 'save') return choice;
    const outcome = await saveFile(deps, path);
    // Fehler und Konflikt hat `saveFile` schon gemeldet; wer während des Schreibens weitertippt, behält den Tab.
    const saved = outcome === 'saved' || outcome === 'unchanged';
    return saved && !isDirty(deps.store, path) ? 'save' : 'cancel';
}

export async function closeTabWithPrompt(deps: TabCloseDeps, path: string): Promise<TabCloseOutcome> {
    const { store } = deps;
    if (!isOpen(store, path)) return 'closed';
    if (!isDirty(store, path)) {
        store.getState().close(path);
        return 'closed';
    }
    const asking = askingSet(store);
    if (asking.has(path)) return 'kept';
    asking.add(path);
    try {
        if ((await chooseAndSave(deps, path)) === 'cancel') return 'kept';
    } finally {
        asking.delete(path);
    }
    store.getState().close(path);
    return 'closed';
}

/** Befehl für Strg+W (kommt mit dem Menü, W2-16) */
export function closeActiveTabWithPrompt(deps: TabCloseDeps): Promise<TabCloseOutcome> {
    const active = deps.store.getState().tabs.active;
    return active === null ? Promise.resolve('closed') : closeTabWithPrompt(deps, active);
}
