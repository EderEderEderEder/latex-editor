// Hauptprogramm der W3-3a-Messseite (Wegwerfcode). Sicherheit wie im Paket aus `src/main/security.ts`: Anfragefilter
// (`file:` nur unter dem eigenen out-Ordner), CSP-Kopf `PACKAGED_CSP_HEADER`, Berechtigungen ablehnen,
// Navigationssperre; im <meta>-Tag steht exakt `RENDERER_CSP`. Gestartet über Playwright `_electron.launch`.
import { app, BrowserWindow, session } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { currentPathPlatform, pathToFileUrl } from '../../../src/main/paths';
import {
    denyAllPermissions,
    installRequestFilter,
    lockNavigation,
    PACKAGED_CSP_HEADER,
    RENDERER_CSP,
    withCspHeader,
    type RendererLocation,
} from '../../../src/main/security';

const WINDOW_WIDTH = 1400;
const WINDOW_HEIGHT = 1000;
const PAGE_FILE = 'index.html';
// Wie tests/perf/measureRun.ts: „bis zum Rahmen“ misst dann die Arbeit, nicht das Warten auf den Rahmentakt
const UNLIMITED_FRAME_SWITCHES = ['disable-frame-rate-limit', 'disable-gpu-vsync'];
const BACKGROUND_SWITCHES = ['disable-renderer-backgrounding', 'disable-background-timer-throttling', 'disable-backgrounding-occluded-windows'];

interface MainProbe {
    headerUrls: string[];
    securityLog: string[];
}

const probe: MainProbe = { headerUrls: [], securityLog: [] };
(globalThis as { w33aMain?: MainProbe }).w33aMain = probe;
const platform = currentPathPlatform();
const pagePath = join(__dirname, PAGE_FILE);

app.setPath('userData', join(os.tmpdir(), 'w33a', 'electron-userdata'));
for (const name of BACKGROUND_SWITCHES) app.commandLine.appendSwitch(name);
if (process.env.W33A_VSYNC !== '1') for (const name of UNLIMITED_FRAME_SWITCHES) app.commandLine.appendSwitch(name);

function log(message: string): void {
    probe.securityLog.push(message);
}

async function writePage(): Promise<void> {
    const template = await readFile(join(__dirname, 'page.template.html'), 'utf8');
    await writeFile(pagePath, template.replace('%%CSP%%', RENDERER_CSP));
}

/** Wie `applySessionSecurity`, nur merkt sich der CSP-Kopf, für welche Antworten er gesetzt wurde */
function installSession(): void {
    const location: RendererLocation = { kind: 'packaged', indexFileUrl: pathToFileUrl(pagePath, platform) };
    installRequestFilter(session.defaultSession, { location, platform, allowDevTools: false }, log);
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        probe.headerUrls.push(details.url);
        callback({ responseHeaders: withCspHeader(details.responseHeaders, PACKAGED_CSP_HEADER) });
    });
    denyAllPermissions(session.defaultSession, log);
}

function createWindow(): void {
    const window = new BrowserWindow({
        show: false,
        width: WINDOW_WIDTH,
        height: WINDOW_HEIGHT,
        webPreferences: {
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
            spellcheck: false,
            backgroundThrottling: false,
        },
    });
    // Sichtbar, aber ohne den Fokus zu stehlen: verdeckte Fenster zeichnen anders
    window.once('ready-to-show', () => window.showInactive());
    void window.loadFile(pagePath);
}

app.on('web-contents-created', (_event, contents) => lockNavigation(contents, log));
app.on('window-all-closed', () => app.quit());
void app.whenReady().then(async () => {
    await writePage();
    installSession();
    createWindow();
});
