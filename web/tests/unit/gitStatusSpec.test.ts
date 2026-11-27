import { delimiter } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitEnvironment, locateGit } from '../../src/main/git';
import {
    displayName,
    gitErrorFor,
    hasCommits,
    isRelevantInternalPath,
    parseStatus,
    pathInsideGitDirectory,
    projectPathFor,
    projectPrefix,
    stagedChanges,
    unstagedChanges,
    userMessage,
} from '../../src/main/gitStatus';
import { LINUX_PATHS } from '../../src/main/paths';
import { loadSpec, type SpecCase } from '../support/specVectors';

// Gemeinsame Vektoren `shared/spec/git-status.json` (Eingabe/Ausgabe je `op`: `notes` der Datei).
const EXPECTED_CASE_COUNT = 26;
// Der Vektor schreibt den macOS-Trenner; TypeScript nimmt den der Plattform.
const SPEC_PATH_DELIMITER = ':';

type Input = Record<string, any> & { readonly op: string };
type Expect = Record<string, any>;

const spec = loadSpec('git-status');

function checkParseStatus(input: Input, expected: Expect): void {
    const snapshot = parseStatus(String(input.output));
    const staged = stagedChanges(snapshot);
    const unstaged = unstagedChanges(snapshot);
    if ('branch' in expected) expect(snapshot.branch).toEqual(expected.branch);
    if ('branchHead' in expected) expect(snapshot.branch.head).toBe(expected.branchHead);
    if ('entryCount' in expected) expect(snapshot.entries).toHaveLength(expected.entryCount);
    if ('hasCommits' in expected) expect(hasCommits(snapshot.branch)).toBe(expected.hasCommits);
    if ('displayName' in expected) expect(displayName(snapshot.branch)).toBe(expected.displayName);
    if ('stagedPaths' in expected) expect(staged.map((change) => change.path)).toEqual(expected.stagedPaths);
    if ('stagedKinds' in expected) expect(staged.map((change) => change.kind)).toEqual(expected.stagedKinds);
    if ('unstagedPaths' in expected) expect(unstaged.map((change) => change.path)).toEqual(expected.unstagedPaths);
    if ('unstagedKinds' in expected) expect(unstaged.map((change) => change.kind)).toEqual(expected.unstagedKinds);
    if ('staged' in expected) expect(staged).toEqual(expected.staged);
}

async function checkLocate(input: Input, expected: Expect): Promise<void> {
    const executable = new Set<string>(input.executable);
    const found = await locateGit(input.candidates, (file) => Promise.resolve(executable.has(file)));
    expect(found).toBe(expected.path);
}

function checkEnvironment(input: Input, expected: Expect): void {
    const environment = gitEnvironment(input.base, process.platform);
    for (const [name, value] of Object.entries(expected.values ?? {})) expect(environment[name]).toBe(value);
    if ('pathHasSuffix' in expected) {
        const suffix = String(expected.pathHasSuffix).split(SPEC_PATH_DELIMITER).join(delimiter);
        expect(environment.PATH?.endsWith(suffix)).toBe(true);
    }
}

function checkUserMessage(input: Input, expected: Expect): void {
    const message = userMessage(String(input.message));
    if ('equals' in expected) expect(message).toBe(expected.equals);
    if ('contains' in expected) expect(message).toContain(expected.contains);
    if ('hasSuffix' in expected) expect(message.endsWith(expected.hasSuffix)).toBe(true);
}

function checkProjectMapping(input: Input, expected: Expect): void {
    const prefix = projectPrefix(input.root, input.projectRoot, LINUX_PATHS);
    if ('projectPrefix' in expected) expect(prefix).toBe(expected.projectPrefix);
    for (const [repositoryPath, url] of Object.entries(expected.urls ?? {})) {
        expect(projectPathFor(repositoryPath, input.projectRoot, prefix, LINUX_PATHS)).toBe(url);
    }
}

async function runCase(specCase: SpecCase): Promise<void> {
    const input = specCase.input as Input;
    const expected = specCase.expect as Expect;
    switch (input.op) {
        case 'parseStatus':
            return checkParseStatus(input, expected);
        case 'locateGit':
            return checkLocate(input, expected);
        case 'environment':
            return checkEnvironment(input, expected);
        case 'userMessage':
            return checkUserMessage(input, expected);
        case 'pathInsideGitDirectory':
            return void expect(pathInsideGitDirectory(input.path, input.gitDirectory)).toBe(expected.result);
        case 'isRelevantInternalPath':
            return void expect(isRelevantInternalPath(input.path)).toBe(expected.result);
        case 'projectMapping':
            return checkProjectMapping(input, expected);
        default:
            throw new Error(`Unbekannte Operation ${input.op}`);
    }
}

describe('Vektoren git-status', () => {
    it(`enthält ${EXPECTED_CASE_COUNT} Fälle`, () => {
        expect(spec.cases).toHaveLength(EXPECTED_CASE_COUNT);
    });

    for (const specCase of spec.cases) {
        it(`${specCase.id}: ${specCase.name}`, () => runCase(specCase));
    }
});

describe('Parser: Ränder', () => {
    it('ignorierte Einträge (!) und kaputte Zeilen werden verworfen, Umlaute bleiben unverändert', () => {
        const output = '! build/main.aux\u00001 M N... kaputt\u0000? Übung/Größe.tex\u0000';
        expect(parseStatus(output).entries).toEqual([
            { path: 'Übung/Größe.tex', originalPath: null, indexKind: null, worktreeKind: 'untracked' },
        ]);
    });

    it('Umbenennung am Ende ohne ursprünglichen Pfad: originalPath null', () => {
        const record = '2 R. N... 100644 100644 100644 a a R100 neu.tex';
        expect(parseStatus(`${record}\u0000`).entries[0]?.originalPath).toBeNull();
    });

    it('leere Meldung ergibt den allgemeinen Text; Netz- und Anmeldefehler bekommen ihre Fehlerart', () => {
        expect(userMessage(' \n')).toBe('Git ist fehlgeschlagen.');
        expect(gitErrorFor('fatal: Authentication failed').kind).toBe('authRequired');
        expect(gitErrorFor('nothing to commit').kind).toBe('nothingToCommit');
        expect(gitErrorFor('fatal: Not possible to fast-forward, aborting.').kind).toBe('nonFastForward');
    });
});
