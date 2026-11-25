import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, type WebPreferences } from 'electron';
import { join } from 'node:path';
import { createAppHandlers } from './handlers/appHandlers';
import type { ProjectWatch } from './handlers/watchHandlers';
import { createEventSender, registerIpcHandlers } from './ipc';
import { bringToFront, CloseGuard, createBeforeQuitHandler, createGuardedQuitHandler, QuitTasks } from './lifecycle';
import { installApplicationMenu } from './menu';
import { currentPathPlatform, type PathPlatform, pathToFileUrl } from './paths';
import { choosePreloadPath } from './preloadChoice';
import { applySessionSecurity, lockNavigation, type RendererLocation } from './security';

const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 800;
const RENDERER_INDEX_PATH = join(__dirname, '../renderer/index.html');
const REAL_PRELOAD_PATH = join(__dirname, '../preload/index.js');
const STUB_PRELOAD_PATH = join(__dirname, '../preload/stub.js');
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';
// Eigene Einstiege von `electron.vite.config.ts` neben `index.js` (`out/main/`).
const PARSE_WORKER_FILE_NAME = 'parse.worker.js';
const SYNCTEX_WORKER_FILE_NAME = 'synctex.worker.js';

let mainWindow: BrowserWindow | null = null;
// Aufräumen beim Beenden: Einstellungen sichern, Build abbrechen, Überwachung beenden, Log- und SyncTeX-Worker beenden
// (jeweils in `createAppHandlers` eingetragen).
const quitTasks = new QuitTasks();
let stubPreloadActive = false;
const sendEvent = createEventSender(() => liveMainWindow()?.webContents ?? null);
const closeGuard = new CloseGuard({ requestConfirmation: requestCloseConfirmation, log: logLifecycle });

function logSecurity(message: string): void {
    console.warn(`[Sicherheit] ${message}`);
}

function logLifecycle(message: string): void {
    console.warn(`[Beenden] ${message}`);
}

function logSettings(message: string): void {
    console.warn(`[Einstellungen] ${message}`);
}

function liveMainWindow(): BrowserWindow | null {
    if (mainWindow === null || mainWindow.isDestroyed()) return null;
    return mainWindow;
}

// Der Stub-Preload hört nicht auf den Main; ein Renderer, der lädt oder abgestürzt ist, kann nicht antworten.
function requestCloseConfirmation(): boolean {
    const window = liveMainWindow();
    if (window === null || stubPreloadActive) return false;
    const contents = window.webContents;
    if (contents.isCrashed() || contents.isLoadingMainFrame()) return false;
    sendEvent('app:closeRequested', null);
    return true;
}

function getRendererLocation(): RendererLocation {
    const devServerUrl = app.isPackaged ? undefined : process.env[DEV_SERVER_ENV];
    if (devServerUrl) return { kind: 'development', devServerUrl };
    return { kind: 'packaged', indexFileUrl: pathToFileUrl(RENDERER_INDEX_PATH, currentPathPlatform()) };
}

function trustedWebContentsId(): number | null {
    if (mainWindow === null || mainWindow.isDestroyed()) return null;
    return mainWindow.webContents.id;
}

function resolvePreloadPath(): string {
    const preload = choosePreloadPath({
        isPackaged: app.isPackaged,
        env: process.env,
        realPath: REAL_PRELOAD_PATH,
        stubPath: STUB_PRELOAD_PATH,
    });
    stubPreloadActive = preload === STUB_PRELOAD_PATH;
    if (stubPreloadActive) logSecurity('Stub-Preload aktiv (nur Tests): window.api liefert gefälschte Antworten');
    return preload;
}

function workerScriptPath(fileName: string): string {
    return join(__dirname, fileName);
}

function windowPreferences(): WebPreferences {
    return {
        preload: resolvePreloadPath(),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
        devTools: !app.isPackaged,
    };
}

function createWindow(location: RendererLocation, watch: ProjectWatch | null): BrowserWindow {
    const window = new BrowserWindow({
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        title: 'LatexEditor Web',
        webPreferences: windowPreferences(),
    });
    window.on('close', (event) => closeGuard.onWindowClose(event));
    window.on('closed', () => {
        mainWindow = null;
    });
    // Sicherheitsnetz der Dateiüberwachung (S10): Änderungen, die `fs.watch` verpasst hat.
    window.on('focus', () => void watch?.rescan());
    if (location.kind === 'development') {
        void window.loadURL(location.devServerUrl);
    } else {
        void window.loadFile(RENDERER_INDEX_PATH);
    }
    return window;
}

function registerHandlers(location: RendererLocation, platform: PathPlatform): ProjectWatch | null {
    const { handlers, watch } = createAppHandlers({
        userDataDir: app.getPath('userData'),
        dialog,
        window: liveMainWindow,
        platform,
        quitTasks,
        log: logSettings,
        confirmClose: () => closeGuard.confirm(liveMainWindow()),
        emit: sendEvent,
        trashItem: (path) => shell.trashItem(path),
        parseWorkerScript: workerScriptPath(PARSE_WORKER_FILE_NAME),
        synctexWorkerScript: workerScriptPath(SYNCTEX_WORKER_FILE_NAME),
    });
    registerIpcHandlers(ipcMain, {
        handlers,
        policy: { getTrustedWebContentsId: trustedWebContentsId, location, platform },
        log: logSecurity,
    });
    return watch;
}

async function start(): Promise<void> {
    await app.whenReady();
    // Eigenes Menü statt Standardmenü (das böte „Toggle Developer Tools“ auch im Paket).
    installApplicationMenu({
        menu: Menu,
        platform: process.platform,
        isPackaged: app.isPackaged,
        sendCommand: (commandId) => sendEvent('menu:command', { commandId }),
    });
    const location = getRendererLocation();
    const platform = currentPathPlatform();
    applySessionSecurity(session.defaultSession, { location, platform, allowDevTools: !app.isPackaged }, logSecurity);
    const watch = registerHandlers(location, platform);
    mainWindow = createWindow(location, watch);
}

// Zwei Instanzen teilten sich `userData` (Einstellungen, Wiederherstellung); die zweite holt die erste nach vorn.
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => bringToFront(mainWindow));
    // Erst die Nachfrage bei Ungespeichertem (K1), dann das Aufräumen (Einstellungen sichern, Build-Abbruch).
    const cleanup = createBeforeQuitHandler({ tasks: quitTasks, quit: () => app.quit(), log: logLifecycle });
    app.on('before-quit', createGuardedQuitHandler(closeGuard, liveMainWindow, cleanup));
    // Jedes webContents (auch künftige Fenster und die DevTools) bekommt die Navigationssperre.
    app.on('web-contents-created', (_event, contents) => lockNavigation(contents, logSecurity));
    app.on('window-all-closed', () => app.quit());
    void start();
}
