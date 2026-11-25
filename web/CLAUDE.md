# web/ (Web-UI-Version: Electron, M0 und M1 fertig)

Electron-Version (nur TypeScript, Node im Main-Prozess) des LaTeX-Editors für Windows (und macOS/Linux). Stand: M1 (Editor-Kern: `.tex`/`.bib` öffnen, bearbeiten, speichern, Tabs, Suche, Zoom, Farbschemata, Einklappen, Diagnose, Tippen) fertig; Projekt, Dateibaum, Kompilieren und PDF kommen ab M2. Plan, Meilensteine und Aufgaben mit Subagent-Zuweisung: `../shared/PLAN-WEBUI.md`. Regeln für Subagents: `../shared/SUBAGENTS.md`. Verhalten der Swift-Version als Vorlage: `../swift/docs/ARCHITEKTUR.md`, `../shared/FEATURES.md`.

Regeln (Thesis, Prozesse, Subagents, Code-Stil): `../CLAUDE.md`, nicht doppelt hier.

## Befehle (im Ordner `web/`)

| Zweck | Befehl |
|---|---|
| Entwickeln (öffnet ein Fenster, Hot Reload) | `npm run dev` |
| Typprüfung (Main/Preload/Tests und Renderer) | `npm run typecheck` |
| Tests mit Zusammenfassung, Hänger-Wächter, Log `.test-logs/last.log` (immer so, nicht direkt `vitest`) | `npm test` (= `node scripts/test-run.mjs`) |
| Nur schnelle Tests / einzelne Tests | `npm run test:fast`, `node scripts/test-run.mjs --filter <Dateimuster>` oder `--name <Testname>` |
| Roher Vitest-Lauf (nur zum Debuggen) | `npm run test:raw` |
| Bauen nach `out/` (ohne Testzugang) | `npm run build` |
| Build **mit** Testzugang `window.__editorTestApi` für Playwright (`electron-vite build --mode e2e`, liest `.env.e2e`, Windows-tauglich) | `npm run build:e2e` |
| Playwright-Sitzungstests (Electron, Stub-Preload; Voraussetzung `build:e2e`) | `node scripts/test-run.mjs --e2e` (= `npm run test:e2e`) |
| Leistungsmessung, 5 frische Electron-Läufe, Budgets aus `tests/perf/budgets.ts` (Voraussetzung `build:e2e`) | `npm run test:perf` (= `node scripts/test-run.mjs --perf`) |
| Prüfung, dass `out/renderer` keinen Testzugang enthält | `node scripts/checkNoTestApi.mjs` |
| Installer nach `dist/` (NSIS, dmg, AppImage): baut neu, prüft mit `checkNoTestApi`, dann `electron-builder` | `npm run package` |

**Playwright-Ablauf (immer so):** `npm run build:e2e` → `node scripts/test-run.mjs --e2e` (außerhalb der Bash-Sandbox) → danach wieder `npm run build`, damit `out/` den Testzugang nicht behält. `npm run test:perf` läuft ohne Vitest und ohne den normalen `--e2e`-Lauf (eigene Konfiguration `tests/perf/playwright.perf.config.ts`, Muster `*.perf.spec.ts`); nichts anderes parallel laufen lassen.

`scripts/test-run.mjs` beendet bei Stillstand (60 s ohne Ausgabe; Perf 120 s) oder nach 300 s (Perf 900 s) nur den eigenen Prozessbaum (Exit 2); `--e2e` ohne `tests/e2e/*.spec.ts` wird übersprungen. Nie in Schleifen auf Tests warten.

## Landkarte

### `src/shared/` (Main, Preload und Renderer; kein DOM, kein Node)

| Datei / Ordner | Inhalt |
|---|---|
| `contract.ts` | IPC-Vertrag (`IpcRequests`, `IpcEvents`, Allow-Listen, `FileTarget`, `GrantId`, `TextFile` mit `name`) |
| `apiBuilder.ts`, `ipcResult.ts` | baut `window.api.<bereich>.<methode>` (Preload und Stub gleich); `{ok, value}` / `IpcError`, `IpcFailure` |
| `settingsSchema.ts` | Einstellungsschlüssel, Standardwerte, Wertebereiche (Main prüft, Renderer nutzt Standardwerte) |
| `core/language.ts` | Sprache nach Dateiendung (`.bib` = BibTeX, sonst LaTeX) |
| `core/latex/` | `tokenizer`, `comments`, `masking`, `environments`, `foldRegions` (`FoldState`), `syntaxChecker`, `duplicateLabels` |
| `core/bib/tokenizer.ts` | BibTeX-Tokenizer |
| `core/tabs.ts`, `core/textEditing.ts` | Tab-Logik (Vorschau/fest, Reihenfolge); Tipp-Logik (Klammern, Enter, Kommentar, Einrücken, Zeilen, Formatierung) |
| `core/synctexCoordinates.ts` | SyncTeX ↔ PDF-Benutzerraum (Media-Box), `unionRect`, `mediaBoxFromViewBox`, `containsRect`; Main (Vektoren) und PDF-Ansicht teilen sie |

### `src/main/` (Node; nur `index.ts` und der Preload importieren `electron` zur Laufzeit)

| Datei / Ordner | Inhalt |
|---|---|
| `index.ts` | Fenster, Single-Instance, Anwendungsmenü einhängen, Verdrahtung der Handler, `CloseGuard` |
| `menuTemplate.ts`, `menu.ts` | Menüvorlage als reine Daten (plattformabhängig, Kürzel `CommandOrControl`) und Umsetzung in das Electron-Menü (`menu:command`, DevTools nur unverpackt) |
| `ipc.ts`, `ipcHandlers.ts`, `ipcValidation.ts` | Handler-Register mit Absenderprüfung, Platzhalter „nicht implementiert“ für noch fehlende Kanäle, Eingabeprüfung (`isGrantId`) |
| `handlers/appHandlers.ts`, `dialogHandlers.ts`, `fsHandlers.ts` | Verdrahtung je App-Lauf (`createAppHandlers`, `app:confirmClose`); Dialoge mit Gewährungen; `fs:readText/readMany/writeText` mit `FileTarget` (Projektpfad oder `GrantId`) |
| `grants.ts` | `GrantStore`: Pfad-Gewährungen (`GrantId`) für Dialog-, „Zuletzt geöffnet“- und Drop-Pfade, eine Kennung je Pfad |
| `textIo.ts` | UTF-8 strikt / Latin-1, BOM, Zeilenenden, Hash, atomares Schreiben mit Wiederholung, Konflikt per Hash |
| `settings.ts` | `SettingsService`: JSON im `userData`-Ordner, validiert, entprellt, atomar; Handler `settings:get/set` |
| `lifecycle.ts` | `QuitTasks` (Aufräumen beim Beenden), `CloseGuard` (Schließen anfragen → `app:confirmClose`), zweite Instanz nach vorn |
| `security.ts`, `paths.ts`, `preloadChoice.ts` | Navigation, `webRequest`-Filter, Berechtigungen, CSP-Header; Pfadnormalisierung und „liegt im Projekt“; Wahl Stub- oder echter Preload |
| `tools.ts`, `build.ts`, `synctex.ts`, `workers/synctex.worker.ts` | noch ohne UI (M2/M3): TeX/Git finden, `BuildRunner` (latexmk, Abbruch), SyncTeX-Parser im `worker_threads`-Worker |

### `src/preload/`

`index.ts`: `contextBridge` mit `window.api` und `webUtils.getPathForFile` (`dragDrop`, Drop-Pfade über `drop:grant` in Gewährungen). `stub.ts`: Stub-Preload für Playwright (Antworten aus `tests/support/preloadStub.ts`).

### `src/renderer/`

| Ordner / Datei | Inhalt |
|---|---|
| `index.html`, `main.tsx`, `App.tsx`, `global.d.ts`, `css.d.ts` | Einstieg (strikte CSP), Rahmen |
| `ipc/` | `api.ts` (dünner Zugriff auf `window.api`), `events.ts` |
| `app/` | `fileActions.ts` (Öffnen, Speichern, Speichern unter, Nachspeichern), `closeFlow.ts` (Nachfrage beim Schließen), `shortcuts.ts` (Strg+O/S/⇧S, Zoom), `commands.ts` (Befehlsregister zu `menu:command`, Kommentar zu Kürzel-Wegen) + `commandsRuntime.ts` (auch SyncTeX-Verdrahtung, `syncTeXViewerSlot`), `synctexFlow.ts` (Strg+J, Strg/⌘-Klick ins PDF, „PDF folgt Cursor“; reine Abläufe), `newFile.ts`, `quickOpenFiles.ts`, `gotoLine.ts`, `zoom.ts`, `startup.ts`, `statusText.ts`, `tabBarData.ts`, `useCursorPosition.ts`, `debounce.ts` |
| `editor/` | `EditorHost.tsx` (ein `EditorView`, Testzugang im E2E-Modus), `session.ts` (`EditorSession`, `SessionRegistry`, `SessionView`), `extensions.ts` (Liste aller Funktionen), `language.ts` + `lineStateCache.ts` (Einfärbung), `folding.ts`, `gutter.ts`, `diagnostics.ts`, `typing.ts`, `search.ts`, `cursorEvents.ts`, `theme.ts`, `themeController.ts`, `appearance.ts`, `appearanceController.ts`, `domAppearanceHost.ts` (Farbschema, Einstellungen als Compartments) |
| `stores/` | `editor.ts` (Tabs, `isDirty`; nie Text), `settings.ts`, `status.ts`, `synctex.ts` (bereit nach `synctex:ready`, letzte Anfrage; nie Bytes) |
| `pdf/` | `viewer.ts` (pdf.js-Viewer; SyncTeX: Stelle mittig sichtbar machen, Sichtbarkeitsprüfung, Strg/⌘-Klick → Seite + SyncTeX-Punkt) |
| `ui/` | `WorkspaceSplit.tsx` + `workspaceSplit.css` (Editor/Geteilt/PDF, 14-px-Teiler, beide immer eingehängt; Logik `app/viewModeLogic.ts`, Zustand `stores/viewMode.ts`), `EditorPane.tsx`, `EditorTabs.tsx`, `EditorToolbar.tsx`, `StatusBar.tsx`, `CloseConfirmDialog.tsx`, `editorPane.css` |
| `workers/` | `analysis.worker.ts` + `analysisLogic.ts` (Syntaxprüfung, doppelte Labels), `analysisClient.ts` (entprellt 0,6 s) |

### Tests, Skripte, Spikes

| Ordner | Inhalt |
|---|---|
| `tests/unit/` | Vitest `*.test.ts` (System-Node, ohne Electron) |
| `tests/e2e/` | Playwright mit Electron und Stub-Preload: `view-mode`, `synctex`, `stub-smoke`, `editor-basic`, `session`, `gutter`, `folding`, `diagnostics`, `typing`, `closeConfirm` |
| `tests/perf/` | Leistungsmessung: `editorPerf.perf.spec.ts`, `budgets.ts`, `measureRun.ts`, `pageProbe.ts`, `stats.ts`, `syntheticDocument.ts`, `playwright.perf.config.ts` |
| `tests/support/` | `preloadStub.ts` (gefälschte `window.api`), `fakeLatexmk.mjs`, `specVectors.ts`, `synctexWorkerClient.ts` |
| `tests/slow/`, `tests/smoke.test.ts` | langsame Tests (`*.slow.test.ts`, nur ohne `--fast`); Rauchtest |
| `scripts/` | `test-run.mjs` (Testläufer mit Wächter), `checkNoTestApi.mjs` |
| `spikes/` | Wegwerfcode und Messungen S1–S10 (`cm-perf`, `pdf-text`, `synctex`, `build`, `electron-check`, `watch`); Ergebnisse in `docs/ARCHITEKTUR.md`, Rohdaten `spikes/*/ERGEBNIS.md` |

Weiteres: Abhängigkeiten und Lizenzen `docs/ABHAENGIGKEITEN.md`; Reviews `docs/REVIEW-M0.md`, `docs/REVIEW-M1.md`; Handtests `TESTING.md`; Architektur Editor-Kern `docs/ARCHITEKTUR.md` Abschnitt „M1 Editor-Kern“.

Noch nicht angelegt (M2 ff., siehe Plan §2): `main/project.ts`, `watch.ts`, `fsOps.ts`, `logParser.ts`, `recovery.ts`, `renderer/pdf/`, `core/completion/` usw.

## Stolpersteine

- Das Electron-Programm lädt `npm install` nicht; es kommt beim ersten Start (`npm run dev`) aus dem Netz.
- Das Paket ist CommonJS (kein `"type": "module"`), weil ein Sandbox-Preload kein ESM sein darf.
- **Electron-Starts (Playwright, `npm run dev`, `test:perf`) und `fs.watch` (`EMFILE`) laufen nicht in der Claude-/Bash-Sandbox**; solche Läufe außerhalb der Sandbox ausführen.
- **Testzugang nur im E2E-Modus:** `window.__editorTestApi` entsteht nur bei `RENDERER_VITE_EDITOR_TEST_API=1` aus `.env.e2e` (`--mode e2e`); `electron.vite.config.ts` löscht die Variable in jedem anderen Modus. Nach einem Playwright-Lauf wieder `npm run build`; `npm run package` bricht ab, wenn `scripts/checkNoTestApi.mjs` die Zuweisung in `out/renderer` findet.
- **Stub-Preload nur unverpackt:** `LATEXEDITOR_STUB_PRELOAD=1` lässt den Main `out/preload/stub.js` statt des echten Preloads laden (`choosePreloadPath` in `main/preloadChoice.ts`); im Paket wirkungslos, `out/preload/stub*` ist per `electron-builder.yml` ausgeschlossen. Sandbox-Preloads dürfen keine Nachbardatei laden, daher baut `electron.vite.config.ts` jeden Preload-Einstieg isoliert (`isolatedEntries`). Mit Stub-Preload schließt das Fenster ohne Nachfrage. E2E-Tests starten die App aus `out/` mit eigenem `--user-data-dir` (sonst blockiert eine laufende App per Single-Instance-Sperre).
- DevTools gibt es nur unverpackt (`devTools: !app.isPackaged`); das eigene Menü (`main/menu.ts`) bietet DevTools nur unverpackt.
- Im Entwicklungsmodus lockert ein Vite-Plugin die CSP (Inline-Skript für React Refresh, WebSocket); im Build gilt die strikte CSP aus `index.html`.
- Sitzungsschlüssel einer Dialog-Datei ist die `GrantId`, nie ein Pfad: Titel, Sprache und Dateiendung immer aus `name` (nicht aus `path`) ableiten.
