import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// scripts/test-run.mjs startet Vitest und Playwright ohne Shell und ohne npx (Windows: keine .cmd-Datei,
// keine ungequoteten Argumente); taskkill mit vollem Pfad. Geprüft über den Ausgabeschalter, ohne Testlauf.
const SCRIPT = fileURLToPath(new URL('../../scripts/test-run.mjs', import.meta.url));
const PRINT_TIMEOUT_MS = 10_000;

function printedCommands(args: readonly string[]): { vitest: string[]; playwright: string[]; kill: string[] } {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
        env: { ...process.env, TEST_RUN_PRINT_COMMAND: '1', TEST_RUN_COMMAND: '' },
        encoding: 'utf8',
        timeout: PRINT_TIMEOUT_MS,
    });
    expect(result.status).toBe(0);
    const line = result.stdout.split('\n').find((entry) => entry.startsWith('{'));
    return JSON.parse(line ?? '{}') as { vitest: string[]; playwright: string[]; kill: string[] };
}

describe('scripts/test-run.mjs', () => {
    it('startet Vitest über node + vitest.mjs, Argumente als eigene Einträge', () => {
        const { vitest } = printedCommands(['--filter', 'a b&c', '--name', 'x"y']);
        expect(vitest[0]).toBe(process.execPath);
        expect(vitest[1]).toMatch(/node_modules[\\/]vitest[\\/]vitest\.mjs$/);
        expect(existsSync(vitest[1] ?? '')).toBe(true);
        expect(vitest).not.toContain('npx');
        expect(vitest).toEqual(expect.arrayContaining(['-t', 'x"y', 'a b&c']));
    });

    it('Playwright ohne npx, taskkill mit vollem Pfad', () => {
        const { playwright, kill } = printedCommands([]);
        expect(playwright[0]).toBe(process.execPath);
        expect(existsSync(playwright[1] ?? '')).toBe(true);
        expect(kill[0]).toMatch(/System32[\\/]taskkill\.exe$/);
        expect(kill.slice(1)).toEqual(['/PID', '1234', '/T', '/F']);
    });
});
