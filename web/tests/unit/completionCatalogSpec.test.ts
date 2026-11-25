import { describe, expect, it } from 'vitest';
import {
    ARGUMENT_COMMANDS,
    COMMANDS,
    commandInsertion,
    ENVIRONMENTS,
    OPTION_CATALOG,
} from '../../src/shared/core/completion/catalog';
import { definedCommands, definedEnvironments, openEnvironments } from '../../src/shared/core/completion/definitions';
import { optionItems, scanOptions, type StyleFile } from '../../src/shared/core/completion/options';
import type { OptionTargetKind } from '../../src/shared/core/completion/types';
import { loadSpec, type SpecCase } from '../support/specVectors';

// Gemeinsame Vektoren `shared/spec/completion.json`, nur die Ops dieses Teils (Format: `notes` der Datei).
// Die übrigen Ops (detectContext, rank, apply) prüft ein anderer Test.
const COVERED_OPS: ReadonlySet<string> = new Set([
    'commandItem', 'definedCommands', 'definedEnvironments', 'openEnvironments', 'scanOptions', 'optionItems',
]);
const EXPECTED_CASE_COUNT = 15;

// Umfang der Kataloge in Swift (CommandCatalog.swift, OptionCatalog.swift, CompletionContext.swift, Renaming.swift)
const SWIFT_COMMAND_COUNT = 151;
const SWIFT_STATIC_ENVIRONMENT_COUNT = 46;
const SWIFT_CODE_ENVIRONMENT_COUNT = 27;
const SWIFT_ARGUMENT_COMMAND_COUNTS: Readonly<Record<string, number>> = {
    label: 11, citation: 18, acronym: 51, graphics: 1, input: 4, beginEnvironment: 1, endEnvironment: 1,
};
const SWIFT_PACKAGE_COUNT = 13;

type Input = Record<string, unknown> & { readonly op: string };
type Expect = Record<string, unknown>;

const spec = loadSpec('completion');
const cases = spec.cases.filter((testCase) => COVERED_OPS.has((testCase.input as Input).op));

function styleFiles(files: unknown): StyleFile[] {
    return Object.entries((files ?? {}) as Record<string, string>).map(([name, text]) => ({ name, text }));
}

function checkCommandItem(input: Input, expected: Expect): void {
    const result = commandInsertion(String(input.name), input.arguments === undefined ? '' : String(input.arguments));
    expect(result.insertion).toBe(expected.insertion);
    expect(result.cursorOffset).toBe(expected.cursorOffset);
}

function checkNames(names: Set<string>, expected: Expect): void {
    const expectedNames = expected.names as string[];
    expect([...names].sort()).toEqual([...expectedNames].sort());
}

function checkOpenEnvironments(input: Input, expected: Expect): void {
    const text = String(input.text);
    const stack = openEnvironments(text, text.length);
    if (expected.stack !== undefined) expect(stack).toEqual(expected.stack);
    if (expected.suggestionsForEnd !== undefined) expect([...stack].reverse()).toEqual(expected.suggestionsForEnd);
}

function checkScanOptions(input: Input, expected: Expect): void {
    const options = scanOptions(styleFiles(input.files)).get(String(expected.package));
    expect(options).toBeDefined();
    for (const [key, values] of Object.entries((expected.keys ?? {}) as Record<string, string[]>)) {
        expect(options?.keys[key]).toEqual(values);
    }
    for (const key of (expected.absentKeys ?? []) as string[]) expect(Object.hasOwn(options?.keys ?? {}, key)).toBe(false);
    if (expected.flags !== undefined) expect(options?.flags).toEqual(expected.flags);
}

function checkOptionItems(input: Input, expected: Expect): void {
    const scanned = scanOptions(styleFiles(input.styleFiles));
    const target = { kind: String(input.target) as OptionTargetKind, name: String(input.name ?? '') };
    const texts = optionItems(target, scanned, typeof input.key === 'string' ? input.key : null).map((item) => item.text);
    if (expected.texts !== undefined) expect(texts).toEqual(expected.texts);
    for (const text of (expected.contains ?? []) as string[]) expect(texts).toContain(text);
    if (expected.first !== undefined) expect(texts[0]).toBe(expected.first);
}

const CHECKS: Record<string, (input: Input, expected: Expect) => void> = {
    commandItem: checkCommandItem,
    definedCommands: (input, expected) => checkNames(definedCommands(String(input.text)), expected),
    definedEnvironments: (input, expected) => checkNames(definedEnvironments(String(input.text)), expected),
    openEnvironments: checkOpenEnvironments,
    scanOptions: checkScanOptions,
    optionItems: checkOptionItems,
};

function runCase(testCase: SpecCase): void {
    const input = testCase.input as Input;
    const check = CHECKS[input.op];
    if (check === undefined) throw new Error(`Unbekannte Operation ${input.op}`);
    check(input, testCase.expect as Expect);
}

describe('Vektoren completion.json (Katalog, Definitionen, Optionen)', () => {
    it('enthält alle Fälle dieser Ops', () => {
        expect(cases).toHaveLength(EXPECTED_CASE_COUNT);
    });

    it.each(cases)('$id: $name', (testCase) => runCase(testCase));
});

describe('Katalog gegenüber Swift', () => {
    it('Befehle: Anzahl, Einträge ohne doppelte Gerüste', () => {
        expect(COMMANDS).toHaveLength(SWIFT_COMMAND_COUNT);
        expect(new Set(COMMANDS.map((command) => command.name + command.arguments)).size).toBe(SWIFT_COMMAND_COUNT);
        expect(COMMANDS.find((command) => command.name === 'includegraphics' && command.arguments.startsWith('['))?.arguments)
            .toBe('[width=\\textwidth]{}');
    });

    it('Umgebungen: eingebaute und HgbThesis-Code-Umgebungen, ohne Duplikate', () => {
        expect(ENVIRONMENTS).toHaveLength(SWIFT_STATIC_ENVIRONMENT_COUNT + SWIFT_CODE_ENVIRONMENT_COUNT);
        expect(new Set(ENVIRONMENTS).size).toBe(ENVIRONMENTS.length);
        expect(ENVIRONMENTS).toEqual(expect.arrayContaining(['itemize', 'align*', 'program', 'GenericCode', 'YamlCode']));
    });

    it('Befehl → Argumentart: Anzahl je Art', () => {
        const counts: Record<string, number> = {};
        for (const kind of ARGUMENT_COMMANDS.values()) counts[kind] = (counts[kind] ?? 0) + 1;
        expect(counts).toEqual(SWIFT_ARGUMENT_COMMAND_COUNTS);
        expect(ARGUMENT_COMMANDS.get('cref')).toBe('label');
        expect(ARGUMENT_COMMANDS.get('textcite')).toBe('citation');
        expect(ARGUMENT_COMMANDS.get('gls')).toBe('acronym');
    });

    it('Optionen: Pakete, Standardklassen, Schlüssel', () => {
        expect(Object.keys(OPTION_CATALOG.packages)).toHaveLength(SWIFT_PACKAGE_COUNT);
        expect(OPTION_CATALOG.standardClasses).toEqual(['article', 'report', 'book', 'scrartcl', 'scrreprt', 'scrbook', '']);
        expect(OPTION_CATALOG.graphics.flags).toEqual(['keepaspectratio', 'clip', 'draft']);
        expect(Object.keys(OPTION_CATALOG.graphics.keys).sort()).toEqual(['angle', 'height', 'page', 'scale', 'trim', 'viewport', 'width']);
        expect(OPTION_CATALOG.floatPlacement.details.H).toBe('Hier erzwingen (H)');
        expect(OPTION_CATALOG.standardClass.flags).toHaveLength(18);
    });
});

describe('Optionen: Randfälle', () => {
    it('Schlüssel ohne Werte nennt der Vorschlag mit den ersten drei Werten, Schlüssel vor Schaltern', () => {
        const items = optionItems({ kind: 'package', name: 'hyperref' }, new Map());
        expect(items[0]).toEqual({ text: 'citecolor=', detail: 'black, blue' });
        expect(items.at(-1)?.text).toBe('bookmarksnumbered');
    });

    it('Windows-Zeilenenden: jeder Schlüssel wird gefunden', () => {
        const text = 'a.code = {}\r\nb.code = {}\r\n';
        const options = scanOptions([{ name: 'x.sty', text }]).get('x');
        expect(Object.keys(options?.keys ?? {})).toEqual(['a', 'b']);
    });
});
