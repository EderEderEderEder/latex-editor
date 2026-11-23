import { contextBridge } from 'electron';
import { createPreloadStub } from '../../tests/support/preloadStub';

// Nur für Playwright-Tests (`LATEXEDITOR_STUB_PRELOAD=1`, siehe `main/preloadChoice.ts`): dieselbe
// `window.api`-Form wie der echte Preload, aber mit gefälschten Antworten und ohne IPC zum Main.
// Wird mitgebaut, aber per `electron-builder.yml` nicht ins Paket aufgenommen.
contextBridge.exposeInMainWorld('api', createPreloadStub().api);
