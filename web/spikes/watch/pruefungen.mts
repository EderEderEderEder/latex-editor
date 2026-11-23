// S10, Prüfungen 1 bis 7 und 9 (Git-Rückkopplung). Wegwerfcode, nur Node-Bordmittel.
// Aufruf aus web/: node spikes/watch/pruefungen.mts [1 2 3 4 5 6 7 9]   (ohne Argument: alle)
// Alle Testordner entstehen unter $TMPDIR und werden am Ende gelöscht.
import { execFile } from 'node:child_process';
import { appendFile, copyFile, mkdir, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { groupBy, isBuildNoise, makeTestDirectory, openSession, sleep, startWatcher, summarize } from './lib.mts';
import type { RawEvent } from './lib.mts';

const SAVE_COUNT = 10;
const SAVE_GAP_MS = 700;
const KILOBYTE = 1024;
const SOURCE_BYTES = 20 * KILOBYTE;
const BIG_BYTES = 5 * KILOBYTE * KILOBYTE;
const STORM_FILE_COUNT = 300;
const STORM_DURATION_MS = 2000;
const RELIABILITY_WRITES = 1000;
const GIT_BINARY = '/usr/local/bin/git';
const runCommand = promisify(execFile);

const text = (bytes: number, seed: string): string => `% ${seed}\n`.padEnd(bytes, 'x');
const show = (events: readonly RawEvent[]): string =>
    events.map((event) => `${event.type}:${JSON.stringify(event.name)}`).join(' ');
const codePoints = (value: string): string => [...value].map((char) => char.codePointAt(0)?.toString(16)).join(' ');

function log(line = ''): void {
    console.log(line);
}

/** Prüfung 1: Ereignisse je Speichern (direkt, atomar per Temp + rename, große Datei in Stücken). */
async function checkSaveStyles(): Promise<void> {
    log('## 1 Speichern: Ereignisse je Speichern');
    const directory = await makeTestDirectory('save');
    const target = join(directory, 'main.tex');
    await writeFile(target, text(SOURCE_BYTES, 'start'));
    const session = await openSession(directory);
    const variants: Record<string, (index: number) => Promise<void>> = {
        'direkt (writeFile, 20 KB)': async (i) => writeFile(target, text(SOURCE_BYTES, `d${i}`)),
        'atomar (Temp + rename)': async (i) => {
            await writeFile(`${target}.tmp`, text(SOURCE_BYTES, `a${i}`));
            await rename(`${target}.tmp`, target);
        },
        'atomar mit fsync-artigem Zweischritt (Temp, Zielordner-Temp, rename)': async (i) => {
            await mkdir(join(directory, '.sicher'), { recursive: true });
            await writeFile(join(directory, '.sicher', 'main.tex'), text(SOURCE_BYTES, `s${i}`));
            await rename(join(directory, '.sicher', 'main.tex'), target);
        },
        'direkt, 5 MB in 80 Stücken': async (i) => {
            await writeFile(target, '');
            for (let part = 0; part < 80; part++) {
                await appendFile(target, text(BIG_BYTES / 80, `g${i}-${part}`));
            }
        },
    };
    for (const [label, save] of Object.entries(variants)) {
        const rawCounts: number[] = [];
        const batchCountBefore = session.allBatches.length;
        for (let i = 0; i < SAVE_COUNT; i++) {
            session.watcher.events.length = 0;
            await save(i);
            await sleep(SAVE_GAP_MS);
            rawCounts.push(session.watcher.events.length);
        }
        const batches = session.allBatches.length - batchCountBefore;
        log(`- ${label}: Rohereignisse je Speichern ${summarize(rawCounts)} (Summe ${rawCounts.reduce((a, b) => a + b, 0)}; Verschiebung ins Nachbarfenster möglich); entprellte Stapel ${batches} bei ${SAVE_COUNT} Speichervorgängen`);
    }
    await session.finish();
    const perBatch = session.filteredBatches.map((batch) => batch.changes.map((c) => `${c.kind}:${c.path}`).join(','));
    log(`- Klassifizierte Stapel nach Filter: ${session.filteredBatches.length}; Beispiele: ${[...new Set(perBatch)].slice(0, 4).join(' | ')}`);
    await rm(directory, { recursive: true, force: true });
}

async function writeAuxiliaryFile(directory: string, name: string, keep: boolean): Promise<void> {
    await writeFile(join(directory, name), text(512, name));
    if (!keep) {
        await rm(join(directory, name));
    }
}

const AUX_EXTENSIONS = ['aux', 'log', 'toc', 'synctex.gz', 'fls', 'out', 'lof', 'fdb_latexmk', 'bbl', 'blg'];

/** Eine latexmk-ähnliche Phase: `count` Hilfsdateien in `durationMs`, ein Teil wird wieder gelöscht. */
async function runBuildPhase(directory: string, count: number, durationMs: number, withPdf = true): Promise<void> {
    const pause = durationMs / count;
    for (let i = 0; i < count; i++) {
        const extension = AUX_EXTENSIONS[i % AUX_EXTENSIONS.length] ?? 'aux';
        await writeAuxiliaryFile(directory, `kap${Math.floor(i / AUX_EXTENSIONS.length)}.${extension}`, i % 3 !== 0);
        await sleep(pause);
    }
    if (!withPdf) {
        return;
    }
    await writeFile(join(directory, 'main.pdf.tmp'), text(2048, 'pdf'));
    await rename(join(directory, 'main.pdf.tmp'), join(directory, 'main.pdf'));
}

/** Prüfung 2: Build-Sturm einmal am Stück (2 s) und einmal als drei Läufe mit Pausen (latexmk, bibtex, latex). */
async function checkBuildStorm(): Promise<void> {
    log('## 2 Build-Sturm (300 Hilfsdateien in 2 s, schreiben und teils löschen)');
    for (const scenario of ['am Stück', 'drei Läufe à 100 Dateien mit 500 ms Pause', 'drei Läufe ohne PDF (nur Hilfsdateien)']) {
        const directory = await makeTestDirectory('storm');
        await writeFile(join(directory, 'kapitel.tex'), text(SOURCE_BYTES, 'quelle'));
        const session = await openSession(directory);
        if (scenario === 'am Stück') {
            await runBuildPhase(directory, STORM_FILE_COUNT, STORM_DURATION_MS);
        } else {
            for (let run = 0; run < 3; run++) {
                await runBuildPhase(directory, STORM_FILE_COUNT / 3, STORM_DURATION_MS / 3, !scenario.includes('ohne PDF'));
                await sleep(500);
            }
        }
        await writeFile(join(directory, 'kapitel.tex'), text(SOURCE_BYTES, 'nach dem Build bearbeitet'));
        await session.finish();
        const raw = session.watcher.events.length;
        const names = new Set(session.watcher.events.map((event) => event.name));
        const kept = session.filteredBatches.map((batch) => `[+${batch.atMs.toFixed(0)} ms ${batch.changes.map((c) => `${c.kind}:${c.path}`).join(',')}]`);
        log(`- ${scenario}: Rohereignisse ${raw} (${names.size} verschiedene Namen), Stapel ohne Filter ${session.allBatches.length}, Stapel mit Filter ${session.filteredBatches.length}; übrig (Stapel): ${kept.join(' ')}`);
        await rm(directory, { recursive: true, force: true });
    }
}

/** Prüfung 3: neue Unterordner, Dateien darin, Ordner umbenennen und löschen. */
async function checkSubdirectories(): Promise<void> {
    log('## 3 Rekursion: neue/umbenannte/gelöschte Ordner');
    const directory = await makeTestDirectory('dirs');
    await writeFile(join(directory, 'main.tex'), 'x');
    const session = await openSession(directory);
    const step = async (label: string, action: () => Promise<void>): Promise<void> => {
        session.watcher.events.length = 0;
        await action();
        await sleep(SAVE_GAP_MS);
        log(`- ${label}: ${show(session.watcher.events)}`);
    };
    await step('mkdir neu + 3 Dateien sofort danach', async () => {
        await mkdir(join(directory, 'neu'));
        for (const name of ['a.tex', 'b.tex', 'c.tex']) {
            await writeFile(join(directory, 'neu', name), 'x');
        }
    });
    await step('mkdir -p tief/a/b + Datei darin', async () => {
        await mkdir(join(directory, 'tief', 'a', 'b'), { recursive: true });
        await writeFile(join(directory, 'tief', 'a', 'b', 'z.tex'), 'x');
    });
    await step('später: Datei in neu/ ändern (Kontrolle: Überwachung reicht in neue Ordner)', async () => {
        await writeFile(join(directory, 'neu', 'a.tex'), 'y');
    });
    await step('Ordner neu -> neu2 umbenennen', async () => rename(join(directory, 'neu'), join(directory, 'neu2')));
    await step('Datei in neu2/ ändern (nach Umbenennen)', async () => writeFile(join(directory, 'neu2', 'b.tex'), 'y'));
    await step('Ordner tief rekursiv löschen', async () => rm(join(directory, 'tief'), { recursive: true }));
    await step('Ordner neu2 mit 3 Dateien löschen', async () => rm(join(directory, 'neu2'), { recursive: true }));
    await session.finish();
    const summary = session.filteredBatches.map((b) => b.changes.map((c) => `${c.kind}:${c.path}`).join(','));
    log(`- Klassifizierung je entprelltem Stapel (mit known-Menge): ${summary.join(' || ')}`);
    log(`- known-Menge am Ende (soll nur main.tex enthalten, sonst veraltet): ${[...session.known].join(', ')}`);
    await rm(directory, { recursive: true, force: true });
}

/** Prüfung 4: Leerzeichen, Umlaute, NFC/NFD, Emoji, CJK. */
async function checkUnicodeNames(): Promise<void> {
    log('## 4 Namen: Leerzeichen, Umlaute, NFC/NFD, Emoji');
    const directory = await makeTestDirectory('names');
    const session = await openSession(directory);
    const names = ['Mein Kapitel.tex', 'Größe.tex'.normalize('NFC'), 'Ärger.tex'.normalize('NFD'), '日本語 Ü.tex', 'Bild 🙂.tex'];
    for (const name of names) {
        session.watcher.events.length = 0;
        await writeFile(join(directory, name), 'x');
        await sleep(SAVE_GAP_MS);
        const seen = session.watcher.events.map((event) => event.name);
        const forms = seen.map((n) => `${n === n.normalize('NFC') ? 'NFC' : 'NFD'}[${codePoints(n).slice(0, 40)}]`);
        log(`- angelegt als ${JSON.stringify(name)} (${name === name.normalize('NFC') ? 'NFC' : 'NFD'}): Ereignisname(n) ${forms.join(' ')}`);
    }
    const listed = await readdir(directory);
    log(`- readdir liefert: ${listed.map((n) => `${n === n.normalize('NFC') ? 'NFC' : 'NFD'}`).join(' ')} (Reihenfolge wie Eingabe: ${listed.join(' / ')})`);
    const otherForm = 'Größe.tex'.normalize('NFD');
    const sameFile = await stat(join(directory, otherForm)).then(() => 'ja', () => 'nein');
    log(`- stat mit anderer Normalform desselben Namens findet die Datei: ${sameFile} (APFS normalisierungsunabhängig)`);
    session.watcher.events.length = 0;
    await writeFile(join(directory, otherForm), 'zweiter Schreibvorgang mit NFD-Name');
    await sleep(SAVE_GAP_MS);
    log(`- Schreiben unter der anderen Normalform: ${show(session.watcher.events)}; Ordner hat danach ${(await readdir(directory)).length} Einträge (5 = dieselbe Datei)`);
    await session.finish();
    log(`- isBuildNoise('Übung.aux')=${isBuildNoise('Übung.aux')} isBuildNoise('Übung.tex')=${isBuildNoise('Übung.tex')}`);
    await rm(directory, { recursive: true, force: true });
}

/** Prüfung 5: Groß-/Kleinschreibung umbenennen (Datei und Ordner). */
async function checkCaseRename(): Promise<void> {
    log('## 5 Groß-/Kleinschreibung umbenennen');
    const directory = await makeTestDirectory('case');
    await writeFile(join(directory, 'Datei.tex'), 'x');
    await mkdir(join(directory, 'Bilder'));
    await writeFile(join(directory, 'Bilder', 'eins.png'), 'x');
    const session = await openSession(directory);
    for (const [from, to] of [['Datei.tex', 'datei.tex'], ['Bilder', 'bilder']] as const) {
        session.watcher.events.length = 0;
        await rename(join(directory, from), join(directory, to));
        await sleep(SAVE_GAP_MS);
        const oldExists = await stat(join(directory, from)).then(() => true, () => false);
        log(`- ${from} -> ${to}: ${show(session.watcher.events)}; stat(alter Name) existiert noch: ${oldExists}; readdir: ${(await readdir(directory)).join(', ')}`);
    }
    await session.finish();
    const summary = session.filteredBatches.map((b) => b.changes.map((c) => `${c.kind}:${c.path}`).join(','));
    log(`- Klassifizierung per stat/known-Menge: ${summary.join(' || ')} (known: ${[...session.known].join(', ')})`);
    await rm(directory, { recursive: true, force: true });
}

/** Prüfung 6: Zuverlässigkeit: 1000 Dateien einzeln und 1000 Schreibvorgänge in dieselbe Datei. */
async function checkReliability(): Promise<void> {
    log('## 6 Zuverlässigkeit: 1000 Schreibvorgänge');
    const directory = await makeTestDirectory('reliable');
    const session = await openSession(directory);
    const startedAt = performance.now();
    for (let i = 0; i < RELIABILITY_WRITES; i++) {
        await writeFile(join(directory, `datei-${i}.tex`), `inhalt ${i}`);
    }
    const writeMs = performance.now() - startedAt;
    await sleep(1000);
    const names = new Set(session.watcher.events.map((event) => event.name));
    const missing = Array.from({ length: RELIABILITY_WRITES }, (_, i) => `datei-${i}.tex`).filter((name) => !names.has(name));
    log(`- 1000 verschiedene Dateien in ${writeMs.toFixed(0)} ms: Rohereignisse ${session.watcher.events.length}, verschiedene Namen ${names.size}, fehlend ${missing.length}`);
    session.watcher.events.length = 0;
    const lastValue = await overwriteSameFile(join(directory, 'eine.tex'));
    await sleep(1000);
    log(`- 1000x dieselbe Datei im Abstand 5 ms: Rohereignisse ${session.watcher.events.length}, letzter Inhalt '${lastValue}'`);
    await session.finish();
    const lastBatch = session.allBatches[session.allBatches.length - 1];
    log(`- Entprellte Stapel insgesamt ${session.allBatches.length}; letzter Stapel enthält 'eine.tex': ${lastBatch?.names.includes('eine.tex')}`);
    await rm(directory, { recursive: true, force: true });
}

async function overwriteSameFile(path: string): Promise<string> {
    const pauseMs = 5;
    let last = '';
    for (let i = 0; i < RELIABILITY_WRITES; i++) {
        last = `stand ${i}`;
        await writeFile(path, last);
        await sleep(pauseMs);
    }
    return last;
}

/** Prüfung 7: Rohereignisse je Operation (Grundlage für neu/geändert/gelöscht). */
async function checkEventKinds(): Promise<void> {
    log('## 7 Ereignisart je Operation (rename vs change)');
    const directory = await makeTestDirectory('kinds');
    await writeFile(join(directory, 'alt.tex'), 'x');
    await mkdir(join(directory, 'ordner'));
    const watcher = await startWatcher(directory);
    const operations: [string, () => Promise<void>][] = [
        ['neue Datei', () => writeFile(join(directory, 'neu.tex'), 'x')],
        ['vorhandene überschreiben', () => writeFile(join(directory, 'alt.tex'), 'yy')],
        ['anhängen', () => appendFile(join(directory, 'alt.tex'), 'z')],
        ['nur Zeitstempel (utimes)', () => utimes(join(directory, 'alt.tex'), new Date(), new Date())],
        ['Datei löschen', () => rm(join(directory, 'neu.tex'))],
        ['Datei umbenennen', () => rename(join(directory, 'alt.tex'), join(directory, 'umbenannt.tex'))],
        ['Datei kopieren', () => copyFile(join(directory, 'umbenannt.tex'), join(directory, 'kopie.tex'))],
        ['atomar ersetzen (Temp + rename)', async () => {
            await writeFile(join(directory, 'x.tmp'), 'q');
            await rename(join(directory, 'x.tmp'), join(directory, 'kopie.tex'));
        }],
        ['Ordner anlegen', () => mkdir(join(directory, 'o2'))],
        ['Ordner löschen', () => rm(join(directory, 'o2'), { recursive: true })],
    ];
    for (const [label, action] of operations) {
        watcher.events.length = 0;
        await action();
        await sleep(SAVE_GAP_MS);
        const stable = groupBy(watcher.events, (event) => `${event.type}:${event.name}`);
        const compact = [...stable.entries()].map(([key, list]) => `${key}${list.length > 1 ? `×${list.length}` : ''}`);
        log(`- ${label}: ${compact.join(' ')}`);
    }
    watcher.close();
    await rm(directory, { recursive: true, force: true });
}

async function git(directory: string, args: string[], optionalLocks: boolean): Promise<void> {
    const env = { ...process.env, ...(optionalLocks ? {} : { GIT_OPTIONAL_LOCKS: '0' }) };
    await runCommand(GIT_BINARY, args, { cwd: directory, env });
}

/** Prüfung 9 (Zusatz): löst `git status` selbst Ereignisse in .git aus (Rückkopplung mit git:changed)? */
async function checkGitFeedback(): Promise<void> {
    log('## 9 Git-Rückkopplung: schreibt `git status` in .git?');
    const directory = await makeTestDirectory('git');
    await git(directory, ['init', '-q'], true);
    for (let i = 0; i < 20; i++) {
        await writeFile(join(directory, `f${i}.tex`), `x${i}`);
    }
    await git(directory, ['add', '.'], true);
    const touchAll = async (): Promise<void> => {
        const now = new Date();
        for (let i = 0; i < 20; i++) {
            await utimes(join(directory, `f${i}.tex`), now, now);
        }
    };
    const watcher = await startWatcher(directory);
    for (const optionalLocks of [true, false]) {
        await touchAll();
        await sleep(SAVE_GAP_MS);
        watcher.events.length = 0;
        await git(directory, ['status', '--porcelain'], optionalLocks);
        await sleep(SAVE_GAP_MS);
        const gitEvents = watcher.events.filter((event) => event.name.startsWith('.git'));
        const kinds = [...new Set(gitEvents.map((event) => event.name))];
        log(`- git status ${optionalLocks ? 'normal' : 'mit GIT_OPTIONAL_LOCKS=0'}: ${gitEvents.length} Ereignisse in .git: ${kinds.join(', ') || 'keine'}`);
    }
    watcher.close();
    await rm(directory, { recursive: true, force: true });
}

const CHECKS: Record<string, () => Promise<void>> = {
    '1': checkSaveStyles,
    '2': checkBuildStorm,
    '3': checkSubdirectories,
    '4': checkUnicodeNames,
    '5': checkCaseRename,
    '6': checkReliability,
    '7': checkEventKinds,
    '9': checkGitFeedback,
};

const requested = process.argv.slice(2);
log(`Node ${process.version} (${process.versions.electron ? 'Electron ' + process.versions.electron : 'ohne Electron'}) ${process.platform}/${process.arch}`);
for (const [key, check] of Object.entries(CHECKS)) {
    // Prüfung 9 ruft das git-Programm auf und läuft deshalb nur auf ausdrücklichen Wunsch.
    const selected = requested.length === 0 ? key !== '9' : requested.includes(key);
    if (selected) {
        await check();
        log();
    }
}
