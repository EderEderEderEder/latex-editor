import react from '@vitejs/plugin-react';
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
    preload: {},
    renderer: {
        plugins: [react(), developmentCsp()],
    },
});
