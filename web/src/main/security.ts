import type { Session, WebContents } from 'electron';
import { arePathsEqual, fileUrlToPath, isPathWithin, type PathPlatform } from './paths';

// Sicherheitsregeln aus PLAN-WEBUI.md §2 „Sicherheit (Electron)“. Electron kommt nur als Typ
// herein; die Prüfungen sind reine Funktionen, die Installationsfunktionen bekommen Session
// und WebContents als Parameter. So läuft alles in Vitest ohne Electron.

export type RendererLocation =
    | { readonly kind: 'packaged'; readonly indexFileUrl: string }
    | { readonly kind: 'development'; readonly devServerUrl: string };

export type SecurityLog = (message: string) => void;

export interface RequestPolicy {
    readonly location: RendererLocation;
    readonly platform: PathPlatform;
    // Nur unverpackt (`!app.isPackaged`): die DevTools laufen in derselben Session; ohne
    // `devtools:` bliebe ihr Fenster leer. Im Paket sind sie ganz abgeschaltet.
    readonly allowDevTools: boolean;
}

// `data:` und `blob:` bleiben erlaubt: Chromium lädt sie meist über eigene Loader ohne den
// webRequest-Filter; meldet es sie doch, bräche ein Verbot pdf.js (Worker als `blob:`, Bilder
// als `data:`). Beide verweisen nur auf Daten im Speicher und erreichen kein Netz. Im Fenster
// geprüft wird das mit der Prüfseite aus W0-10.
const MEMORY_PROTOCOLS: ReadonlySet<string> = new Set(['data:', 'blob:']);
const FILE_PROTOCOL = 'file:';
const DEV_SERVER_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'ws:', 'wss:']);
const DEVTOOLS_PROTOCOL = 'devtools:';
const CSP_HEADER_NAME = 'Content-Security-Policy';

// Muss mit dem `<meta>`-Tag in `src/renderer/index.html` übereinstimmen (Test `security`).
export const RENDERER_CSP =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "worker-src 'self' blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

// `frame-ancestors` wirkt nur als Header, im `<meta>`-Tag ignoriert Chromium es mit Warnung.
export const PACKAGED_CSP_HEADER = `${RENDERER_CSP}; frame-ancestors 'none'`;

function parseUrl(raw: string): URL | null {
    return URL.canParse(raw) ? new URL(raw) : null;
}

function isDevServerRequest(url: URL, devServerUrl: string): boolean {
    const devServer = parseUrl(devServerUrl);
    if (devServer === null) return false;
    return DEV_SERVER_PROTOCOLS.has(url.protocol) && url.host === devServer.host;
}

// Gepackt nur Dateien unterhalb des Ordners der eigenen `index.html` (nicht Projektordner, nicht `C:\`).
function isFileRequestAllowed(rawUrl: string, policy: RequestPolicy): boolean {
    const { location, platform } = policy;
    if (location.kind === 'development') return true;
    try {
        const rendererFolder = platform.path.dirname(fileUrlToPath(location.indexFileUrl, platform));
        return isPathWithin(fileUrlToPath(rawUrl, platform), rendererFolder, platform);
    } catch {
        return false;
    }
}

export function isRequestAllowed(rawUrl: string, policy: RequestPolicy): boolean {
    const url = parseUrl(rawUrl);
    if (url === null) return false;
    if (MEMORY_PROTOCOLS.has(url.protocol)) return true;
    if (url.protocol === FILE_PROTOCOL) return isFileRequestAllowed(rawUrl, policy);
    if (url.protocol === DEVTOOLS_PROTOCOL) return policy.allowDevTools;
    if (policy.location.kind !== 'development') return false;
    return isDevServerRequest(url, policy.location.devServerUrl);
}

function isSameFile(frameUrl: string, indexFileUrl: string, platform: PathPlatform): boolean {
    try {
        return arePathsEqual(fileUrlToPath(frameUrl, platform), fileUrlToPath(indexFileUrl, platform), platform);
    } catch {
        return false;
    }
}

// Darf ein Frame mit dieser URL IPC-Anfragen stellen? Gepackt nur die eigene `index.html`
// (Anker und Abfrage egal), im Entwicklungsmodus nur der Ursprung des electron-vite-Servers.
export function isTrustedRendererUrl(frameUrl: string, location: RendererLocation, platform: PathPlatform): boolean {
    if (location.kind === 'packaged') return isSameFile(frameUrl, location.indexFileUrl, platform);
    const frame = parseUrl(frameUrl);
    const devServer = parseUrl(location.devServerUrl);
    if (frame === null || devServer === null) return false;
    return frame.origin === devServer.origin;
}

export type ResponseHeaders = Record<string, string[]>;

export function withCspHeader(headers: ResponseHeaders | undefined, csp: string): ResponseHeaders {
    const result: ResponseHeaders = {};
    for (const [name, values] of Object.entries(headers ?? {})) {
        if (name.toLowerCase() !== CSP_HEADER_NAME.toLowerCase()) result[name] = values;
    }
    result[CSP_HEADER_NAME] = [csp];
    return result;
}

// ---------- dünne Installationsfunktionen (Electron-Objekte als Parameter) ----------

export function installRequestFilter(session: Session, policy: RequestPolicy, log: SecurityLog): void {
    session.webRequest.onBeforeRequest((details, callback) => {
        const allowed = isRequestAllowed(details.url, policy);
        if (!allowed) log(`Anfrage blockiert: ${details.url}`);
        callback({ cancel: !allowed });
    });
}

// Nur im gepackten Fenster: im Entwicklungsmodus lockert das Vite-Plugin die CSP im `<meta>`-Tag
// (Inline-Skript für React Refresh, WebSocket), ein strenger Header würde das wieder verbieten.
export function installCspHeader(session: Session, location: RendererLocation): void {
    if (location.kind !== 'packaged') return;
    session.webRequest.onHeadersReceived((details, callback) => {
        callback({ responseHeaders: withCspHeader(details.responseHeaders, PACKAGED_CSP_HEADER) });
    });
}

export function denyAllPermissions(session: Session, log: SecurityLog): void {
    session.setPermissionRequestHandler((_webContents, permission, callback) => {
        log(`Berechtigung abgelehnt: ${permission}`);
        callback(false);
    });
    session.setPermissionCheckHandler(() => false);
}

export function applySessionSecurity(session: Session, policy: RequestPolicy, log: SecurityLog): void {
    installRequestFilter(session, policy, log);
    installCspHeader(session, policy.location);
    denyAllPermissions(session, log);
}

export function lockNavigation(contents: WebContents, log: SecurityLog): void {
    contents.on('will-navigate', (event, url) => {
        event.preventDefault();
        log(`Navigation blockiert: ${url}`);
    });
    contents.on('will-attach-webview', (event) => {
        event.preventDefault();
        log('webview blockiert');
    });
    contents.setWindowOpenHandler(({ url }) => {
        log(`Neues Fenster blockiert: ${url}`);
        return { action: 'deny' };
    });
}
