import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv, { type ValidateFunction } from 'ajv';
import { describe, expect, it } from 'vitest';
import { specDirectory } from '../support/specVectors';

const SCHEMA_FILE = 'schema.json';

function readJson(path: string): unknown {
    return JSON.parse(readFileSync(path, 'utf8'));
}

function listVectorFiles(): string[] {
    return readdirSync(specDirectory(), { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== SCHEMA_FILE)
        .map((entry) => entry.name)
        .sort();
}

function compileSchema(): ValidateFunction {
    const ajv = new Ajv({ allErrors: true, strict: false });
    return ajv.compile(readJson(join(specDirectory(), SCHEMA_FILE)) as object);
}

function describeSchemaErrors(validate: ValidateFunction): string {
    return (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`).join('; ');
}

function collectIds(entries: unknown): string[] {
    if (!Array.isArray(entries)) return [];
    return entries
        .map((entry) => (entry as { id?: unknown } | null)?.id)
        .filter((id): id is string => typeof id === 'string');
}

function findDuplicates(ids: readonly string[]): string[] {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const id of ids) {
        if (seen.has(id)) duplicates.add(id);
        seen.add(id);
    }
    return [...duplicates];
}

/** Liefert alle Verstöße einer Vektordatei (Schema, eindeutige ids, nicht leere cases) als Texte */
function findViolations(fileName: string, data: unknown, validate: ValidateFunction): string[] {
    const violations: string[] = [];
    if (!validate(data)) violations.push(`${fileName}: Schema verletzt: ${describeSchemaErrors(validate)}`);
    const file = data as { cases?: unknown; skipped?: unknown };
    const duplicates = findDuplicates([...collectIds(file.cases), ...collectIds(file.skipped)]);
    if (duplicates.length > 0) violations.push(`${fileName}: doppelte ids: ${duplicates.join(', ')}`);
    const casesEmpty = !Array.isArray(file.cases) || file.cases.length === 0;
    const hasSkipReason = Array.isArray(file.skipped) && file.skipped.length > 0;
    if (casesEmpty && !hasSkipReason) violations.push(`${fileName}: cases ist leer und skipped nennt keinen Grund`);
    return violations;
}

describe('Testvektordateien gegen schema.json', () => {
    const validate = compileSchema();
    const files = listVectorFiles();

    it('findet Vektordateien', () => {
        expect(files.length).toBeGreaterThan(0);
    });

    for (const fileName of files) {
        it(`${fileName} ist gültig`, () => {
            const data = readJson(join(specDirectory(), fileName));
            expect(findViolations(fileName, data, validate)).toEqual([]);
        });
    }

    it('erkennt ein kaputtes Beispiel (fehlendes name, doppelte id)', () => {
        const broken = {
            suite: 'kaputt',
            version: 1,
            source: 'x.swift',
            cases: [{ id: 'a' }, { id: 'a', name: 'zweiter' }],
        };
        const violations = findViolations('kaputt.json', broken, validate);
        expect(violations.some((text) => text.includes('Schema verletzt') && text.includes('name'))).toBe(true);
        expect(violations.some((text) => text.includes('doppelte ids: a'))).toBe(true);
    });
});
