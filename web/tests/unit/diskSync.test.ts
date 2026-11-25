import { undo, undoDepth } from '@codemirror/commands';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecoveryEntry, TextFile } from '../../src/shared/contract';
import { IpcFailure } from '../../src/shared/ipcResult';
import { DISK_SYNC_DEBOUNCE_MS, DISK_SYNC_TEXTS, DiskSync, diskSyncRuntime } from '../../src/renderer/app/diskSync';
import type { DiskSyncDeps } from '../../src/renderer/app/diskSync';
import { saveFile } from '../../src/renderer/app/fileActions';
import { startRecovery, stopRecovery } from '../../src/renderer/app/recovery';
import type { RecoveryController } from '../../src/renderer/app/recovery';
import type { EditorSession } from '../../src/renderer/editor/session';
import { createDiskConflictStore } from '../../src/renderer/stores/diskConflict';
import { createEditorStore } from '../../src/renderer/stores/editor';
import type { StatusMessage } from '../../src/renderer/stores/status';
import { createPreloadStub } from '../support/preloadStub';
import type { StubControl } from '../support/preloadStub';

// W2-13: Abgleich offener Tabs mit der Platte, mit gefälschter Platte hinter dem Stub-Preload (ohne Electron).

const PATH = '/projekt/main.tex';
const OTHER_PATH = '/projekt/andere.tex';
const OWN_HASH = 'h0';
const DISK_MTIME = 7;
const WRITTEN_HASH = 'h-geschrieben';
const STORM_EVENTS = 20;
const STORM_GAP_MS = 10;

type DiskEntry = { readonly text: string; readonly hash: string } | null;

/** Platte im Speicher; `hold` hält Lesevorgänge an (der Inhalt ist der vom Beginn des Lesens) */
class FakeDisk {
    private readonly files = new Map<string, DiskEntry>();
    private gate: Promise<void> | null = null;
    private failure: IpcFailure | null = null;
    readonly readPaths: string[] = [];

    write(path: string, text: string, hash: string): void {
        this.files.set(path, { text, hash });
    }

    remove(path: string): void {
        this.files.set(path, null);
    }

    failWith(failure: IpcFailure | null): void {
        this.failure = failure;
    }

    hold(): () => void {
        let release: () => void = () => undefined;
        this.gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        return () => {
            this.gate = null;
            release();
        };
    }

    async read(path: string): Promise<TextFile> {
        this.readPaths.push(path);
        const entry = this.files.get(path) ?? null;
        const failure = this.failure;
        if (this.gate !== null) await this.gate;
        if (failure !== null) throw failure;
        if (entry === null) throw new IpcFailure({ kind: 'notFound', message: `fehlt: ${path}` });
        const name = path.split('/').at(-1) ?? path;
        return { path, name, text: entry.text, encoding: 'utf8', eol: 'lf', hash: entry.hash, mtime: DISK_MTIME };
    }
}

const syncs: DiskSync[] = [];
const controllers: RecoveryController[] = [];

function setup(extra: Partial<DiskSyncDeps> = {}) {
    const stub = createPreloadStub();
    const store = createEditorStore();
    const conflicts = createDiskConflictStore();
    const disk = new FakeDisk();
    const messages: StatusMessage[] = [];
    stub.respond('fs:readText', (path) => disk.read(path));
    stub.respond('fs:writeText', (path, text) => {
        disk.write(path, text, WRITTEN_HASH);
        return { hash: WRITTEN_HASH, mtime: DISK_MTIME };
    });
    const report = (message: StatusMessage): void => {
        messages.push(message);
    };
    const sync = new DiskSync({ api: stub.api, store, conflicts, report, ...extra });
    syncs.push(sync);
    return { stub, store, conflicts, disk, messages, sync, report };
}

type Setup = ReturnType<typeof setup>;

function open({ store, disk }: Setup, text: string, path = PATH): EditorSession {
    const name = path.split('/').at(-1) ?? path;
    store.getState().open({ path, name, text, encoding: 'utf8', eol: 'lf', hash: OWN_HASH, mtime: 0 }, { asPreview: false });
    disk.write(path, text, OWN_HASH);
    return store.getState().session(path)!;
}

function changed({ sync }: Setup, paths: readonly string[] = [PATH]): void {
    sync.handleChanged({ paths, kinds: paths.map(() => 'changed' as const), treeChanged: false, gitChanged: false });
}

function type(session: EditorSession, text: string): void {
    session.dispatch({ changes: { from: 0, insert: text }, userEvent: 'input.type' });
}

function runUndo(session: EditorSession): boolean {
    return undo({ state: session.state, dispatch: (tr) => session.dispatch(tr) });
}

async function settle({ sync }: Setup): Promise<void> {
    await vi.advanceTimersByTimeAsync(DISK_SYNC_DEBOUNCE_MS);
    await sync.whenIdle();
}

function writeCalls({ stub }: Setup): unknown[][] {
    return stub.calls.filter((call) => call.channel === 'fs:writeText').map((call) => [...call.args]);
}

/** Tab mit eigener Änderung „X“ und externer Änderung auf der Platte: Konflikt */
async function conflictSetup(): Promise<Setup & { session: EditorSession }> {
    const context = setup();
    const session = open(context, 'Text');
    type(session, 'X');
    context.disk.write(PATH, 'Platte', 'h2');
    changed(context);
    await settle(context);
    return { ...context, session };
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(async () => {
    for (const sync of syncs.splice(0)) sync.stop();
    for (const controller of controllers.splice(0)) await stopRecovery(controller);
    vi.useRealTimers();
});

describe('Abgleich: eigene Änderungen und stilles Neuladen', () => {
    it('gleicher Hash wie zuletzt bekannt (eigenes Speichern) ändert nichts, auch nicht den Verlauf', async () => {
        const context = setup();
        const session = open(context, 'Text');
        type(session, 'X');
        context.store.getState().markSaved(PATH, session.snapshotForSave(), { hash: 'h1', mtime: 1 });
        context.disk.write(PATH, 'XText', 'h1');
        changed(context);
        await settle(context);
        expect(context.disk.readPaths).toEqual([PATH]);
        expect(session.state.doc.toString()).toBe('XText');
        expect(undoDepth(session.state)).toBe(1);
        expect(context.conflicts.getState().conflicts).toEqual({});
        expect(context.messages).toEqual([]);
    });

    it('unveränderter Tab lädt still mit minimalem Ersatz; Cursor und „unverändert“ bleiben', async () => {
        const context = setup();
        const session = open(context, 'A\nB\nC');
        session.select({ anchor: 1, head: 1 });
        context.disk.write(PATH, 'A\nNEU\nC', 'h2');
        changed(context);
        await settle(context);
        expect(session.state.doc.toString()).toBe('A\nNEU\nC');
        expect(session.selection).toEqual({ anchor: 1, head: 1 });
        expect(session.isDirty).toBe(false);
        expect(context.store.getState().files[PATH]).toMatchObject({ hash: 'h2', mtime: DISK_MTIME, isDirty: false });
        expect(context.conflicts.getState().conflicts).toEqual({});
    });

    it('liest nur offene Dateien; NFD-Namen im Ereignis treffen den NFC-Tab', async () => {
        const context = setup();
        const umlautPath = '/projekt/Übung.tex';
        open(context, 'Text', umlautPath);
        changed(context, [OTHER_PATH, umlautPath.normalize('NFD')]);
        await settle(context);
        expect(context.disk.readPaths).toEqual([umlautPath]);
    });
});

describe('Abgleich: geänderter Tab (Konflikt)', () => {
    it('überschreibt nie, sondern zeigt den Konflikt mit dem Plattenstand', async () => {
        const { session, conflicts, messages } = await conflictSetup();
        expect(session.state.doc.toString()).toBe('XText');
        expect(session.isDirty).toBe(true);
        expect(conflicts.getState().conflicts[PATH]).toEqual({
            kind: 'changed', knownHash: OWN_HASH, disk: { hash: 'h2', mtime: DISK_MTIME },
        });
        expect(messages).toEqual([]);
    });

    it('„Meine Version behalten“: Plattenhash übernommen, bleibt geändert, Speichern schreibt mit diesem Hash', async () => {
        const context = await conflictSetup();
        await context.sync.keepMine(PATH);
        await context.sync.whenIdle();
        expect(context.conflicts.getState().conflicts).toEqual({});
        expect(context.session.isDirty).toBe(true);
        expect(context.session.file.hash).toBe('h2');
        expect(context.store.getState().files[PATH]?.hash).toBe('h2');
        expect(context.messages.at(-1)).toEqual({ text: DISK_SYNC_TEXTS.keptMine('main.tex'), kind: 'info' });
        await saveFile({ api: context.stub.api, store: context.store, report: context.report }, PATH);
        expect(writeCalls(context).at(-1)).toEqual([PATH, 'XText', 'utf8', 'lf', 'h2']);
    });

    it('„Platten-Version laden“ sichert vorher, lädt dann; Rückgängig holt die eigene Version zurück', async () => {
        const context = await conflictSetup();
        const docAtBackup: string[] = [];
        context.stub.respond('recovery:save', (entry: RecoveryEntry) => {
            docAtBackup.push(`${entry.text}|${context.session.state.doc.toString()}`);
        });
        await context.sync.loadDiskVersion(PATH);
        await context.sync.whenIdle();
        expect(docAtBackup[0]).toBe('XText|XText');
        expect(docAtBackup).toHaveLength(2);
        expect(context.session.state.doc.toString()).toBe('Platte');
        expect(context.session.isDirty).toBe(false);
        expect(context.conflicts.getState().conflicts).toEqual({});
        expect(context.messages.at(-1)).toEqual({ text: DISK_SYNC_TEXTS.diskLoaded('main.tex'), kind: 'info' });
        expect(runUndo(context.session)).toBe(true);
        expect(context.session.state.doc.toString()).toBe('XText');
        expect(context.session.isDirty).toBe(true);
    });

    it('mit laufender Sicherung bleibt die verworfene Version nach dem Neuladen gesichert', async () => {
        const base = setup();
        const controller = startRecovery({ api: base.stub.api, store: base.store, report: base.report });
        controllers.push(controller);
        base.sync.stop();
        const sync = new DiskSync({
            api: base.stub.api, store: base.store, conflicts: base.conflicts, report: base.report,
            settleRecovery: () => controller.flush(),
        });
        syncs.push(sync);
        const session = open(base, 'Text');
        type(session, 'X');
        base.disk.write(PATH, 'Platte', 'h2');
        changed({ ...base, sync });
        await settle({ ...base, sync });
        await sync.loadDiskVersion(PATH);
        const control = (base.stub.api as unknown as { __stub: StubControl }).__stub;
        expect(control.recoveryBackups()).toEqual([{ path: PATH, text: 'XText' }]);
    });

    it('scheitert die Sicherung, wird nichts verworfen', async () => {
        const context = await conflictSetup();
        context.stub.respond('recovery:save', () => {
            throw new IpcFailure({ kind: 'io', message: 'Platte voll' });
        });
        await context.sync.loadDiskVersion(PATH);
        await context.sync.whenIdle();
        expect(context.session.state.doc.toString()).toBe('XText');
        expect(context.session.isDirty).toBe(true);
        expect(context.conflicts.getState().conflicts[PATH]?.kind).toBe('changed');
        expect(context.messages.at(-1)).toEqual({ text: DISK_SYNC_TEXTS.backupFailed('main.tex', 'Platte voll'), kind: 'error' });
    });

    it('Rückgängig bis zum Plattenstand bei offenem Konflikt: still neu laden', async () => {
        const context = await conflictSetup();
        expect(runUndo(context.session)).toBe(true);
        await context.sync.whenIdle();
        expect(context.session.state.doc.toString()).toBe('Platte');
        expect(context.session.isDirty).toBe(false);
        expect(context.conflicts.getState().conflicts).toEqual({});
    });
});

describe('Abgleich: gelöschte Datei', () => {
    async function deletedSetup(): Promise<Setup & { session: EditorSession }> {
        const context = setup();
        const session = open(context, 'Text');
        context.disk.remove(PATH);
        context.sync.handleChanged({ paths: [PATH], kinds: ['deleted'], treeChanged: true, gitChanged: false });
        await settle(context);
        return { ...context, session };
    }

    it('zeigt den Hinweis, der Tab behält seinen Text', async () => {
        const { session, conflicts, store } = await deletedSetup();
        expect(conflicts.getState().conflicts[PATH]).toEqual({ kind: 'deleted', knownHash: OWN_HASH, disk: null });
        expect(session.state.doc.toString()).toBe('Text');
        expect(store.getState().tabs.items).toContain(PATH);
    });

    it('„Neu anlegen“ schreibt ohne erwarteten Hash und entfernt den Hinweis', async () => {
        const context = await deletedSetup();
        await context.sync.recreate(PATH);
        await context.sync.whenIdle();
        expect(writeCalls(context)).toEqual([[PATH, 'Text', 'utf8', 'lf']]);
        expect(context.session.file.hash).toBe(WRITTEN_HASH);
        expect(context.conflicts.getState().conflicts).toEqual({});
        expect(context.messages.at(-1)).toEqual({ text: DISK_SYNC_TEXTS.recreated('main.tex'), kind: 'info' });
    });

    it('„Neu anlegen“, wenn die Datei inzwischen wieder da ist: nicht überschreiben, sondern Konflikt', async () => {
        const context = await deletedSetup();
        type(context.session, 'X');
        context.disk.write(PATH, 'fremd', 'h3');
        await context.sync.recreate(PATH);
        await context.sync.whenIdle();
        expect(writeCalls(context)).toEqual([]);
        expect(context.conflicts.getState().conflicts[PATH]?.kind).toBe('changed');
    });

    it('taucht die Datei unverändert wieder auf, verschwindet der Hinweis', async () => {
        const context = await deletedSetup();
        context.disk.write(PATH, 'Text', OWN_HASH);
        changed(context);
        await settle(context);
        expect(context.conflicts.getState().conflicts).toEqual({});
    });

    it('Speichern mit neuem Hash (z. B. über einen anderen Weg) macht den Hinweis überflüssig', async () => {
        const context = await deletedSetup();
        context.store.getState().markSaved(PATH, context.session.snapshotForSave(), { hash: 'h9', mtime: 9 });
        expect(context.conflicts.getState().conflicts).toEqual({});
    });
});

describe('Abgleich: Sturm, Reihenfolge, veraltete Antworten', () => {
    it('viele Meldungen in Folge ergeben ein einziges Lesen mit dem letzten Stand', async () => {
        const context = setup();
        const session = open(context, 'Text');
        for (let index = 1; index <= STORM_EVENTS; index++) {
            context.disk.write(PATH, `Stand ${index}`, `h${index}`);
            changed(context);
            await vi.advanceTimersByTimeAsync(STORM_GAP_MS);
        }
        await settle(context);
        expect(context.disk.readPaths).toEqual([PATH]);
        expect(session.state.doc.toString()).toBe(`Stand ${STORM_EVENTS}`);
    });

    it('Meldungen während eines Lesens ergeben genau ein weiteres Lesen danach', async () => {
        const context = setup();
        const session = open(context, 'Text');
        const release = context.disk.hold();
        context.disk.write(PATH, 'erste', 'h1');
        changed(context);
        await vi.advanceTimersByTimeAsync(DISK_SYNC_DEBOUNCE_MS);
        for (const text of ['zweite', 'dritte', 'vierte']) {
            context.disk.write(PATH, text, `h-${text}`);
            changed(context);
            await vi.advanceTimersByTimeAsync(DISK_SYNC_DEBOUNCE_MS);
        }
        expect(context.disk.readPaths).toHaveLength(1);
        release();
        await context.sync.whenIdle();
        expect(context.disk.readPaths).toHaveLength(2);
        expect(session.state.doc.toString()).toBe('vierte');
    });

    it('Antwort von vor dem eigenen Speichern wird verworfen und neu gelesen', async () => {
        const context = setup();
        const session = open(context, 'Text');
        const release = context.disk.hold();
        context.disk.write(PATH, 'Extern', 'h1');
        changed(context);
        await vi.advanceTimersByTimeAsync(DISK_SYNC_DEBOUNCE_MS);
        type(session, 'X');
        context.store.getState().markSaved(PATH, session.snapshotForSave(), { hash: 'h2', mtime: 2 });
        context.disk.write(PATH, 'XText', 'h2');
        release();
        await context.sync.whenIdle();
        expect(context.disk.readPaths).toHaveLength(2);
        expect(session.state.doc.toString()).toBe('XText');
        expect(session.isDirty).toBe(false);
        expect(context.conflicts.getState().conflicts).toEqual({});
    });

    it('Tab während des Lesens geschlossen: die Antwort verfällt still', async () => {
        const context = setup();
        open(context, 'Text');
        const release = context.disk.hold();
        context.disk.write(PATH, 'Extern', 'h1');
        changed(context);
        await vi.advanceTimersByTimeAsync(DISK_SYNC_DEBOUNCE_MS);
        context.store.getState().close(PATH);
        release();
        await context.sync.whenIdle();
        expect(context.conflicts.getState().conflicts).toEqual({});
        expect(context.messages).toEqual([]);
    });

    it('Antwort, die „Meine Version behalten“ überholt hat, setzt keinen neuen Konflikt', async () => {
        const context = await conflictSetup();
        const release = context.disk.hold();
        changed(context);
        await vi.advanceTimersByTimeAsync(DISK_SYNC_DEBOUNCE_MS);
        await context.sync.keepMine(PATH);
        release();
        await context.sync.whenIdle();
        expect(context.conflicts.getState().conflicts).toEqual({});
        expect(context.session.isDirty).toBe(true);
    });
});

describe('Abgleich: nicht ladbare Dateien', () => {
    it('binärer Inhalt wird nicht geladen', async () => {
        const context = setup();
        const session = open(context, 'Text');
        context.disk.write(PATH, 'PNG\u0000\u0001', 'h5');
        changed(context);
        await settle(context);
        expect(session.state.doc.toString()).toBe('Text');
        expect(context.messages).toEqual([{ text: DISK_SYNC_TEXTS.notLoaded('main.tex'), kind: 'error' }]);
    });

    it('zu große Datei (der Main lehnt das Lesen ab) wird nicht geladen', async () => {
        const context = setup();
        const session = open(context, 'Text');
        context.disk.failWith(new IpcFailure({ kind: 'invalidInput', message: 'Die Datei ist zu groß' }));
        changed(context);
        await settle(context);
        expect(session.state.doc.toString()).toBe('Text');
        expect(context.messages).toEqual([{ text: DISK_SYNC_TEXTS.notLoaded('main.tex'), kind: 'error' }]);
    });

    it('ohne laufenden Abgleich sind die Aktionen der Leiste wirkungslos', async () => {
        await expect(diskSyncRuntime.keepMine(PATH)).resolves.toBeUndefined();
    });
});
