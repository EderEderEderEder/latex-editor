import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type LogIssue, parseBiberLog, parseLog, parseLogBytes } from '../../src/shared/core/latex/logParser';
import { loadSpec, specDirectory, type SpecCase } from '../support/specVectors';

// Vektoren aus shared/spec/latex-log.json (Format: shared/spec/README.md), dazu eigene Randfälle und Leistung.

const PROJECT = '/Users/x/5 Semster/Projekt';
const SYNTHETIC_LOG_BYTES = 5 * 1024 * 1024;
const PERF_RUNS = 5;
// Großzügig für einen belasteten Rechner; gemessen wird der schnellste Lauf (Parsen eines 5-MB-Logs).
const PERF_BUDGET_MS = 100;
const LONG_LINE_LENGTH = 10_000;

interface LogInput {
    readonly op: 'parseLog' | 'parseBiberLog';
    readonly file?: string;
    readonly text?: string;
    readonly baseDirectory?: string;
    readonly onlySeverity?: string;
    readonly firstID?: number;
}

interface LogExpect {
    readonly summary?: string[];
    readonly isEmpty?: boolean;
    readonly files?: Record<string, string>;
    readonly details?: Record<string, string>;
    readonly fileList?: string[];
    readonly lineList?: number[];
    readonly firstLine?: number;
    readonly lastFile?: string;
    readonly lastLine?: number;
    readonly contains?: { messageContains: string; line: number }[];
    readonly messages?: string[];
    readonly firstSeverity?: string;
    readonly firstId?: number;
}

function baseName(path: string | null): string {
    return path === null ? '-' : (path.split(/[\\/]/).pop() ?? '-');
}

function relativeToBase(path: string | null, base: string): string | null {
    return path === null ? null : path.slice(base.length + 1);
}

function summarize(issues: readonly LogIssue[]): string[] {
    return issues.map((issue) => `${issue.severity} ${baseName(issue.file)}:${issue.line ?? '-'} ${issue.message}`);
}

function readFixture(file: string): Buffer {
    return readFileSync(join(specDirectory(), file));
}

function checkLatexExpectations(issues: LogIssue[], expected: LogExpect, base: string): void {
    if (expected.summary) expect(summarize(issues)).toEqual(expected.summary);
    if (expected.isEmpty) expect(issues).toEqual([]);
    for (const [index, path] of Object.entries(expected.files ?? {})) {
        expect(relativeToBase(issues[Number(index)]?.file ?? null, base)).toBe(path);
    }
    for (const [index, detail] of Object.entries(expected.details ?? {})) {
        expect(issues[Number(index)]?.detail).toBe(detail);
    }
    if (expected.fileList) expect(issues.map((issue) => relativeToBase(issue.file, base))).toEqual(expected.fileList);
    if (expected.lineList) expect(issues.map((issue) => issue.line)).toEqual(expected.lineList);
    if (expected.firstLine !== undefined) expect(issues[0]?.line).toBe(expected.firstLine);
    if (expected.lastFile !== undefined) expect(relativeToBase(issues.at(-1)?.file ?? null, base)).toBe(expected.lastFile);
    if (expected.lastLine !== undefined) expect(issues.at(-1)?.line).toBe(expected.lastLine);
    for (const entry of expected.contains ?? []) {
        expect(issues.some((issue) => issue.message.includes(entry.messageContains) && issue.line === entry.line)).toBe(true);
    }
}

function runLatexCase(input: LogInput, expected: LogExpect): void {
    const base = input.baseDirectory ?? PROJECT;
    const source = input.file !== undefined ? readFixture(input.file) : (input.text ?? '');
    const all = parseLog(source, base);
    const issues = input.onlySeverity === undefined ? all : all.filter((issue) => issue.severity === input.onlySeverity);
    checkLatexExpectations(issues, expected, base);
}

function runBiberCase(input: LogInput, expected: LogExpect): void {
    const issues = parseBiberLog(readFixture(input.file ?? ''), input.firstID ?? 0);
    if (expected.messages) expect(issues.map((issue) => issue.message)).toEqual(expected.messages);
    if (expected.firstSeverity !== undefined) expect(issues[0]?.severity).toBe(expected.firstSeverity);
    if (expected.firstId !== undefined) expect(issues[0]?.id).toBe(expected.firstId);
}

function runCase(specCase: SpecCase): void {
    const input = specCase.input as LogInput;
    const expected = specCase.expect as LogExpect;
    if (input.op === 'parseBiberLog') runBiberCase(input, expected);
    else runLatexCase(input, expected);
}

describe('Log-Parser: Vektoren (latex-log.json)', () => {
    const spec = loadSpec('latex-log');
    it('enthält alle 12 Fälle', () => {
        expect(spec.cases).toHaveLength(12);
    });
    for (const specCase of spec.cases) {
        it(`${specCase.id}: ${specCase.name}`, () => runCase(specCase));
    }
});

describe('Log-Parser: Bytes und Text', () => {
    it('parseLogBytes und parseLog liefern auf den Fixtures dasselbe', () => {
        for (const name of ['errors', 'fatal', 'warnings', 'clean', 'biber']) {
            const bytes = readFixture(`fixtures/${name}.log`);
            expect(parseLogBytes(bytes, PROJECT)).toEqual(parseLog(bytes.toString('utf8'), PROJECT));
        }
    });

    it('CRLF-Zeilenenden ergeben dieselben Meldungen wie LF', () => {
        const text = readFixture('fixtures/errors.log').toString('utf8');
        const crlf = text.replace(/\n/g, '\r\n');
        expect(parseLog(crlf, PROJECT)).toEqual(parseLog(text, PROJECT));
        const warnings = readFixture('fixtures/warnings.log').toString('utf8');
        expect(parseLog(warnings.replace(/\n/g, '\r\n'), PROJECT)).toEqual(parseLog(warnings, PROJECT));
    });

    it('Umlaute und Emoji bleiben in Meldungen erhalten', () => {
        const log = '(./main.tex\nLaTeX Warning: Reference `größe-😀' + "' on page 1 undefined on input line 4.\n";
        const [issue] = parseLog(log, PROJECT);
        expect(issue?.message).toBe("Reference `größe-😀' on page 1 undefined");
        expect(issue?.line).toBe(4);
        expect(parseLogBytes(Buffer.from(log, 'utf8'), PROJECT)).toEqual(parseLog(log, PROJECT));
    });

    it('Latin-1 und UTF-8 gemischt: gültiges UTF-8 bleibt, einzelne Latin-1-Bytes werden Zeichen', () => {
        const latin1Line = Buffer.concat([Buffer.from('LaTeX Warning: K'), Buffer.from([0xfc]), Buffer.from('r on input line 2.\n')]);
        const mixedLine = Buffer.concat([
            Buffer.from('LaTeX Warning: '),
            Buffer.from('ö', 'utf8'),
            Buffer.from([0xe4]),
            Buffer.from('😀 on input line 3.\n', 'utf8'),
        ]);
        expect(parseLogBytes(latin1Line, PROJECT)[0]?.message).toBe('Kür');
        expect(parseLogBytes(mixedLine, PROJECT)[0]?.message).toBe('öä😀');
    });

    it('Biber-Log: Fehler und Warnung, CRLF, Nummern ab firstId, ERROR vor WARN je Zeile', () => {
        const log = 'INFO - x\r\nWARN - nicht gezählt\r\n> WARN - Datei fehlt\r\n> ERROR - Kaputt ü\r\n';
        const issues = parseBiberLog(log, 7);
        expect(issues.map((issue) => [issue.id, issue.severity, issue.message])).toEqual([
            [7, 'warning', 'Biber: Datei fehlt'],
            [8, 'error', 'Biber: Kaputt ü'],
        ]);
        expect(issues[0]).toMatchObject({ file: null, line: null, detail: null });
    });
});

describe('Log-Parser: Randfälle', () => {
    it('leeres Log und Log ohne Fehler ergeben keine Meldungen', () => {
        expect(parseLog('', PROJECT)).toEqual([]);
        expect(parseLogBytes(new Uint8Array(0), PROJECT)).toEqual([]);
        expect(parseLog('\n\n(./main.tex\n[1{/usr/share/x.map}] [2]\n)\n', PROJECT)).toEqual([]);
        expect(parseBiberLog('', 0)).toEqual([]);
    });

    it('sehr lange Zeilen (max_print_line=10000): Warnung, Box und Fehlertext bleiben vollständig', () => {
        const filler = 'a'.repeat(LONG_LINE_LENGTH);
        const log = [
            '(./main.tex',
            `LaTeX Warning: ${filler} on input line 9.`,
            `Overfull \\hbox (1.0pt too wide) in paragraph at lines 3--4 ${filler}`,
            `[]\\OT1/cmr/m/n/10 ${filler} (offen`,
            '',
            `./main.tex:12: ${filler}`,
            'l.12 \\foo',
            '',
            'LaTeX Warning: Citation `k\' on page 1 undefined on input line 15.',
        ].join('\n');
        const issues = parseLog(log, PROJECT);
        expect(issues.map((issue) => [issue.severity, issue.line])).toEqual([
            ['warning', 9],
            ['badBox', 3],
            ['error', 12],
            ['warning', 15],
        ]);
        expect(issues[0]?.message).toBe(filler);
        expect(issues[2]?.message).toBe(filler);
        expect(issues.every((issue) => issue.file === `${PROJECT}/main.tex`)).toBe(true);
    });

    it('umbrochene Warnung mit (Paket)-Fortsetzungen wird zu einer Meldung', () => {
        const log = '(./main.tex\nPackage hyperref Warning: Token not allowed in a PDF string\n(hyperref)                removing `math shift\' on input line 7.\n';
        const issues = parseLog(log, PROJECT);
        expect(summarize(issues)).toEqual(["warning main.tex:7 Token not allowed in a PDF string removing `math shift'"]);
    });

    it('Folgefehler bleiben nur ohne eigentliche Ursache, Nummern bleiben wie vergeben', () => {
        const only = parseLog('! Emergency stop.\nl.1 x\n', PROJECT);
        expect(only.map((issue) => issue.message)).toEqual(['Emergency stop.']);
        const withCause = parseLog('! Undefined control sequence.\nl.2 \\x\n\n! Emergency stop.\nl.2 \\x\n', PROJECT);
        expect(withCause.map((issue) => [issue.id, issue.message])).toEqual([[0, 'Undefined control sequence.']]);
    });

    it('Pfade: relativ zum Basisordner, `..` aufgelöst, Windows-Laufwerke mit Rückstrich', () => {
        const posix = parseLog('./a/../b/./c.tex:3: Missing $ inserted.\n', '/proj/');
        expect(posix[0]?.file).toBe('/proj/b/c.tex');
        const windows = parseLog('./chapters/a.tex:3: Missing $ inserted.\nC:/proj/main.tex:4: Missing $ inserted.\n', 'C:\\proj');
        expect(windows.map((issue) => issue.file)).toEqual(['C:\\proj\\chapters\\a.tex', 'C:\\proj\\main.tex']);
    });

    it('Warnung ohne Datei im Stapel hat file null', () => {
        const [issue] = parseLog('LaTeX Warning: There were undefined references.\n', PROJECT);
        expect(issue).toMatchObject({ severity: 'warning', file: null, line: null, detail: null });
    });
});

function syntheticBlock(chapter: number): string {
    const file = `./chapters/kapitel${chapter}.tex`;
    const body = 'Dies ist ein Absatz mit Fülltext (und einer Klammer) ohne Bedeutung für den Parser.\n'.repeat(12);
    return [
        `(${file}`,
        body.trimEnd(),
        `LaTeX Warning: Reference \`sec:x${chapter}' on page ${chapter} undefined on input line 12.`,
        'Overfull \\hbox (1.0pt too wide) in paragraph at lines 3--4',
        '[]\\OT1/cmr/m/n/10 Text (mit offener Klammer',
        ' []',
        '',
        `${file}:5: Undefined control sequence.`,
        'l.5 \\foo',
        '        bar',
        ')',
        '',
    ].join('\n');
}

function buildSyntheticLog(): { log: Buffer; blocks: number } {
    const parts: string[] = [];
    let size = 0;
    let blocks = 0;
    while (size < SYNTHETIC_LOG_BYTES) {
        const block = syntheticBlock(blocks);
        parts.push(block);
        size += Buffer.byteLength(block);
        blocks += 1;
    }
    return { log: Buffer.from(parts.join(''), 'utf8'), blocks };
}

describe('Log-Parser: Leistung', () => {
    it(`ca. 5 MB Log in unter ${PERF_BUDGET_MS} ms (schnellster von ${PERF_RUNS} Läufen)`, () => {
        const { log, blocks } = buildSyntheticLog();
        expect(log.length).toBeGreaterThanOrEqual(SYNTHETIC_LOG_BYTES);
        const durations: number[] = [];
        let issues: LogIssue[] = [];
        for (let run = 0; run < PERF_RUNS; run += 1) {
            const started = performance.now();
            issues = parseLogBytes(log, PROJECT);
            durations.push(performance.now() - started);
        }
        expect(issues).toHaveLength(blocks * 3);
        expect(issues[0]?.file).toBe(`${PROJECT}/chapters/kapitel0.tex`);
        expect(Math.min(...durations)).toBeLessThan(PERF_BUDGET_MS);
    });
});
