import { app, BrowserWindow, ipcMain, session } from 'electron';
import { join } from 'node:path';
import { registerIpcHandlers } from './ipc';
import { createHandlerRegistry } from './ipcHandlers';
import { currentPathPlatform, pathToFileUrl } from './paths';
import { applySessionSecurity, lockNavigation, type RendererLocation } from './security';

const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 800;
const RENDERER_INDEX_PATH = join(__dirname, '../renderer/index.html');
const DEV_SERVER_ENV = 'ELECTRON_RENDERER_URL';

let mainWindow: BrowserWindow | null = null;

function logSecurity(message: string): void {
    console.warn(`[Sicherheit] ${message}`);
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

function createWindow(location: RendererLocation): BrowserWindow {
    const window = new BrowserWindow({
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        title: 'LatexEditor Web',
        webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
            spellcheck: false,
        },
    });
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
    const location = getRendererLocation();
    applySessionSecurity(session.defaultSession, location, logSecurity);
    registerIpcHandlers(ipcMain, {
        handlers: createHandlerRegistry(),
        policy: { getTrustedWebContentsId: trustedWebContentsId, location, platform: currentPathPlatform() },
        log: logSecurity,
    });
    mainWindow = createWindow(location);
}

// Jedes webContents (auch künftige Fenster und die DevTools) bekommt die Navigationssperre.
app.on('web-contents-created', (_event, contents) => lockNavigation(contents, logSecurity));
app.on('window-all-closed', () => app.quit());
void start();
