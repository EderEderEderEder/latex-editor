import { watch } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeTextFile } from '../../src/main/textIo';
import { DEBOUNCE_QUIET_MS, type FsChangedBatch, ProjectWatcher } from '../../src/main/watch';

// Dateiüberwachung mit ECHTEM `fs.watch` in einem Temp-Ordner (langsam, nicht in `--fast`). In der Claude-Sandbox
// scheitert jedes `fs.watch` mit EMFILE (FSEvents gesperrt): dann überspringt sich die Gruppe mit Hinweis.

// FSEvents startet asynchron; vorher Geschriebenes kann noch nachgeliefert werden.
const WATCHER_WARMUP_MS = 400;
const PROBE_WAIT_MS = 100;
// Nach dem ersten Stapel so lange auf weitere warten (Ereignisse wandern ins Nachbarfenster).
const AFTER_BATCH_QUIET_MS = DEBOUNCE_QUIET_MS + 500;
const BATCH_TIMEOUT_MS = 5_000;
const TEST_TIMEOUT_MS = 15_000;
const UNAVAILABLE_CODE = 'EMFILE';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function errorCode(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
}

// `null` = Überwachung verfügbar, sonst der Fehlercode.
async function probeWatch(): Promise<string | null> {
    const probeDir = await mkdtemp(join(tmpdir(), 'watch-probe-'));
    try {
        const handle = watch(probeDir, { recursive: true });
        const failure = await new Promise<unknown>((resolve) => {
            handle.once('error', resolve);
            setTimeout(() => resolve(null), PROBE_WAIT_MS);
        });
        handle.close();
        return failure === null ? null : (errorCode(failure) ?? 'unbekannt');
    } catch (error) {
        return errorCode(error) ?? 'unbekannt';
    } finally {
        await rm(probeDir, { recursive: true, force: true });
    }
}

const probeResult = await probeWatch();
const unavailable = probeResult === UNAVAILABLE_CODE;
if (unavailable) {
    console.warn(`[watchReal] übersprungen: fs.watch scheitert mit ${UNAVAILABLE_CODE} (Claude-Sandbox?); außerhalb der Sandbox ausführen`);
}

let dir: string;
let watcher: ProjectWatcher;
let batches: FsChangedBatch[];
let errors: Error[];
let notify: (() => void) | null;

beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), 'watch-real-')));
    await writeFile(join(dir, 'main.tex'), '\\documentclass{article}\n');
    await writeFile(join(dir, 'kapitel.tex'), 'Kapitel\n');
    batches = [];
    errors = [];
    notify = null;
    watcher = new ProjectWatcher({ onError: (error) => errors.push(error) });
    await watcher.start(dir, (batch) => {
        batches.push(batch);
        notify?.();
    });
    await sleep(WATCHER_WARMUP_MS);
    await watcher.whenIdle();
    batches.length = 0;
});

afterEach(async () => {
    watcher.stop();
    await rm(dir, { recursive: true, force: true });
});

// Wartet auf den ersten Stapel und danach eine Ruhezeit; liefert alle Stapel dieses Zeitraums.
async function collectBatches(): Promise<FsChangedBatch[]> {
    if (batches.length === 0) {
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('kein Stapel innerhalb der Frist')), BATCH_TIMEOUT_MS);
            notify = () => {
                clearTimeout(timer);
                resolve();
            };
        });
    }
    await sleep(AFTER_BATCH_QUIET_MS);
    await watcher.whenIdle();
    return [...batches];
}

function summary(batch: FsChangedBatch | undefined): string[] {
    if (batch === undefined) return [];
    return batch.paths.map((path, index) => `${batch.kinds[index]}:${path.slice(dir.length + 1).split('\\').join('/')}`);
}

describe.skipIf(unavailable)('Dateiüberwachung mit echtem fs.watch', () => {
    it('direktes Speichern: genau ein Stapel', { timeout: TEST_TIMEOUT_MS }, async () => {
        await writeFile(join(dir, 'main.tex'), '\\documentclass{book}\n');
        const result = await collectBatches();
        expect(result.map(summary)).toEqual([['changed:main.tex']]);
        expect(result[0]?.treeChanged).toBe(false);
        expect(errors).toEqual([]);
    });

    it('atomares Speichern der App (Temp + rename): genau ein Stapel, Temp-Datei unsichtbar', { timeout: TEST_TIMEOUT_MS }, async () => {
        await writeTextFile(join(dir, 'kapitel.tex'), 'Neuer Stand\n', 'utf8', 'lf');
        const result = await collectBatches();
        expect(result.map(summary)).toEqual([['changed:kapitel.tex']]);
        expect(result[0]?.treeChanged).toBe(false);
    });

    it('eigenes Speichern mit ignoreOwnWrite: kein Stapel', { timeout: TEST_TIMEOUT_MS }, async () => {
        const written = await writeTextFile(join(dir, 'main.tex'), 'eigener Stand\n', 'utf8', 'lf');
        watcher.ignoreOwnWrite(join(dir, 'main.tex'), written.hash);
        await sleep(AFTER_BATCH_QUIET_MS + WATCHER_WARMUP_MS);
        await watcher.whenIdle();
        expect(batches).toEqual([]);
    });

    it('neuer Ordner mit Datei: created und treeChanged', { timeout: TEST_TIMEOUT_MS }, async () => {
        await mkdir(join(dir, 'kapitel', 'tief'), { recursive: true });
        await writeFile(join(dir, 'kapitel', 'tief', 'a.tex'), 'a\n');
        const result = await collectBatches();
        expect(result.flatMap(summary)).toEqual(['created:kapitel/tief/a.tex']);
        expect(result.some((batch) => batch.treeChanged)).toBe(true);
    });

    it('Löschen: deleted und treeChanged; Hilfsdateien lösen nichts aus', { timeout: TEST_TIMEOUT_MS }, async () => {
        await writeFile(join(dir, 'main.aux'), 'aux');
        await writeFile(join(dir, 'main.log'), 'log');
        await rm(join(dir, 'kapitel.tex'));
        const result = await collectBatches();
        expect(result.map(summary)).toEqual([['deleted:kapitel.tex']]);
        expect(result[0]?.treeChanged).toBe(true);
    });
});
