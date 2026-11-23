import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Prüft die Regeln aus .gitignore (Wurzel und web/) ohne Index, also auch für noch nicht vorhandene Dateien.
const GIT = '/usr/local/bin/git';
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const HAS_REPO = existsSync(GIT) && existsSync(`${REPO_ROOT}.git`);
const IGNORED_EXIT = 0;

function isIgnored(relativePath: string): boolean {
    const result = spawnSync(GIT, ['check-ignore', '--no-index', '-q', relativePath], { cwd: REPO_ROOT });
    return result.status === IGNORED_EXIT;
}

describe.runIf(HAS_REPO)('.gitignore', () => {
    it.each([
        ['web/build/icons/icon.png', false],
        ['web/src/shared/contract.ts', false],
        ['web/test-results/ergebnis.json', true],
        ['web/playwright-report/index.html', true],
        ['web/out/main/index.js', true],
        ['web/spikes/pdf-text/build/x.pdf', true],
    ])('%s ignoriert: %s', (path, expected) => {
        expect(isIgnored(path)).toBe(expected);
    });

    it('src/shared/.gitkeep ist entfernt', () => {
        expect(existsSync(`${REPO_ROOT}web/src/shared/.gitkeep`)).toBe(false);
    });
});
