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
| Build mit Testzugang für Playwright-Sitzungstests (`window.__editorTestApi`, nie im normalen Build) | `npm run build:e2e`, danach `node scripts/test-run.mjs --e2e` (ohne Bash-Sandbox), danach wieder `npm run build` |
| Bauen nach `out/` | `npm run build` |
| Installer nach `dist/` (NSIS, dmg, AppImage) | `npm run package` |

`scripts/test-run.mjs` beendet bei Stillstand (60 s ohne Ausgabe) oder nach 300 s nur den eigenen Prozessbaum (Exit 2); E2E (`--e2e`, Playwright mit Electron, kein Browserdownload) wird ohne `tests/e2e/*.spec.ts` übersprungen. Nie in Schleifen auf Tests warten.

## Landkarte

- `src/shared/contract.ts`: IPC-Vertrag (`IpcRequests`, `IpcEvents`, Allow-Listen); `apiBuilder.ts` baut daraus `window.api.<bereich>.<methode>` (Preload und Test-Stub gleich), `ipcResult.ts` (`{ok, value}` / `IpcError`, `GitError`).
- `src/main/`: `index.ts` (Fenster, Single-Instance; nur hier und im Preload wird `electron` zur Laufzeit importiert, `ipc.ts`/`security.ts` nur Typen), `ipc.ts` + `ipcHandlers.ts` + `ipcValidation.ts` (Handler-Register, Absenderprüfung, Eingabeprüfung; Fachhandler sind noch Platzhalter „nicht implementiert“), `lifecycle.ts` (Beenden: `QuitTasks`, `before-quit`, Fenster nach vorn bei zweiter Instanz; W2-10 trägt dort das Abbrechen des Builds ein), `grants.ts` (Pfad-Gewährungen: der Main vergibt `GrantId`s für Dialog-, „Zuletzt geöffnet“- und Drop-Pfade; der Renderer kann keine Pfadherkunft behaupten, kein `projectRoot` in Kanälen, noch nicht in `index.ts` verdrahtet bis zu den ersten echten Handlern), `security.ts` (Navigation, `webRequest`-Filter, Berechtigungen, CSP-Header), `paths.ts` (Pfadnormalisierung, „liegt im Projekt“, Projekt-Hash), `tools.ts` (TeX/Git finden, S4), `build.ts` (`BuildRunner`: latexmk starten und abbrechen, S4), `synctex.ts` + `workers/synctex.worker.ts` (SyncTeX-Parser und Index im `worker_threads`-Worker, S3).
- `src/preload/index.ts`: `contextBridge` mit `window.api` und `webUtils.getPathForFile` (`dragDrop`, löst Drop-Pfade über `drop:grant` in Gewährungen auf).
- `src/renderer/`: `index.html` (strikte CSP), `main.tsx`, `App.tsx`, `ipc/` (dünner Zugriff auf `window.api`), `global.d.ts`.
- `tests/unit/` Vitest (`*.test.ts`), `tests/support/preloadStub.ts` (Stub für `window.api`), `tests/support/fakeLatexmk.mjs` (Fake-latexmk für `build`-Tests), später `tests/e2e/*.spec.ts`, langsame Tests in `tests/slow/` oder `*.slow.*`.
- `spikes/`: Wegwerfcode und Messungen der Spikes S1–S10 (Ergebnisse in `docs/ARCHITEKTUR.md`, Abschnitt „Entscheidungen aus den Spikes“; Rohdaten `spikes/*/ERGEBNIS.md`).
- Abhängigkeiten und Lizenzen: `docs/ABHAENGIGKEITEN.md`. Review M0 mit offenen Befunden: `docs/REVIEW-M0.md`. Handtests: `TESTING.md`.
- Geplant, noch nicht angelegt: `renderer/editor/lineStateCache.ts` und `language.ts` (ViewPlugin, W1-4), `core/` unter `src/shared/` (Logik nach `shared/spec`), `main/watch.ts`, `fsOps.ts`, `textIo.ts` usw. (siehe Plan §2).

## Stolpersteine

- Das Electron-Programm lädt `npm install` nicht; es kommt beim ersten Start (`npm run dev`) aus dem Netz.
- Das Paket ist CommonJS (kein `"type": "module"`), weil ein Sandbox-Preload kein ESM sein darf.
- `fs.watch` (`EMFILE`) und Electron-Starts laufen nicht in der Claude-Sandbox; solche Tests außerhalb der Sandbox ausführen.
- DevTools gibt es nur unverpackt (`devTools: !app.isPackaged`); bis W2-16 hat die App kein eigenes Menü.
- Im Entwicklungsmodus lockert ein Vite-Plugin die CSP (Inline-Skript für React Refresh, WebSocket); im Build gilt die strikte CSP aus `index.html`.
- Stub-Preload für Playwright: `LATEXEDITOR_STUB_PRELOAD=1` lässt den Main `out/preload/stub.js` (gefälschte `window.api`-Antworten aus `tests/support/preloadStub.ts`) statt des echten Preloads laden; nur unverpackt (`choosePreloadPath` in `main/preloadChoice.ts`), im Paket wirkungslos und `out/preload/stub*` ist per `electron-builder.yml` ausgeschlossen. Sandbox-Preloads dürfen keine Nachbardatei laden, daher baut `electron.vite.config.ts` jeden Preload-Einstieg isoliert (`isolatedEntries`). E2E-Tests starten die App aus `out/` (vorher `npm run build`), mit eigenem `--user-data-dir` (sonst blockiert eine laufende App per Single-Instance-Sperre).
