import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Ordner der gemeinsamen Testvektoren (`shared/spec`), ausgehend von `web/tests/support/` */
const SPEC_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'shared', 'spec');

export interface SpecCase {
    readonly id: string;
    readonly name: string;
    readonly input: unknown;
    readonly expect: unknown;
    readonly sourceLine?: number;
    readonly source?: string | readonly string[];
}

export interface SpecFile {
    readonly suite: string;
    readonly version: number;
    readonly source: string | readonly string[];
    readonly notes?: string;
    readonly skipped?: readonly unknown[];
    readonly cases: readonly SpecCase[];
}

/** Liest `shared/spec/<name>.json` (ohne Endung), Format laut `shared/spec/README.md` */
export function loadSpec(name: string): SpecFile {
    return JSON.parse(readFileSync(join(SPEC_DIRECTORY, `${name}.json`), 'utf8')) as SpecFile;
}

export function specDirectory(): string {
    return SPEC_DIRECTORY;
}
