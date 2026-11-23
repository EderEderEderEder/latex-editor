// S10, Prüfung 8: Speicher und CPU des Überwachers bei 5.000 Dateien im Baum.
// Der Überwacher läuft in einem eigenen Kindprozess (eigene PID, wird am Ende per Handle beendet),
// damit die Werte nicht mit dem Schreiber vermischt werden.
// Aufruf aus web/: node spikes/watch/dauerbetrieb.mts [Leerlauf-Sekunden]
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDebouncer, isBuildNoise, makeTestDirectory, sleep, startWatcher } from './lib.mts';

const DIRECTORY_COUNT = 50;
const FILES_PER_DIRECTORY = 100;
const STORM_ROUNDS = 4;
const DEFAULT_IDLE_SECONDS = 15;
const BYTES_PER_MB = 1024 * 1024;
const MICROSECONDS_PER_MS = 1000;

interface ChildStats {
    rssMB: number;
    cpuMs: number;
    events: number;
    names: number;
    flushes: number;
}

async function runChild(directory: string): Promise<void> {
    let events = 0;
    let flushes = 0;
    const names = new Set<string>();
    const debouncer = createDebouncer(() => {
        flushes++;
    });
    const watcher = await startWatcher(directory, (event) => {
        events++;
        names.add(event.name);
        watcher.events.length = 0;
        if (!isBuildNoise(event.name)) {
            debouncer.push(event.name);
        }
    });
    process.on('message', (message) => {
        if (message !== 'stats') {
            return;
        }
        const usage = process.cpuUsage();
        const stats: ChildStats = {
            rssMB: process.memoryUsage().rss / BYTES_PER_MB,
            cpuMs: (usage.user + usage.system) / MICROSECONDS_PER_MS,
            events,
            names: names.size,
            flushes,
        };
        process.send?.(stats);
    });
    process.send?.('ready');
}

function askStats(child: ChildProcess): Promise<ChildStats> {
    return new Promise((resolve) => {
        child.once('message', (message) => resolve(message as ChildStats));
        child.send('stats');
    });
}

async function createTree(root: string): Promise<void> {
    for (let d = 0; d < DIRECTORY_COUNT; d++) {
        await mkdir(join(root, `kapitel-${d}`), { recursive: true });
        for (let f = 0; f < FILES_PER_DIRECTORY; f++) {
            await writeFile(join(root, `kapitel-${d}`, `datei-${f}.tex`), `inhalt ${d} ${f}`);
        }
    }
}

async function touchAll(root: string): Promise<number> {
    const startedAt = performance.now();
    const now = new Date();
    for (let d = 0; d < DIRECTORY_COUNT; d++) {
        for (let f = 0; f < FILES_PER_DIRECTORY; f++) {
            await utimes(join(root, `kapitel-${d}`, `datei-${f}.tex`), now, now);
        }
    }
    return performance.now() - startedAt;
}

const format = (label: string, stats: ChildStats, previous?: ChildStats): string => {
    const cpu = previous ? stats.cpuMs - previous.cpuMs : stats.cpuMs;
    return `- ${label}: RSS ${stats.rssMB.toFixed(0)} MB, CPU ${cpu.toFixed(0)} ms (Zuwachs), Ereignisse ${stats.events}, Namen ${stats.names}, Stapel ${stats.flushes}`;
};

async function runParent(): Promise<void> {
    const idleSeconds = Number(process.argv[2] ?? DEFAULT_IDLE_SECONDS);
    const root = await makeTestDirectory('dauer');
    await createTree(root);
    console.log(`Node ${process.version}, ${DIRECTORY_COUNT * FILES_PER_DIRECTORY} Dateien in ${DIRECTORY_COUNT} Ordnern`);
    const child = fork(fileURLToPath(import.meta.url), ['--child', root]);
    await new Promise<void>((resolve) => child.once('message', () => resolve()));
    let last = await askStats(child);
    console.log(format('nach Start des Überwachers', last));
    await sleep(idleSeconds * 1000);
    let now = await askStats(child);
    console.log(format(`Leerlauf ${idleSeconds} s`, now, last));
    last = now;
    for (let round = 1; round <= STORM_ROUNDS; round++) {
        const writeMs = await touchAll(root);
        await sleep(1000);
        now = await askStats(child);
        console.log(format(`Runde ${round}: 5.000 Dateien angefasst in ${writeMs.toFixed(0)} ms`, now, last));
        last = now;
    }
    await sleep(idleSeconds * 1000 / 3);
    now = await askStats(child);
    console.log(format('Leerlauf danach', now, last));
    child.kill();
    await rm(root, { recursive: true, force: true });
}

if (process.argv[2] === '--child') {
    await runChild(process.argv[3] ?? '.');
} else {
    await runParent();
}
