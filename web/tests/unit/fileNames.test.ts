import { describe, expect, it } from 'vitest';
import {
    assertValidFileName,
    extensionOf,
    MAX_FILE_NAME_LENGTH,
    newFileName,
    renamedFileName,
    validateFileName,
    type FileNameProblem,
} from '../../src/shared/core/fileNames';
import { IpcFailure } from '../../src/shared/ipcResult';
import { loadSpec } from '../support/specVectors';

const MAC = { windows: false };
const WINDOWS = { windows: true };

interface VectorInput {
    readonly op: string;
    readonly name: string;
    readonly original?: string;
    readonly originalIsDirectory?: boolean;
}

interface VectorExpect {
    readonly result?: string;
    readonly error?: string;
}

/** Namen der Swift-`FileOperationError`-Fälle */
const SWIFT_ERROR_BY_PROBLEM: Readonly<Record<FileNameProblem, string>> = {
    empty: 'emptyName',
    dotName: 'invalidCharacters',
    controlCharacter: 'invalidCharacters',
    separator: 'invalidCharacters',
    alternateDataStream: 'invalidCharacters',
    reservedCharacter: 'invalidCharacters',
    trailingDotOrSpace: 'invalidCharacters',
    deviceName: 'invalidCharacters',
    hidden: 'hiddenName',
    tooLong: 'nameTooLong',
};

const VECTOR_OPERATIONS = ['fileNameValidate', 'fileNameNew', 'fileNameRenamed'];
const EXPECTED_VECTOR_COUNT = 13;

function swiftError(name: string, platform: { windows: boolean }): string | undefined {
    const problem = validateFileName(name, platform);
    return problem === null ? undefined : SWIFT_ERROR_BY_PROBLEM[problem];
}

function checkVector(input: VectorInput, expected: VectorExpect): void {
    for (const platform of [MAC, WINDOWS]) {
        if (input.op === 'fileNameValidate') {
            expect(swiftError(input.name, platform)).toBe(expected.error);
        } else if (input.op === 'fileNameNew') {
            expect(newFileName(input.name, platform)).toBe(expected.result);
        } else {
            expect(renamedFileName(input.name, input.original ?? '', input.originalIsDirectory === true, platform)).toBe(expected.result);
        }
    }
}

describe('Dateinamen: Vektoren aus misc.json', () => {
    const cases = loadSpec('misc').cases.filter((specCase) => VECTOR_OPERATIONS.includes((specCase.input as VectorInput).op));

    it('enthält alle erwarteten Fälle', () => {
        expect(cases.length).toBe(EXPECTED_VECTOR_COUNT);
    });

    for (const specCase of cases) {
        it(`${specCase.id}: ${specCase.name}`, () => {
            try {
                checkVector(specCase.input as VectorInput, specCase.expect as VectorExpect);
            } catch (error) {
                throw new Error(`Vektor ${specCase.id} (${specCase.name}): ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }
});

describe('Namen im Detail', () => {
    it('Windows-Gerätenamen nur unter Windows', () => {
        expect(validateFileName('nul.tex', WINDOWS)).toBe('deviceName');
        expect(validateFileName('nul.tex', MAC)).toBeNull();
    });

    it('Grenze der Namenslänge', () => {
        expect(validateFileName('x'.repeat(MAX_FILE_NAME_LENGTH), MAC)).toBeNull();
        expect(validateFileName('x'.repeat(MAX_FILE_NAME_LENGTH + 1), MAC)).toBe('tooLong');
    });

    it('assertValidFileName kürzt Ränder und wirft IpcFailure mit Meldung', () => {
        expect(assertValidFileName('  Ordner  ', MAC)).toBe('Ordner');
        expect(() => assertValidFileName('a/b', MAC)).toThrow(IpcFailure);
    });

    it('extensionOf: letzter Namensteil, versteckte Namen ohne Endung', () => {
        expect(extensionOf('/p/einleitung.tex')).toBe('.tex');
        expect(extensionOf('C:\\p\\ordner.v2')).toBe('.v2');
        expect(extensionOf('.gitignore')).toBe('');
        expect(extensionOf('/p.d/datei')).toBe('');
        expect(extensionOf('a.b.bib')).toBe('.bib');
    });

    it('Umbenennen mit ganzem Pfad als Original', () => {
        expect(renamedFileName('intro', 'C:\\p\\kapitel.tex', false, WINDOWS)).toBe('intro.tex');
    });
});
