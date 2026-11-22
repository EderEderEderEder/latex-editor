# web/ (Web-UI-Version, Gerüst steht)

Hier entsteht die Electron-Version (nur TypeScript, Node im Main-Prozess) des LaTeX-Editors für Windows (und macOS/Linux). Plan, Meilensteine und Aufgaben mit Subagent-Zuweisung: `../shared/PLAN-WEBUI.md`. Regeln für Subagents: `../shared/SUBAGENTS.md`. Verhalten der fertigen Swift-Version als Vorlage: `../swift/docs/ARCHITEKTUR.md`, `../shared/FEATURES.md`.

Regeln (Thesis, Prozesse, Subagents, Code-Stil): `../CLAUDE.md`, nicht doppelt hier.

## Befehle (im Ordner `web/`)

| Zweck | Befehl |
|---|---|
| Entwickeln (öffnet ein Fenster, Hot Reload) | `npm run dev` |
| Typprüfung (Main/Preload/Tests und Renderer) | `npm run typecheck` |
| Tests mit Zusammenfassung, Hänger-Wächter, Log `.test-logs/last.log` (immer so, nicht direkt `vitest`) | `npm test` (= `node scripts/test-run.mjs`) |
| Nur schnelle Tests / einzelne Tests / mit E2E | `npm run test:fast`, `node scripts/test-run.mjs --filter <Dateimuster>` oder `--name <Testname>`, `--e2e` |
| Roher Vitest-Lauf (nur zum Debuggen) | `npm run test:raw` |
| Bauen nach `out/` | `npm run build` |
| Installer nach `dist/` (NSIS, dmg, AppImage) | `npm run package` |

`scripts/test-run.mjs` beendet bei Stillstand (60 s ohne Ausgabe) oder nach 300 s nur den eigenen Prozessbaum (Exit 2); E2E (`--e2e`, Playwright mit Electron, kein Browserdownload) wird ohne `tests/e2e/*.spec.ts` übersprungen. Nie in Schleifen auf Tests warten.

## Landkarte

- `src/shared/contract.ts`: IPC-Vertrag (`IpcRequests`, `IpcEvents`, Allow-Listen); `apiBuilder.ts` baut daraus `window.api.<bereich>.<methode>` (Preload und Test-Stub gleich), `ipcResult.ts` (`{ok, value}` / `IpcError`, `GitError`).
- `src/main/`: `index.ts` (Fenster; nur hier und im Preload wird `electron` zur Laufzeit importiert), `ipc.ts` + `ipcHandlers.ts` + `ipcValidation.ts` (Handler-Register, Absenderprüfung, Eingabeprüfung; Fachhandler sind noch Platzhalter „nicht implementiert“), `security.ts` (Navigation, `webRequest`-Filter, Berechtigungen, CSP-Header), `paths.ts` (Pfadnormalisierung, „liegt im Projekt“, Projekt-Hash).
- `src/preload/index.ts`: `contextBridge` mit `window.api` und `webUtils.getPathForFile` (`dragDrop`).
- `src/renderer/`: `index.html` (strikte CSP), `main.tsx`, `App.tsx`, `ipc/` (dünner Zugriff auf `window.api`), `global.d.ts`.
- `tests/unit/` Vitest (`*.test.ts`), `tests/support/preloadStub.ts` (Stub für `window.api`), später `tests/e2e/*.spec.ts`, langsame Tests in `tests/slow/` oder `*.slow.*`.
- `spikes/`: Wegwerfcode und Messungen der Spikes S1–S10 (Ergebnisse in `docs/ARCHITEKTUR.md`, Abschnitt „Entscheidungen aus den Spikes“).
- Abhängigkeiten und Lizenzen: `docs/ABHAENGIGKEITEN.md`.

## Stolpersteine

- Das Electron-Programm lädt `npm install` nicht; es kommt beim ersten Start (`npm run dev`) aus dem Netz.
- Das Paket ist CommonJS (kein `"type": "module"`), weil ein Sandbox-Preload kein ESM sein darf.
- Im Entwicklungsmodus lockert ein Vite-Plugin die CSP (Inline-Skript für React Refresh, WebSocket); im Build gilt die strikte CSP aus `index.html`.
