import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GrantStore } from '../../src/main/grants';
import { createDialogHandlers, type DialogLike } from '../../src/main/handlers/dialogHandlers';
import { createFsHandlers } from '../../src/main/handlers/fsHandlers';
import { currentPathPlatform } from '../../src/main/paths';
import { createPreloadStub } from '../support/preloadStub';

// Vertragstest (H1): Der Stub-Preload antwortet wie der Main, sonst merken E2E-Tests Fehler wie „GrantId im
// Tab-Titel“ nicht. Verglichen werden Schlüssel und Typen, dazu die Regel `path` = gesendetes Ziel.

const FILE_NAME = 'quellen.bib';
const FILE_TEXT = '@book{a,\n}\n';

type Shape = Record<string, string>;

function shapeOf(value: object): Shape {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, typeof entry]));
}

let base: string;

beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'stub-contract-')));
});

afterEach(async () => {
    await rm(base, { recursive: true, force: true });
});

async function mainAnswers() {
    const file = join(base, FILE_NAME);
    await writeFile(file, FILE_TEXT);
    const grants = new GrantStore({ platform: currentPathPlatform() });
    const dialog: DialogLike<object> = {
        showOpenDialog: () => Promise.resolve({ canceled: false, filePaths: [file] }),
        showSaveDialog: () => Promise.resolve({ canceled: true }),
    };
    const dialogs = createDialogHandlers({ dialog, grants, window: () => ({}), platform: currentPathPlatform() });
    const [picked] = (await dialogs['dialog:pickFiles']({})) ?? [];
    const fs = createFsHandlers({ grants });
    return { picked: picked!, read: await fs['fs:readText'](picked!.grantId), many: await fs['fs:readMany']([picked!.grantId]) };
}

async function stubAnswers() {
    const stub = createPreloadStub();
    (stub.api as unknown as { __stub: { prepareFile(name: string, text: string): void } }).__stub.prepareFile(FILE_NAME, FILE_TEXT);
    const picked = await stub.api.dialog.pickFiles({});
    const grant = picked.ok ? picked.value?.[0] : undefined;
    const read = await stub.api.fs.readText(grant!.grantId);
    const many = await stub.api.fs.readMany([grant!.grantId]);
    if (!read.ok || !many.ok) throw new Error('Stub antwortet mit Fehler');
    return { picked: grant!, read: read.value, many: many.value };
}

describe('Stub- und Main-Antwort gleich geformt', () => {
    it('dialog:pickFiles und fs:readText: gleiche Schlüssel und Typen, `path` ist die Kennung, `name` der Dateiname', async () => {
        const main = await mainAnswers();
        const stub = await stubAnswers();
        expect(shapeOf(stub.picked)).toEqual(shapeOf(main.picked));
        expect(shapeOf(stub.read)).toEqual(shapeOf(main.read));
        for (const answer of [main, stub]) {
            expect(answer.read.path).toBe(answer.picked.grantId);
            expect(answer.read.name).toBe(FILE_NAME);
            expect(answer.read.text).toBe(FILE_TEXT);
        }
    });

    it('fs:readMany: gleiche Form je Eintrag', async () => {
        const main = await mainAnswers();
        const stub = await stubAnswers();
        const [mainItem] = main.many;
        const [stubItem] = stub.many;
        expect(shapeOf(stubItem!)).toEqual(shapeOf(mainItem!));
        expect(stubItem!.result.ok && mainItem!.result.ok).toBe(true);
        expect(stubItem!.name).toBe(mainItem!.name);
        expect(stubItem!.path).toBe(stub.picked.grantId);
    });
});
