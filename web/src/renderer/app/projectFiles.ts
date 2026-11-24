// Projektdatei im Editor öffnen (Baum, Gliederung, Pfadzeile): Einzelklick als Vorschau-Tab, Doppelklick/Enter fest.
// Gelesen wird mit dem absoluten Projektpfad über `fs:readText`; Fehler landen als Meldung in der Statusleiste.
import type { RendererApi, TextFile } from '../../shared/contract';
import { isEditableTextFile } from '../../shared/core/fileTypes';
import type { EditorStore } from '../stores/editor';
import type { StatusMessage } from '../stores/status';

export interface ProjectFileDeps {
    readonly api: Pick<RendererApi, 'fs'>;
    readonly store: EditorStore;
    readonly report: (message: StatusMessage) => void;
}

export const PROJECT_FILE_TEXTS = {
    notEditable: (name: string) => `„${name}“ ist keine Textdatei und lässt sich hier nicht öffnen.`,
    openFailed: (name: string, detail: string) => `Öffnen von „${name}“ fehlgeschlagen: ${detail}`,
} as const;

interface OpenState {
    /** Laufende Lesevorgänge je Pfad: Klick und Doppelklick lesen die Datei nur einmal */
    readonly pending: Map<string, Promise<TextFile | null>>;
    latestPreviewRequest: number;
}

const states = new WeakMap<EditorStore, OpenState>();

function stateOf(store: EditorStore): OpenState {
    const existing = states.get(store);
    if (existing !== undefined) return existing;
    const created: OpenState = { pending: new Map(), latestPreviewRequest: 0 };
    states.set(store, created);
    return created;
}

function nameOfPath(path: string): string {
    return path.split(/[\\/]/).at(-1) ?? path;
}

async function readProjectFile(deps: ProjectFileDeps, path: string): Promise<TextFile | null> {
    try {
        const read = await deps.api.fs.readText(path);
        if (read.ok) return read.value;
        deps.report({ text: PROJECT_FILE_TEXTS.openFailed(nameOfPath(path), read.error.message), kind: 'error' });
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        deps.report({ text: PROJECT_FILE_TEXTS.openFailed(nameOfPath(path), detail), kind: 'error' });
    }
    return null;
}

function readOnce(deps: ProjectFileDeps, state: OpenState, path: string): Promise<TextFile | null> {
    const running = state.pending.get(path);
    if (running !== undefined) return running;
    const started = readProjectFile(deps, path).finally(() => state.pending.delete(path));
    state.pending.set(path, started);
    return started;
}

/** `true`, wenn die Datei danach im Editor offen ist */
export async function openProjectFile(deps: ProjectFileDeps, path: string, asPreview: boolean): Promise<boolean> {
    const store = deps.store.getState();
    const state = stateOf(deps.store);
    if (store.session(path) === undefined) {
        const name = nameOfPath(path);
        if (!isEditableTextFile(name)) {
            deps.report({ text: PROJECT_FILE_TEXTS.notEditable(name), kind: 'info' });
            return false;
        }
        const request = asPreview ? ++state.latestPreviewRequest : state.latestPreviewRequest;
        const file = await readOnce(deps, state, path);
        if (file === null) return false;
        // Ein neuerer Einzelklick auf eine andere Datei gewinnt; eine veraltete Vorschau öffnet nicht mehr
        if (asPreview && request !== state.latestPreviewRequest) return false;
        if (deps.store.getState().session(path) === undefined) deps.store.getState().open(file, { asPreview });
    }
    const current = deps.store.getState();
    current.activate(path);
    if (!asPreview) current.pin(path);
    return current.session(path) !== undefined;
}
