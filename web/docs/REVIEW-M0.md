# Review M0 (W0-R), Stand 2026-11-23

Review durch einen Opus-Agenten, nur lesend, Befunde am Code belegt. Status der Einarbeitung: siehe Spalte „Stand“ (wird beim Abarbeiten gepflegt).

## Befunde

| # | Schwere | Stelle | Befund | Fix | Stand |
|---|---|---|---|---|---|
| H1 | Hoch | `shared/contract.ts`, `main/ipc*.ts` | Main kann die Herkunft eines Pfads nicht prüfen: `project:open(path)` nimmt jeden Pfad vom Renderer (`C:\`, `~`), `assertInsideProject` ist damit wertlos; `dialog:*` liefert nackte Pfade; `fs:import`/`image:import` nehmen beliebige Quellpfade; Drag & Drop ist weder „im Projekt“ noch „aus einem Dialog“; `marks:*`/`recovery:*` erwarten `projectRoot` vom Renderer | Main hält den Zustand: aktuelles Projekt und Menge der vom Main gewährten Pfade (Dialog, Zuletzt geöffnet, Drop). `project:open` nur mit Kennung aus `dialog:openProject`/`project:recent`; `projectRoot` aus den Kanälen entfernen; Importquellen nur lesen, Endungs-/Größen-Allowlist, kein UNC. Vertrag jetzt ändern, solange es keine Handler gibt | erledigt: Vertrag mit `GrantId`, `main/grants.ts`; Fachhandler bleiben Platzhalter |
| H2 | Hoch | `spikes/pdf-text/ERGEBNIS.md`, `page.html` | S2 verlangt `getDocument({disableWorkerRendering: true})` (Seitenrendern im Renderer-Hauptthread): ungemessen, kollidiert mit M1-Budget (Tastendruck p95 < 16 ms) und M3 (300 Seiten); nur 13 Seiten gemessen; Spike-Seite ohne CSP | Vor W3-3 messen (Tippen während PDF-Rendern, Scrollen durch 300 Seiten); S2 unter `RENDERER_CSP` wiederholen; Alternative: Geometrie nur für sichtbare Seiten nachträglich | Plan (W3-3, W5-4) |
| M1 | Mittel | `main/paths.ts` | UNC-Pfade werden angenommen; `isInsideProject` ruft `realpath` vor der lexikalischen Prüfung (SMB-Verbindung, NTLM-Leck; autofs `/net/…` auf macOS) | zuerst `isPathWithin` lexikalisch, dann `realpath`; UNC nur, wenn die Projektwurzel UNC ist; Test | erledigt |
| M2 | Mittel | `main/security.ts` | webRequest-Filter erlaubt jede `file:`-URL; `latexeditor:` nach S9 ungenutzt, aber in der Allow-Liste | gepackt `file:` nur unter dem App-Ordner; `APP_PROTOCOL` entfernen (auch `security.test.ts`); in W7-6 Fuse `GrantFileProtocolExtraPrivileges` aus | erledigt (Fuse: W7-6) |
| M3 | Mittel | `main/index.ts`, `security.ts`, `TESTING.md` | kein `devTools: !app.isPackaged`, kein eigenes Menü: Standardmenü mit „Toggle Developer Tools“ auch im Paket (leer, weil `devtools:` nur im Dev-Modus erlaubt); W-H9 so nicht durchführbar | `devTools: !app.isPackaged`; `devtools:` immer erlauben, wenn nicht verpackt; bis W2-16 `Menu.setApplicationMenu(null)`; W-H9 umschreiben | erledigt (W-H9-Text: Doku) |
| M4 | Mittel | `main/build.ts` | Windows: `cancel()` wartet ohne Frist auf `close`; Status bleibt `cancelling`, neue Builds `busy` | Frist (Gnadenfrist + 2 s), Streams `destroy()`, über `exit` abschließen, Fehler melden; Test mit FakeChild ohne `close` | erledigt (Frist für alle Plattformen, Ergebnis `problem`) |
| M5 | Mittel | `main/index.ts` | kein `requestSingleInstanceLock` (zwei Instanzen, gleicher `userData`); kein `before-quit` (Build überlebt Beenden, Unix `detached`) | Lock mit `second-instance`; beim Beenden `runner.cancel()` | erledigt: Lock, `before-quit` mit `quitTasks`; Build-Abbruch dort eintragen: W2-10 |
| M6 | Mittel | `tests/unit/build.test.ts`, `synctexWorker.test.ts` | Abbruchtest prüft mit `process.kill(-pid, 0)`: unter Windows grün ohne etwas zu prüfen; Lag-Test (250.000 Einträge, < 50 ms) läuft immer und ist zeitabhängig | unter Windows überspringen oder per PID-Liste; Lag-Test nach `tests/slow/` | erledigt (Gruppenprüfung unter Windows übersprungen, Lag-Test in `tests/slow/`) |
| N1 | Niedrig | `paths.ts` | NFC/Kleinschreibung unabhängig vom Dateisystem (ext4, case-sensitives APFS) | NFC nur unter darwin, Hinweis | erledigt (SyncTeX-Nachschlagen bleibt NFC-tolerant) |
| N2 | Niedrig | `paths.ts` | ADS (`main.tex:x`), Gerätenamen (`CON`, `NUL`, `COM1`), Punkt/Leerzeichen am Ende werden angenommen | in `fsOps` (W2-7) ablehnen | Plan (W2-7) |
| N3 | Niedrig | `build.ts` | Hauptdatei als bloßer Name: beginnt er mit `-`, liest latexmk ihn als Option | `./` voranstellen | erledigt (nur bei `-` am Anfang) |
| N4 | Niedrig | `scripts/test-run.mjs` | Windows: `shell: true` mit ungequoteten Argumenten; `taskkill` ohne vollen Pfad | `process.execPath` + `node_modules/vitest/vitest.mjs`, ohne Shell; voller taskkill-Pfad | erledigt |
| N5 | Niedrig | `security.ts` | kein `frame-src 'none'`; kein Test, dass der CSP-Header im Paket wirkt | ergänzen | erledigt (Header-Test mit gefälschter Session; im echten Paket: Handtest) |
| N6 | Niedrig | `workers/synctex.worker.ts` | `startWorker()` läuft als Nebenwirkung beim Import | nur bei `!isMainThread` und eigener `workerData`-Kennung starten | erledigt |
| N7 | Niedrig | SyncTeX-Worker/Test | kein Einstieg in `electron.vite.config.ts` (W3-2); Testkommentar „wie im Produkt gebündelt“ falsch; Test importiert `rolldown` (nicht in `package.json`); Client behandelt `error`/`exit` nicht | Kommentar korrigieren, `error`/`exit` behandeln, `rolldown`-Import durch eine Variante mit vorhandenen Paketen ersetzen (z. B. `vite` `build`) | erledigt (Test-Client, `vite` `build`); Einstieg in electron-vite: W3-2 |
| N8 | Niedrig | `package.json` | `@types/node` 26.6.6, App läuft auf Electron-Node 24.22.3 | `@types/node@24` | erledigt (24.19.2) |
| N9 | Niedrig | `electron-builder.yml` | `appId: com.example…` Platzhalter; spätere Änderung = Doppelinstallation unter Windows | endgültige `appId` festlegen (Entscheidung des Nutzers, W7-6) | Plan (W7-6) |
| N10 | Niedrig | `.gitignore` | `build/` ignoriert auch `web/build/icons` (W7-6); `web/.gitignore` ohne `test-results/`, `playwright-report/`; `src/shared/.gitkeep` überflüssig | eingrenzen/ergänzen | erledigt (in `web/.gitignore`, Wurzel unverändert) |
| N11 | Niedrig | `renderer/ipc/events.ts` | greift direkt auf `window.api` zu (`api.ts` über `getApi()`); Preload-Stub lässt sich in Electron nirgends einhängen (Plan: Playwright W1-6, W2-9, W6-4) | `getApi()` überall; Stub-Preload + Startschalter | erledigt (`getApi()`); Stub-Preload: W1-6 |
| N12 | Niedrig | Vektoren | kein automatischer Test der Vektoren gegen `shared/spec/schema.json` (`ajv` nicht benutzt) | Vitest-Test mit `ajv` | erledigt |

## Nötige Plan-Änderungen

| ID / Stelle | Änderung |
|---|---|
| §1 Technikwahl CodeMirror | `StreamLanguage` ersetzen durch: eigenes `ViewPlugin` mit `LineStateCache` (S1), `StreamLanguage` nur als Rückfall, kein Lezer-Baum |
| §1 Abhängigkeiten | `chokidar` entfällt (nur mit Nutzer-OK, falls der Win/Linux-Handtest scheitert); `@types/node` explizit, auf 24 pinnen; prüfen, ob `@lezer/highlight` entfällt |
| §2 Ordnerbaum | `pdfProtocol.ts` streichen; `workers/` als „worker_threads (S3)“; ergänzen: `main/ipcHandlers.ts`, `main/ipcValidation.ts`, `shared/apiBuilder.ts`, `shared/ipcResult.ts`, `renderer/editor/lineStateCache.ts` |
| §2 Sicherheit/Regeln | `file:` nur unter dem App-Ordner, dazu `data:`/`blob:`, kein eigenes Protokoll; DevTools nur unverpackt; Single-Instance-Lock; Pfad-Gewährung durch den Main (H1); in `ipc.ts`/`security.ts` nur Typimporte von Electron |
| §2 IPC-Tabelle | `pdf:open` liefert nur Bytes nach `assertInsideProject`, `PdfSource.url` streichen; `project:open`, `fs:import`, `image:import` mit Grant; `marks:*`/`recovery:*` ohne `projectRoot` |
| §2 Performance | „Stream-Tokenizer bis Konvergenz“ → Zeilenzustands-Cache, synchron höchstens 200 Zeilen hinter dem Sichtbereich, Rest im Leerlauf; Kein Polling, aber Sicherheitsnetz bei `build:finished` und Fenster-Fokus (S10) |
| §6/§8 | Spike-Ergebnisse verlinken; `fs.watch` (EMFILE) und Electron laufen nicht in der Claude-Sandbox |
| W1-4 | ViewPlugin + `LineStateCache` (Vorlage `spikes/cm-perf`), Dekorationen mit CSS-Klassen; Vitest über `highlightEdit`/`tokenizedLineCount` ohne DOM; Bib im selben Mechanismus |
| W1-6 (oder neue W1-0) | Stub-Preload und Startschalter für `_electron.launch` (Voraussetzung W1-6, W1-10, W2-9, W6-4) |
| W1-11 | `settings:set` lehnt Schlüssel wie `__proto__`/`constructor` ab |
| W1-13 | Budget zusätzlich unter Windows messen |
| W2-2 | nur `fs.watch`; Regeln aus S10 (Ereignisart ignorieren, `lstat`/`readdir`, Höchstwartezeit 1,5 s, Filter inkl. Build-PDF, Sicherheitsnetz); Akzeptanz: Win/Linux-Handtest; Tests außerhalb der Sandbox |
| W2-7 | ADS/Gerätenamen/Punkt am Ende ablehnen (N2) |
| W2-10 | Abbruch-Frist unter Windows (M4), Abbruch beim Beenden, `./` vor dem Dateinamen |
| W2-14/W2-16 | Single-Instance-Lock; eigenes Menü ersetzt Standardmenü (DevTools nur unverpackt) |
| W3-2 | Main-Client für den Worker: Einstieg in electron-vite, `id`-Zuordnung, Timeout, Neustart nach `exit`, Windows-Gegenprobe mit `synctex.exe` |
| W3-3 | `main/pdfProtocol.ts` streichen; Bytes über IPC; `latexeditor:` aus `security.ts` entfernen; Messung zu H2 (300 Seiten, Hauptthread-Rendern) |
| W5-4 | S2-Regeln (`fontSpaces`, Rückfall `uniform`, dann Zeilen) unter `RENDERER_CSP` und unter Windows prüfen |
| W7-6 | Fuses: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`, `GrantFileProtocolExtraPrivileges` aus; `OnlyLoadAppFromAsar`, `EnableEmbeddedAsarIntegrityValidation` an; `devTools` aus; endgültige `appId`; `build/` in der Wurzel-`.gitignore` eingrenzen |
| W0-D / M0-DoD | `web/docs/ARCHITEKTUR.md`: Abschnitt S4 fehlt; Wurzel-`CLAUDE.md` veraltet (Zeilen „noch nicht begonnen“, „sobald das Gerüst steht“, „später `spec/`“); `SUBAGENTS.md` Ablauf-Schritte 4 und 7 nennen nur Swift-Befehle |
| W0-2/W1-1 | Vitest mit `ajv` über `shared/spec/*.json` |
| FEATURES.md | Syntaxfarben: ViewPlugin; BibTeX nicht mehr „eigene Stream-Sprache“; Bildvorschau: IPC-Bytes mit `blob:`-URL; Vervollständigung „nie in Kommentar/Verbatim“ über den Cache-Zustand statt `syntaxTree` |

## Sind die Spike-Entscheidungen gedeckt?

- Gedeckt: S1 (Farbverzug 90–140 ms gegen 9–16 ms), S3 (110 ms Blockade gegen < 1 ms), S9 (38,8 gegen 44,2 ms, einfacher), S10 (Zählungen).
- Zu optimistisch, weil nur auf dem Intel-Mac gemessen: S1 nur mit `dispatch` und ohne IME; S9 mit synthetischem, unkomprimiertem PDF und nur bis `getDocument`; S10 ohne Windows-Pufferüberlauf, OneDrive, Linux-`recursive`; S4 mit ungeprüftem taskkill-Baum und MiKTeX-Dialog; S2 mit 13 Seiten, ohne CSP, ohne Worker-Rendering (H2).

## Was gut ist

Lückenlose Absenderprüfung (webContents-ID, Hauptframe, URL); nur `handle`, Kanäle aus Allow-Listen mit Compiler-Vollständigkeit; Sandbox, `contextIsolation`, Navigations-/Fenster-/webview-Sperre, Berechtigungen immer abgelehnt, kein `unsafe-eval`; Prozesse nie über eine Shell, Abbruch nur über eigene PID; plattformparametrisierte Pfadlogik mit Windows-/UNC-/Symlink-Tests; SyncTeX ohne Blockade; ehrliche Spike-Berichte mit Windows-Handtest-Anleitungen.
