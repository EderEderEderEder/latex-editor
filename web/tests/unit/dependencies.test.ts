import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Die Node-Typen müssen zur Node-Version in Electron passen, sonst erlaubt der Compiler APIs, die es
// zur Laufzeit nicht gibt. Electron nennt seine Node-Hauptversion über die eigene @types/node-Abhängigkeit.
const WEB_DIRECTORY = new URL('../../', import.meta.url);
const VERSION_MAJOR = /(\d+)\./;

interface PackageJson {
    readonly version?: string;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
}

function readPackage(relativePath: string): PackageJson {
    return JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, WEB_DIRECTORY)), 'utf8')) as PackageJson;
}

function majorOf(version: string | undefined): string | undefined {
    return VERSION_MAJOR.exec(version ?? '')?.[1];
}

describe('Abhängigkeiten', () => {
    it('@types/node ist exakt gepinnt und hat die Hauptversion der Node-Laufzeit in Electron', () => {
        const declared = readPackage('package.json').devDependencies?.['@types/node'];
        expect(declared).toMatch(/^\d+\.\d+\.\d+$/);
        const electronNode = readPackage('node_modules/electron/package.json').dependencies?.['@types/node'];
        expect(majorOf(declared)).toBe(majorOf(electronNode));
    });
});
