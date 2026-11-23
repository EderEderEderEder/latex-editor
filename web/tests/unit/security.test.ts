import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Session, WebContents } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { MACOS_PATHS, WINDOWS_PATHS } from '../../src/main/paths';
import {
    installCspHeader,
    installRequestFilter,
    isRequestAllowed,
    isTrustedRendererUrl,
    lockNavigation,
    PACKAGED_CSP_HEADER,
    RENDERER_CSP,
    type RendererLocation,
    type RequestPolicy,
    withCspHeader,
} from '../../src/main/security';

const PACKAGED: RendererLocation = { kind: 'packaged', indexFileUrl: 'file:///app/out/renderer/index.html' };
const DEVELOPMENT: RendererLocation = { kind: 'development', devServerUrl: 'http://localhost:5173/' };
const INDEX_HTML = join(__dirname, '../../src/renderer/index.html');
// Gepackt heißt im Paket immer auch DevTools aus; ein unverpackter Build (`electron .`) erlaubt sie.
const PACKAGED_POLICY: RequestPolicy = { location: PACKAGED, platform: MACOS_PATHS, allowDevTools: false };
const UNPACKED_BUILD_POLICY: RequestPolicy = { ...PACKAGED_POLICY, allowDevTools: true };
const DEVELOPMENT_POLICY: RequestPolicy = { location: DEVELOPMENT, platform: MACOS_PATHS, allowDevTools: true };
const WINDOWS_POLICY: RequestPolicy = {
    location: { kind: 'packaged', indexFileUrl: 'file:///C:/Programme/LatexEditor/resources/app.asar/out/renderer/index.html' },
    platform: WINDOWS_PATHS,
    allowDevTools: false,
};
const META_CSP = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/;

describe('isRequestAllowed', () => {
    it.each([
        ['file:///app/out/renderer/main.js', true],
        ['file:///app/out/renderer/assets/index-abc.js?x=1#y', true],
        ['file:///app/out/renderer/../main/index.js', false],
        ['file:///app/out/renderer-andere/x.js', false],
        ['file:///Users/u/.ssh/id_rsa', false],
        ['file:///etc/passwd', false],
        ['file://server/share/x.js', false],
        ['data:image/png;base64,AAAA', true],
        ['blob:file:///0b5c1f6e-1d2e-4f00-9a3b-123456789abc', true],
        ['https://example.com/', false],
        ['http://localhost:5173/', false],
        ['ws://localhost:5173/', false],
        ['devtools://devtools/bundled/inspector.html', false],
        ['chrome-extension://abc/x.js', false],
        ['ftp://example.com/a', false],
        ['keine url', false],
    ])('gepackt: %s → %s', (url, expected) => {
        expect(isRequestAllowed(url, PACKAGED_POLICY)).toBe(expected);
    });

    it('gepackt unter Windows: nur unterhalb des Renderer-Ordners, kein UNC, kein anderes Laufwerk', () => {
        const base = 'file:///C:/Programme/LatexEditor/resources/app.asar/out/renderer';
        expect(isRequestAllowed(`${base}/assets/a.js`, WINDOWS_POLICY)).toBe(true);
        expect(isRequestAllowed('file:///c:/programme/latexeditor/RESOURCES/app.asar/out/renderer/x.css', WINDOWS_POLICY)).toBe(true);
        expect(isRequestAllowed('file:///C:/Windows/win.ini', WINDOWS_POLICY)).toBe(false);
        expect(isRequestAllowed('file:///D:/Programme/LatexEditor/resources/app.asar/out/renderer/a.js', WINDOWS_POLICY)).toBe(false);
        expect(isRequestAllowed('file://server/share/a.js', WINDOWS_POLICY)).toBe(false);
    });

    it('devtools: nur, wenn nicht verpackt (auch bei einem unverpackten Build ohne Dev-Server)', () => {
        const url = 'devtools://devtools/bundled/inspector.html';
        expect(isRequestAllowed(url, PACKAGED_POLICY)).toBe(false);
        expect(isRequestAllowed(url, UNPACKED_BUILD_POLICY)).toBe(true);
        expect(isRequestAllowed(url, DEVELOPMENT_POLICY)).toBe(true);
    });

    it.each([
        ['http://localhost:5173/@vite/client', true],
        ['ws://localhost:5173/', true],
        ['file:///x/preload.js', true],
        ['devtools://devtools/bundled/inspector.html', true],
        ['http://localhost:5174/', false],
        ['http://127.0.0.1:5173/', false],
        ['https://fonts.googleapis.com/css', false],
        ['http://localhost.evil.example:5173/', false],
    ])('Entwicklung: %s → %s', (url, expected) => {
        expect(isRequestAllowed(url, DEVELOPMENT_POLICY)).toBe(expected);
    });
});

describe('isTrustedRendererUrl', () => {
    it('gepackt: nur die eigene index.html, Anker und Abfrage egal', () => {
        expect(isTrustedRendererUrl('file:///app/out/renderer/index.html', PACKAGED, MACOS_PATHS)).toBe(true);
        expect(isTrustedRendererUrl('file:///app/out/renderer/index.html#/x?y', PACKAGED, MACOS_PATHS)).toBe(true);
        expect(isTrustedRendererUrl('file:///app/out/renderer/andere.html', PACKAGED, MACOS_PATHS)).toBe(false);
        expect(isTrustedRendererUrl('https://example.com/index.html', PACKAGED, MACOS_PATHS)).toBe(false);
        expect(isTrustedRendererUrl('about:blank', PACKAGED, MACOS_PATHS)).toBe(false);
    });

    it('gepackt unter Windows: Laufwerk und Schreibweise egal', () => {
        const location: RendererLocation = { kind: 'packaged', indexFileUrl: 'file:///C:/App/out/renderer/index.html' };
        expect(isTrustedRendererUrl('file:///c:/app/OUT/renderer/index.html', location, WINDOWS_PATHS)).toBe(true);
        expect(isTrustedRendererUrl('file:///D:/App/out/renderer/index.html', location, WINDOWS_PATHS)).toBe(false);
    });

    it('Entwicklung: nur der Ursprung des Dev-Servers', () => {
        expect(isTrustedRendererUrl('http://localhost:5173/', DEVELOPMENT, MACOS_PATHS)).toBe(true);
        expect(isTrustedRendererUrl('http://localhost:5173/sub?x=1', DEVELOPMENT, MACOS_PATHS)).toBe(true);
        expect(isTrustedRendererUrl('http://localhost:9999/', DEVELOPMENT, MACOS_PATHS)).toBe(false);
        expect(isTrustedRendererUrl('file:///app/out/renderer/index.html', DEVELOPMENT, MACOS_PATHS)).toBe(false);
    });
});

describe('CSP', () => {
    it('der <meta>-Tag in index.html stimmt mit RENDERER_CSP überein', async () => {
        const html = await readFile(INDEX_HTML, 'utf8');
        expect(META_CSP.exec(html)?.[1]).toBe(RENDERER_CSP);
    });

    it('Header ist streng: kein unsafe-eval, keine fremden Hosts, frame-ancestors', () => {
        expect(PACKAGED_CSP_HEADER).not.toContain('unsafe-eval');
        expect(PACKAGED_CSP_HEADER).not.toMatch(/https?:/);
        expect(PACKAGED_CSP_HEADER).toContain("frame-ancestors 'none'");
        expect(PACKAGED_CSP_HEADER).toContain("object-src 'none'");
        expect(PACKAGED_CSP_HEADER).toContain("frame-src 'none'");
    });

    it('withCspHeader ersetzt vorhandene CSP-Header unabhängig von der Schreibweise', () => {
        const headers = withCspHeader({ 'content-security-policy': ['alt'], 'Content-Type': ['text/html'] }, 'neu');
        expect(headers).toEqual({ 'Content-Type': ['text/html'], 'Content-Security-Policy': ['neu'] });
    });
});

type Listener = (...args: unknown[]) => void;

function fakeWebContents() {
    const listeners = new Map<string, Listener>();
    let openHandler: ((details: { url: string }) => { action: string }) | null = null;
    const contents = {
        on: (event: string, listener: Listener) => listeners.set(event, listener),
        setWindowOpenHandler: (handler: typeof openHandler) => {
            openHandler = handler;
        },
    };
    return { contents: contents as unknown as WebContents, listeners, openHandler: () => openHandler };
}

describe('Installationsfunktionen mit gefälschten Electron-Objekten', () => {
    it('lockNavigation verhindert Navigation, webview und neue Fenster', () => {
        const fake = fakeWebContents();
        const log = vi.fn();
        lockNavigation(fake.contents, log);
        const preventDefault = vi.fn();
        fake.listeners.get('will-navigate')?.({ preventDefault }, 'https://example.com/');
        fake.listeners.get('will-attach-webview')?.({ preventDefault });
        expect(preventDefault).toHaveBeenCalledTimes(2);
        expect(fake.openHandler()?.({ url: 'https://example.com/' })).toEqual({ action: 'deny' });
        expect(log).toHaveBeenCalledWith('Navigation blockiert: https://example.com/');
    });

    it('installRequestFilter bricht Anfragen an fremde Hosts ab', () => {
        type Filter = (details: { url: string }, callback: (response: { cancel: boolean }) => void) => void;
        const installed: { filter?: Filter } = {};
        const session = {
            webRequest: {
                onBeforeRequest: (listener: Filter) => {
                    installed.filter = listener;
                },
            },
        };
        const log = vi.fn();
        installRequestFilter(session as unknown as Session, PACKAGED_POLICY, log);
        const callback = vi.fn();
        installed.filter?.({ url: 'https://example.com/tracker.js' }, callback);
        installed.filter?.({ url: 'file:///app/out/renderer/main.js' }, callback);
        expect(callback.mock.calls).toEqual([[{ cancel: true }], [{ cancel: false }]]);
        expect(log).toHaveBeenCalledTimes(1);
    });

    it('installCspHeader setzt im gepackten Fenster den strengen Header auf jede Antwort, im Dev-Modus nicht', () => {
        type HeaderListener = (
            details: { responseHeaders?: Record<string, string[]> },
            callback: (response: { responseHeaders: Record<string, string[]> }) => void,
        ) => void;
        const installed: HeaderListener[] = [];
        const session = { webRequest: { onHeadersReceived: (listener: HeaderListener) => installed.push(listener) } };
        installCspHeader(session as unknown as Session, DEVELOPMENT);
        expect(installed).toHaveLength(0);
        installCspHeader(session as unknown as Session, PACKAGED);
        const callback = vi.fn();
        installed[0]?.({ responseHeaders: { 'Content-Security-Policy': ["default-src *"] } }, callback);
        expect(callback).toHaveBeenCalledWith({ responseHeaders: { 'Content-Security-Policy': [PACKAGED_CSP_HEADER] } });
    });
});
