import { describe, expect, it, vi } from 'vitest';
import type { BuildIssue, TextFile, ToolsInfo } from '../../src/shared/contract';
import { IpcFailure } from '../../src/shared/ipcResult';
import { saveDirtyProjectFiles } from '../../src/renderer/app/saveBeforeBuild';
import { BUILD_TEXTS, DEFAULT_ENGINE, createBuildStore } from '../../src/renderer/stores/build';
import type { BuildResult } from '../../src/renderer/stores/build';
import { createEditorStore } from '../../src/renderer/stores/editor';
import type { StatusMessage } from '../../src/renderer/stores/status';
import { SAVE_TEXTS } from '../../src/renderer/app/fileActions';
import { createPreloadStub } from '../support/preloadStub';

const ROOT = '/stub/projekt';
const MAIN = `${ROOT}/main.tex`;
const CHAPTER = `${ROOT}/kapitel.tex`;
const OUTSIDE = 'grant-id-ausserhalb';
const TOOLS: ToolsInfo = { latexmk: '/bin/latexmk', git: null, synctexRef: null, distro: 'texlive', problems: [] };

const error = (file: string | null, line: number | null, message = 'Fehler'): BuildIssue =>
    ({ severity: 'error', message, file, line });

const finished = (change: Partial<BuildResult> = {}): BuildResult =>
    ({ ok: true, cancelled: false, report: [], pdfPath: `${ROOT}/main.pdf`, durationMs: 1000, ...change });

const textFile = (path: string, text = 'x'): TextFile =>
    ({ path, name: path.split('/').at(-1) ?? path, text, encoding: 'utf8', eol: 'lf', hash: 'h', mtime: 1 });

function setup(options: { mainFile?: string | null; tools?: ToolsInfo } = {}) {
    const stub = createPreloadStub();
    stub.respond('tools:detect', () => options.tools ?? TOOLS);
    const editor = createEditorStore();
    const messages: StatusMessage[] = [];
    const report = (message: StatusMessage): void => void messages.push(message);
    const mainFile = options.mainFile === undefined ? MAIN : options.mainFile;
    const store = createBuildStore({
        api: () => stub.api,
        mainFile: () => mainFile,
        root: () => ROOT,
        saveAll: () => saveDirtyProjectFiles({ api: stub.api, store: editor, report }, ROOT),
        report,
    });
    const channels = () => stub.calls.map((call) => call.channel);
    const type = (path: string): void => editor.getState().session(path)!.dispatch({ changes: { from: 0, insert: 'neu ' } });
    return { stub, editor, store, messages, channels, type };
}

describe('Zustandsübergänge', () => {
    it('übernimmt build:status und setzt nur bei echter Änderung', () => {
        const { stub, store } = setup();
        store.getState().connect();
        const listener = vi.fn();
        store.subscribe(listener);
        stub.emit('build:status', { state: 'running', startedAt: 5 });
        expect(store.getState()).toMatchObject({ status: 'running', startedAt: 5 });
        stub.emit('build:status', { state: 'running', startedAt: 5 });
        expect(listener).toHaveBeenCalledTimes(1);
        stub.emit('build:status', { state: 'queued', startedAt: 5 });
        stub.emit('build:status', { state: 'cancelling', startedAt: 5 });
        stub.emit('build:status', { state: 'idle', startedAt: null });
        expect(store.getState()).toMatchObject({ status: 'idle', startedAt: null });
        expect(listener).toHaveBeenCalledTimes(4);
    });

    it('build:finished legt Ergebnis, Meldungen, Zähler und Meldungen je Datei ab', () => {
        const { stub, store } = setup();
        store.getState().connect();
        const report = [error(MAIN, 3), error(null, null, 'Prozess'), { ...error(MAIN, 8), severity: 'warning' as const }];
        stub.emit('build:finished', finished({ ok: false, report }));
        const state = store.getState();
        expect(state.lastResult?.ok).toBe(false);
        expect(state.counts).toEqual({ error: 2, warning: 1, badBox: 0 });
        expect(state.fileIssues.get(MAIN)).toHaveLength(2);
        expect(state.issues).toBe(report);
    });

    it('ein gleicher Bericht lässt Meldungen und Zähler unberührt, nur die Dauer ändert das Ergebnis', () => {
        const { stub, store } = setup();
        store.getState().connect();
        stub.emit('build:finished', finished({ report: [error(MAIN, 1)] }));
        const before = store.getState();
        stub.emit('build:finished', finished({ report: [error(MAIN, 1)] }));
        expect(store.getState()).toBe(before);
        stub.emit('build:finished', finished({ report: [error(MAIN, 1)], durationMs: 2000 }));
        expect(store.getState().issues).toBe(before.issues);
        expect(store.getState().fileIssues).toBe(before.fileIssues);
        expect(store.getState().lastResult?.durationMs).toBe(2000);
    });

    it('ein abgebrochener Lauf behält die Meldungen davor', () => {
        const { stub, store } = setup();
        store.getState().connect();
        stub.emit('build:finished', finished({ ok: false, report: [error(MAIN, 1)] }));
        stub.emit('build:finished', finished({ ok: false, cancelled: true, pdfPath: null }));
        expect(store.getState().lastResult?.cancelled).toBe(true);
        expect(store.getState().counts.error).toBe(1);
    });

    it('der nächste Lauf ersetzt die Meldungen und setzt die Auswahl zurück', () => {
        const { stub, store } = setup();
        store.getState().connect();
        stub.emit('build:finished', finished({ report: [error(MAIN, 1)] }));
        store.getState().select('0');
        stub.emit('build:finished', finished({ report: [] }));
        expect(store.getState()).toMatchObject({ issues: [], selectedKey: null, counts: { error: 0, warning: 0, badBox: 0 } });
    });

    it('clearResults verwirft Ergebnis und Meldungen (Projektwechsel)', () => {
        const { stub, store } = setup();
        store.getState().connect();
        stub.emit('build:finished', finished({ report: [error(MAIN, 1)] }));
        store.getState().clearResults();
        expect(store.getState()).toMatchObject({ lastResult: null, issues: [] });
        const listener = vi.fn();
        store.subscribe(listener);
        store.getState().clearResults();
        expect(listener).not.toHaveBeenCalled();
    });
});

describe('Ereignisse abonnieren und abmelden', () => {
    it('connect abonniert beide Ereignisse und holt die Werkzeuge, die Rückgabe meldet ab', async () => {
        const { stub, store } = setup();
        const stop = store.getState().connect();
        expect(stub.listenerCount('build:status')).toBe(1);
        expect(stub.listenerCount('build:finished')).toBe(1);
        await vi.waitFor(() => expect(store.getState().tools).toEqual(TOOLS));
        stop();
        expect(stub.listenerCount('build:status')).toBe(0);
        expect(stub.listenerCount('build:finished')).toBe(0);
        stub.emit('build:status', { state: 'running', startedAt: 1 });
        expect(store.getState().status).toBe('idle');
    });

    it('refreshTools setzt nur bei geänderten Werkzeugen', async () => {
        const { store } = setup();
        await store.getState().refreshTools();
        const listener = vi.fn();
        store.subscribe(listener);
        await store.getState().refreshTools();
        expect(listener).not.toHaveBeenCalled();
    });
});

describe('Speichern vor dem Build', () => {
    it('speichert alle ungespeicherten Dateien des Projekts, dann build:start mit Hauptdatei und Engine', async () => {
        const { stub, store, editor, type, channels } = setup();
        editor.getState().open(textFile(MAIN), { asPreview: false });
        editor.getState().open(textFile(CHAPTER), { asPreview: false });
        editor.getState().open(textFile(OUTSIDE), { asPreview: false });
        editor.getState().open(textFile(`${ROOT}/sauber.tex`), { asPreview: false });
        type(MAIN);
        type(CHAPTER);
        type(OUTSIDE);
        await store.getState().refreshTools();
        (stub.api as unknown as { __stub: { clearCalls(): void } }).__stub.clearCalls();
        expect(await store.getState().compile()).toBe('started');
        expect(channels()).toEqual(['fs:writeText', 'fs:writeText', 'build:start']);
        expect(stub.calls.slice(0, 2).map((call) => call.args[0])).toEqual([MAIN, CHAPTER]);
        expect(stub.calls[2]!.args).toEqual([MAIN, { engine: DEFAULT_ENGINE }]);
        expect(editor.getState().files[OUTSIDE]?.isDirty).toBe(true);
        expect(store.getState().isSaving).toBe(false);
    });

    it('ein Konflikt beim Speichern verhindert den Build und meldet es', async () => {
        const { stub, store, editor, type, channels, messages } = setup();
        editor.getState().open(textFile(MAIN), { asPreview: false });
        type(MAIN);
        stub.respond('fs:writeText', () => {
            throw new IpcFailure({ kind: 'conflict', message: 'Hash passt nicht' });
        });
        expect(await store.getState().compile()).toBe('saveFailed');
        expect(channels()).not.toContain('build:start');
        expect(messages.at(-1)).toEqual({ text: BUILD_TEXTS.saveFailed, kind: 'error' });
        expect(messages.map((message) => message.text)).toContain(SAVE_TEXTS.conflict('main.tex'));
        expect(editor.getState().files[MAIN]?.isDirty).toBe(true);
    });

    it('ein anderer Schreibfehler verhindert den Build ebenfalls, auch wenn andere Dateien gespeichert wurden', async () => {
        const { stub, store, editor, type, channels } = setup();
        editor.getState().open(textFile(MAIN), { asPreview: false });
        editor.getState().open(textFile(CHAPTER), { asPreview: false });
        type(MAIN);
        type(CHAPTER);
        stub.respond('fs:writeText', (path) => {
            if (path === MAIN) throw new IpcFailure({ kind: 'io', message: 'Platte voll' });
            return { hash: 'neu', mtime: 2 };
        });
        expect(await store.getState().compile()).toBe('saveFailed');
        expect(channels()).not.toContain('build:start');
        expect(editor.getState().files[CHAPTER]?.isDirty).toBe(false);
    });
});

describe('compile ohne Voraussetzungen', () => {
    it('ohne Hauptdatei: nichts wird gespeichert oder gestartet, Hinweis in der Statusleiste', async () => {
        const { stub, store, messages } = setup({ mainFile: null });
        expect(await store.getState().compile()).toBe('noMainFile');
        expect(stub.calls).toHaveLength(0);
        expect(messages.at(-1)?.text).toBe(BUILD_TEXTS.noMainFile);
    });

    it('fehlt latexmk, wird neu gesucht; erst wenn es da ist, startet der Build', async () => {
        const missing: ToolsInfo = { ...TOOLS, latexmk: null };
        const { stub, store, channels, messages } = setup({ tools: missing });
        await store.getState().refreshTools();
        expect(await store.getState().compile()).toBe('toolsMissing');
        expect(channels().filter((channel) => channel === 'tools:detect')).toHaveLength(2);
        expect(channels()).not.toContain('build:start');
        expect(messages.at(-1)?.text).toBe(BUILD_TEXTS.toolsMissing);
        stub.respond('tools:detect', () => TOOLS);
        expect(await store.getState().compile()).toBe('started');
    });

    it('lehnt der Main den Start ab, steht die Meldung im Store und in der Statusleiste', async () => {
        const { stub, store, messages } = setup();
        stub.respond('build:start', () => {
            throw new IpcFailure({ kind: 'conflict', message: 'App wird beendet' });
        });
        await store.getState().refreshTools();
        expect(await store.getState().compile()).toBe('startFailed');
        expect(store.getState().startFailure).toBe('App wird beendet');
        expect(messages.at(-1)).toEqual({ text: BUILD_TEXTS.startFailed('App wird beendet'), kind: 'error' });
        store.getState().connect();
        stub.emit('build:status', { state: 'running', startedAt: 1 });
        expect(store.getState().startFailure).toBeNull();
    });

    it('zwei gleichzeitige Aufrufe starten den Build einmal', async () => {
        const { stub, store } = setup();
        await store.getState().refreshTools();
        const starts = (): number => stub.calls.filter((call) => call.channel === 'build:start').length;
        const [first, second] = await Promise.all([store.getState().compile(), store.getState().compile()]);
        expect([first, second]).toEqual(['started', 'started']);
        expect(starts()).toBe(1);
    });
});

describe('Abbrechen und Aufräumen', () => {
    it('cancel ruft build:cancel nur, wenn etwas läuft', async () => {
        const { stub, store, channels } = setup();
        store.getState().connect();
        await store.getState().cancel();
        expect(channels()).not.toContain('build:cancel');
        stub.emit('build:status', { state: 'running', startedAt: 1 });
        await store.getState().cancel();
        expect(channels()).toContain('build:cancel');
    });

    it('clean ruft build:clean mit der Hauptdatei, meldet Erfolg und Fehler', async () => {
        const { stub, store, messages } = setup();
        expect(await store.getState().clean()).toBe(true);
        expect(stub.calls.at(-1)).toMatchObject({ channel: 'build:clean', args: [MAIN] });
        expect(messages.at(-1)?.text).toBe(BUILD_TEXTS.cleaned);
        stub.respond('build:clean', () => {
            throw new IpcFailure({ kind: 'conflict', message: 'läuft noch' });
        });
        expect(await store.getState().clean()).toBe(false);
        expect(messages.at(-1)).toEqual({ text: BUILD_TEXTS.cleanFailed('läuft noch'), kind: 'error' });
        expect(store.getState().isCleaning).toBe(false);
    });
});

describe('Filter, Auswahl und Navigation', () => {
    it('setFilter und select setzen nur bei Änderung', () => {
        const { store } = setup();
        const listener = vi.fn();
        store.subscribe(listener);
        store.getState().setFilter('error', true);
        store.getState().select(null);
        expect(listener).not.toHaveBeenCalled();
        store.getState().setFilter('badBox', true);
        expect(store.getState().filter.badBox).toBe(true);
    });

    it('navigate wählt die nächste Meldung mit Datei im Projekt und läuft um', () => {
        const { stub, store } = setup();
        store.getState().connect();
        stub.emit('build:finished', finished({ ok: false, report: [error(MAIN, 5), error(null, null), error(CHAPTER, 2)] }));
        expect(store.getState().navigate('next')?.issue.line).toBe(5);
        expect(store.getState().selectedKey).toBe('0');
        expect(store.getState().navigate('next')?.issue.file).toBe(CHAPTER);
        expect(store.getState().navigate('next')?.issue.line).toBe(5);
        expect(store.getState().navigate('previous')?.issue.file).toBe(CHAPTER);
    });

    it('navigate ohne Meldungen liefert null', () => {
        expect(setup().store.getState().navigate('next')).toBeNull();
    });
});
