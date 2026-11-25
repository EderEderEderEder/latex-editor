import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GrantStore } from '../../src/main/grants';
import {
    createPdfHandlers, isCompletePdf, PDF_MESSAGES, PDF_READ_ATTEMPTS, PDF_RETRY_DELAY_MS, type PdfHandlers,
} from '../../src/main/handlers/pdfHandlers';
import { currentPathPlatform } from '../../src/main/paths';
import { IpcFailure } from '../../src/shared/ipcResult';

const FIXTURE = join(__dirname, '../fixtures/vier-seiten.pdf');
const PARTIAL_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog', 'latin1');

let base: string;
let project: string;
let outside: string;
let grants: GrantStore;
let handlers: PdfHandlers;
let fixture: Buffer;

beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'pdf-handlers-')));
    project = join(base, 'Projekt');
    outside = join(base, 'Fremd');
    await mkdir(project);
    await mkdir(outside);
    fixture = await readFile(FIXTURE);
    grants = new GrantStore({ platform: currentPathPlatform() });
    grants.openProject(grants.grant(project, 'project').grantId);
    handlers = createPdfHandlers({ grants, wait: () => Promise.resolve() });
});

afterEach(async () => {
    await rm(base, { recursive: true, force: true });
});

async function errorOf(action: () => Promise<unknown>): Promise<{ kind: string; message: string } | null> {
    try {
        await action();
        return null;
    } catch (error) {
        return error instanceof IpcFailure ? error.error : { kind: 'other', message: String(error) };
    }
}

describe('pdf:open im Projekt', () => {
    it('liefert die Bytes des PDFs unverändert als Uint8Array', async () => {
        const file = join(project, 'main.pdf');
        await writeFile(file, fixture);
        const source = await handlers['pdf:open'](file);
        expect(source.kind).toBe('bytes');
        expect(source.bytes).toBeInstanceOf(Uint8Array);
        expect(Buffer.from(source.bytes).equals(fixture)).toBe(true);
    });

    it('akzeptiert die Endung unabhängig von Groß-/Kleinschreibung', async () => {
        const file = join(project, 'MAIN.PDF');
        await writeFile(file, fixture);
        expect((await handlers['pdf:open'](file)).bytes.length).toBe(fixture.length);
    });

    it('meldet notFound, wenn das PDF fehlt', async () => {
        expect((await errorOf(() => handlers['pdf:open'](join(project, 'fehlt.pdf'))))?.kind).toBe('notFound');
    });
});

describe('pdf:open Pfadprüfung', () => {
    it('verweigert Pfade außerhalb des Projekts, auch über einen Symlink', async () => {
        const secret = join(outside, 'geheim.pdf');
        await writeFile(secret, fixture);
        await symlink(secret, join(project, 'link.pdf'));
        expect((await errorOf(() => handlers['pdf:open'](secret)))?.kind).toBe('forbiddenPath');
        expect((await errorOf(() => handlers['pdf:open'](join(project, 'link.pdf'))))?.kind).toBe('forbiddenPath');
    });

    it('verweigert relative Pfade und Kennungen', async () => {
        expect((await errorOf(() => handlers['pdf:open']('main.pdf')))?.kind).toBe('invalidInput');
        expect((await errorOf(() => handlers['pdf:open']('Projekt/main.pdf')))?.kind).toBe('invalidInput');
    });

    it('verweigert „..“ auch dann, wenn der Pfad im Projekt bliebe', async () => {
        await writeFile(join(project, 'main.pdf'), fixture);
        // Als Text zusammengesetzt: `join` würde das „..“ schon auflösen.
        expect(await errorOf(() => handlers['pdf:open'](`${project}/kapitel/../main.pdf`))).toEqual({
            kind: 'forbiddenPath', message: PDF_MESSAGES.parentSegment,
        });
    });

    it('liest nur PDF-Dateien', async () => {
        await writeFile(join(project, 'main.tex'), '\\documentclass{article}');
        expect(await errorOf(() => handlers['pdf:open'](join(project, 'main.tex')))).toEqual({
            kind: 'invalidInput', message: PDF_MESSAGES.notPdf,
        });
    });

    it('ohne geöffnetes Projekt: notFound', async () => {
        const withoutProject = createPdfHandlers({ grants: new GrantStore({ platform: currentPathPlatform() }) });
        expect((await errorOf(() => withoutProject['pdf:open'](join(project, 'main.pdf'))))?.kind).toBe('notFound');
    });
});

describe('pdf:open unvollständige Datei', () => {
    it('erkennt Kopf und Ende', () => {
        expect(isCompletePdf(fixture)).toBe(true);
        expect(isCompletePdf(PARTIAL_PDF)).toBe(false);
        expect(isCompletePdf(new Uint8Array())).toBe(false);
        expect(isCompletePdf(Buffer.from('kein PDF\n%%EOF\n', 'latin1'))).toBe(false);
    });

    it('liest nach kurzer Wartezeit erneut, sobald latexmk fertig geschrieben hat', async () => {
        const reads = [PARTIAL_PDF, fixture];
        const readBytes = vi.fn(() => Promise.resolve(reads.shift() ?? fixture));
        const wait = vi.fn(() => Promise.resolve());
        await writeFile(join(project, 'main.pdf'), fixture);
        const source = await createPdfHandlers({ grants, readBytes, wait })['pdf:open'](join(project, 'main.pdf'));
        expect(Buffer.from(source.bytes).equals(fixture)).toBe(true);
        expect(readBytes).toHaveBeenCalledTimes(2);
        expect(wait).toHaveBeenCalledWith(PDF_RETRY_DELAY_MS);
    });

    it('bleibt die Datei unvollständig, kommt nach allen Versuchen ein Fehler (der Renderer behält die alte Ansicht)', async () => {
        await writeFile(join(project, 'main.pdf'), PARTIAL_PDF);
        const readBytes = vi.fn(() => Promise.resolve(PARTIAL_PDF));
        const error = await errorOf(() => createPdfHandlers({ grants, readBytes, wait: () => Promise.resolve() })['pdf:open'](
            join(project, 'main.pdf'),
        ));
        expect(error).toEqual({ kind: 'io', message: PDF_MESSAGES.incomplete });
        expect(readBytes).toHaveBeenCalledTimes(PDF_READ_ATTEMPTS);
    });
});
