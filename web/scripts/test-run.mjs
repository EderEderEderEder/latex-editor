#!/usr/bin/env node
// Testlauf mit Überwachung und kurzer Zusammenfassung (Gegenstück zu swift/scripts/test-run.sh).
//
// Aufruf (im Ordner web/): node scripts/test-run.mjs [--fast] [--e2e] [--perf] [--filter MUSTER] [--name MUSTER]
//   --fast           Vitest ohne langsame Gruppen (Ordner tests/slow/ und Dateien mit ".slow." im Namen)
//   --e2e            zusätzlich Playwright (`npx playwright test`); ohne e2e-Tests wird mit Hinweis übersprungen
//   --perf           nur die Leistungsmessung (tests/perf/*.perf.spec.ts, Playwright mit Electron, eigene Konfiguration);
//                    Voraussetzung `npm run build:e2e`; läuft ohne Vitest, damit nichts anderes die Messung stört
//   --filter MUSTER  Dateimuster, geht als Positionsargument an Vitest (z. B. --filter tokenizer)
//   --name MUSTER    Testnamenmuster, geht als `-t` an Vitest
//
// Wächter: Abbruch bei 60 s ohne Ausgabe (Stillstand) oder nach 300 s Gesamtdauer. Beendet wird nur der eigene
// Prozessbaum (Windows: taskkill /PID <Kind> /T /F; Unix: eigene Prozessgruppe, SIGTERM, nach 5 s SIGKILL).
// Das ganze Log liegt in .test-logs/last.log. Ausgang: 0 grün, 1 Testfehler, 2 Hänger oder Zeitüberschreitung.
//
// Nur für Tests dieses Skripts:
//   TEST_RUN_COMMAND          JSON-Array ["programm", "arg", ...]; ersetzt den Vitest-Aufruf (keine Zusammenfassung aus JSON)
//   TEST_RUN_STALL_SECONDS    ersetzt die Stillstandgrenze
//   TEST_RUN_TIMEOUT_SECONDS  ersetzt die Gesamtgrenze
//   TEST_RUN_PRINT_COMMAND=1  gibt nur die Befehle (Vitest, Playwright, taskkill) als JSON aus und startet nichts
//
// Gestartet wird immer ohne Shell: `node <vitest.mjs>` statt `npx` (unter Windows wäre npx eine .cmd-Datei,
// die nur über eine Shell mit ungequoteten Argumenten liefe).
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STALL_SECONDS = Number(process.env.TEST_RUN_STALL_SECONDS ?? 60);
const TIMEOUT_SECONDS = Number(process.env.TEST_RUN_TIMEOUT_SECONDS ?? 300);
const KILL_GRACE_MS = 5000;
const POLL_INTERVAL_MS = 1000;
// Die Leistungsmessung startet fünfmal ein frisches Electron und meldet sich dazwischen nur je Lauf
const PERF_STALL_SECONDS = 120;
const PERF_TIMEOUT_SECONDS = 900;
const PERF_LOG_MARKER = '[perf]';
const TAIL_LINE_COUNT = 20;
const SLOWEST_COUNT = 3;
const MAX_ERROR_LINES = 6;
const MAX_FAILED_SHOWN = 10;
const FLAKY_RETRIES = 2;
const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_HUNG = 2;
// Bekannt unzuverlässige Testnamen; nur diese werden einzeln wiederholt, wenn allein sie fehlgeschlagen sind
const FLAKY_TESTS = [];
const SLOW_EXCLUDES = ['**/tests/slow/**', '**/*.slow.*'];

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const logDir = join(webDir, '.test-logs');
const logPath = join(logDir, 'last.log');
const jsonPath = join(logDir, 'vitest-result.json');
const isWindows = process.platform === 'win32';
const vitestEntry = join(webDir, 'node_modules', 'vitest', 'vitest.mjs');
const playwrightEntry = join(webDir, 'node_modules', '@playwright', 'test', 'cli.js');
// Voller Pfad, damit kein fremdes taskkill aus PATH oder dem Arbeitsordner läuft.
const taskkillPath = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');

function parseArgs(argv) {
    const options = { fast: false, e2e: false, perf: false, filter: null, name: null };
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--fast') options.fast = true;
        else if (arg === '--e2e') options.e2e = true;
        else if (arg === '--perf') options.perf = true;
        else if (arg === '--filter') options.filter = argv[++index];
        else if (arg === '--name') options.name = argv[++index];
        else throw new Error(`Unbekannte Option: ${arg}`);
    }
    return options;
}

function buildVitestCommand(options, nameOverride = null) {
    if (process.env.TEST_RUN_COMMAND) return JSON.parse(process.env.TEST_RUN_COMMAND);
    const args = [vitestEntry, 'run', '--reporter=default', '--reporter=json', `--outputFile.json=${jsonPath}`];
    if (options.fast) SLOW_EXCLUDES.forEach((pattern) => args.push('--exclude', pattern));
    const name = nameOverride ?? options.name;
    if (name) args.push('-t', name);
    if (options.filter) args.push(options.filter);
    return [process.execPath, ...args];
}

function playwrightCommand() {
    return [process.execPath, playwrightEntry, 'test'];
}

function perfCommand() {
    return [process.execPath, playwrightEntry, 'test', '--config', join('tests', 'perf', 'playwright.perf.config.ts')];
}

function killCommand(pid) {
    return [taskkillPath, '/PID', String(pid), '/T', '/F'];
}

function killProcessTree(child) {
    if (isWindows) {
        const [command, ...args] = killCommand(child.pid);
        spawnSync(command, args, { stdio: 'ignore', windowsHide: true });
        return;
    }
    signalGroup(child.pid, 'SIGTERM');
    setTimeout(() => signalGroup(child.pid, 'SIGKILL'), KILL_GRACE_MS);
}

function signalGroup(pid, signal) {
    try {
        process.kill(-pid, signal);
    } catch {
        // Gruppe ist schon beendet
    }
}

// Startet den Befehl, schreibt alles ins Log, überwacht Stillstand und Gesamtdauer.
function runWatched([command, ...args], logStream, limits = { stallSeconds: STALL_SECONDS, timeoutSeconds: TIMEOUT_SECONDS }) {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            cwd: webDir,
            detached: !isWindows,
            shell: false,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const state = { lines: [], partial: '', lastOutput: Date.now(), reason: null, finished: false };
        const started = Date.now();
        const onData = (chunk) => recordOutput(state, logStream, chunk);
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        const finish = (code) => {
            if (state.finished) return;
            state.finished = true;
            clearInterval(watcher);
            resolve({ code, reason: state.reason, lines: state.lines, seconds: (Date.now() - started) / 1000 });
        };
        const watcher = setInterval(() => watchLimits(state, started, child, finish, limits), POLL_INTERVAL_MS);
        child.on('error', (error) => { recordOutput(state, logStream, `Start fehlgeschlagen: ${error.message}\n`); finish(null); });
        child.on('close', (code) => finish(code));
    });
}

function recordOutput(state, logStream, chunk) {
    const text = String(chunk);
    logStream.write(text);
    state.lastOutput = Date.now();
    const parts = (state.partial + text).split(/\r?\n/);
    state.partial = parts.pop();
    state.lines.push(...parts);
}

function watchLimits(state, started, child, finish, limits) {
    if (state.reason) return;
    const now = Date.now();
    if (now - state.lastOutput >= limits.stallSeconds * 1000) state.reason = 'stall';
    else if (now - started >= limits.timeoutSeconds * 1000) state.reason = 'timeout';
    if (!state.reason) return;
    killProcessTree(child);
    // Hält ein Enkel die Ausgabe offen, kommt kein "close"; nach der Gnadenfrist trotzdem fertig melden
    setTimeout(() => finish(null), KILL_GRACE_MS + POLL_INTERVAL_MS);
}

function reportHang(result, limits = { stallSeconds: STALL_SECONDS, timeoutSeconds: TIMEOUT_SECONDS }) {
    const text = result.reason === 'stall'
        ? `HÄNGER: ${limits.stallSeconds} s ohne Ausgabe, Prozessbaum beendet.`
        : `ZEITÜBERSCHREITUNG: ${limits.timeoutSeconds} s Gesamtdauer überschritten, Prozessbaum beendet.`;
    console.log(text);
    if (result.reason === 'stall') {
        console.log(`Letzte ${TAIL_LINE_COUNT} Ausgabezeilen:`);
        result.lines.slice(-TAIL_LINE_COUNT).forEach((line) => console.log(`  ${line}`));
    }
}

function readVitestResult() {
    try {
        return JSON.parse(readFileSync(jsonPath, 'utf8'));
    } catch {
        return null;
    }
}

function collectTests(result) {
    return result.testResults.flatMap((file) =>
        file.assertionResults.map((test) => ({ ...test, file: file.name })),
    );
}

function printVitestSummary(result, seconds) {
    const tests = collectTests(result);
    const count = (status) => tests.filter((test) => test.status === status).length;
    const skipped = count('pending') + count('skipped') + count('todo');
    console.log(`Vitest: ${count('passed')} bestanden, ${count('failed')} fehlgeschlagen, ${skipped} übersprungen in ${seconds.toFixed(1)} s`);
    const slowest = tests.filter((test) => test.duration != null).sort((a, b) => b.duration - a.duration);
    slowest.slice(0, SLOWEST_COUNT).forEach((test) => console.log(`  langsam: ${Math.round(test.duration)} ms  ${test.fullName}`));
    printFailures(tests.filter((test) => test.status === 'failed'));
}

function printFailures(failed) {
    for (const test of failed.slice(0, MAX_FAILED_SHOWN)) {
        console.log(`  FEHLER: ${test.fullName}`);
        const message = (test.failureMessages ?? []).join('\n');
        message.split('\n').slice(0, MAX_ERROR_LINES).forEach((line) => console.log(`    ${line}`));
    }
    if (failed.length > MAX_FAILED_SHOWN) console.log(`  ... und ${failed.length - MAX_FAILED_SHOWN} weitere (siehe Log)`);
}

// Wiederholt nur, wenn ausschließlich bekannt unzuverlässige Tests fehlgeschlagen sind. Liefert true, wenn danach alles grün ist.
async function retryFlakyFailures(options, result, logStream) {
    if (!result) return false;
    const failedNames = collectTests(result).filter((test) => test.status === 'failed').map((test) => test.fullName);
    if (failedNames.length === 0 || !failedNames.every((name) => FLAKY_TESTS.some((flaky) => name.includes(flaky)))) return false;
    for (const name of failedNames) {
        if (!(await passesWithinRetries(options, name, logStream))) return false;
    }
    console.log(`Bekannt unzuverlässige Tests wiederholt und bestanden: ${failedNames.join(', ')}`);
    return true;
}

async function passesWithinRetries(options, name, logStream) {
    for (let attempt = 1; attempt <= FLAKY_RETRIES; attempt++) {
        const run = await runWatched(buildVitestCommand(options, name), logStream);
        if (run.code === 0) return true;
    }
    return false;
}

function hasE2eTests() {
    const e2eDir = join(webDir, 'tests', 'e2e');
    return existsSync(e2eDir) && readdirSync(e2eDir, { recursive: true }).some((file) => String(file).endsWith('.spec.ts'));
}

async function runVitestStage(options, logStream) {
    rmSync(jsonPath, { force: true });
    const run = await runWatched(buildVitestCommand(options), logStream);
    if (run.reason) { reportHang(run); return EXIT_HUNG; }
    const result = readVitestResult();
    if (result) printVitestSummary(result, run.seconds);
    else console.log(`Vitest beendet mit Code ${run.code} (keine JSON-Auswertung, siehe Log), ${run.seconds.toFixed(1)} s`);
    if (run.code === 0) return EXIT_OK;
    return (await retryFlakyFailures(options, result, logStream)) ? EXIT_OK : EXIT_FAILED;
}

async function runE2eStage(logStream) {
    if (!hasE2eTests()) {
        console.log('Playwright: übersprungen, es gibt noch keine e2e-Tests (tests/e2e/*.spec.ts).');
        return EXIT_OK;
    }
    const run = await runWatched(playwrightCommand(), logStream);
    if (run.reason) { reportHang(run); return EXIT_HUNG; }
    console.log(`Playwright: ${run.code === 0 ? 'bestanden' : 'fehlgeschlagen'} in ${run.seconds.toFixed(1)} s`);
    if (run.code !== 0) run.lines.slice(-TAIL_LINE_COUNT).forEach((line) => console.log(`  ${line}`));
    return run.code === 0 ? EXIT_OK : EXIT_FAILED;
}

function hasPerfTests() {
    const perfDir = join(webDir, 'tests', 'perf');
    return existsSync(perfDir) && readdirSync(perfDir).some((file) => file.endsWith('.perf.spec.ts'));
}

// Nur die Messung, ohne Vitest davor; die Messzeilen (Marke `[perf]`) kommen in die Zusammenfassung.
async function runPerfStage(logStream) {
    if (!hasPerfTests()) {
        console.log('Perf: übersprungen, es gibt keine Messung (tests/perf/*.perf.spec.ts).');
        return EXIT_OK;
    }
    const limits = { stallSeconds: PERF_STALL_SECONDS, timeoutSeconds: PERF_TIMEOUT_SECONDS };
    const run = await runWatched(perfCommand(), logStream, limits);
    if (run.reason) { reportHang(run, limits); return EXIT_HUNG; }
    run.lines.filter((line) => line.includes(PERF_LOG_MARKER)).forEach((line) => console.log(line));
    console.log(`Perf: ${run.code === 0 ? 'Budgets eingehalten' : 'fehlgeschlagen'} in ${run.seconds.toFixed(1)} s`);
    if (run.code !== 0) run.lines.slice(-TAIL_LINE_COUNT).forEach((line) => console.log(`  ${line}`));
    return run.code === 0 ? EXIT_OK : EXIT_FAILED;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (process.env.TEST_RUN_PRINT_COMMAND === '1') {
        console.log(JSON.stringify({ vitest: buildVitestCommand(options), playwright: playwrightCommand(), perf: perfCommand(), kill: killCommand(1234) }));
        return;
    }
    mkdirSync(logDir, { recursive: true });
    const logStream = createWriteStream(logPath);
    let exitCode = options.perf ? await runPerfStage(logStream) : await runVitestStage(options, logStream);
    if (options.e2e && !options.perf && exitCode === EXIT_OK) exitCode = await runE2eStage(logStream);
    logStream.end();
    console.log(`Log: ${logPath}`);
    process.exit(exitCode);
}

main().catch((error) => {
    console.error(error.message);
    process.exit(EXIT_FAILED);
});
