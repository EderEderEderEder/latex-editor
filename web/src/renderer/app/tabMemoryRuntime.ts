// Das Tab-Gedächtnis des geöffneten Projekts (ein Controller je App-Lauf). Wer ein Projekt öffnet, ruft nach
// `project:open` `tabMemoryRuntime.start(root)`; vor dem Schließen oder Wechseln des Projekts (noch bevor die Tabs
// geschlossen werden) `await tabMemoryRuntime.stop()`. Beim Schließen des Fensters schreibt `closeFlow` per `flush`.
import type { AbsolutePath } from '../../shared/contract';
import { getApi } from '../ipc/api';
import { editorStore } from '../stores/editor';
import { statusStore } from '../stores/status';
import { scrollMemory } from './scrollMemory';
import { TabMemoryController } from './tabMemory';
import type { RestoreResult, TabMemoryDeps } from './tabMemory';

export class TabMemoryRuntime {
    private controller: TabMemoryController | null = null;

    constructor(private readonly createController: (root: AbsolutePath) => TabMemoryController) {}

    /** Beendet das Gedächtnis eines früheren Projekts, stellt das des neuen her und folgt danach den Tabs */
    async start(root: AbsolutePath): Promise<RestoreResult> {
        await this.stop();
        const controller = this.createController(root);
        this.controller = controller;
        return controller.restore();
    }

    async stop(): Promise<void> {
        const controller = this.controller;
        this.controller = null;
        await controller?.stop();
    }

    async flush(): Promise<void> {
        await this.controller?.flush();
    }
}

function appDeps(root: AbsolutePath): TabMemoryDeps {
    return {
        api: getApi(),
        store: editorStore,
        root,
        scroll: scrollMemory,
        report: (message) => statusStore.getState().show(message),
    };
}

export const tabMemoryRuntime = new TabMemoryRuntime((root) => new TabMemoryController(appDeps(root)));

// ---------- Testzugang (nur E2E-Build, wie `__editorTestApi`; bis das Projekt in der Oberfläche öffnet) ----------

export interface TabMemoryTestApi {
    start(root: AbsolutePath): Promise<RestoreResult>;
    stop(): Promise<void>;
    flush(): Promise<void>;
}

declare global {
    // Wie in `editor/EditorHost.tsx` (gleiche Form); hier nochmals, weil Tests dieses Modul ohne den Host laden.
    interface ImportMetaEnv {
        readonly RENDERER_VITE_EDITOR_TEST_API?: string;
    }
    interface ImportMeta {
        readonly env: ImportMetaEnv;
    }
    interface Window {
        __tabMemoryTestApi?: TabMemoryTestApi;
    }
}

const TEST_API_ENABLED = '1';

export function installTabMemoryTestApi(): () => void {
    if (import.meta.env.RENDERER_VITE_EDITOR_TEST_API !== TEST_API_ENABLED) return () => undefined;
    window.__tabMemoryTestApi = {
        start: (root) => tabMemoryRuntime.start(root),
        stop: () => tabMemoryRuntime.stop(),
        flush: () => tabMemoryRuntime.flush(),
    };
    return () => {
        delete window.__tabMemoryTestApi;
    };
}
