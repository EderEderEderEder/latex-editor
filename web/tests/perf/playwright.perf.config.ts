import { defineConfig } from '@playwright/test';

// Leistungsmessung (W1-13), nicht Teil der normalen E2E-Menge (`playwright.config.ts` sucht nur in tests/e2e).
// Aufruf: `node scripts/test-run.mjs --perf` nach `npm run build:e2e`. Fünf Läufe mit frischem Electron dauern einige Minuten.
const PERF_TIMEOUT_MS = 900_000;

export default defineConfig({
    testDir: '.',
    testMatch: '*.perf.spec.ts',
    outputDir: '../../test-results/perf',
    timeout: PERF_TIMEOUT_MS,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: 'list',
});
