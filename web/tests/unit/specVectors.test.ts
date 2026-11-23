import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

// Alle Testvektoren in shared/spec/ gegen shared/spec/schema.json (JSON Schema Draft-7, Standard von ajv 8).
// Eindeutige `id` je Datei prüft das Schema selbst nicht (siehe shared/spec/README.md), deshalb hier.
const SPEC_DIRECTORY = fileURLToPath(new URL('../../../shared/spec/', import.meta.url));
const SCHEMA_FILE = 'schema.json';
const JSON_EXTENSION = '.json';

interface VectorFile {
    readonly cases: readonly { readonly id: string }[];
}

function readJson(name: string): unknown {
    return JSON.parse(readFileSync(join(SPEC_DIRECTORY, name), 'utf8'));
}

const vectorFiles = readdirSync(SPEC_DIRECTORY)
    .filter((name) => name.endsWith(JSON_EXTENSION) && name !== SCHEMA_FILE)
    .sort();
const validate = new Ajv({ allErrors: true }).compile(readJson(SCHEMA_FILE) as object);

describe('shared/spec: Testvektoren', () => {
    it('es gibt Vektordateien', () => {
        expect(vectorFiles.length).toBeGreaterThan(0);
    });

    it.each(vectorFiles)('%s passt zum Schema und hat eindeutige ids', (name) => {
        const data = readJson(name);
        const valid = validate(data);
        expect(validate.errors ?? [], name).toEqual([]);
        expect(valid).toBe(true);
        const ids = (data as VectorFile).cases.map((entry) => entry.id);
        const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
        expect(duplicates, name).toEqual([]);
    });
});
