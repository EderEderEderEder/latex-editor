// Vervollständigungs-Index mit den App-Singletons (W4-6): Projekt-Store (Wurzel, Baum), Editor-Store (offene Tabs,
// Text aus den Sitzungen), `fs:changed` und `fs:readMany` über die Preload-API. `startCompletionIndex` (beim Aufbau
// des Befehlsregisters) meldet den Index bei der Editor-Anbindung an (`connectCompletionIndex`; so importiert
// `editor/completion.ts` keine Stores, sonst entstünde ein Importkreis über `session.ts`) und gibt den Worker beim
// Beenden der Seite frei. Ohne DOM-Typen (Zugriff über `globalThis`).
import type { DirectoryNode, RendererApi, Unsubscribe } from '../../shared/contract';
import { unwrap } from '../../shared/ipcResult';
import { connectCompletionIndex } from '../editor/completion';
import { editorStore } from '../stores/editor';
import { projectStore, type ProjectView } from '../stores/project';
import { CompletionIndexClient, type OpenDocument } from './completionIndex';
import type { ProjectFiles } from './completionIndexLogic';

const UNLOAD_EVENT = 'pagehide';

interface PageEvents {
    addEventListener?(type: string, listener: () => void): void;
    removeEventListener?(type: string, listener: () => void): void;
}

let client: CompletionIndexClient | null = null;
let stops: Unsubscribe[] = [];

function rendererApi(): RendererApi | undefined {
    return (globalThis as unknown as { api?: RendererApi }).api;
}

function collectFiles(node: DirectoryNode, files: string[]): void {
    for (const child of node.children) {
        if (child.kind === 'directory') collectFiles(child, files);
        else if (child.isBuildFile !== true) files.push(child.path);
    }
}

/** Dateien des Baums ohne Build-Ausgaben, in Baumreihenfolge */
export function projectFilesOf(project: ProjectView | null): ProjectFiles | null {
    if (project === null) return null;
    const files: string[] = [];
    collectFiles(project.tree, files);
    return { root: project.root, mainFile: project.mainFile, files };
}

function openDocumentsOfStore(): ReadonlyMap<string, OpenDocument> {
    const state = editorStore.getState();
    const documents = new Map<string, OpenDocument>();
    for (const [path, info] of Object.entries(state.files)) {
        const session = state.session(path);
        if (session === undefined || session.isDisposed) continue;
        documents.set(path, { name: info.title, doc: session.state.doc });
    }
    return documents;
}

function connect(index: CompletionIndexClient, api: RendererApi): void {
    index.setProject(projectFilesOf(projectStore.getState().current));
    index.noteOpenDocumentsChanged();
    stops = [
        projectStore.subscribe((state, previous) => {
            if (state.current !== previous.current) index.setProject(projectFilesOf(state.current));
        }),
        editorStore.subscribe((state, previous) => {
            if (state.files !== previous.files) index.noteOpenDocumentsChanged();
        }),
        api.events.on('fs:changed', (event) => index.handleFsChanged(event)),
    ];
    const page = globalThis as unknown as PageEvents;
    page.addEventListener?.(UNLOAD_EVENT, stopCompletionIndex);
    stops.push(() => page.removeEventListener?.(UNLOAD_EVENT, stopCompletionIndex));
}

/** Startet den Index einmal (ohne Preload-API bleibt er aus); der Worker entsteht erst mit der ersten Anfrage */
export function startCompletionIndex(): void {
    const api = rendererApi();
    if (client !== null || api === undefined) return;
    const index = new CompletionIndexClient({
        readMany: async (paths) => unwrap(await api.fs.readMany(paths)),
        openDocuments: openDocumentsOfStore,
    });
    client = index;
    connectCompletionIndex({ index: () => index.index, documentsEdited: () => index.noteDocumentsEdited() });
    connect(index, api);
}

/** Gibt Abonnements und Worker frei (Beenden) */
export function stopCompletionIndex(): void {
    for (const stop of stops) stop();
    stops = [];
    client?.dispose();
    client = null;
    connectCompletionIndex(null);
}
