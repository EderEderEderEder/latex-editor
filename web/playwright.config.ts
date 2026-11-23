import { defineConfig } from '@playwright/test';

// Nur Electron-Tests (`_electron.launch`): kein Browser, daher kein `npx playwright install` und kein Download.
// Die App muss vorher gebaut sein (`npm run build`); ein Fenster nach dem anderen.
export default defineConfig({
    testDir: 'tests/e2e',
    testMatch: '**/*.spec.ts',
    timeout: 30_000,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: 'list',
});
