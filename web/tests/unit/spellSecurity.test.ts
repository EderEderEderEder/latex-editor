import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MACOS_PATHS, WINDOWS_PATHS } from '../../src/main/paths';
import { isRequestAllowed, PACKAGED_CSP_HEADER, RENDERER_CSP } from '../../src/main/security';
import type { RequestPolicy } from '../../src/main/security';

// Rechtschreibung ohne Netz (W7-2): Chromiums Prüfung bleibt aus, kein Wörterbuch-Download, die Netzsperre bleibt
// unverändert streng, und der Rechtschreib-Code selbst stellt keine Netzanfragen. Texte verlassen den Rechner nie.

const SOURCE = join(__dirname, '../../src');
const PACKAGED: RequestPolicy = {
    location: { kind: 'packaged', indexFileUrl: 'file:///app/out/renderer/index.html' },
    platform: MACOS_PATHS,
    allowDevTools: false,
};
const WINDOWS: RequestPolicy = {
    location: { kind: 'packaged', indexFileUrl: 'file:///C:/Programme/LatexEditor/resources/app.asar/out/renderer/index.html' },
    platform: WINDOWS_PATHS,
    allowDevTools: false,
};
const DEVELOPMENT: RequestPolicy = {
    location: { kind: 'development', devServerUrl: 'http://localhost:5173/' },
    platform: MACOS_PATHS,
    allowDevTools: true,
};
/** Woher Chromium unter Windows/Linux Hunspell-Wörterbücher lädt (Spike S8) */
const DICTIONARY_DOWNLOADS = [
    'https://redirector.gvt1.com/edgedl/chrome/dict/de-de-3-0.bdic',
    'http://dl.google.com/chrome/dict/de-de-3-0.bdic',
];
/** Rechtschreib-Code im Renderer und in `shared` */
const SPELL_FILES = [
    'renderer/workers/spell.worker.ts',
    'renderer/app/spellClient.ts',
    'renderer/app/spellDictionary.ts',
    'renderer/app/spellRuntime.ts',
    'renderer/app/spellWords.ts',
    'renderer/app/spellMenu.ts',
    'renderer/app/spellMenuItems.ts',
    'renderer/editor/spell.ts',
    ...readdirSync(join(SOURCE, 'shared/core/spelling')).filter((name) => name.endsWith('.ts')).map((name) => `shared/core/spelling/${name}`),
];
const NETWORK_APIS = /\b(?:XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b|https?:\/\//;

function source(relativePath: string): string {
    return readFileSync(join(SOURCE, relativePath), 'utf8');
}

describe('Rechtschreibung ohne Netz', () => {
    it('Chromium-Prüfung aus: `spellcheck: false` im Fenster und `setSpellCheckerEnabled(false)` in der Session', () => {
        const main = source('main/index.ts');
        expect(main).toContain('spellcheck: false');
        expect(main).toContain('session.defaultSession.setSpellCheckerEnabled(false)');
        expect(main).not.toMatch(/setSpellCheckerDictionaryDownloadURL|setSpellCheckerLanguages|addWordToSpellCheckerDictionary/);
    });

    it('Wörterbuch-Downloads blockiert der Anfragefilter (gepackt, Windows und Entwicklung)', () => {
        for (const url of DICTIONARY_DOWNLOADS) {
            expect(isRequestAllowed(url, PACKAGED), url).toBe(false);
            expect(isRequestAllowed(url, WINDOWS), url).toBe(false);
            expect(isRequestAllowed(url, DEVELOPMENT), url).toBe(false);
        }
    });

    it('Wörterbuchdateien kommen nur aus dem Renderer-Ordner, nie aus `node_modules`', () => {
        expect(isRequestAllowed('file:///app/out/renderer/assets/index-abc123.dic', PACKAGED)).toBe(true);
        expect(isRequestAllowed('file:///app/node_modules/dictionary-de-at/index.dic', PACKAGED)).toBe(false);
        expect(isRequestAllowed('file:///C:/Programme/LatexEditor/resources/app.asar/node_modules/dictionary-de-at/index.dic', WINDOWS)).toBe(false);
    });

    it('CSP bleibt streng: `connect-src` nur `self`, keine fremden Hosts, kein `unsafe-eval`, kein Wasm', () => {
        expect(RENDERER_CSP).toContain("connect-src 'self';");
        expect(RENDERER_CSP).toContain("worker-src 'self' blob:;");
        for (const csp of [RENDERER_CSP, PACKAGED_CSP_HEADER]) expect(csp).not.toMatch(/https?:|\*|unsafe-eval|wasm-unsafe-eval/);
    });

    it('Rechtschreib-Code nutzt keine Netz-APIs und nennt keine fremden Adressen', () => {
        for (const file of SPELL_FILES) expect(source(file), file).not.toMatch(NETWORK_APIS);
        const fetchUsers = SPELL_FILES.filter((file) => /\bfetch\(/.test(source(file)));
        expect(fetchUsers).toEqual(['renderer/app/spellDictionary.ts']);
        expect(source('renderer/app/spellDictionary.ts')).toMatch(/import \w+ from '@spell-dictionary\/de-at\/index\.(aff|dic)\?url'/);
    });

    it('Dokumenttext geht nie an den Main: der Vertrag kennt nur Wortlisten', () => {
        const contract = source('shared/contract.ts');
        expect(contract).toContain("'spell:words': Request<[], string[]>;");
        expect(contract).toContain("'spell:addWord': Request<[word: string], string[]>;");
    });
});
