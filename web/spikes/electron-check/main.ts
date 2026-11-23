// Hauptprogramm der Prüfseite (Wegwerfcode, Spike S5/S6/S9). Nutzt security.ts aus src/main
// unverändert (Navigationssperre, Anfragefilter, Berechtigungen) und baut die CSP-Header selbst,
// weil die Seite für Variante 1 zusätzlich `latexeditor:` in `connect-src` braucht.
import { app, BrowserWindow, clipboard, ipcMain, protocol, session } from 'electron';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { assertInsideProject, currentPathPlatform, pathToFileUrl } from '../../src/main/paths';
import {
    APP_PROTOCOL,
    denyAllPermissions,
    installRequestFilter,
    lockNavigation,
    RENDERER_CSP,
    withCspHeader,
    type RendererLocation,
} from '../../src/main/security';
import type { SpikeConfig } from './src/spikeApi';

const WINDOW_WIDTH = 1100;
const WINDOW_HEIGHT = 900;
const SCHEME_NAME = APP_PROTOCOL.replace(':', '');
const PDF_HOST = 'pdf';
const STRICT_PAGE = 'index.html';
const PROTOCOL_PAGE = 'index-protocol.html';
const PROTOCOL_CSP = RENDERER_CSP.replace("connect-src 'self'", `connect-src 'self' ${APP_PROTOCOL}`);
const HTTP_OK = 200;
const HTTP_PARTIAL = 206;
const HTTP_NO_CONTENT = 204;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_SATISFIABLE = 416;
const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

const pageName = process.env.SPIKE_PAGE ?? STRICT_PAGE;
const platform = currentPathPlatform();
let mainWindow: BrowserWindow | null = null;

// Muss vor `ready` stehen. Keine Rechte wie `bypassCSP`: die CSP soll auch das Protokoll prüfen.
protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME_NAME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

function cspForPage(page: string): string {
    return page === PROTOCOL_PAGE ? PROTOCOL_CSP : RENDERER_CSP;
}

function config(): SpikeConfig {
    return {
        pdfPath: process.env.SPIKE_PDF ?? '',
        allowedDirectory: process.env.SPIKE_ALLOWED_DIR ?? '',
        outsidePath: process.env.SPIKE_OUTSIDE ?? '',
        pageName,
        csp: cspForPage(pageName),
    };
}

async function writePages(): Promise<void> {
    const template = await readFile(join(__dirname, 'page.template.html'), 'utf8');
    for (const page of [STRICT_PAGE, PROTOCOL_PAGE]) {
        await writeFile(join(__dirname, page), template.replace('%%CSP%%', cspForPage(page)));
    }
}

function parseRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | null {
    if (header === null) return null;
    const match = RANGE_PATTERN.exec(header);
    if (match === null) return 'invalid';
    const [, from = '', to = ''] = match;
    const start = from === '' ? size - Number(to) : Number(from);
    const end = from === '' || to === '' ? size - 1 : Math.min(Number(to), size - 1);
    return start < 0 || start > end ? 'invalid' : { start, end };
}

function pdfResponse(path: string, size: number, range: { start: number; end: number } | null): Response {
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    const headers: Record<string, string> = {
        'Content-Type': 'application/pdf',
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
        // Die Prüfseite kommt von file:// (Ursprung „null“); ein späteres latexeditor://-Fenster bräuchte das nicht.
        'Access-Control-Allow-Origin': '*',
    };
    if (range !== null) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    return new Response(stream, { status: range === null ? HTTP_OK : HTTP_PARTIAL, headers });
}

function preflightResponse(): Response {
    return new Response(null, {
        status: HTTP_NO_CONTENT,
        headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'range', 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
    });
}

async function handlePdfRequest(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return preflightResponse();
    const url = new URL(request.url);
    const requested = url.searchParams.get('p');
    if (url.host !== PDF_HOST || requested === null) return new Response('Nicht erlaubt', { status: HTTP_FORBIDDEN });
    try {
        const real = await assertInsideProject(requested, config().allowedDirectory, { platform });
        const size = (await stat(real)).size;
        const range = parseRange(request.headers.get('range'), size);
        if (range === 'invalid') return new Response(null, { status: HTTP_NOT_SATISFIABLE });
        return pdfResponse(real, size, range);
    } catch {
        return new Response('Nicht erlaubt', { status: HTTP_FORBIDDEN });
    }
}

async function readPdfForIpc(path: unknown): Promise<ArrayBuffer> {
    if (typeof path !== 'string') throw new Error('Pfad fehlt');
    const real = await assertInsideProject(path, config().allowedDirectory, { platform });
    const buffer = await readFile(real);
    const whole = buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength;
    return whole ? (buffer.buffer as ArrayBuffer) : (buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);
}

function registerIpc(): void {
    const guard = <T>(handler: (...args: unknown[]) => T) => (event: Electron.IpcMainInvokeEvent, ...args: unknown[]): T => {
        if (mainWindow === null || event.sender.id !== mainWindow.webContents.id) throw new Error('Absender nicht vertrauenswürdig');
        return handler(...args);
    };
    ipcMain.handle('spike:config', guard(() => config()));
    ipcMain.handle('spike:readPdf', guard((path) => readPdfForIpc(path)));
    ipcMain.handle('spike:clipboardRead', guard(() => clipboard.readText()));
    ipcMain.handle('spike:clipboardWrite', guard((text) => clipboard.writeText(String(text))));
}

function installSession(): void {
    const location: RendererLocation = { kind: 'packaged', indexFileUrl: pathToFileUrl(join(__dirname, pageName), platform) };
    const log = (message: string): void => console.warn(`[Sicherheit] ${message}`);
    installRequestFilter(session.defaultSession, location, log);
    denyAllPermissions(session.defaultSession, log);
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({ responseHeaders: withCspHeader(details.responseHeaders, cspForPage(pageName)) });
    });
    protocol.handle(SCHEME_NAME, handlePdfRequest);
}

function createWindow(): BrowserWindow {
    const window = new BrowserWindow({
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        title: `Prüfseite Electron (${pageName})`,
        webPreferences: {
            preload: join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
            spellcheck: false,
            backgroundThrottling: false,
        },
    });
    window.on('closed', () => {
        mainWindow = null;
    });
    void window.loadFile(join(__dirname, pageName));
    return window;
}

app.on('web-contents-created', (_event, contents) => lockNavigation(contents, (message) => console.warn(`[Sicherheit] ${message}`)));
app.on('window-all-closed', () => app.quit());
void app.whenReady().then(async () => {
    await writePages();
    installSession();
    registerIpc();
    mainWindow = createWindow();
});
