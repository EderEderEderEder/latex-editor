import { execFile } from 'node:child_process';
import { access, constants, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { crc32, deflateRawSync, gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    backwardSearch,
    decompressSyncTeX,
    forwardSearch,
    loadSyncTeX,
    parseSyncTeX,
    sourcePathKey,
    SyncTeXError,
    type SyncTeXIndex,
    unionRect,
} from '../../src/main/synctex';

// Fixture und Referenzwerte aus swift/Tests/LatexEditorTests/SyncTeXTests.swift (Werte der
// `synctex`-Kommandozeile für two-chapters.synctex.gz, MacTeX 2026). Nie selbst nachrechnen.
const FIXTURE = fileURLToPath(new URL('../../../shared/spec/fixtures/two-chapters.synctex.gz', import.meta.url));
const FIXTURE_DIRECTORY = '/tmp/LatexEditor SyncTeX Fixture';
// Absichtlich über `/tmp` (Symlink) und ohne `./`, um die Pfadnormalisierung zu prüfen
const CHAPTER_ONE = `${FIXTURE_DIRECTORY}/chapters/eins.tex`;
const CHAPTER_TWO = `${FIXTURE_DIRECTORY}/chapters/zwei.tex`;
const POSITION_TOLERANCE = 0.5;
const FIXTURE_INPUT_COUNT = 12;
const FIXTURE_MAGNIFICATION = 1_000;

const VIEW_REFERENCES = [
    { file: CHAPTER_TWO, line: 3, page: 2, left: 133.768356, baseline: 340.838989, width: 343.71106 },
    { file: CHAPTER_TWO, line: 5, page: 2, left: 133.768356, baseline: 351.687195, width: 343.71106 },
    { file: CHAPTER_TWO, line: 8, page: 3, left: 133.768356, baseline: 136.701797, width: 343.71106 },
    { file: CHAPTER_ONE, line: 2, page: 1, left: 133.768356, baseline: 313.040497, width: 343.71106 },
];

const EDIT_REFERENCES = [
    { page: 2, x: 200, y: 339, file: CHAPTER_TWO, line: 3 },
    { page: 2, x: 250, y: 351, file: CHAPTER_TWO, line: 5 },
    { page: 3, x: 200, y: 136, file: CHAPTER_TWO, line: 8 },
    { page: 1, x: 200, y: 311, file: CHAPTER_ONE, line: 2 },
];

const MAC = 'darwin' as const;

function samePath(actual: string | undefined, expected: string): boolean {
    return actual !== undefined && sourcePathKey(actual, MAC) === sourcePathKey(expected, MAC);
}

function loadFixture(): Promise<SyncTeXIndex> {
    return loadSyncTeX(FIXTURE, { platform: MAC });
}

describe('SyncTeX: Einlesen', () => {
    it('gzip wird mit node:zlib entpackt', async () => {
        const text = new TextDecoder().decode(await decompressSyncTeX(await readFile(FIXTURE)));
        expect(text.startsWith('SyncTeX Version:1')).toBe(true);
        expect(text).toContain('Input:9:/private/tmp/LatexEditor SyncTeX Fixture/./chapters/zwei.tex');
    });

    it('gzip-Kopf mit Dateinamen-Feld wird übersprungen', async () => {
        const original = new TextEncoder().encode('SyncTeX Version:1\nInput:1:/a.tex\n');
        const header = Buffer.from([0x1f, 0x8b, 0x08, 0x08, 0, 0, 0, 0, 0, 0x03]);
        const trailer = Buffer.alloc(8);
        trailer.writeUInt32LE(crc32(original), 0);
        trailer.writeUInt32LE(original.length, 4);
        const data = Buffer.concat([header, Buffer.from('main.synctex\0'), deflateRawSync(original), trailer]);
        expect(Buffer.from(await decompressSyncTeX(data)).equals(Buffer.from(original))).toBe(true);
    });

    it('Abgeschnittene oder fremde Daten führen zu einem Fehler, nicht zum Absturz', async () => {
        const data = await readFile(FIXTURE);
        await expect(decompressSyncTeX(data.subarray(0, data.length / 2))).rejects.toThrow(SyncTeXError);
        await expect(decompressSyncTeX(new TextEncoder().encode('kein gzip'))).rejects.toThrow(SyncTeXError);
        expect(() => parseSyncTeX(new Uint8Array())).toThrow(SyncTeXError);
    });

    it('Eingabedateien und Seiten werden erkannt', async () => {
        const index = await loadFixture();
        expect(index.inputs.size).toBe(FIXTURE_INPUT_COUNT);
        expect([...index.pageRanges.keys()].sort()).toEqual([1, 2, 3]);
        expect(index.geometry.magnification).toBe(FIXTURE_MAGNIFICATION);
    });

    it('Unkomprimierte .synctex-Dateien werden ebenfalls gelesen', async () => {
        const plain = await decompressSyncTeX(await readFile(FIXTURE));
        const index = parseSyncTeX(plain, { platform: MAC });
        expect(forwardSearch(index, CHAPTER_TWO, 3)?.page).toBe(2);
    });

    it('CRLF-Zeilenenden (Windows) ändern nichts', async () => {
        const plain = new TextDecoder().decode(await decompressSyncTeX(await readFile(FIXTURE)));
        const crlf = parseSyncTeX(new TextEncoder().encode(plain.replaceAll('\n', '\r\n')), { platform: MAC });
        const lf = parseSyncTeX(new TextEncoder().encode(plain), { platform: MAC });
        expect(forwardSearch(crlf, CHAPTER_TWO, 3)).toEqual(forwardSearch(lf, CHAPTER_TWO, 3));
        expect([...crlf.inputs.values()]).toEqual([...lf.inputs.values()]);
    });
});

describe('SyncTeX: Vorwärtssuche (Quelltext → PDF)', () => {
    let index: SyncTeXIndex;
    beforeAll(async () => {
        index = await loadFixture();
    });

    it.each(VIEW_REFERENCES)('$file:$line wie die synctex-Kommandozeile', (reference) => {
        const result = forwardSearch(index, reference.file, reference.line);
        const rect = unionRect(result?.rects ?? []);
        expect(result?.page).toBe(reference.page);
        expect(rect).not.toBeNull();
        expect(Math.abs(rect!.x - reference.left)).toBeLessThan(POSITION_TOLERANCE);
        expect(Math.abs(rect!.width - reference.width)).toBeLessThan(POSITION_TOLERANCE);
        expect(rect!.y).toBeLessThanOrEqual(reference.baseline);
        expect(reference.baseline).toBeLessThanOrEqual(rect!.y + rect!.height + POSITION_TOLERANCE);
    });

    it('Leerzeile führt zur Zeile davor, Zeile hinter dem Ende zur letzten', () => {
        expect(forwardSearch(index, CHAPTER_TWO, 4)).toEqual(forwardSearch(index, CHAPTER_TWO, 3));
        expect(forwardSearch(index, CHAPTER_TWO, 999)?.page).toBe(3);
        expect(forwardSearch(index, CHAPTER_TWO, -5)).not.toBeNull();
    });

    it('Pfade mit ./, Symlink und Leerzeichen werden gleich behandelt', () => {
        const variants = [
            '/private/tmp/LatexEditor SyncTeX Fixture/./chapters/zwei.tex',
            '/tmp/LatexEditor SyncTeX Fixture/chapters/../chapters/zwei.tex',
            '/tmp/LatexEditor SyncTeX Fixture/chapters/zwei.tex',
        ];
        const results = variants.map((variant) => forwardSearch(index, variant, 3));
        expect(results[0]).not.toBeNull();
        for (const result of results) expect(result).toEqual(results[0]);
    });

    it('Unbekannte Datei ergibt kein Ergebnis', () => {
        expect(forwardSearch(index, '/gibt/es/nicht.tex', 1)).toBeNull();
        expect(forwardSearch(index, 'relativ.tex', 1)).toBeNull();
    });
});

describe('SyncTeX: Rückwärtssuche (PDF → Quelltext)', () => {
    let index: SyncTeXIndex;
    beforeAll(async () => {
        index = await loadFixture();
    });

    it.each(EDIT_REFERENCES)('Seite $page ($x, $y) wie die synctex-Kommandozeile', (reference) => {
        const location = backwardSearch(index, reference.page, reference.x, reference.y);
        expect(samePath(location?.file, reference.file)).toBe(true);
        expect(location?.line).toBe(reference.line);
    });

    it('Hin und zurück landet auf derselben Zeile', () => {
        const cases = [[CHAPTER_TWO, 3], [CHAPTER_TWO, 5], [CHAPTER_TWO, 8], [CHAPTER_ONE, 2]] as const;
        for (const [file, line] of cases) {
            const box = forwardSearch(index, file, line);
            const rect = unionRect(box?.rects ?? []);
            expect(rect).not.toBeNull();
            const location = backwardSearch(index, box!.page, rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
            expect(samePath(location?.file, file)).toBe(true);
            expect(Math.abs((location?.line ?? Infinity) - line)).toBeLessThanOrEqual(1);
        }
    });

    it('Seite außerhalb des Dokuments ergibt kein Ergebnis', () => {
        expect(backwardSearch(index, 0, 0, 0)).toBeNull();
        expect(backwardSearch(index, 99, 100, 100)).toBeNull();
    });

    it('Ergebnispfad ist normalisiert (ohne ./)', () => {
        const location = backwardSearch(index, 2, 200, 339);
        expect(location?.file).toBe('/private/tmp/LatexEditor SyncTeX Fixture/chapters/zwei.tex');
    });
});

const SYNTHETIC_LINE_SPACING = 1_000_000;

// Kleine synthetische Datei mit einer Zeilenbox je Quelltextzeile (Werte frei gewählt, nur zum
// Prüfen der Pfadzuordnung, keine Referenzwerte).
function syntheticSyncTeX(inputs: readonly string[]): Uint8Array {
    const header = ['SyncTeX Version:1', ...inputs.map((path, index) => `Input:${index + 1}:${path}`)];
    const boxes = inputs.map((_, index) => {
        const tag = index + 1;
        const baseline = tag * SYNTHETIC_LINE_SPACING;
        return `(${tag},1:100,${baseline}:3000000,300000,0\nx${tag},1:150,${baseline}\n)`;
    });
    const body = ['Magnification:1000', 'Unit:1', 'X Offset:0', 'Y Offset:0', 'Content:', '{1', ...boxes, '}1'];
    return new TextEncoder().encode([...header, ...body, ''].join('\n'));
}

describe('SyncTeX: Pfade unter Windows (path.win32)', () => {
    const WIN = 'win32' as const;
    const inputs = [
        'C:/Users/Max/Doku/./main.tex',
        'c:\\Users\\Max\\Doku\\chapters\\Einführung.tex',
        'D:\\Mit Leerzeichen\\kapitel\\..\\Zwei.TEX',
        './relativ/drei.tex',
        '//server/share/vier.tex',
    ];
    const index = parseSyncTeX(syntheticSyncTeX(inputs), { platform: WIN, baseDirectory: 'C:\\Users\\Max\\Doku' });

    it.each([
        ['C:\\Users\\Max\\Doku\\main.tex', 1],
        ['c:\\users\\max\\doku\\MAIN.tex', 1],
        ['C:/Users/Max/Doku/chapters/Einführung.tex', 2],
        // macOS liefert Umlaute zerlegt (NFD); der Schlüssel ist NFC
        ['C:\\Users\\Max\\Doku\\chapters\\Einfu\u0308hrung.tex', 2],
        ['d:\\mit leerzeichen\\zwei.tex', 3],
        ['C:\\Users\\Max\\Doku\\relativ\\drei.tex', 4],
        ['\\\\server\\share\\vier.tex', 5],
    ])('%s wird gefunden', (file, tag) => {
        const result = forwardSearch(index, file, 1);
        expect(result).not.toBeNull();
        const rect = result!.rects[0]!;
        const location = backwardSearch(index, 1, rect.x + rect.width / 2, rect.y + rect.height / 2);
        expect(sourcePathKey(location!.file, WIN)).toBe(sourcePathKey(file, WIN));
        expect(index.inputs.get(tag)).toBe(location!.file);
    });

    it('Rückwärtssuche liefert Windows-Pfade mit Laufwerk und \\', () => {
        expect(index.inputs.get(1)).toBe('C:\\Users\\Max\\Doku\\main.tex');
        expect(index.inputs.get(3)).toBe('D:\\Mit Leerzeichen\\Zwei.TEX');
    });

    it('Groß-/Kleinschreibung zählt unter Linux', () => {
        const linux = parseSyncTeX(syntheticSyncTeX(['/home/max/Main.tex']), { platform: 'linux' });
        expect(forwardSearch(linux, '/home/max/Main.tex', 1)).not.toBeNull();
        expect(forwardSearch(linux, '/home/max/main.tex', 1)).toBeNull();
    });
});

// Gegenprobe mit dem echten Werkzeug (nur als Referenz; überspringt sich ohne MacTeX).
const SYNCTEX_COMMAND = '/Library/TeX/texbin/synctex';
const CLI_LINES_CHAPTER_TWO = [1, 2, 3, 5, 6, 8];
const runCommand = promisify(execFile);

async function hasCommand(): Promise<boolean> {
    try {
        await access(SYNCTEX_COMMAND, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

async function runSyncTeX(args: string[], cwd: string): Promise<Map<string, string>> {
    const { stdout } = await runCommand(SYNCTEX_COMMAND, args, { cwd });
    const values = new Map<string, string>();
    for (const line of stdout.split('\n')) {
        const colon = line.indexOf(':');
        if (colon > 0 && !values.has(line.slice(0, colon))) values.set(line.slice(0, colon), line.slice(colon + 1));
    }
    return values;
}

describe.runIf(await hasCommand())('SyncTeX gegen die synctex-Kommandozeile (nur mit MacTeX)', () => {
    let directory: string;
    let index: SyncTeXIndex;
    beforeAll(async () => {
        directory = await mkdtemp(join(tmpdir(), 'synctex-cli-'));
        await copyFile(FIXTURE, join(directory, 'two-chapters.synctex.gz'));
        index = await loadFixture();
    });
    afterAll(async () => {
        await rm(directory, { recursive: true, force: true });
    });

    it.each(CLI_LINES_CHAPTER_TWO)('zwei.tex:%i vorwärts und rückwärts gleich', async (line) => {
        const view = await runSyncTeX(['view', '-i', `${line}:0:${CHAPTER_TWO}`, '-o', 'two-chapters.pdf'], directory);
        const result = forwardSearch(index, CHAPTER_TWO, line);
        const rect = unionRect(result?.rects ?? []);
        expect(String(result?.page)).toBe(view.get('Page'));
        expect(Math.abs(rect!.x - Number(view.get('h')))).toBeLessThan(POSITION_TOLERANCE);
        const [x, y] = [rect!.x + rect!.width / 2, rect!.y + rect!.height / 2];
        const edit = await runSyncTeX(['edit', '-o', `${result!.page}:${x}:${y}:two-chapters.pdf`], directory);
        expect(String(backwardSearch(index, result!.page, x, y)?.line)).toBe(edit.get('Line'));
    });
});

describe('SyncTeX: gzip-Fehler', () => {
    it('loadSyncTeX meldet eine unvollständige Datei als SyncTeXError', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'synctex-broken-'));
        try {
            const file = join(directory, 'main.synctex.gz');
            const data = gzipSync(Buffer.from('SyncTeX Version:1\n'));
            await writeFile(file, data.subarray(0, data.length - 4));
            await expect(loadSyncTeX(file)).rejects.toThrow(SyncTeXError);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
