import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// scripts/checkNoTestApi.mjs läuft vor `electron-builder` und bricht ab, wenn der Renderer-Build den Testzugang enthält.
const SCRIPT = fileURLToPath(new URL('../../scripts/checkNoTestApi.mjs', import.meta.url));
const RUN_TIMEOUT_MS = 10_000;

type CheckModule = { findTestApiFiles(dir: string): string[] };

let fixtureDir = '';

beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'check-no-test-api-'));
    mkdirSync(join(fixtureDir, 'assets'));
});

afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
});

function runScript(dir: string): { status: number | null; stderr: string } {
    const result = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS });
    return { status: result.status, stderr: result.stderr };
}

describe('scripts/checkNoTestApi.mjs', () => {
    it('sauberer Build: Exit 0', () => {
        writeFileSync(join(fixtureDir, 'index.html'), '<script src="assets/app.js"></script>');
        writeFileSync(
            join(fixtureDir, 'assets', 'app.js'),
            'const a=1;delete window.__editorTestApi;if(x===window.__editorTestApi){}delete window.__tabMemoryTestApi;',
        );
        expect(runScript(fixtureDir)).toMatchObject({ status: 0, stderr: '' });
    });

    it.each([
        ['mit Leerzeichen', 'window.__editorTestApi = createTestApi(s);'],
        ['minifiziert', 'window.__editorTestApi=e(t,n);'],
        ['Tab-Gedächtnis', 'window.__tabMemoryTestApi = { start, flush };'],
        ['Tab-Gedächtnis minifiziert', 'window.__tabMemoryTestApi={start:a,flush:b}'],
    ])('Treffer (%s): Exit 1 und Dateiname in der Meldung', (_name, code) => {
        writeFileSync(join(fixtureDir, 'assets', 'index-abc.js'), code);
        const result = runScript(fixtureDir);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('index-abc.js');
    });

    it('fehlender Ordner: Exit 1', () => {
        expect(runScript(join(fixtureDir, 'gibt-es-nicht')).status).toBe(1);
    });

    it('findTestApiFiles liefert nur die betroffenen Dateien und ignoriert andere Endungen', async () => {
        const module = (await import(pathToFileURL(SCRIPT).href)) as CheckModule;
        writeFileSync(join(fixtureDir, 'assets', 'bad.js'), 'window.__editorTestApi = 1');
        writeFileSync(join(fixtureDir, 'assets', 'good.js'), 'window.other = 1');
        writeFileSync(join(fixtureDir, 'assets', 'bad.js.map'), 'window.__editorTestApi = 1');
        expect(module.findTestApiFiles(fixtureDir)).toEqual([join(fixtureDir, 'assets', 'bad.js')]);
    });
});
