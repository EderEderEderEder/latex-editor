import { app, BrowserWindow, dialog, ipcMain, Menu, session } from 'electron';
import { join } from 'node:path';
import { createAppHandlers } from './handlers/appHandlers';
import { createEventSender, registerIpcHandlers } from './ipc';
import { bringToFront, CloseGuard, createBeforeQuitHandler, createGuardedQuitHandler, QuitTasks } from './lifecycle';
import { currentPathPlatform, pathToFileUrl } from './paths';
import { choosePreloadPath } from './preloadChoice';
import { applySessionSecurity, lockNavigation, type RendererLocation } from './security';

const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 800;
const RENDERER_INDEX_PATH = join(__dirname, '../renderer/index.html');
const REAL_PRELOAD_PATH = join(__dirname, '../preload/index.js');
const STUB_PRELOAD_PATH = join(__dirname, '../preload/stub.js');
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';

let mainWindow: BrowserWindow | null = null;
// Aufräumen beim Beenden; W2-10 trägt hier den Build-Abbruch ein (`quitTasks.add(() => runner.cancel())`).
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

function createWindow(location: RendererLocation): BrowserWindow {
    const window = new BrowserWindow({
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        title: 'LatexEditor Web',
        webPreferences: {
            preload: resolvePreloadPath(),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
            spellcheck: false,
            devTools: !app.isPackaged,
        },
    });
    window.on('close', (event) => closeGuard.onWindowClose(event));
    window.on('closed', () => {
        mainWindow = null;
    });
    if (location.kind === 'development') {
        void window.loadURL(location.devServerUrl);
    } else {
        void window.loadFile(RENDERER_INDEX_PATH);
    }
    return window;
}

async function start(): Promise<void> {
    await app.whenReady();
    // Bis W2-16 kein Menü: das Standardmenü böte „Toggle Developer Tools“ und Neuladen.
    Menu.setApplicationMenu(null);
    const location = getRendererLocation();
    const platform = currentPathPlatform();
    applySessionSecurity(session.defaultSession, { location, platform, allowDevTools: !app.isPackaged }, logSecurity);
    const { handlers } = createAppHandlers({
        userDataDir: app.getPath('userData'),
        dialog,
        window: liveMainWindow,
        platform,
        quitTasks,
        log: logSettings,
        confirmClose: () => closeGuard.confirm(liveMainWindow()),
    });
    registerIpcHandlers(ipcMain, {
        handlers,
        policy: { getTrustedWebContentsId: trustedWebContentsId, location, platform },
        log: logSecurity,
    });
    mainWindow = createWindow(location);
}

// Zwei Instanzen teilten sich `userData` (Einstellungen, Wiederherstellung); die zweite holt die erste nach vorn.
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => bringToFront(mainWindow));
    // Erst die Nachfrage bei Ungespeichertem (K1), dann das Aufräumen (Einstellungen sichern, später Build-Abbruch).
    const cleanup = createBeforeQuitHandler({ tasks: quitTasks, quit: () => app.quit(), log: logLifecycle });
    app.on('before-quit', createGuardedQuitHandler(closeGuard, liveMainWindow, cleanup));
    // Jedes webContents (auch künftige Fenster und die DevTools) bekommt die Navigationssperre.
    app.on('web-contents-created', (_event, contents) => lockNavigation(contents, logSecurity));
    app.on('window-all-closed', () => app.quit());
    void start();
}
