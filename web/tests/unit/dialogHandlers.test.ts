import { describe, expect, it, vi } from 'vitest';
import { GrantStore } from '../../src/main/grants';
import {
    createDialogHandlers,
    DEFAULT_FILE_FILTERS,
    type DialogLike,
    type OpenDialogOptionsLike,
    type SaveDialogOptionsLike,
} from '../../src/main/handlers/dialogHandlers';
import { MACOS_PATHS } from '../../src/main/paths';
import { IpcFailure } from '../../src/shared/ipcResult';

const MAIN_WINDOW = { id: 'hauptfenster' };
type FakeWindow = typeof MAIN_WINDOW;

function sequentialIds(): () => string {
    let next = 0;
    return () => `grant-${next++}`;
}

function setup(options: { openPaths?: string[]; savePath?: string; canceled?: boolean; window?: FakeWindow | null }) {
    const canceled = options.canceled ?? false;
    const dialog = {
        showOpenDialog: vi.fn((_window: FakeWindow, _options: OpenDialogOptionsLike) =>
            Promise.resolve({ canceled, filePaths: canceled ? [] : (options.openPaths ?? []) }),
        ),
        showSaveDialog: vi.fn((_window: FakeWindow, _options: SaveDialogOptionsLike) =>
            Promise.resolve(canceled ? { canceled, filePath: '' } : { canceled, filePath: options.savePath ?? '' }),
        ),
    } satisfies DialogLike<FakeWindow>;
    const grants = new GrantStore({ platform: MACOS_PATHS, createId: sequentialIds() });
    const window = options.window === undefined ? MAIN_WINDOW : options.window;
    const handlers = createDialogHandlers({ dialog, grants, window: () => window, platform: MACOS_PATHS });
    return { dialog, grants, handlers };
}

function openOptions(dialog: { showOpenDialog: { mock: { calls: [FakeWindow, OpenDialogOptionsLike][] } } }) {
    const call = dialog.showOpenDialog.mock.calls[0];
    if (call === undefined) throw new Error('Dialog nicht geöffnet');
    return call;
}

describe('dialog:pickFiles', () => {
    it('gewährt die gewählte Datei; der Renderer sieht nur Kennung und Namen', async () => {
        const { handlers, grants } = setup({ openPaths: ['/Users/u/Briefe/brief.tex'] });
        const result = await handlers['dialog:pickFiles']({});
        expect(result).toEqual([{ grantId: 'grant-0', name: 'brief.tex' }]);
        expect(JSON.stringify(result)).not.toContain('/Users/u');
        expect(grants.resolve('grant-0', 'pickedFile')).toBe('/Users/u/Briefe/brief.tex');
    });

    it('Abbruch ergibt null und legt keine Gewährung an', async () => {
        const { handlers, grants } = setup({ canceled: true });
        expect(await handlers['dialog:pickFiles']({ multiple: true })).toBeNull();
        expect(() => grants.resolve('grant-0', 'pickedFile')).toThrow(IpcFailure);
    });

    it('nutzt das Hauptfenster als Eltern und Standardfilter für LaTeX und Textdateien', async () => {
        const { handlers, dialog } = setup({ openPaths: ['/Users/u/a.tex'] });
        await handlers['dialog:pickFiles']({});
        const [window, options] = openOptions(dialog);
        expect(window).toBe(MAIN_WINDOW);
        expect(options.properties).toEqual(['openFile']);
        expect(options.filters).toEqual(DEFAULT_FILE_FILTERS);
        expect(options.filters?.[0]?.extensions).toEqual(['tex', 'bib', 'sty', 'cls']);
        expect(options.filters?.[1]?.name).toBe('Alle Textdateien');
    });

    it('übernimmt eigene Filter ohne führenden Punkt', async () => {
        const { handlers, dialog } = setup({ openPaths: ['/Users/u/bild.png'] });
        await handlers['dialog:pickFiles']({ title: 'Bild wählen', filters: [{ name: 'Bilder', extensions: ['.png', 'jpg'] }] });
        const [, options] = openOptions(dialog);
        expect(options.title).toBe('Bild wählen');
        expect(options.filters).toEqual([{ name: 'Bilder', extensions: ['png', 'jpg'] }]);
    });

    it('Mehrfachauswahl gewährt jede Datei einzeln', async () => {
        const { handlers, dialog } = setup({ openPaths: ['/Users/u/a.tex', '/Users/u/b.bib'] });
        const result = await handlers['dialog:pickFiles']({ multiple: true });
        expect(openOptions(dialog)[1].properties).toEqual(['openFile', 'multiSelections']);
        expect(result).toEqual([
            { grantId: 'grant-0', name: 'a.tex' },
            { grantId: 'grant-1', name: 'b.bib' },
        ]);
    });

    it('ohne Mehrfachauswahl zählt nur die erste Datei', async () => {
        const { handlers } = setup({ openPaths: ['/Users/u/a.tex', '/Users/u/b.tex'] });
        expect(await handlers['dialog:pickFiles']({ multiple: false })).toHaveLength(1);
    });

    it('ohne Hauptfenster öffnet sich kein Dialog', async () => {
        const { handlers, dialog } = setup({ openPaths: ['/Users/u/a.tex'], window: null });
        await expect(handlers['dialog:pickFiles']({})).rejects.toThrow(IpcFailure);
        expect(dialog.showOpenDialog).not.toHaveBeenCalled();
    });
});

describe('dialog:saveAs', () => {
    it('gewährt das Ziel als saveTarget; Abbruch ergibt null', async () => {
        const chosen = setup({ savePath: '/Users/u/neu.tex' });
        expect(await chosen.handlers['dialog:saveAs']({})).toEqual({ grantId: 'grant-0', name: 'neu.tex' });
        expect(chosen.grants.resolve('grant-0', 'saveTarget')).toBe('/Users/u/neu.tex');
        const canceled = setup({ canceled: true });
        expect(await canceled.handlers['dialog:saveAs']({})).toBeNull();
    });

    it('Vorschlag außerhalb des Projekts behält nur den Dateinamen', async () => {
        const { handlers, dialog, grants } = setup({ savePath: '/Users/u/x.tex' });
        await handlers['dialog:saveAs']({ defaultPath: '/Users/u/.ssh/config' });
        expect(dialog.showSaveDialog.mock.calls[0]?.[1].defaultPath).toBe('config');
        grants.openProject(grants.grant('/Users/u/Projekt', 'project').grantId);
        await handlers['dialog:saveAs']({ defaultPath: '/Users/u/Projekt/kapitel.tex' });
        expect(dialog.showSaveDialog.mock.calls[1]?.[1].defaultPath).toBe('/Users/u/Projekt/kapitel.tex');
    });
});

describe('dialog:openProject', () => {
    it('wählt einen Ordner und gewährt ihn als Projekt', async () => {
        const { handlers, dialog, grants } = setup({ openPaths: ['/Users/u/Arbeit'] });
        expect(await handlers['dialog:openProject']()).toEqual({ grantId: 'grant-0', name: 'Arbeit' });
        expect(openOptions(dialog)[1].properties).toContain('openDirectory');
        expect(grants.openProject('grant-0')).toBe('/Users/u/Arbeit');
    });

    it('Abbruch ergibt null', async () => {
        const { handlers } = setup({ canceled: true });
        expect(await handlers['dialog:openProject']()).toBeNull();
    });
});
