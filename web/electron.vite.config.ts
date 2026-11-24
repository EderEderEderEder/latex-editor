import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import type { UserConfig } from 'electron-vite';
import type { Plugin } from 'vite';

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
    main: {},
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
        plugins: [react(), developmentCsp()],
    },
};

export default defineConfig(({ mode }) => {
    clearTestApiOutsideE2e(mode);
    return electronViteConfig;
});
