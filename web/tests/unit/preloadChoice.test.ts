import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { choosePreloadPath, STUB_PRELOAD_ENV } from '../../src/main/preloadChoice';

const REAL = '/app/out/preload/index.js';
const STUB = '/app/out/preload/stub.js';

const choose = (isPackaged: boolean, env: Record<string, string | undefined>): string =>
    choosePreloadPath({ isPackaged, env, realPath: REAL, stubPath: STUB });

describe('choosePreloadPath', () => {
    it('wählt den Stub nur unverpackt und mit gesetztem Schalter', () => {
        expect(choose(false, { [STUB_PRELOAD_ENV]: '1' })).toBe(STUB);
    });

    it('wählt ohne Schalter den echten Preload', () => {
        expect(choose(false, {})).toBe(REAL);
    });

    it.each(['0', '', 'true', 'yes', ' 1'])('wählt bei Schalterwert „%s“ den echten Preload', (value) => {
        expect(choose(false, { [STUB_PRELOAD_ENV]: value })).toBe(REAL);
    });

    it('ignoriert den Schalter im gepackten Programm', () => {
        expect(choose(true, { [STUB_PRELOAD_ENV]: '1' })).toBe(REAL);
    });

    it('beachtet andere Umgebungsvariablen nicht', () => {
        expect(choose(false, { OTHER: '1' })).toBe(REAL);
    });
});

describe('Paketinhalt', () => {
    it('schließt den Stub-Preload in electron-builder.yml aus', () => {
        const config = readFileSync(join(__dirname, '../../electron-builder.yml'), 'utf8');
        const patterns = config
            .split(/\r?\n/)
            .filter((line) => line.startsWith('  - '))
            .map((line) => line.slice('  - '.length).replace(/^"|"$/g, ''));
        expect(patterns).toContain('out/**');
        expect(patterns).toContain('!out/preload/stub*');
        expect(patterns.indexOf('!out/preload/stub*')).toBeGreaterThan(patterns.indexOf('out/**'));
    });
});
