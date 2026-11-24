#!/usr/bin/env node
// Prüft vor dem Paketieren, dass der gebaute Renderer den Testzugang `window.__editorTestApi` nicht enthält
// (er entsteht nur im E2E-Build, `npm run build:e2e`). Aufruf (im Ordner web/): node scripts/checkNoTestApi.mjs [Ordner]
// Standardordner: out/renderer. Ausgang: 0 sauber, 1 Treffer oder Ordner fehlt.
//
// Gesucht wird die Zuweisung (auch minifiziert ohne Leerzeichen); `delete window.__editorTestApi` oder ein Vergleich
// zählen nicht.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TEST_API_ASSIGNMENT = /__editorTestApi\s*=(?!=)/;
const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.html']);
const EXIT_OK = 0;
const EXIT_FOUND = 1;

function scannedFiles(dir) {
    const files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) files.push(...scannedFiles(path));
        else if (SCANNED_EXTENSIONS.has(path.slice(path.lastIndexOf('.')))) files.push(path);
    }
    return files;
}

/** Dateien unterhalb von `dir`, die den Testzugang zuweisen; wirft, wenn `dir` kein Ordner ist */
export function findTestApiFiles(dir) {
    if (!statSync(dir).isDirectory()) throw new Error(`${dir} ist kein Ordner`);
    return scannedFiles(dir).filter((path) => TEST_API_ASSIGNMENT.test(readFileSync(path, 'utf8')));
}

function run(dir) {
    let found;
    try {
        found = findTestApiFiles(dir);
    } catch (error) {
        console.error(`checkNoTestApi: ${dir} nicht lesbar (vorher npm run build?): ${error.message}`);
        return EXIT_FOUND;
    }
    if (found.length === 0) return EXIT_OK;
    console.error('checkNoTestApi: Testzugang __editorTestApi im Renderer-Build gefunden, Paket abgebrochen:');
    for (const path of found) console.error(`  ${path}`);
    console.error('Normalen Build ausführen (npm run build), nicht npm run build:e2e.');
    return EXIT_FOUND;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
    const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
    process.exitCode = run(resolve(process.argv[2] ?? join(webDir, 'out', 'renderer')));
}
