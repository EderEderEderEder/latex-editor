import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
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

export default defineConfig({
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
});
