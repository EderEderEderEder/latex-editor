// Nachfrage beim Schließen des Fensters (K1), Vorbild Swift `confirmUnsavedChanges`: Der Main hält das Schließen auf
// und schickt `app:closeRequested`; ohne Ungespeichertes wird sofort bestätigt, sonst gefragt (Speichern / Nicht
// speichern / Abbrechen). Erst `app:confirmClose` lässt den Main das Fenster zerstören. Ohne DOM, testbar mit dem Stub.
import type { RendererApi } from '../../shared/contract';
import type { EditorStore } from '../stores/editor';
import type { StatusMessage } from '../stores/status';
import { saveFile } from './fileActions';
import { tabMemoryRuntime } from './tabMemoryRuntime';
import type { FileActionDeps } from './fileActions';

export type CloseChoice = 'save' | 'discard' | 'cancel';
/** closed: bestätigt; kept: Fenster bleibt offen; busy: eine Nachfrage läuft schon */
export type CloseOutcome = 'closed' | 'kept' | 'busy';

export interface CloseFlowDeps {
    readonly api: Pick<RendererApi, 'app' | 'dialog' | 'fs'>;
    readonly store: EditorStore;
    readonly report: (message: StatusMessage) => void;
    /** Zeigt die Nachfrage mit den Namen der geänderten Dateien */
    readonly ask: (names: readonly string[]) => Promise<CloseChoice>;
    /** Läuft vor der Bestätigung (Standard: Tab-Gedächtnis des Projekts schreiben); Fehler halten das Schließen nicht auf */
    readonly beforeConfirm?: () => Promise<void>;
}

const NAME_SEPARATOR = ', ';
const DETAIL_SEPARATOR = ' ';

export const CLOSE_TEXTS = {
    title: 'Ungespeicherte Änderungen',
    changed: (names: readonly string[]) => `Geändert: ${names.join(NAME_SEPARATOR)}`,
    save: 'Speichern',
    discard: 'Nicht speichern',
    cancel: 'Abbrechen',
    keptOpen: (details: string) => `Das Fenster bleibt offen, nicht alles wurde gespeichert. ${details}`.trim(),
    confirmFailed: (detail: string) => `Schließen fehlgeschlagen: ${detail}`,
} as const;

/** Schlüssel der ungespeicherten Sitzungen in Tab-Reihenfolge */
export function dirtyPaths(store: EditorStore): string[] {
    const { tabs, files } = store.getState();
    return tabs.items.filter((path) => files[path]?.isDirty === true);
}

function namesOf(store: EditorStore, paths: readonly string[]): string[] {
    const { files } = store.getState();
    return paths.map((path) => files[path]?.title ?? path);
}

/** Speichert alle; Fehlermeldungen werden gesammelt und als eine Meldung gezeigt. `true`, wenn nichts offen blieb */
async function saveAll(deps: CloseFlowDeps, paths: readonly string[]): Promise<boolean> {
    const errors: string[] = [];
    const collecting: FileActionDeps = {
        api: deps.api,
        store: deps.store,
        report: (message) => {
            if (message.kind === 'error') errors.push(message.text);
        },
    };
    for (const path of paths) await saveFile(collecting, path);
    if (errors.length === 0 && dirtyPaths(deps.store).length === 0) return true;
    deps.report({ text: CLOSE_TEXTS.keptOpen(errors.join(DETAIL_SEPARATOR)), kind: 'error' });
    return false;
}

async function confirmClose(deps: CloseFlowDeps): Promise<CloseOutcome> {
    await (deps.beforeConfirm ?? (() => tabMemoryRuntime.flush()))().catch(() => undefined);
    const result = await deps.api.app.confirmClose();
    if (result.ok) return 'closed';
    deps.report({ text: CLOSE_TEXTS.confirmFailed(result.error.message), kind: 'error' });
    return 'kept';
}

async function runClose(deps: CloseFlowDeps): Promise<CloseOutcome> {
    const dirty = dirtyPaths(deps.store);
    if (dirty.length === 0) return confirmClose(deps);
    const choice = await deps.ask(namesOf(deps.store, dirty));
    if (choice === 'cancel') return 'kept';
    if (choice === 'save' && !(await saveAll(deps, dirty))) return 'kept';
    return confirmClose(deps);
}

/** Antwort auf `app:closeRequested`; eine zweite Anfrage während der Nachfrage wird übergangen */
export function createCloseHandler(deps: CloseFlowDeps): () => Promise<CloseOutcome> {
    let busy = false;
    return async () => {
        if (busy) return 'busy';
        busy = true;
        try {
            return await runClose(deps);
        } finally {
            busy = false;
        }
    };
}
