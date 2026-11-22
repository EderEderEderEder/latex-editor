import { defineConfig } from '@playwright/test';

// Für spätere Electron-Tests (_electron.launch); noch kein Test vorhanden.
export default defineConfig({
    testDir: 'tests/e2e',
    testMatch: '**/*.spec.ts',
    timeout: 30_000,
    reporter: 'list',
});
