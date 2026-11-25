import react from '@vitejs/plugin-react';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import type { UserConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import {
    PDFJS_ASSET_DIRECTORY, PDFJS_ASSET_FOLDERS, PDFJS_WORKER_FILE, PDFJS_WORKER_SOURCE,
} from './src/renderer/pdf/pdfjsAssets';

// React Fast Refresh und der Vite-Client brauchen im Entwicklungsmodus ein
// Inline-Skript und einen WebSocket; im gebauten Paket gilt die strikte CSP.
function developmentCsp(): Plugin {
    return {
        name: 'development-csp',
        apply: 'serve',
        transformIndexHtml: (html) =>
            html
                .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
                .replace("connect-src 'self'", "connect-src 'self' ws://localhost:*"),
    };
}

// pdf.js-Hilfsdateien offline (W3-3a): Worker, cmaps, Standardschriften, Wasm (mit JS-Rückfall) und ICC-Profile
// kommen unverändert aus `node_modules/pdfjs-dist` nach `out/renderer/pdfjs/`; der Entwicklungsserver liefert sie
// unter `/pdfjs/`. Ohne eigene Abhängigkeit (kein Kopier-Plugin), Ablage siehe `src/renderer/pdf/pdfjsAssets.ts`.
const PDFJS_DIST = resolve(__dirname, 'node_modules/pdfjs-dist');
const PDFJS_URL_PREFIX = `/${PDFJS_ASSET_DIRECTORY}/`;
const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
const CONTENT_TYPES: Readonly<Record<string, string>> = {
    '.mjs': 'text/javascript',
    '.js': 'text/javascript',
    '.wasm': 'application/wasm',
};

/** Veröffentlichter Pfad (unter `out/renderer/`) → Quelldatei in `pdfjs-dist` */
async function listPdfjsAssets(): Promise<Map<string, string>> {
    const assets = new Map([[`${PDFJS_ASSET_DIRECTORY}/${PDFJS_WORKER_FILE}`, join(PDFJS_DIST, PDFJS_WORKER_SOURCE)]]);
    for (const folder of PDFJS_ASSET_FOLDERS) {
        const entries = await readdir(join(PDFJS_DIST, folder), { withFileTypes: true });
        for (const entry of entries.filter((item) => item.isFile())) {
            assets.set(`${PDFJS_ASSET_DIRECTORY}/${folder}/${entry.name}`, join(PDFJS_DIST, folder, entry.name));
        }
    }
    return assets;
}

function pdfjsAssets(): Plugin {
    let assets: Promise<Map<string, string>> | null = null;
    const assetMap = (): Promise<Map<string, string>> => (assets ??= listPdfjsAssets());
    return {
        name: 'pdfjs-assets',
        async generateBundle() {
            for (const [fileName, source] of await assetMap()) {
                this.emitFile({ type: 'asset', fileName, source: await readFile(source) });
            }
        },
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                const url = (request.url ?? '').split('?')[0] ?? '';
                if (!url.startsWith(PDFJS_URL_PREFIX)) return next();
                void assetMap().then(async (map) => {
                    const source = map.get(decodeURIComponent(url.slice(1)));
                    if (source === undefined) return next();
                    response.setHeader('Content-Type', CONTENT_TYPES[extname(source)] ?? DEFAULT_CONTENT_TYPE);
                    response.end(await readFile(source));
                }).catch(next);
            });
        },
    };
}

const E2E_MODE = 'e2e';
const TEST_API_VARIABLE = 'RENDERER_VITE_EDITOR_TEST_API';

/**
 * Der Testzugang (`window.__editorTestApi`) kommt nur aus `.env.e2e` (`--mode e2e`). In jedem anderen Modus wird
 * die Variable ausdrücklich entfernt, auch wenn sie in der Umgebung der Shell steht (Umgebung schlägt .env-Dateien).
 */
function clearTestApiOutsideE2e(mode: string): void {
    if (mode !== E2E_MODE) delete process.env[TEST_API_VARIABLE];
}

const electronViteConfig: UserConfig = {
    // Die `worker_threads`-Worker brauchen eigene Dateien neben `index.js` (`out/main/parse.worker.js`,
    // `out/main/synctex.worker.js`); `index.ts` startet sie über diese Pfade (`workerScriptPath`).
    main: {
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, 'src/main/index.ts'),
                    'parse.worker': resolve(__dirname, 'src/main/workers/parse.worker.ts'),
                    'synctex.worker': resolve(__dirname, 'src/main/workers/synctex.worker.ts'),
                },
            },
        },
    },
    // `stub.ts` ist der Test-Preload (siehe `src/main/preloadChoice.ts`) und wird nicht ins Paket aufgenommen
    // (`electron-builder.yml`). Ein Sandbox-Preload darf keine Nachbardatei laden: jeder Einstieg wird
    // deshalb allein und vollständig gebündelt, ohne gemeinsame Chunks.
    preload: {
        build: {
            isolatedEntries: true,
            externalizeDeps: false,
            rollupOptions: {
                input: {
                    index: resolve(__dirname, 'src/preload/index.ts'),
                    stub: resolve(__dirname, 'src/preload/stub.ts'),
                },
            },
        },
    },
    renderer: {
        plugins: [react(), developmentCsp(), pdfjsAssets()],
    },
};

export default defineConfig(({ mode }) => {
    clearTestApiOutsideE2e(mode);
    return electronViteConfig;
});
