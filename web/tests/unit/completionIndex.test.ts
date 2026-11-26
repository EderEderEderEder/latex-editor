import { describe, expect, it } from 'vitest';
import type { ReadManyItem, TextFile } from '../../src/shared/contract';
import {
    COMPLETION_INDEX_DEBOUNCE_MS,
    CompletionIndexClient,
    type CompletionWorkerLike,
    type IndexTimer,
    type OpenDocument,
} from '../../src/renderer/app/completionIndex';
import {
    CompletionIndexBuilder,
    handleCompletionIndexRequest,
    type CompletionIndexResponse,
    type CompletionIndexSnapshot,
    type CompletionIndexUpdate,
    type ProjectFiles,
} from '../../src/renderer/app/completionIndexLogic';

const ROOT = '/p';
const MAIN = `${ROOT}/main.tex`;
const CHAPTER = `${ROOT}/kapitel.tex`;
const BIB = `${ROOT}/lit.bib`;
const PROJECT: ProjectFiles = { root: ROOT, mainFile: MAIN, files: [MAIN, CHAPTER, BIB, `${ROOT}/bild.png`] };

class FakeTimer implements IndexTimer {
    private nextHandle = 1;
    private readonly scheduled = new Map<number, { at: number; callback: () => void }>();
    now = 0;

    set(callback: () => void, delayMs: number): unknown {
        const handle = this.nextHandle++;
        this.scheduled.set(handle, { at: this.now + delayMs, callback });
        return handle;
    }

    clear(handle: unknown): void {
        this.scheduled.delete(handle as number);
    }

    get pending(): number {
        return this.scheduled.size;
    }

    advance(ms: number): void {
        this.now += ms;
        for (const [handle, entry] of [...this.scheduled]) {
            if (entry.at > this.now) continue;
            this.scheduled.delete(handle);
            entry.callback();
        }
    }
}

/** Fake-Worker: merkt sich Anfragen; `reply` beantwortet sie mit der echten Index-Logik */
class FakeWorker implements CompletionWorkerLike {
    readonly posted: CompletionIndexUpdate[] = [];
    readonly builder = new CompletionIndexBuilder();
    terminated = false;
    onmessage: CompletionWorkerLike['onmessage'] = null;
    onerror: CompletionWorkerLike['onerror'] = null;
    onmessageerror: CompletionWorkerLike['onmessageerror'] = null;

    postMessage(request: CompletionIndexUpdate): void {
        this.posted.push(request);
    }

    terminate(): void {
        this.terminated = true;
    }

    respond(request: CompletionIndexUpdate): CompletionIndexResponse {
        const response = handleCompletionIndexRequest(this.builder, request);
        this.onmessage?.({ data: response });
        return response;
    }

    replyAll(): void {
        for (const request of this.posted.splice(0)) this.respond(request);
    }
}

function textFile(path: string, text: string, hash = `h-${text.length}`): TextFile {
    return { path, name: path.split('/').at(-1) ?? path, text, encoding: 'utf8', eol: 'lf', hash, mtime: 1 };
}

const flushPromises = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function setup() {
    const disk = new Map<string, TextFile>([
        [MAIN, textFile(MAIN, '\\label{sec:main}\n')],
        [CHAPTER, textFile(CHAPTER, '\\label{fig:kapitel}\n')],
        [BIB, textFile(BIB, '@book{knuth1984, title={TeX}}\n')],
    ]);
    const reads: string[][] = [];
    const open = new Map<string, OpenDocument>();
    const timer = new FakeTimer();
    const workers: FakeWorker[] = [];
    const published: CompletionIndexSnapshot[] = [];
    const readMany = (paths: string[]): Promise<ReadManyItem[]> => {
        reads.push([...paths]);
        return Promise.resolve(paths.map((path) => {
            const file = disk.get(path);
            const result = file === undefined
                ? { ok: false as const, error: { kind: 'notFound' as const, message: 'weg' } }
                : { ok: true as const, value: file };
            return { path, name: path, result };
        }));
    };
    const client = new CompletionIndexClient({
        readMany,
        openDocuments: () => open,
        timer,
        createWorker: () => {
            const worker = new FakeWorker();
            workers.push(worker);
            return worker;
        },
        onIndexChanged: (index) => published.push(index),
    });
    return { client, disk, reads, open, timer, workers, published };
}

type Setup = ReturnType<typeof setup>;

async function openProject(context: Setup): Promise<FakeWorker> {
    context.client.setProject(PROJECT);
    context.timer.advance(0);
    await flushPromises();
    const worker = context.workers[0];
    if (worker === undefined) throw new Error('kein Worker');
    worker.replyAll();
    return worker;
}

const labelsOf = (client: CompletionIndexClient): string[] => client.index.labels.map((entry) => entry.label);

describe('Client des Vervollständigungs-Index', () => {
    it('liest beim Öffnen des Projekts alle Quelldateien (ohne Bilder) und übernimmt den Index', async () => {
        const context = setup();
        await openProject(context);
        expect(context.reads).toEqual([[MAIN, CHAPTER, BIB]]);
        expect(labelsOf(context.client)).toEqual(['fig:kapitel', 'sec:main']);
        expect(context.client.index.citations.map((entry) => entry.key)).toEqual(['knuth1984']);
        expect(context.published).toHaveLength(1);
    });

    it('liest bei `fs:changed` nur die betroffene Datei und schickt sie nur bei neuem Hash', async () => {
        const context = setup();
        const worker = await openProject(context);
        context.client.handleFsChanged({ paths: [CHAPTER, `${ROOT}/bild.png`], kinds: ['changed', 'changed'], treeChanged: false, gitChanged: false });
        context.timer.advance(COMPLETION_INDEX_DEBOUNCE_MS);
        await flushPromises();
        expect(context.reads.at(-1)).toEqual([CHAPTER]);
        expect(worker.posted).toEqual([]);

        context.disk.set(CHAPTER, textFile(CHAPTER, '\\label{fig:neu}\n', 'neu'));
        context.client.handleFsChanged({ paths: [CHAPTER], kinds: ['changed'], treeChanged: false, gitChanged: false });
        context.timer.advance(COMPLETION_INDEX_DEBOUNCE_MS);
        await flushPromises();
        expect(worker.posted.map((update) => update.changed.map((file) => file.path))).toEqual([[CHAPTER]]);
        worker.replyAll();
        expect(labelsOf(context.client)).toEqual(['fig:neu', 'sec:main']);
    });

    it('nimmt für offene Tabs den Editortext (entprellt), nach dem Schließen wieder die Platte', async () => {
        const context = setup();
        const worker = await openProject(context);
        context.open.set(MAIN, { name: 'main.tex', doc: { toString: () => '\\label{sec:ungespeichert}\n' } });
        context.client.noteOpenDocumentsChanged();
        context.client.noteDocumentsEdited();
        context.timer.advance(COMPLETION_INDEX_DEBOUNCE_MS - 1);
        expect(worker.posted).toEqual([]);
        context.timer.advance(1);
        await flushPromises();
        worker.replyAll();
        expect(labelsOf(context.client)).toEqual(['fig:kapitel', 'sec:ungespeichert']);

        context.client.noteDocumentsEdited();
        context.timer.advance(COMPLETION_INDEX_DEBOUNCE_MS);
        await flushPromises();
        expect(worker.posted).toEqual([]);

        context.open.clear();
        context.client.noteOpenDocumentsChanged();
        context.timer.advance(COMPLETION_INDEX_DEBOUNCE_MS);
        await flushPromises();
        worker.replyAll();
        expect(labelsOf(context.client)).toEqual(['fig:kapitel', 'sec:main']);
    });

    it('verwirft Antworten mit veralteter Version, behält aber deren Index, wenn die neue „unverändert“ meldet', async () => {
        const context = setup();
        const worker = await openProject(context);
        context.disk.set(CHAPTER, textFile(CHAPTER, '\\label{fig:zwei}\n', 'zwei'));
        context.client.handleFsChanged({ paths: [CHAPTER], kinds: ['changed'], treeChanged: false, gitChanged: false });
        context.timer.advance(COMPLETION_INDEX_DEBOUNCE_MS);
        await flushPromises();
        context.disk.set(BIB, textFile(BIB, '@book{knuth1984, title={TeX}}\n', 'gleich-anders'));
        context.client.handleFsChanged({ paths: [BIB], kinds: ['changed'], treeChanged: false, gitChanged: false });
        context.timer.advance(COMPLETION_INDEX_DEBOUNCE_MS);
        await flushPromises();
        const [older, newer] = worker.posted.splice(0);
        if (older === undefined || newer === undefined) throw new Error('zwei Anfragen erwartet');
        worker.respond(older);
        expect(labelsOf(context.client)).toEqual(['fig:kapitel', 'sec:main']);
        expect(worker.respond(newer)).toMatchObject({ kind: 'index', index: null });
        expect(labelsOf(context.client)).toEqual(['fig:zwei', 'sec:main']);
    });

    it('setzt beim Projektwechsel zurück und verwirft Lesungen des alten Projekts', async () => {
        const context = setup();
        const worker = await openProject(context);
        context.client.setProject({ root: '/q', mainFile: null, files: [] });
        expect(context.client.index.labels).toEqual([]);
        context.timer.advance(0);
        await flushPromises();
        expect(worker.posted).toMatchObject([{ reset: true, project: { root: '/q' }, changed: [] }]);
        worker.replyAll();
        expect(context.client.index.labels).toEqual([]);
    });

    it('liest nach einem neuen Baum nur neue Dateien und meldet entfernte', async () => {
        const context = setup();
        const worker = await openProject(context);
        const extra = `${ROOT}/neu.tex`;
        context.disk.set(extra, textFile(extra, '\\label{sec:neu}\n'));
        context.client.setProject({ ...PROJECT, files: [MAIN, BIB, extra] });
        context.timer.advance(COMPLETION_INDEX_DEBOUNCE_MS);
        await flushPromises();
        expect(context.reads.at(-1)).toEqual([extra]);
        expect(worker.posted[0]?.removed).toEqual([CHAPTER]);
        worker.replyAll();
        expect(labelsOf(context.client)).toEqual(['sec:main', 'sec:neu']);
        expect(context.client.index.inputPaths).toEqual(['neu']);
    });

    it('gibt beim Beenden Zeitgeber und Worker frei', async () => {
        const context = setup();
        const worker = await openProject(context);
        context.client.noteDocumentsEdited();
        context.client.dispose();
        expect(worker.terminated).toBe(true);
        expect(context.timer.pending).toBe(0);
        context.client.noteDocumentsEdited();
        expect(context.timer.pending).toBe(0);
    });

    it('startet nach einem Worker-Absturz einen neuen Worker erst mit der nächsten Änderung und schickt dann alles', async () => {
        const context = setup();
        const worker = await openProject(context);
        worker.onerror?.({});
        expect(worker.terminated).toBe(true);
        expect(context.timer.pending).toBe(0);
        context.client.noteDocumentsEdited();
        context.timer.advance(COMPLETION_INDEX_DEBOUNCE_MS);
        await flushPromises();
        const second = context.workers[1];
        expect(second?.posted[0]).toMatchObject({ reset: true, project: { root: ROOT } });
        expect(second?.posted[0]?.changed.map((file) => file.path).sort()).toEqual([CHAPTER, BIB, MAIN]);
    });
});
