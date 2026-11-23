import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IpcFailure } from '../../src/shared/ipcResult';
import { hashBytes, MAX_TEXT_FILE_BYTES, RENAME_RETRY_DELAYS_MS, readTextFile, writeTextFile } from '../../src/main/textIo';

let dir: string;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'textio-'));
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

async function fileWith(name: string, content: Buffer | string): Promise<string> {
    const path = join(dir, name);
    await writeFile(path, content);
    return path;
}

async function failureKind(promise: Promise<unknown>): Promise<string | undefined> {
    try {
        await promise;
    } catch (error) {
        return error instanceof IpcFailure ? error.error.kind : 'other';
    }
    return undefined;
}

async function roundTrip(path: string): Promise<Buffer> {
    const file = await readTextFile(path);
    await writeTextFile(path, file.text, file.encoding, file.eol, file.hash);
    return readFile(path);
}

describe('readTextFile', () => {
    it('liest Latin-1 mit Umlauten und schreibt byte-gleich zurück', async () => {
        const bytes = Buffer.from('Grüße aus Österreich ß\n', 'latin1');
        const path = await fileWith('a.tex', bytes);
        const file = await readTextFile(path);
        expect(file.encoding).toBe('latin1');
        expect(file.text).toBe('Grüße aus Österreich ß\n');
        expect(await roundTrip(path)).toEqual(bytes);
    });

    it('erhält CRLF und liefert intern LF', async () => {
        const bytes = Buffer.from('a\r\nb\r\nc\r\n');
        const path = await fileWith('crlf.tex', bytes);
        const file = await readTextFile(path);
        expect(file.eol).toBe('crlf');
        expect(file.text).toBe('a\nb\nc\n');
        expect(await roundTrip(path)).toEqual(bytes);
    });

    it('gemischte Zeilenenden: Mehrheit gewinnt', async () => {
        const path = await fileWith('mixed.tex', 'a\r\nb\r\nc\nd');
        expect((await readTextFile(path)).eol).toBe('crlf');
        const lfPath = await fileWith('mixed2.tex', 'a\nb\nc\r\nd');
        expect((await readTextFile(lfPath)).eol).toBe('lf');
    });

    it('erhält das UTF-8-BOM', async () => {
        const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Hallo\n')]);
        const path = await fileWith('bom.tex', bytes);
        expect((await readTextFile(path)).encoding).toBe('utf8');
        expect(await roundTrip(path)).toEqual(bytes);
    });

    it('liest UTF-8 mit Emoji und Umlauten', async () => {
        const bytes = Buffer.from('Größe 😀 \\emph{x}\n', 'utf8');
        const path = await fileWith('u.tex', bytes);
        const file = await readTextFile(path);
        expect(file.encoding).toBe('utf8');
        expect(file.text).toBe('Größe 😀 \\emph{x}\n');
        expect(await roundTrip(path)).toEqual(bytes);
    });

    it('leere Datei und Datei ohne abschließenden Zeilenumbruch', async () => {
        const empty = await fileWith('empty.tex', '');
        const file = await readTextFile(empty);
        expect(file).toMatchObject({ text: '', encoding: 'utf8', eol: 'lf' });
        expect((await roundTrip(empty)).length).toBe(0);
        const noNewline = await fileWith('n.tex', 'ohne Ende');
        expect((await roundTrip(noNewline)).toString()).toBe('ohne Ende');
    });

    it('meldet nicht gefunden', async () => {
        expect(await failureKind(readTextFile(join(dir, 'fehlt.tex')))).toBe('notFound');
    });

    it('lehnt zu große Dateien ab', async () => {
        const path = await fileWith('big.tex', Buffer.alloc(MAX_TEXT_FILE_BYTES + 1, 0x61));
        expect(await failureKind(readTextFile(path))).toBe('invalidInput');
    });
});

describe('writeTextFile', () => {
    it('liefert Hash und mtime der geschriebenen Datei', async () => {
        const path = join(dir, 'neu.tex');
        const result = await writeTextFile(path, 'a\nb', 'utf8', 'crlf');
        const bytes = await readFile(path);
        expect(bytes.toString()).toBe('a\r\nb');
        expect(result.hash).toBe(hashBytes(bytes));
        expect(result.mtime).toBeGreaterThan(0);
    });

    it('erkennt einen Konflikt bei fremdem Hash und lässt die Datei unverändert', async () => {
        const path = await fileWith('c.tex', 'original');
        const kind = await failureKind(writeTextFile(path, 'neu', 'utf8', 'lf', 'fremd'));
        expect(kind).toBe('conflict');
        expect(await readFile(path, 'utf8')).toBe('original');
        expect(await readdir(dir)).toEqual(['c.tex']);
    });

    it('wiederholt das Umbenennen bei EBUSY', async () => {
        const path = await fileWith('r.tex', 'alt');
        const delays: number[] = [];
        let calls = 0;
        const rename = async (from: string, to: string): Promise<void> => {
            calls++;
            if (calls <= 2) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
            const { rename: realRename } = await import('node:fs/promises');
            await realRename(from, to);
        };
        await writeTextFile(path, 'neu', 'utf8', 'lf', undefined, { rename, sleep: async (ms) => void delays.push(ms) });
        expect(calls).toBe(3);
        expect(delays).toEqual(RENAME_RETRY_DELAYS_MS.slice(0, 2));
        expect(await readFile(path, 'utf8')).toBe('neu');
        expect(await readdir(dir)).toEqual(['r.tex']);
    });

    it('räumt nach endgültigem Fehler auf und lässt das Original unverändert', async () => {
        const path = await fileWith('f.tex', 'original');
        const rename = async (): Promise<void> => {
            throw Object.assign(new Error('gesperrt'), { code: 'EBUSY' });
        };
        const kind = await failureKind(writeTextFile(path, 'neu', 'utf8', 'lf', undefined, { rename, sleep: async () => {} }));
        expect(kind).toBe('io');
        expect(await readFile(path, 'utf8')).toBe('original');
        expect(await readdir(dir)).toEqual(['f.tex']);
    });

    it('bricht bei nicht wiederholbarem Fehler sofort ab', async () => {
        const path = await fileWith('g.tex', 'original');
        let calls = 0;
        const rename = async (): Promise<void> => {
            calls++;
            throw Object.assign(new Error('weg'), { code: 'ENOENT' });
        };
        await failureKind(writeTextFile(path, 'neu', 'utf8', 'lf', undefined, { rename }));
        expect(calls).toBe(1);
        expect(await readdir(dir)).toEqual(['g.tex']);
    });

    it('lehnt Zeichen ab, die Latin-1 nicht darstellen kann', async () => {
        const path = await fileWith('l.tex', 'x');
        expect(await failureKind(writeTextFile(path, 'Emoji 😀', 'latin1', 'lf'))).toBe('invalidInput');
        expect(await readFile(path, 'utf8')).toBe('x');
    });

    it('lehnt zu großen Text ab', async () => {
        const path = join(dir, 'big.tex');
        const text = 'a'.repeat(MAX_TEXT_FILE_BYTES + 1);
        expect(await failureKind(writeTextFile(path, text, 'utf8', 'lf'))).toBe('invalidInput');
        expect(await readdir(dir)).toEqual([]);
    });
});
