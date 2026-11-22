# web/ (Web-UI-Version, Gerüst steht)

Hier entsteht die Electron-Version (nur TypeScript, Node im Main-Prozess) des LaTeX-Editors für Windows (und macOS/Linux). Plan, Meilensteine und Aufgaben mit Subagent-Zuweisung: `../shared/PLAN-WEBUI.md`. Regeln für Subagents: `../shared/SUBAGENTS.md`. Verhalten der fertigen Swift-Version als Vorlage: `../swift/docs/ARCHITEKTUR.md`, `../shared/FEATURES.md`.

Regeln (Thesis, Prozesse, Subagents, Code-Stil): `../CLAUDE.md`, nicht doppelt hier.

## Befehle (im Ordner `web/`)

| Zweck | Befehl |
|---|---|
| Entwickeln (öffnet ein Fenster, Hot Reload) | `npm run dev` |
| Typprüfung (Main/Preload/Tests und Renderer) | `npm run typecheck` |
| Unit-Tests (Vitest, Node) | `npm test` |
| E2E-Tests (Playwright, Electron; noch keine Tests, kein Browserdownload) | `npm run test:e2e` |
| Bauen nach `out/` | `npm run build` |
| Installer nach `dist/` (NSIS, dmg, AppImage) | `npm run package` |

Ein Wrapper `scripts/test-run.mjs` kommt mit W0-5; bis dahin laufen Tests direkt über `npm test`.

## Landkarte

- `src/main/index.ts`: Fenster und Sicherheit (`contextIsolation`, `sandbox`, keine `nodeIntegration`, Navigationssperre, `webRequest`-Filter, Berechtigungen abgelehnt).
- `src/preload/index.ts`: `contextBridge`, bisher nur `ping()`; Typ in `src/shared/api.ts`, globale Deklaration `src/renderer/global.d.ts`.
- `src/renderer/`: `index.html` (strikte CSP), `main.tsx`, `App.tsx`.
- `tests/`: Vitest (`*.test.ts`), später `tests/e2e/*.spec.ts`.
- Abhängigkeiten und Lizenzen: `docs/ABHAENGIGKEITEN.md`.

## Stolpersteine

- Das Electron-Programm lädt `npm install` nicht; es kommt beim ersten Start (`npm run dev`) aus dem Netz.
- Das Paket ist CommonJS (kein `"type": "module"`), weil ein Sandbox-Preload kein ESM sein darf.
- Im Entwicklungsmodus lockert ein Vite-Plugin die CSP (Inline-Skript für React Refresh, WebSocket); im Build gilt die strikte CSP aus `index.html`.
