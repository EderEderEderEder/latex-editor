import { app, BrowserWindow, session } from 'electron';
import { join } from 'node:path';

const APP_PROTOCOL = 'latexeditor:';
const WINDOW_WIDTH = 1200;
const WINDOW_HEIGHT = 800;
const ALLOWED_PROTOCOLS: readonly string[] = ['file:', APP_PROTOCOL];

function getDevServerUrl(): URL | null {
    const raw = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];
    return raw ? new URL(raw) : null;
}

function isRequestAllowed(rawUrl: string, devServer: URL | null): boolean {
    const url = new URL(rawUrl);
    if (ALLOWED_PROTOCOLS.includes(url.protocol)) return true;
    return devServer !== null && url.host === devServer.host;
}

function installRequestFilter(devServer: URL | null): void {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        callback({ cancel: !isRequestAllowed(details.url, devServer) });
    });
}

function denyAllPermissions(): void {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(false);
    });
    session.defaultSession.setPermissionCheckHandler(() => false);
}

function blockNavigation(window: BrowserWindow): void {
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function createWindow(devServer: URL | null): BrowserWindow {
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
    blockNavigation(window);
    if (devServer) {
        void window.loadURL(devServer.href);
    } else {
        void window.loadFile(join(__dirname, '../renderer/index.html'));
    }
    return window;
}

async function start(): Promise<void> {
    await app.whenReady();
    const devServer = getDevServerUrl();
    installRequestFilter(devServer);
    denyAllPermissions();
    createWindow(devServer);
}

app.on('window-all-closed', () => app.quit());
void start();
