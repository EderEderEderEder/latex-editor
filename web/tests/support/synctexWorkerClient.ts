import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'vite';
import {
    SYNCTEX_WORKER_DATA,
    type SyncTeXWorkerRequest,
    type SyncTeXWorkerResponse,
} from '../../src/main/workers/synctex.worker';

// Hilfen für Tests mit einem echten worker_threads-Worker. Gebündelt wird mit Vites `build`-API nach
// $TMPDIR (CommonJS für Node). Das ist nicht der Produkt-Build: einen eigenen Einstieg in
// `electron.vite.config.ts` bekommt der Worker erst mit W3-2.

const WORKER_SOURCE = fileURLToPath(new URL('../../src/main/workers/synctex.worker.ts', import.meta.url));
const WORKER_FILE_NAME = 'synctex.worker.cjs';

export type RequestBody = SyncTeXWorkerRequest extends infer Request
    ? Request extends { id: number } ? Omit<Request, 'id'> : never
    : never;

export async function bundleSyncTeXWorker(outDir: string): Promise<string> {
    await build({
        configFile: false,
        logLevel: 'warn',
        build: {
            ssr: WORKER_SOURCE,
            outDir,
            emptyOutDir: false,
            minify: false,
            rollupOptions: { output: { format: 'cjs', entryFileNames: WORKER_FILE_NAME } },
        },
    });
    return join(outDir, WORKER_FILE_NAME);
}

type Pending = { resolve: (response: SyncTeXWorkerResponse) => void; reject: (error: Error) => void };

// Ordnet Antworten über die `id` zu. Stirbt der Worker (`error`, `exit`), schlagen alle offenen und
// späteren Anfragen fehl, statt ewig zu warten.
export class WorkerClient {
    private nextId = 1;
    private readonly pending = new Map<number, Pending>();
    private failure: Error | null = null;

    constructor(readonly worker: Worker) {
        worker.on('message', (response: SyncTeXWorkerResponse) => {
            this.pending.get(response.id)?.resolve(response);
            this.pending.delete(response.id);
        });
        worker.on('error', (error: Error) => this.failAll(new Error(`SyncTeX-Worker abgestürzt: ${error.message}`)));
        worker.on('exit', (code) => this.failAll(new Error(`SyncTeX-Worker beendet (Code ${code})`)));
    }

    request(body: RequestBody): Promise<SyncTeXWorkerResponse> {
        if (this.failure !== null) return Promise.reject(this.failure);
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.worker.postMessage({ ...body, id });
        });
    }

    private failAll(error: Error): void {
        this.failure ??= error;
        for (const entry of this.pending.values()) entry.reject(error);
        this.pending.clear();
    }
}

export async function withWorker<T>(script: string, action: (client: WorkerClient) => Promise<T>): Promise<T> {
    const worker = new Worker(script, { workerData: SYNCTEX_WORKER_DATA });
    try {
        return await action(new WorkerClient(worker));
    } finally {
        await worker.terminate();
    }
}
