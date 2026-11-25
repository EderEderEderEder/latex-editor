import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRecoveryHandlers } from '../../src/main/handlers/recoveryHandlers';
import { GrantStore } from '../../src/main/grants';
import { areArgsValid } from '../../src/main/ipcValidation';
import { MACOS_PATHS } from '../../src/main/paths';
import { RECOVERY_DIRECTORY, RecoveryStore } from '../../src/main/recovery';
import type { BackupInput } from '../../src/main/recovery';
import { IpcFailure } from '../../src/shared/ipcResult';

let userData: string;
let work: string;

beforeEach(async () => {
    userData = await mkdtemp(join(tmpdir(), 'recovery-user-'));
    work = await realpath(await mkdtemp(join(tmpdir(), 'recovery-work-')));
});

afterEach(async () => {
    await rm(userData, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
});

const FIRST_RUN = 'lauf-1';
const SECOND_RUN = 'lauf-2';

const storeFor = (runId: string, textIo?: ConstructorParameters<typeof RecoveryStore>[0]['textIo']) =>
    new RecoveryStore({ userDataDir: userData, platform: MACOS_PATHS, runId, textIo });

async function diskFile(name: string, text: string): Promise<string> {
    const path = join(work, name);
    await writeFile(path, text, 'utf8');
    return path;
}

function input(path: string, text = 'gesichert', projectRoot: string | null = null): BackupInput {
    return { path, text, savedAt: 1_000, projectRoot };
}

const backupFiles = (): Promise<string[]> => readdir(join(userData, RECOVERY_DIRECTORY)).catch(() => []);

describe('RecoveryStore: Schreiben', () => {
    it('legt je Datei eine JSON-Datei an, deren Name keinen Pfad enthält, ohne Reste der Temp-Datei', async () => {
        const path = await diskFile('kapitel eins.tex', 'Platte');
        const store = storeFor(FIRST_RUN);
        await store.write(input(path, 'neuer Text'));
        const files = await backupFiles();
        expect(files).toEqual([`${store.fileOf(path).split('/').at(-1)}`]);
        expect(files[0]).toMatch(/^[0-9a-f]{64}\.json$/);
        const stored = JSON.parse(await readFile(store.fileOf(path), 'utf8')) as Record<string, unknown>;
        expect(stored).toMatchObject({ path, name: 'kapitel eins.tex', text: 'neuer Text', savedAt: 1_000, runId: FIRST_RUN });
        expect(typeof stored.diskHash).toBe('string');
    });

    it('eine Sicherung je Datei: erneutes Sichern ersetzt die alte', async () => {
        const path = await diskFile('a.tex', 'Platte');
        const store = storeFor(FIRST_RUN);
        await store.write(input(path, 'eins'));
        await store.write(input(path, 'zwei'));
        expect(await backupFiles()).toHaveLength(1);
        expect((await store.readAll()).map((backup) => backup.text)).toEqual(['zwei']);
    });

    it('ein misslungenes Umbenennen lässt die vorherige Sicherung heil und hinterlässt keine Temp-Datei', async () => {
        const path = await diskFile('a.tex', 'Platte');
        await storeFor(FIRST_RUN).write(input(path, 'heil'));
        const failing = storeFor(FIRST_RUN, {
            rename: () => Promise.reject(Object.assign(new Error('Platte voll'), { code: 'ENOSPC' })),
        });
        await expect(failing.write(input(path, 'kaputt'))).rejects.toBeInstanceOf(IpcFailure);
        expect((await storeFor(FIRST_RUN).readAll()).map((backup) => backup.text)).toEqual(['heil']);
        expect(await backupFiles()).toHaveLength(1);
    });

    it('merkt den Hash der Plattendatei; fehlt die Datei, ist er null', async () => {
        const store = storeFor(FIRST_RUN);
        const missing = join(work, 'neu.tex');
        await store.write(input(missing));
        expect((await store.readAll()).map((backup) => backup.diskHash)).toEqual([null]);
    });

    it('remove löscht die Sicherung der Datei und ist ohne Sicherung kein Fehler', async () => {
        const path = await diskFile('a.tex', 'Platte');
        const store = storeFor(FIRST_RUN);
        await store.write(input(path));
        await store.remove(path);
        await store.remove(path);
        expect(await backupFiles()).toEqual([]);
    });
});

describe('RecoveryStore: Auflisten', () => {
    it('bietet nur Sicherungen früherer Läufe an', async () => {
        const path = await diskFile('a.tex', 'Platte');
        await storeFor(FIRST_RUN).write(input(path, 'alt'));
        expect(await storeFor(FIRST_RUN).pending(null)).toEqual([]);
        const offered = await storeFor(SECOND_RUN).pending(null);
        expect(offered.map((entry) => entry.backup.text)).toEqual(['alt']);
    });

    it('übergeht kaputte und fremde Dateien, ohne sie zu löschen', async () => {
        const path = await diskFile('a.tex', 'Platte');
        await storeFor(FIRST_RUN).write(input(path, 'gut'));
        const directory = join(userData, RECOVERY_DIRECTORY);
        await writeFile(join(directory, 'kaputt.json'), '{ nicht json', 'utf8');
        await writeFile(join(directory, 'fremd.json'), JSON.stringify({ version: 1, path: '/x' }), 'utf8');
        await writeFile(join(directory, 'notiz.txt'), 'egal', 'utf8');
        const offered = await storeFor(SECOND_RUN).pending(null);
        expect(offered.map((entry) => entry.backup.text)).toEqual(['gut']);
        expect(await backupFiles()).toHaveLength(4);
    });

    it('ohne Sicherungsordner ist die Liste leer', async () => {
        expect(await storeFor(SECOND_RUN).pending(null)).toEqual([]);
    });

    it('vergleicht mit der Platte: unverändert, geändert (Hash), nicht mehr vorhanden', async () => {
        const path = await diskFile('a.tex', 'Platte');
        await storeFor(FIRST_RUN).write(input(path, 'ungespeichert'));
        const next = storeFor(SECOND_RUN);
        expect((await next.pending(null)).map((entry) => entry.diskState)).toEqual(['unchanged']);
        await writeFile(path, 'jemand anders war hier', 'utf8');
        expect((await next.pending(null)).map((entry) => entry.diskState)).toEqual(['changed']);
        await rm(path);
        expect((await next.pending(null)).map((entry) => entry.diskState)).toEqual(['missing']);
    });

    it('löscht veraltete Sicherungen: gesicherter Text gleich dem der Platte', async () => {
        const path = await diskFile('a.tex', 'gleich');
        await storeFor(FIRST_RUN).write(input(path, 'gleich'));
        expect(await storeFor(SECOND_RUN).pending(null)).toEqual([]);
        expect(await backupFiles()).toEqual([]);
    });

    it('Projektdateien gehören zu ihrem Projekt, Dateien außerhalb werden immer angeboten', async () => {
        const inside = await diskFile('a.tex', 'Platte');
        const outside = await diskFile('b.tex', 'Platte');
        await storeFor(FIRST_RUN).write(input(inside, 'im Projekt', '/projekt/a'));
        await storeFor(FIRST_RUN).write(input(outside, 'draußen', null));
        const next = storeFor(SECOND_RUN);
        const texts = async (root: string | null) => (await next.pending(root)).map((entry) => entry.backup.text);
        expect(await texts(null)).toEqual(['draußen']);
        expect(await texts('/projekt/b')).toEqual(['draußen']);
        expect((await texts('/projekt/a')).sort()).toEqual(['draußen', 'im Projekt']);
    });
});

describe('recovery:*-Handler', () => {
    async function openProject(grants: GrantStore, name: string): Promise<string> {
        const root = join(work, name);
        await mkdir(root, { recursive: true });
        grants.openProject(grants.grant(root, 'project').grantId);
        return root;
    }

    function run(runId: string) {
        const grants = new GrantStore({ platform: MACOS_PATHS });
        const handlers = createRecoveryHandlers({ grants, store: storeFor(runId) });
        return { grants, handlers };
    }

    it('Projektdatei: sichern, im nächsten Lauf mit Projektpfad anbieten, verwerfen', async () => {
        const first = run(FIRST_RUN);
        const root = await openProject(first.grants, 'arbeit');
        const file = join(root, 'main.tex');
        await writeFile(file, 'Platte', 'utf8');
        await first.handlers['recovery:save']({ path: file, text: 'ungespeichert', savedAt: 5 });
        expect(await first.handlers['recovery:list']()).toEqual([]);

        const second = run(SECOND_RUN);
        expect(await second.handlers['recovery:list']()).toEqual([]);
        await openProject(second.grants, 'arbeit');
        expect(await second.handlers['recovery:list']()).toEqual([
            { path: file, name: 'main.tex', text: 'ungespeichert', savedAt: 5, diskState: 'unchanged' },
        ]);
        await second.handlers['recovery:delete'](file);
        expect(await second.handlers['recovery:list']()).toEqual([]);
        expect(await backupFiles()).toEqual([]);
    });

    it('Datei aus einem anderen Projekt wird nicht angeboten', async () => {
        const first = run(FIRST_RUN);
        const root = await openProject(first.grants, 'eins');
        const file = join(root, 'main.tex');
        await writeFile(file, 'Platte', 'utf8');
        await first.handlers['recovery:save']({ path: file, text: 'x', savedAt: 5 });
        const second = run(SECOND_RUN);
        await openProject(second.grants, 'zwei');
        expect(await second.handlers['recovery:list']()).toEqual([]);
    });

    it('Datei außerhalb des Projekts: nur über Kennung, im nächsten Lauf frisch gewährt, nie als Pfad', async () => {
        const first = run(FIRST_RUN);
        const file = await diskFile('einzel.tex', 'Platte');
        const grant = first.grants.grant(file, 'pickedFile');
        await first.handlers['recovery:save']({ path: grant.grantId, text: 'ungespeichert', savedAt: 7 });

        const second = run(SECOND_RUN);
        const [item] = await second.handlers['recovery:list']();
        expect(item).toMatchObject({ name: 'einzel.tex', text: 'ungespeichert', savedAt: 7, diskState: 'unchanged' });
        expect(item?.path).not.toContain(work);
        expect(second.grants.resolve(item!.path, 'pickedFile')).toBe(file);
        await second.handlers['recovery:delete'](item!.path);
        expect(await backupFiles()).toEqual([]);
    });

    it('verlangt für Projektpfade ein geöffnetes Projekt und lehnt Pfade außerhalb ab', async () => {
        const { grants, handlers } = run(FIRST_RUN);
        const file = await diskFile('a.tex', 'Platte');
        const entry = { path: file, text: 'x', savedAt: 1 };
        await expect(handlers['recovery:save'](entry)).rejects.toBeInstanceOf(IpcFailure);
        await openProject(grants, 'arbeit');
        await expect(handlers['recovery:save'](entry)).rejects.toMatchObject({ error: { kind: 'forbiddenPath' } });
        await expect(handlers['recovery:save']({ ...entry, path: 'unbekannte-kennung' })).rejects.toBeInstanceOf(IpcFailure);
        expect(await backupFiles()).toEqual([]);
    });

    it('Argumentprüfung: Eintrag mit Ziel, Text und Zeit; Löschen mit einem Ziel', () => {
        expect(areArgsValid('recovery:save', [{ path: 'g-1', text: '', savedAt: 0 }])).toBe(true);
        expect(areArgsValid('recovery:save', [{ path: 'g-1', text: '', savedAt: 0, diskHash: 'x' }])).toBe(false);
        expect(areArgsValid('recovery:delete', ['g-1'])).toBe(true);
        expect(areArgsValid('recovery:list', [])).toBe(true);
    });
});
