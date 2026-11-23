// Fake-latexmk für die Build-Tests (Node-Skript, kein TeX nötig).
// Steueroptionen stehen vor den echten latexmk-Argumenten:
//   --fake-lines=N                 N Zeilen „Zeile i“ auf stdout (teils in halben Stücken geschrieben)
//   --fake-stderr                  zusätzlich eine Zeile auf stderr
//   --fake-exit=CODE               Exit-Code am Ende (Standard 0)
//   --fake-hang-ms=MS              vor dem Ende so lange laufen (simuliert ein langes Dokument)
//   --fake-grandchild              startet einen Enkelprozess (hält stdout offen), der Enkel meldet selbst „GRANDCHILD <pid>“
//   --fake-grandchild-ignores-term der Enkel ignoriert SIGTERM (prüft den SIGKILL-Nachschlag)
// Immer: „ARGS <json>“, „CWD <ordner>“, „PATH0 <erster PATH-Eintrag>“, „MAX_PRINT_LINE <wert>“, am Ende eine Zeile ohne Umbruch.
import { spawn } from 'node:child_process';
import { delimiter } from 'node:path';

// Sicherheitsnetz: Kein Fake-Prozess überlebt einen kaputten Test länger als das.
const SELF_LIMIT_MS = 60_000;
const GRANDCHILD_TICK_MS = 1_000;

function parseControl(argv) {
    const control = { lines: 0, stderr: false, exit: 0, hangMs: 0, grandchild: false, ignoresTerm: false };
    const rest = [];
    for (const arg of argv) {
        const [name, value] = arg.split('=');
        if (name === '--fake-lines') control.lines = Number(value);
        else if (name === '--fake-stderr') control.stderr = true;
        else if (name === '--fake-exit') control.exit = Number(value);
        else if (name === '--fake-hang-ms') control.hangMs = Number(value);
        else if (name === '--fake-grandchild') control.grandchild = true;
        else if (name === '--fake-grandchild-ignores-term') control.ignoresTerm = true;
        else rest.push(arg);
    }
    return { control, rest };
}

function startGrandchild(ignoresTerm) {
    const code = [
        ignoresTerm ? "process.on('SIGTERM', () => {});" : '',
        `setInterval(() => {}, ${GRANDCHILD_TICK_MS});`,
        `setTimeout(() => process.exit(0), ${SELF_LIMIT_MS});`,
        // Erst melden, wenn der Signal-Handler steht; sonst träfe ein früher Abbruch einen noch startenden Enkel.
        "process.stdout.write('GRANDCHILD ' + process.pid + '\\n');",
    ].join('\n');
    const grandchild = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'inherit', 'ignore'] });
    grandchild.unref();
}

function writeInfo(rest) {
    process.stdout.write(`ARGS ${JSON.stringify(rest)}\n`);
    process.stdout.write(`CWD ${process.cwd()}\n`);
    process.stdout.write(`PATH0 ${(process.env.PATH ?? '').split(delimiter)[0]}\n`);
    process.stdout.write(`MAX_PRINT_LINE ${process.env.max_print_line ?? ''}\n`);
}

function writeLines(count) {
    for (let index = 1; index <= count; index++) {
        process.stdout.write(`Zeile ${index}`.slice(0, 4));
        process.stdout.write(`Zeile ${index}`.slice(4) + (index % 2 === 0 ? '\r\n' : '\n'));
    }
}

const { control, rest } = parseControl(process.argv.slice(2));
writeInfo(rest);
writeLines(control.lines);
if (control.stderr) process.stderr.write('Warnung auf stderr\n');
if (control.grandchild) startGrandchild(control.ignoresTerm);
process.stdout.write('läuft\n');
setTimeout(() => {
    process.stdout.write('Ende ohne Umbruch');
    // Kein process.exit(): Unter macOS sind Pipes asynchron, die Ausgabe ginge sonst verloren.
    process.exitCode = control.exit;
}, Math.min(control.hangMs, SELF_LIMIT_MS));
