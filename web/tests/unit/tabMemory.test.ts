import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAB_MEMORY_VERSION } from '../../src/shared/contract';
import type { TabMemory, TextFile } from '../../src/shared/contract';
import { ScrollMemory } from '../../src/renderer/app/scrollMemory';
import { TabMemoryController, buildTabMemory, restoreTabMemory, toAbsolutePath, toRelativePath } from '../../src/renderer/app/tabMemory';
import { createEditorStore } from '../../src/renderer/stores/editor';
import type { EditorStore } from '../../src/renderer/stores/editor';
import { IpcFailure } from '../../src/shared/ipcResult';
import { createPreloadStub } from '../support/preloadStub';

const ROOT = '/p';
const DELAY = 50;

function file(path: string, text = 'Inhalt\nzweite Zeile\n'): TextFile {
    return { path, name: path.split('/').at(-1)!, text, encoding: 'utf8', eol: 'lf', hash: 'h', mtime: 1 };
}

function memory(tabs: Partial<TabMemory['tabs'][number]>[], active: string | null): TabMemory {
    return {
        version: TAB_MEMORY_VERSION,
        tabs: tabs.map((tab) => ({ path: 'a.tex', isPreview: false, anchor: 0, head: 0, scrollTop: 0, ...tab })),
        active,
    };
}

describe('Tab-Gedächtnis: Pfade', () => {
    it('relativ mit /, nur unterhalb der Wurzel', () => {
        expect(toRelativePath('/p', '/p/kapitel/eins.tex')).toBe('kapitel/eins.tex');
        expect(toRelativePath('/p/', '/p/a.tex')).toBe('a.tex');
        expect(toRelativePath('/p', '/p')).toBeNull();
        expect(toRelativePath('/p', '/pp/a.tex')).toBeNull();
        expect(toRelativePath('/p', 'b1f0c2e4-grant')).toBeNull();
    });

    it('unter Windows mit Gegenstrichen und ohne Groß-/Kleinschreibung beim Laufwerk', () => {
        expect(toRelativePath('C:\\Arbeit', 'C:\\Arbeit\\kapitel\\eins.tex')).toBe('kapitel/eins.tex');
        expect(toRelativePath('c:\\arbeit', 'C:\\Arbeit\\a.tex')).toBe('a.tex');
        expect(toAbsolutePath('C:\\Arbeit', 'kapitel/eins.tex')).toBe('C:\\Arbeit\\kapitel\\eins.tex');
        expect(toAbsolutePath('/p/', 'kapitel/eins.tex')).toBe('/p/kapitel/eins.tex');
    });

    it.each(['/etc/passwd', 'C:/x.tex', '../x.tex', 'a/../../x.tex', 'a\\b.tex', ''])('lehnt %j beim Zurückwandeln ab', (relative) => {
        expect(toAbsolutePath('/p', relative)).toBeNull();
    });
});

describe('Tab-Gedächtnis: Store → Gedächtnis', () => {
    function openedStore(): EditorStore {
        const store = createEditorStore();
        store.getState().open(file('/p/a.tex'), { asPreview: false });
        store.getState().open(file('/p/kapitel/b.tex'), { asPreview: false });
        store.getState().open(file('/p/c.bib'));
        store.getState().open(file('dialog-grant-1'), { asPreview: false });
        store.getState().activate('/p/kapitel/b.tex');
        return store;
    }

    it('merkt Reihenfolge, Vorschau, aktiven Tab, Auswahl und Scrollposition; Dialog-Dateien nicht', () => {
        const store = openedStore();
        store.getState().session('/p/a.tex')!.select({ anchor: 3, head: 7 });
        const scroll = new ScrollMemory();
        scroll.record('/p/a.tex', 120.4);
        const built = buildTabMemory({
            root: ROOT,
            tabs: store.getState().tabs,
            selectionOf: (path) => store.getState().session(path)?.selection ?? null,
            scrollOf: (path) => scroll.get(path),
        });
        expect(built).toEqual(memory([
            { path: 'a.tex', anchor: 3, head: 7, scrollTop: 120 },
            { path: 'kapitel/b.tex' },
            { path: 'c.bib', isPreview: true },
        ], 'kapitel/b.tex'));
    });

    it('aktiver Dialog-Tab ergibt keinen aktiven Eintrag', () => {
        const store = openedStore();
        store.getState().activate('dialog-grant-1');
        const built = buildTabMemory({ root: ROOT, tabs: store.getState().tabs, selectionOf: () => null, scrollOf: () => 0 });
        expect(built.active).toBeNull();
        expect(built.tabs).toHaveLength(3);
    });

    it('ohne Tabs: leere Liste', () => {
        const built = buildTabMemory({ root: ROOT, tabs: createEditorStore().getState().tabs, selectionOf: () => null, scrollOf: () => 0 });
        expect(built).toEqual({ version: TAB_MEMORY_VERSION, tabs: [], active: null });
    });
});

describe('Tab-Gedächtnis: Wiederherstellung', () => {
    function setup(files: Record<string, string>) {
        const stub = createPreloadStub({
            'fs:readMany': (paths) =>
                paths.map((path) => ({
                    path,
                    name: path.split('/').at(-1)!,
                    result: path in files
                        ? { ok: true as const, value: file(path, files[path]) }
                        : { ok: false as const, error: { kind: 'notFound' as const, message: 'fehlt' } },
                })),
        });
        const store = createEditorStore();
        const scroll = new ScrollMemory();
        return { stub, store, scroll, deps: { api: stub.api, store, root: ROOT, scroll } };
    }

    it('öffnet in der gemerkten Reihenfolge mit Vorschau, Auswahl und aktivem Tab', async () => {
        const { store, scroll, deps } = setup({ '/p/a.tex': 'abcdefgh', '/p/b.tex': 'x', '/p/c.tex': 'y' });
        const saved = memory([
            { path: 'a.tex', anchor: 2, head: 5, scrollTop: 300 },
            { path: 'b.tex', isPreview: true },
            { path: 'c.tex' },
        ], 'a.tex');
        expect(await restoreTabMemory(deps, saved)).toEqual({ opened: 3, skipped: 0 });
        const { tabs } = store.getState();
        expect(tabs.items).toEqual(['/p/a.tex', '/p/b.tex', '/p/c.tex']);
        expect(tabs.preview).toBe('/p/b.tex');
        expect(tabs.active).toBe('/p/a.tex');
        expect(store.getState().session('/p/a.tex')?.selection).toEqual({ anchor: 2, head: 5 });
        expect(scroll.get('/p/a.tex')).toBe(300);
        expect(scroll.takePending('/p/a.tex')).toBe(300);
    });

    it('überspringt fehlende Dateien und fehlende aktive Datei, ohne Fehler', async () => {
        const { store, deps } = setup({ '/p/a.tex': 'x', '/p/c.tex': 'y' });
        const saved = memory([{ path: 'a.tex' }, { path: 'weg.tex' }, { path: 'c.tex' }], 'weg.tex');
        expect(await restoreTabMemory(deps, saved)).toEqual({ opened: 2, skipped: 1 });
        expect(store.getState().tabs.items).toEqual(['/p/a.tex', '/p/c.tex']);
        expect(store.getState().tabs.active).toBe('/p/c.tex');
    });

    it('klemmt die gemerkte Auswahl, wenn die Datei kürzer geworden ist', async () => {
        const { store, deps } = setup({ '/p/a.tex': 'kurz' });
        await restoreTabMemory(deps, memory([{ path: 'a.tex', anchor: 500, head: 900 }], 'a.tex'));
        expect(store.getState().session('/p/a.tex')?.selection).toEqual({ anchor: 4, head: 4 });
    });

    it('liest nur sichere Pfade; unsichere gelten als übersprungen', async () => {
        const { stub, deps } = setup({ '/p/a.tex': 'x' });
        const saved = memory([{ path: 'a.tex' }, { path: '../geheim.tex' }], 'a.tex');
        expect(await restoreTabMemory(deps, saved)).toEqual({ opened: 1, skipped: 1 });
        expect(stub.calls.find((call) => call.channel === 'fs:readMany')?.args).toEqual([['/p/a.tex']]);
    });

    it('eine schon offene Datei behält ihre Sitzung und wird nur aktiviert', async () => {
        const { store, scroll, deps } = setup({ '/p/a.tex': 'neu' });
        store.getState().open(file('/p/a.tex', 'alt'), { asPreview: false });
        await restoreTabMemory(deps, memory([{ path: 'a.tex', scrollTop: 50 }], 'a.tex'));
        expect(store.getState().session('/p/a.tex')?.snapshotForSave().text).toBe('alt');
        expect(scroll.takePending('/p/a.tex')).toBeUndefined();
    });

    it('ein Lesefehler der ganzen Anfrage öffnet nichts', async () => {
        const { stub, store, deps } = setup({});
        stub.respond('fs:readMany', () => {
            throw new IpcFailure({ kind: 'io', message: 'x' });
        });
        expect(await restoreTabMemory(deps, memory([{ path: 'a.tex' }], 'a.tex'))).toEqual({ opened: 0, skipped: 1 });
        expect(store.getState().tabs.items).toEqual([]);
    });
});

describe('Tab-Gedächtnis: Controller', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function setup(stored: TabMemory | null = null) {
        const stub = createPreloadStub({
            'fs:readMany': (paths) => paths.map((path) => ({ path, name: path, result: { ok: true as const, value: file(path) } })),
        });
        (stub.api as unknown as { __stub: { setTabMemory(m: TabMemory | null): void } }).__stub.setTabMemory(stored);
        const store = createEditorStore();
        const scroll = new ScrollMemory();
        const report = vi.fn();
        const controller = new TabMemoryController({ api: stub.api, store, root: ROOT, scroll, report, delayMs: DELAY });
        const saves = () => stub.calls.filter((call) => call.channel === 'tabs:memorySave');
        return { stub, store, scroll, report, controller, saves };
    }

    it('speichert Änderungen der Tabs entprellt, mehrere Änderungen ergeben ein Speichern', async () => {
        const { store, controller, saves } = setup();
        store.getState().open(file('/p/a.tex'), { asPreview: false });
        store.getState().open(file('/p/b.tex'), { asPreview: false });
        expect(saves()).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(DELAY);
        expect(saves()).toHaveLength(1);
        expect((saves()[0]?.args[0] as TabMemory).tabs.map((tab) => tab.path)).toEqual(['a.tex', 'b.tex']);
        await controller.stop();
    });

    it('flush speichert sofort, auch Auswahl und Scrollposition ohne Tab-Änderung', async () => {
        const { store, scroll, controller, saves } = setup();
        store.getState().open(file('/p/a.tex'), { asPreview: false });
        await controller.flush();
        store.getState().session('/p/a.tex')!.select({ anchor: 1, head: 2 });
        scroll.record('/p/a.tex', 80);
        await controller.flush();
        expect(saves()).toHaveLength(2);
        expect((saves()[1]?.args[0] as TabMemory).tabs[0]).toMatchObject({ anchor: 1, head: 2, scrollTop: 80 });
        await controller.stop();
    });

    it('speichert unveränderten Stand nicht noch einmal', async () => {
        const { store, controller, saves } = setup();
        store.getState().open(file('/p/a.tex'), { asPreview: false });
        await controller.flush();
        await controller.flush();
        expect(saves()).toHaveLength(1);
        await controller.stop();
    });

    it('Scrollen löst nach der Verzögerung ein Speichern aus', async () => {
        const { store, scroll, controller, saves } = setup();
        store.getState().open(file('/p/a.tex'), { asPreview: false });
        await controller.flush();
        scroll.record('/p/a.tex', 500);
        await vi.advanceTimersByTimeAsync(DELAY);
        expect(saves()).toHaveLength(2);
        await controller.stop();
    });

    it('restore stellt wieder her, schreibt dabei nichts Halbfertiges und danach nichts Gleiches', async () => {
        const stored = memory([{ path: 'a.tex' }, { path: 'b.tex', isPreview: true }], 'a.tex');
        const { store, controller, saves } = setup(stored);
        expect(await controller.restore()).toEqual({ opened: 2, skipped: 0 });
        expect(store.getState().tabs.active).toBe('/p/a.tex');
        await vi.advanceTimersByTimeAsync(DELAY);
        expect(saves()).toHaveLength(0);
        await controller.stop();
    });

    it('nach dem Wiederherstellen mit fehlender Datei wird das bereinigte Gedächtnis gespeichert', async () => {
        const stored = memory([{ path: 'a.tex' }], 'a.tex');
        const { stub, store, controller, saves } = setup(stored);
        stub.respond('fs:readMany', (paths) => paths.map((path) => ({
            path, name: path, result: { ok: false as const, error: { kind: 'notFound' as const, message: 'weg' } },
        })));
        expect(await controller.restore()).toEqual({ opened: 0, skipped: 1 });
        await vi.advanceTimersByTimeAsync(DELAY);
        expect(store.getState().tabs.items).toEqual([]);
        expect((saves()[0]?.args[0] as TabMemory).tabs).toEqual([]);
        await controller.stop();
    });

    it('ohne gemerkte Tabs bleibt der Store leer; Ladefehler stören nicht', async () => {
        const { stub, store, controller } = setup(null);
        expect(await controller.restore()).toEqual({ opened: 0, skipped: 0 });
        stub.respond('tabs:memoryLoad', () => {
            throw new IpcFailure({ kind: 'io', message: 'kaputt' });
        });
        expect(await controller.restore()).toEqual({ opened: 0, skipped: 0 });
        expect(store.getState().tabs.items).toEqual([]);
        await controller.stop();
    });

    it('meldet einen Speicherfehler nur einmal', async () => {
        const { stub, store, report, controller } = setup();
        stub.respond('tabs:memorySave', () => {
            throw new IpcFailure({ kind: 'io', message: 'Platte voll' });
        });
        store.getState().open(file('/p/a.tex'), { asPreview: false });
        await controller.flush();
        store.getState().open(file('/p/b.tex'), { asPreview: false });
        await controller.flush();
        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0]?.[0]).toMatchObject({ kind: 'error' });
        await controller.stop();
    });

    it('nach stop folgt der Controller dem Store nicht mehr', async () => {
        const { store, controller, saves } = setup();
        store.getState().open(file('/p/a.tex'), { asPreview: false });
        await controller.stop();
        const before = saves().length;
        store.getState().open(file('/p/b.tex'), { asPreview: false });
        await vi.advanceTimersByTimeAsync(DELAY * 2);
        expect(saves()).toHaveLength(before);
    });

    it('Schließen und Wiederöffnen eines Tabs beginnt bei Scrollposition 0', async () => {
        const { store, scroll, controller } = setup();
        store.getState().open(file('/p/a.tex'), { asPreview: false });
        scroll.record('/p/a.tex', 400);
        store.getState().close('/p/a.tex');
        expect(scroll.get('/p/a.tex')).toBe(0);
        await controller.stop();
    });
});
