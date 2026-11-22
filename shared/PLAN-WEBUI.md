> **Stand (2026-11-22):** Plan erstellt von einem Plan-Agent, geprüft von der Hauptsitzung. **Wechsel Tauri → Electron am 2026-11-22 auf Wunsch des Nutzers** (Begründung: §1 „Entscheidung Electron statt Tauri“). Erledigte Aufgaben bleiben erledigt, die Vektoren in `spec/` sind vom Wechsel unabhängig. **Erledigt:** W0-1 (Bestand, `spec/QUELLEN.md`), W0-2 (Format, `spec/README.md`, `schema.json`, `fixtures/`), W0-11 (Tokenizer-Vektoren), W0-12 (Quelle, Einklappen, Prüfer, Tippen), W0-3 (Gerüst `web/` mit freigegebenen Paketen; Typprüfung, Vitest und Build grün; Fenster per `npm run dev` vom Nutzer zu prüfen). **Wartet auf den Nutzer:** W0-13 (Änderung in `swift/`). Danach geplant: W0-4/W0-5, Spikes. Dieser Plan ist die Grundlage für `web/`. Verbindlich sind die Regeln aus `../CLAUDE.md` und `SUBAGENTS.md`; Änderungen an `swift/` (z. B. `SpecVectorTests`) nur mit OK des Nutzers. Offene Entscheidungen des Nutzers: Windows-Rechner oder VM für Builds und Handtests, ob und wann `swift/` für die Gegenprobe angefasst werden darf.

# Umsetzungsplan: LatexEditor als Web-UI-Version (`web/`, Electron)

Grundlage: `swift/CLAUDE.md`, `swift/docs/ARCHITEKTUR.md`, `shared/VERLAUF.md`, `shared/SUBAGENTS.md`, Kopf von `swift/TESTING.md`. Die Swift-Version hat 143 Quelldateien und 747 `@Test`-Fälle in 85 Testdateien. Die Fixtures liegen in `swift/Tests/LatexEditorTests/Fixtures/` (5 Logs, `biber.blg`, `two-chapters.synctex.gz`). Hinweis: In `shared/Testdaten/HgbDemo/chapters/` liegt eine `anhang.aux`, das Demo-Projekt wurde also schon einmal an Ort und Stelle kompiliert. Das ist nach `ARCHITEKTUR.md` verboten, Tests dürfen nur in Kopien kompilieren.

## 1. Ziel, Nicht-Ziele, Annahmen, Funktionsumfang

**Ziel:** Der Editor läuft plattformübergreifend, zuerst unter Windows 11, danach unter macOS und Linux. Er verhält sich wie die Swift-App (Tokenizer, Anker, Generatoren, SyncTeX), abgesichert durch gemeinsame Testvektoren in `shared/spec/`. Die Bedienung folgt Windows-Konventionen (Strg statt ⌘). Er arbeitet nur lokal.

**Nicht-Ziele:** Cloud, Konten, Netzwerk-Features (DOI-Abruf usw.) · Auto-Updater · Ablösung der Swift-App, beide bestehen weiter · Mehrfach-Cursor (ausdrücklich nicht gewünscht) · gelbe PDF-Markierung und Find-Indicator-Flash (nie wieder einbauen) · Merge, Rebase, Stash · Ideenspeicher aus `VERLAUF.md` ohne Auftrag.

**Annahmen:**
- Entwickelt wird auf dem Mac (Intel) mit Node ≥ 20 (installiert ist Node v25). Electron bringt eine eigene Node-Version mit; der Code muss in beiden laufen (Vitest läuft im System-Node, die App im Electron-Node). **Rust und Cargo werden nicht gebraucht.**
- Windows-Builds und Handtests laufen auf einem Win11-Rechner oder einer VM des Nutzers. GitHub Actions kommt nur auf ausdrückliches Wort des Nutzers in Frage, weil das einen Push braucht.
- Ein TeX-System ist installiert (MiKTeX oder TeX Live). Git für Windows ist optional.
- Externe npm-Abhängigkeiten sind nötig. Anders als bei Swift legt W0-3 die Liste dem Nutzer einmal zur Freigabe vor. `npm install` lädt einmalig das Electron-Programm aus dem Netz (nur bei der Installation, nicht zur Laufzeit).

**Abhängigkeiten (Vorschlag, Freigabe in W0-3):**

| Art | Pakete | Lizenz |
|---|---|---|
| `dependencies` | `react`, `react-dom`, `zustand`, `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/commands`, `@codemirror/search`, `@codemirror/autocomplete`, `@codemirror/lint`, `@lezer/highlight` | MIT |
| `dependencies` | `pdfjs-dist` | Apache-2.0 |
| `devDependencies` | `electron`, `electron-vite`, `electron-builder`, `vite`, `@vitejs/plugin-react`, `vitest`, `ajv` | MIT |
| `devDependencies` | `typescript`, `@playwright/test` | Apache-2.0 |
| `devDependencies` (nur Typen) | `@types/react`, `@types/react-dom` (React 19 bringt keine eigenen Typen mit; `@types/node` kommt über `electron`) | MIT |
| Spike-abhängig, später | `chokidar` (nur falls S10 es verlangt), `nspell` (nur falls S8 es verlangt) + Wörterbücher `de_AT`/`de_DE` | MIT; Wörterbücher: Lizenz prüfen (deutsche Hunspell-Wörterbücher meist GPL) |

`electron-builder` zieht viele transitive Pakete; es ist nur Bauwerkzeug und landet nicht im Installer. Kein Cargo, keine Rust-Toolchain, keine nativen Node-Module.

**Technikwahl (vorgegeben) mit Begründung und Risiko:**

| Baustein | Begründung | Risiko / Abweichung |
|---|---|---|
| Electron (nur TypeScript, Node im Main-Prozess) | eine Sprache für alles; überall dasselbe Chromium; Dateisystem, Prozesse und Git im Main-Prozess über Node | größeres Paket und mehr Speicher (für das lokale Werkzeug egal); Sicherheit liegt bei uns (Sandbox, CSP, Navigationssperre, §2 „Sicherheit“); Windows-Paket am besten nativ auf Windows bauen (S6) |
| TypeScript + **React 19 + Zustand** (Ergänzung) | den Subagents am besten bekannt; getrennte Stores mit Selektoren entsprechen den getrennten `@Observable`-Stores; CodeMirror und pdf.js laufen imperativ außerhalb von React | unnötiges Neuzeichnen, daher Regel: nie Text im State, Selektoren nur mit flachem Vergleich (Svelte 5 wäre die Alternative, für Agents aber weniger verbreitet) |
| CodeMirror 6 | Ansicht nur für den sichtbaren Bereich, `StreamLanguage` passt zum Zeilen-Tokenizer mit `LexState`, fertige Bausteine für Einklappen, Diagnose, Vervollständigung und Suche | Tempo der Stream-Sprache bei 50.000 Zeilen (S1) |
| pdf.js (`pdfjs-dist`, `PDFViewer`) | lazy Rendern, Link-Service, Textebene | Zeichenrechtecke für die Markierungsanker (S2) |
| **SyncTeX: eigener TS-Parser** (Abweichung) | Die Swift-Entscheidung „nicht von installierten Werkzeugen abhängen“ gilt weiter. Ein CLI-Aufruf kostet pro Abfrage einen Prozessstart (unter Windows 20–50 ms), und die Pfade von MiKTeX und TeX Live unterscheiden sich. Entpacken mit `node:zlib`, Index im Worker. Die Testvektoren gibt es schon. | Das `synctex`-CLI dient nur als Referenz in den Tests (wie in Swift); Tempo bei 250.000 Einträgen (S3) |
| latexmk als Kindprozess | gleiche Pipeline wie in Swift | Unter MiKTeX braucht latexmk Perl; Abbruch ohne SIGINT, deshalb `taskkill /PID <eigene Kind-PID> /T /F` (Windows) bzw. eigene Prozessgruppe (Unix) (S4) |
| git-CLI | wie in Swift, keine Bibliothek | CRLF und `core.autocrlf`, Credential-Manager-Fenster (S7) |
| `fs.watch` mit `recursive` + eigener Entpreller 300 ms | ersetzt FSEvents, kein Polling, keine Zusatzbibliothek | Ereignisstürme beim Speichern unter Windows, gesperrte Dateien durch OneDrive oder Virenscanner, `recursive` unter Linux (S10; nur falls nötig `chokidar`) |

### Entscheidung Electron statt Tauri

Am 2026-11-22 hat der Nutzer entschieden, die Web-Version mit Electron statt mit Tauri 2 zu bauen. Gründe: eine einzige Sprache (TypeScript) statt Rust + TypeScript, keine Rust-Toolchain auf Mac und Windows, überall dieselbe Web-Engine (die früheren Spikes zu WebView-Unterschieden entfallen), weniger Fremdbibliotheken (Node bringt gzip, Hash, Pfade, Dateiüberwachung und Kindprozesse mit). Die Installationsgröße spielt für das lokale Werkzeug keine Rolle.

| Gesichtspunkt | Tauri 2 (vorher) | Electron (jetzt) |
|---|---|---|
| Installer / installiert | etwa 5–15 MB | etwa 80–100 MB Installer, 100–150 MB installiert (Richtwerte, nicht gemessen) |
| Speicher im Betrieb | geringer, WebView2 teilt sich Teile mit dem System | höher, eigene Chromium-Instanz plus Node im Main-Prozess |
| Toolchain | Node + Rust stable + Cargo (unter Windows zusätzlich MSVC Build Tools) | nur Node/npm |
| Web-Engine | WebView2 (Windows), WKWebView (macOS), WebKitGTK (Linux): drei Engines mit Unterschieden bei IME, Drag & Drop, Workern | überall dasselbe Chromium, mit der App ausgeliefert |
| Sprachen im Kern | Rust (E/A, Prozesse, SyncTeX, Log-Parser, Git) + TS | nur TS; Main-Module in Node |
| Rechte / Sicherheit | Capabilities-Datei (eingebaut minimal) | eigene Disziplin: `contextIsolation`, `sandbox`, typisierte Preload-API, CSP, Navigationssperre |
| Engine-Sicherheitsupdates | WebView2 aktualisiert sich mit Windows | kommen nur mit einer neuen App-Version (vertretbar: nur lokale Dateien, kein Netz) |

### Feature-Paritätsmatrix (Swift → Web)

Siehe `FEATURES.md` (eigene Datei, wird beim Umsetzen gepflegt).

## 2. Zielarchitektur `web/`

```
web/
├── CLAUDE.md                  Regeln Web (Befehle, Landkarte, Stolpersteine)
├── docs/ARCHITEKTUR.md        Feature-Architektur Web
├── TESTING.md                 Handtests Web/Windows (eigene Nummerierung W-H1 …)
├── package.json  electron.vite.config.ts  electron-builder.yml  vitest.config.ts  playwright.config.ts  tsconfig*.json
├── scripts/test-run.mjs       wie swift/scripts/test-run.sh: Zusammenfassung, Hänger-Wächter, nur eigener Prozessbaum
├── src/
│   ├── main/                  Main-Prozess (Node): index.ts (App, Fenster), ipc.ts (Handler, Absenderprüfung), security.ts (Navigation, webRequest, CSP, Berechtigungen), menu.ts
│   │   ├── paths.ts  textIo.ts  project.ts  watch.ts  fsOps.ts  build.ts  logParser.ts  synctex.ts  git.ts
│   │   ├── marks.ts  recovery.ts  settings.ts  search.ts  images.ts  tools.ts (TeX/Git finden)  pdfProtocol.ts (nach S9)
│   │   └── workers/           worker_threads bzw. utilityProcess: synctex.worker.ts, search.worker.ts, parse.worker.ts (Log, Git-Status)
│   ├── preload/index.ts       contextBridge: typisierte API `window.api` aus contract.ts, nur erlaubte Kanäle, `webUtils.getPathForFile`
│   ├── renderer/
│   │   ├── index.html  main.tsx  app/   App-Rahmen, Befehlsregister (Menü + Kürzel), Keymap Strg/⌘
│   │   ├── ipc/               api.ts (dünner Wrapper um window.api), events.ts
│   │   ├── stores/            project, sidebar, editor (Tabs), outline, build, pdf, synctex, git, marks, search, settings, appUndo
│   │   ├── editor/            CodeMirror-Erweiterungen: language, theme, gutter, folding, diagnostics, typing, completion, session (EditorState je Tab)
│   │   ├── pdf/               viewer, links, history, preview, textGeometry, marksOverlay
│   │   ├── workers/           analysis.worker.ts (Prüfung, Hinweise, Wortzahl, Index, Änderungsmarken)
│   │   └── ui/                Sidebar, FileTree, OutlineList, IssueList, Changes, Diff, TabBar, Toolbar, StatusBar, insert/, settings/, dialogs/
│   └── shared/
│       ├── contract.ts        Kanäle, Ein-/Ausgabetypen, Ereignisse; von Main, Preload und Renderer importiert
│       └── core/              reine Logik ohne DOM und ohne Node (Portierung aus Syntax/, Model/, Insertion/, Completion/)
│           ├── latex/         tokenizer, comments, masking, environments, foldRegions, syntaxChecker, references, outline, wordCount, writingHints, capitalization
│           ├── bib/           tokenizer, parser, formatter, keys, sourceBuilder
│           ├── completion/    context, matcher, applier, catalog, options, provider
│           ├── insertion/     escaping, labelNaming, blockPlacement, generators, context
│           ├── marks/         anchor, locator, sourceLines, resolver, creator, grouping
│           ├── diff/          lineDiff, wordDiff, layout
│           └── tabs.ts  quickOpen.ts  jumpTargets.ts  referenceUpdater.ts  fileNames.ts  textEditing.ts
└── tests/  unit/ (Vitest, Node)  support/preloadStub.ts  e2e/ (Playwright `_electron.launch`)
```

**Pfade in §5:** gekürzt relativ zu `web/src/`. `core/…` steht für `shared/core/…`; `app/`, `ipc/`, `stores/`, `editor/`, `pdf/`, `ui/`, `workers/` für `renderer/…`; `main/…`, `preload/…` und `shared/contract.ts` wie angegeben.

**Aufgabenteilung:** Der Main-Prozess übernimmt Ein-/Ausgabe, Kindprozesse (latexmk, git), Dateiüberwachung, Binärformate (SyncTeX), den Log-Parser (große Byte-Logs), Git, Papierkorb (`shell.trashItem`), Dialoge und den App-Datenordner (`app.getPath('userData')`). Die LaTeX-Textlogik gibt es genau einmal, in `shared/core/`. Alles ist TypeScript, Offsets sind überall UTF-16; Byte-Positionen aus `Buffer` verlassen den Main-Prozess nie.

**Regeln Main-Prozess:**
- Der Main-Prozess blockiert nie: Dateizugriff nur asynchron (`fs/promises`), kein `*Sync`. Schwere Arbeit (Log-Parser, SyncTeX-Index, Projektsuche, Git-Parser) läuft in `worker_threads` bzw. `utilityProcess` (Entscheidung je Fall in W0-4/W0-8).
- Nur `main/index.ts`, `main/ipc.ts`, `main/security.ts`, `main/menu.ts` und `main/pdfProtocol.ts` importieren `electron`. Alle anderen Main-Module sind reines Node und bekommen Electron-Dinge (Papierkorb, App-Datenordner) als Parameter; so laufen sie in Vitest ohne Electron.
- Kindprozesse nur mit `spawn` ohne Shell, Programm mit vollem Pfad aus `tools.ts`. Abbruch nur über die eigene Kind-PID: Windows `taskkill /PID <pid> /T /F`, Unix `detached: true` + `process.kill(-pid)`. Nie nach Namen.
- Pfade: `node:path` + `fs.realpath.native` (Laufwerksbuchstabe, Groß-/Kleinschreibung, 8.3-Namen); jeder Pfad vom Renderer wird in `paths.ts` normalisiert und geprüft (liegt im geöffneten Projekt oder kommt aus einem Dialog des Main-Prozesses).

### Sicherheit (Electron)

| Regel | Umsetzung |
|---|---|
| Renderer ohne Node | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity` an; der Renderer sieht nur `window.api` aus dem Preload |
| Strikte CSP | `default-src 'self'`; Skripte und Worker nur aus dem App-Paket; keine fremden Hosts; kein `unsafe-eval` (falls pdf.js oder CodeMirror es verlangen: S5 entscheidet) |
| Keine Netzwerk-Features | `will-navigate` und `setWindowOpenHandler` verbieten alles; `session.webRequest.onBeforeRequest` bricht jede Anfrage außerhalb von `file:` und dem eigenen Protokoll ab (im Entwicklungsmodus zusätzlich nur der lokale electron-vite-Server); Berechtigungsanfragen (`setPermissionRequestHandler`) immer ablehnen; kein Auto-Updater |
| IPC | nur `ipcMain.handle`, Absender geprüft (`event.senderFrame` ist das eigene Fenster); Eingaben aus dem Renderer gelten als unsicher (Pfade prüfen, Typen prüfen) |
| Rechtschreibung | bis S8 `spellcheck: false`: die Chromium-Prüfung lädt unter Windows/Linux sonst Wörterbücher von einem Google-Server |

### Schnittstelle Main ↔ Renderer (IPC)

Vertrag in `shared/contract.ts`; Anfragen über `ipcRenderer.invoke` → `ipcMain.handle`, Ereignisse über `webContents.send`. Im Renderer heißt jeder Kanal `window.api.<bereich>.<methode>`.

| Kanal (`invoke`) | Ein/Aus | Main-Modul | Bemerkung |
|---|---|---|---|
| `tools:detect` | → `{latexmk, git, synctexRef, distro, problems[]}` | `tools.ts` | PATH + bekannte Orte (MiKTeX `%LOCALAPPDATA%\Programs\MiKTeX`, `C:\texlive\<Jahr>`, `/Library/TeX/texbin`, Git für Windows); nie `/usr/bin/git` |
| `project:open(path)` | → `{root, mainFile, tree}` | `project.ts` | Hauptdatei über `\documentclass` / `main.tex`; Wächter starten |
| `dialog:openProject` / `dialog:pickFiles` / `dialog:saveAs` | → Pfad(e) oder `null` | `index.ts` | `dialog.showOpenDialog` usw.; so gewählte Pfade gelten als erlaubt |
| `fs:readText(path)` / `fs:readMany(paths)` | → `{text, encoding: utf8\|latin1, eol: lf\|crlf, hash, mtime}` | `textIo.ts` | UTF-8 strikt (`TextDecoder` mit `fatal`), sonst Latin-1 (`Buffer` `'latin1'`), Hash `node:crypto` |
| `fs:writeText(path, text, encoding, eol, expectedHash?)` | → `{hash, mtime}` | `textIo.ts` | atomar (Temp + `rename`, Wiederholung bei `EPERM`/`EBUSY`); Konflikt bei fremdem Hash |
| `fs:create`, `fs:rename`, `fs:move`, `fs:duplicate`, `fs:import(paths, dir)` | → `{path, undoToken}` | `fsOps.ts` | nie aus dem Projekt heraus, nie in sich selbst |
| `fs:trash(path)` / `fs:restore(undoToken)` | → `undoToken` | `fsOps.ts` | Kopie in der App-Ablage, dann OS-Papierkorb (`shell.trashItem`) |
| `search:project(query, opts, excludePaths)` | → `searchId`, Treffer als Ereignis `search:hits` | `search.ts` (Worker) | höchstens 2.000; offene Dateien sucht der Renderer selbst |
| `build:start(main, opts)` / `build:cancel` / `build:clean` | → Status als Ereignis | `build.ts` | nie parallel, zusammengefasst |
| `synctex:forward(file, line)` / `synctex:backward(page, x, y)` | → `{page, rects[]}` / `{file, line}` | `synctex.ts` (Worker) | Koordinaten in PDF-Punkten oben links |
| `git:status`, `git:blob(spec)`, `git:stage/unstage(paths)`, `git:commit(msg)`, `git:fetch/pullFf/push`, `git:branches/checkout/create`, `git:resetPlan/resetApply` | strukturierte Ergebnisse + `GitError {kind, message}` | `git.ts` | Warteschlange im Main (nacheinander), Parser im Worker |
| `marks:load/save(projectRoot, json)`, `recovery:save/list/delete`, `settings:get/set`, `project:recent` | – | `marks.ts`, `recovery.ts`, `settings.ts` | App-Datenordner (`userData`), Projekt-Hash über normalisierten Pfad |
| `image:import(src, imagesDir)` | → `{relPath, reused}` | `images.ts` | Hash-Vergleich, Namen bereinigen, durchnummerieren |
| `pdf:open(path)` | → URL des eigenen Protokolls oder Bytes | `pdfProtocol.ts` | eigenes Protokoll (`protocol.handle`, nur Projektordner) oder Lesen per IPC; S9 entscheidet |

| Ereignis (`webContents.send`) | Inhalt |
|---|---|
| `fs:changed` | `{paths[], kinds[], treeChanged, gitChanged}`; 300 ms entprellt, Build-Hilfsdateien gefiltert |
| `build:status` / `build:finished` | `{state, startedAt}` / `{ok, cancelled, report: Issue[], pdfPath, durationMs}` |
| `synctex:ready` | `{pdfMtime}`; nach Build oder Projektöffnen, im Fehlerfall bleiben die alten Daten |
| `git:changed` | Refs/HEAD/Index geändert |
| `search:hits` | `{searchId, hits[], done}` |
| `menu:command` | Befehls-ID aus dem Anwendungsmenü |
| `app:closeRequested` | Fenster schließen mit Nachfrage |

### Zustand und Performance-Regeln

| Regel | Umsetzung |
|---|---|
| Stores getrennt, nur bei echter Änderung setzen | Zustand-Slices je Bereich; Setter vergleichen vorher; Komponenten lesen nur über Selektoren |
| **Nie Text im React-State** | Text lebt nur im CM-`EditorState` (`editor/session.ts`, Map Tab → State); im Store stehen nur `isDirty`, Pfad, Kodierung |
| **Nichts pro Tastendruck proportional zur Dateigröße** | pro Tastendruck nur CM-Inkrement, Stream-Tokenizer bis zur Zustandskonvergenz, Kontext der Zeile, `RangeSet.map`; Prüfung, Hinweise, Wortzahl, Index, Änderungsmarken entprellt (0,3–0,6 s) im Worker |
| **Dateisystem nie im Renderer, Main blockiert nie** | jeder Zugriff ist ein `invoke` an den Main-Prozess; dort nur `fs/promises`, schwere Arbeit im Worker |
| Kein Polling | `fs.watch` + Entpreller (S10); Build-PDF einmal nach `build:finished`, nicht über Dateiereignisse |
| Layout-Rückkopplung vermeiden | Kopfleiste und Pfadzeile mit fester Höhe; Editorbreite hängt nie von Anzeigeinhalten ab; Scroll-Meldungen nur bei geänderter Zeile |
| Budgets | `tests/perf/*.bench` (schnellster von n Läufen, etwa 3-facher Puffer); ein überschrittenes Budget ist ein Fehler |
| Zeilenenden | `EditorState.lineSeparator` je Datei aus `eol`; Speichern behält CRLF/LF |

## 3. Wiederverwendung aus Swift: `shared/spec/`

**Format:** `shared/spec/<bereich>.json` = `{suite, version, source: "swift/Tests/…Tests.swift", cases: [{id, name, input, expect}]}`. Offsets in UTF-16, Zeilenindizes in den Erwartungen 0-basiert (nur `sourceLine` und Meldungstexte sind 1-basiert; siehe `spec/README.md`), Enum-Namen wie in Swift (`command`, `keyArgument` …). `shared/spec/README.md` beschreibt das Schema, `shared/spec/fixtures/` enthält Kopien der Swift-Fixtures. Keine persönlichen Pfade.

| Vektordatei | Quelle (Swift-Tests) | Verbraucher Web |
|---|---|---|
| `latex-tokenizer.json` | `LatexTokenizerTests`, deterministischer Teil von `SyntaxHighlighterTests` | Vitest `core/latex/tokenizer` |
| `bib-tokenizer.json` | `BibTokenizerTests` | Vitest |
| `latex-source.json` (Kommentare, Maskierung, `\verb`) | `LatexSourceTests` | Vitest |
| `fold-regions.json`, `syntax-checker.json` | Logikteil von `FoldingTests`, `SyntaxCheckerTests` | Vitest |
| `insertion.json` (Escaping, Labels, Blockplatzierung, alle Generatoren) | `InsertionTests`, `InsertionContextTests` | Vitest |
| `bibliography.json` | `BibliographyTests` (Parser, Autoren, Schlüssel, Formatter, SourceBuilder) | Vitest |
| `completion.json` (Kontext, Rang, Applier, Optionen, OptionScanner) | `CompletionTests` (Logik), `CompletionOptionTests` | Vitest |
| `references.json`, `writing.json` (Hinweise, Großschreibung, Wortzahl) | `LatexReferencesTests`, `ReferenceCheckTests` (Logik), `WritingHintsTests`, `CapitalizationTests`, `WordCounterTests` | Vitest |
| `text-editing.json` (Eingabe + Auswahl + Aktion → Text + Auswahl) | `TextEditingTests` | Vitest |
| `mark-anchor.json` | `MarkAnchorTests`, `MarkAnchorSimilarLineTests`, `MarkAnchorRewrapTests`, `MarkAnchorRefreshTests` (Logik), `MarkListGroupingTests` | Vitest |
| `synctex.json` + `fixtures/two-chapters.synctex.gz` | `SyncTeXTests` (Referenzwerte des CLI, Pfadfälle, Koordinaten) | Vitest (Main-Modul `synctex`) |
| `latex-log.json` + `fixtures/*.log`, `biber.blg` | `LatexLogParserTests` | Vitest (Main-Modul `logParser`) |
| `git-status.json`, `line-diff.json` | `GitStatusTests` (Parser), `LineDiffTests`, `DiffLayoutTests` | Vitest (Main-Modul `git` für Status, `core/diff` für Diff) |
| `misc.json` (Tabs-Folgen, Schnell öffnen, Gliederung, ReferenceUpdater, Namensprüfung, Sprungziele, Link-Vorschau-Layout, Sprungverlauf, Dateitypen) | `EditorTabsTests`, `QuickOpenTests`, `OutlineParserTests`, `ReferenceUpdaterTests`, `FileOperationsTests` (Namensteil), `JumpTargetTests`, `LinkPreviewTests` (Layout), `PDFJumpHistoryTests`, `FileTypeFilterTests` | Vitest |

**Ablauf je Vektordatei (Subagent `general-purpose`, `sonnet`, `medium`):**
1. Genau eine Swift-Testdatei lesen.
2. Nur die `#expect`-Vergleiche mit Literalen übernehmen. Zufallstests, Pixel- und Fenstertests auslassen und im Feld `skipped` mit Grund nennen.
3. Erwartete Werte nie selbst ausrechnen, nur aus dem Test abschreiben.
4. Den Namen des `@Test` als `name` übernehmen und `source` mit Zeilennummer angeben.

**Gegenprobe:** `swift/Tests/LatexEditorTests/SpecVectorTests.swift` lädt dieselben JSON-Dateien und prüft die Swift-Implementierung. Nur die Hauptsitzung führt `scripts/test-run.sh --filter SpecVectorTests` aus. Das ist eine Änderung in `swift/` und braucht deshalb das OK des Nutzers. Ein Vektor gilt erst als gültig, wenn ihn die Swift-Seite besteht.

## 4. Phasen und Meilensteine

| M | Ziel | Definition of Done |
|---|---|---|
| M0 Spikes + Gerüst | Risiken klären, Gerüst, IPC-Vertrag, Spec-Format, erste Vektoren | Jeder Spike hat eine Entscheidung (weiter / Alternative) in `web/docs/ARCHITEKTUR.md` · `npm run dev` startet auf Mac und Windows (Sandbox, CSP, Navigationssperre aktiv) · `scripts/test-run.mjs` läuft (Vitest + optional Playwright) · `shared/spec/README.md` steht · Abhängigkeitsliste vom Nutzer freigegeben |
| M1 Editor-Kern | eine `.tex`/`.bib` öffnen, bearbeiten, speichern wie in Swift | Tokenizer- und Bib-Vektoren grün · Einklappen, Diagnose, Gutter, Tippen, Suche, Zoom, Farbschemata · Budget 10.000 Zeilen: Tastendruck p95 < 16 ms in Electron unter Windows, Öffnen < 200 ms · CRLF und Latin-1 bleiben beim Speichern erhalten |
| M2 Projekt/Dateien/Kompilieren | HgbDemo-Kopie öffnen, Baum, Tabs, Gliederung, Dateiaktionen mit Undo, Kompilieren, Fehlerliste | Kopie von HgbDemo kompiliert unter Windows (MiKTeX und TeX Live) mit genau einer Warnung (`fig:fehlt`) · Abbruch beendet den Prozessbaum in < 3 s · Log-Vektoren grün · Papierkorb + Rückgängig ohne Datenverlust · Wiederherstellung nach Absturz |
| M3 PDF + SyncTeX | PDF-Ansicht, Strg+J, Klick ins PDF, Folgen, Links, Verlauf, Vorschau | SyncTeX-Vektoren grün; Windows-Pfade (Laufwerk, `\`, Leerzeichen, Umlaute) · Neuladen hält Seite und Zoom · 300-Seiten-PDF scrollt flüssig |
| M4 Vervollständigung/Einfügen/Verweise | Schreibhilfen auf Swift-Stand | Completion-, Insertion- und Bibliography-Vektoren grün · alle Bausteine inkl. 27 Sprachumgebungen kompilieren in einer Demo-Kopie (Integrationstest, nur mit TeX) · Verweisprüfung zeigt `fig:fehlt`, `sec:ungenutzt`, `ungenutzt2026` · Projektsuche/Ersetzen mit Undo |
| M5 Markierungen | PDF-Markierungen mit Ankern, Phasen A–C | Anker-Vektoren grün · wortgenaue Lage in ≥ 95 % der Testfälle (S2) · Markierung überlebt Neukompilieren, Umbruch und Umbenennen · Undo · Liste mit „Nicht zugeordnet“ |
| M6 Git | Phase 1 + 2 | Status-/Diff-Vektoren grün · Tests in temporären Repositories (`GIT_CONFIG_GLOBAL` leer) · Status ändert den Index nicht (byte-gleich) · Pull nur Vorspulen, Push ohne Force · Zurücksetzen mit Sicherung + Undo · CRLF-Fall unter Windows geprüft |
| M7 Politur/Installer | Einstellungsfenster, Rechtschreibung, Hinweise, Installer | NSIS-Installer (electron-builder) ohne Adminrechte auf frischem Win11 · Handtests W-H1… alle grün · macOS `.dmg` und Linux AppImage bauen · Doku vollständig |

## 5. Aufgabenliste mit Reihenfolge und Subagent-Zuweisung

Abkürzungen: **GP** = `general-purpose`, **Ex** = `Explore`. „Par.“ heißt: läuft parallel zu anderen Aufgaben derselben Stufe (nur bei verschiedenen Dateien). Build und Tests macht nur die Hauptsitzung nach jeder Aufgabe (Spalte „Tests“ = was sie ausführt; „Vitest `x`“ heißt `scripts/test-run.mjs --filter x`). Jede Review-Aufgabe (R) ist GP + `opus` + `high`, nur lesend. Jede Doku-Aufgabe (D) ist GP + `sonnet` + `low` und pflegt `web/docs/ARCHITEKTUR.md`, `web/CLAUDE.md`, `web/TESTING.md` und einen Web-Abschnitt in `shared/VERLAUF.md`. Pfade gekürzt wie in §2 beschrieben. „Preload-Stub“ = `tests/support/preloadStub.ts`: dieselbe App über `_electron.launch`, aber mit gefälschten Antworten statt echter Main-Module (schnell, kein eigener Browser-Download für Playwright).

### M0 – Spikes und Gerüst

| ID | Aufgabe | Agent | Modell | Effort | Abh. | Par. | Dateien/Ordner | Akzeptanz | Tests |
|---|---|---|---|---|---|---|---|---|---|
| W0-1 | Bestand: welche Swift-Tests sind reine Logik und als Vektor geeignet (Liste mit Datei, Testname, Art) **(erledigt)** | Ex | sonnet | low | – | ja | nur lesen `swift/Tests` | Liste an die Hauptsitzung, keine Datei | – |
| W0-2 | Spec-Format: `README.md`, JSON-Schema, Fixtures kopieren **(erledigt)** | GP | sonnet | medium | W0-1 | ja | `shared/spec/README.md`, `schema.json`, `fixtures/` | Schema validiert ein Beispiel; keine persönlichen Pfade | `npx ajv` über das Beispiel |
| W0-3 | Gerüst Electron + electron-vite + React 19 + Zustand + Vitest + Playwright; Abhängigkeitsliste aus §1 mit Lizenzen vorlegen | GP | sonnet | medium | Nutzer-OK zur Liste | ja | `web/` (`package.json`, `electron.vite.config.ts`, `electron-builder.yml`, `tsconfig*.json`, `vitest.config.ts`, `playwright.config.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html` + `main.tsx`, `.gitignore`; ohne `src/shared/core`) | `npm run dev` zeigt ein leeres Fenster mit `contextIsolation`, `sandbox`, ohne `nodeIntegration`, CSP gesetzt; `.gitignore` deckt `node_modules`/`out`/`dist`/`.test-logs` | Vitest-Platzhalter (Node), `tsc --noEmit` |
| W0-4 | IPC-Vertrag `shared/contract.ts` (alle Kanäle und Ereignisse aus §2) + Preload (`contextBridge`, nur erlaubte Kanäle) + `main/ipc.ts` (Absenderprüfung) + `main/security.ts` (Navigation, `webRequest`, Fenster, Berechtigungen, CSP) + Pfadnormalisierung `main/paths.ts` (`node:path`, `fs.realpath.native`, Laufwerk, Groß-/Kleinschreibung, „liegt im Projekt“) + Preload-Stub | GP | opus | high | W0-3 | nein | `src/shared/contract.ts`, `src/preload/*`, `src/main/ipc.ts`, `security.ts`, `paths.ts`, `src/renderer/ipc/*`, `tests/support/preloadStub.ts` | alle Kanäle und Ereignisse typisiert; Stub deckt alle ab; Anfrage an fremden Host wird abgebrochen | Vitest `paths`, `contract` (jeder Kanal hat Handler und Stub) |
| W0-5 | `scripts/test-run.mjs`: Vitest + optional Playwright (`--e2e`), kurze Zusammenfassung, Wächter (60 s Stillstand / 300 s), beendet nur den eigenen Prozessbaum (Windows: `taskkill /PID <eigene Kind-PID> /T /F`, Unix: eigene Prozessgruppe) | GP | sonnet | medium | W0-3 | ja | `web/scripts/test-run.mjs`, `package.json` | `--fast`, `--filter`, `--e2e`, Log in `web/.test-logs/last.log` | Probelauf |
| W0-6 | Spike S1: CodeMirror mit Wegwerf-Tokenizer, 10.000/50.000 Zeilen, Tastendruck und Öffnen in Electron auf Mac und Windows messen | GP | opus | high | W0-3 | ja | `web/spikes/cm-perf/` | Messwerte + Entscheidung StreamLanguage vs. ViewPlugin | Hand: Messseite auf Mac + Win |
| W0-7 | Spike S2: pdf.js-Textebene: Rechteck → Wörter → Zeichenrechtecke (`Range.getClientRects`) an einer kompilierten Demo-Kopie | GP | opus | high | W0-3 | ja | `web/spikes/pdf-text/` | Trefferquote, Laufzeit/Seite, Entscheidung | Hand |
| W0-8 | Spike S3: SyncTeX in Node: Parser mit `node:zlib`, Vorwärts/Rückwärts gegen die Fixture-Referenzwerte, Index im Worker (`worker_threads` oder `utilityProcess`), Windows-Pfadfälle | GP | opus | high | W0-4 | ja | `src/main/synctex.ts`, `src/main/workers/synctex.worker.ts` | Fixture-Werte stimmen; Messung 250.000 Einträge; Main bleibt beim Einlesen bedienbar | Vitest `synctex` |
| W0-9 | Spike S4: `main/tools.ts` (TeX/Git finden) + latexmk-Start + Abbruch (Windows `taskkill /PID … /T /F`, Unix Prozessgruppe); Perl-Prüfung MiKTeX; nur `.exe` bzw. ausführbare Dateien starten, keine Shell | GP | opus | high | W0-4 | ja | `src/main/tools.ts`, `build.ts` (Rohfassung) | Abbruch eines 40-s-Dokuments < 3 s auf Win + Mac, keine verwaisten Prozesse | Vitest `build` (Fake-latexmk als Node-Skript); echter TeX-Lauf nur mit Schalter, sonst übersprungen |
| W0-10 | Spike S5/S6/S9: Electron-Prüfseite (AltGr, IME, Drag & Drop mit `webUtils.getPathForFile`, Zwischenablage, Sandbox + Preload, CSP, pdf.js-Worker; PDF-Transport eigenes Protokoll vs. IPC mit 10 MB); NSIS-Testbuild mit electron-builder | GP | sonnet | medium | W0-4 | ja | `web/spikes/electron-check/`, `electron-builder.yml` | Prüfliste in `web/TESTING.md`; Entscheidung S9; Installer startet ohne Admin | Hand Win/Mac |
| W0-11 | Vektoren `latex-tokenizer.json`, `bib-tokenizer.json` **(erledigt)** | GP | sonnet | medium | W0-2 | ja | `shared/spec/` (2 Dateien) | jede Erwartung mit Quellzeile | Schema-Prüfung |
| W0-12 | Vektoren `latex-source`, `fold-regions`, `syntax-checker`, `text-editing` **(erledigt)** | GP | sonnet | medium | W0-2 | ja | `shared/spec/` (4 Dateien) | wie oben | Schema |
| W0-13 | Swift-Gegenprobe `SpecVectorTests.swift` (Tokenizer, Quelle, Einklappen, Prüfung) | GP | sonnet | high | W0-11, W0-12, Nutzer-OK | nein | `swift/Tests/LatexEditorTests/SpecVectorTests.swift` | Swift besteht alle Vektoren | `scripts/test-run.sh --filter SpecVectorTests` |
| W0-14 | Spike S10: Dateiüberwachung mit `fs.watch` (`recursive`) + Entpreller 300 ms: atomares Speichern, Build-Sturm, OneDrive/Virenscanner unter Windows, `recursive` unter Linux; Entscheidung gegen oder für `chokidar` | GP | sonnet | high | W0-3 | ja | `web/spikes/watch/` | ein Ereignis pro Speichern, kein Sturm beim Build, auf Mac + Win gemessen | Hand Mac/Win |
| W0-R | Review M0 (Vertrag, Spike-Entscheidungen, Sicherheit: Sandbox, CSP, Navigationssperre, IPC-Absenderprüfung) | GP | opus | high | alle W0 | ja | nur lesen | Befunde eingearbeitet | – |
| W0-D | Doku M0: `web/CLAUDE.md`, `web/docs/ARCHITEKTUR.md` (Entscheidungen), Web-Pflichtangaben für Subagents als Vorschlag für `shared/SUBAGENTS.md` (Nutzer-OK) | GP | sonnet | low | W0-R | nein | Doku-Dateien | Befehle stimmen | – |

### M1 – Editor-Kern

| ID | Aufgabe | Agent | Modell | Effort | Abh. | Par. | Dateien/Ordner | Akzeptanz | Tests |
|---|---|---|---|---|---|---|---|---|---|
| W1-1 | Tokenizer-Port (`LexState`, Zeile → Tokens + Endzustand) | GP | opus | high | W0-11, W0-6 | ja | `core/latex/tokenizer.ts` | alle Vektoren grün; 500 Zufallsbearbeitungen inkrementell = komplett | Vitest `tokenizer` |
| W1-2 | Kommentar-Regel, Maskierung, Umgebungslisten (eine Regel, keine Kopien) | GP | sonnet | medium | W0-12 | ja | `core/latex/comments.ts`, `masking.ts`, `environments.ts` | Vektoren grün | Vitest |
| W1-3 | Bib-Tokenizer-Port | GP | sonnet | high | W0-11 | ja | `core/bib/tokenizer.ts` | Vektoren grün | Vitest |
| W1-4 | CM-Sprachadapter (StreamLanguage oder nach S1) + `HighlightStyle` | GP | opus | high | W1-1, W1-3 | nein | `editor/language.ts` | Tastendruck färbt nur bis zur Konvergenz neu | Vitest + Perf |
| W1-5 | Text-E/A im Main: UTF-8 strikt / Latin-1 (`Buffer` `'latin1'`), EOL, Hash (`node:crypto`), atomares Schreiben mit Wiederholung bei Sperre | GP | sonnet | medium | W0-4 | ja | `main/textIo.ts` | Latin-1 und CRLF bleiben byte-gleich | Vitest `textIo` |
| W1-6 | Sitzungen: `EditorState` je Tab, Undo je Datei, Auswahl/Scroll, Tausch ohne Neuaufbau, `lineSeparator` | GP | opus | high | W1-4, W1-5 | nein | `editor/session.ts`, `stores/editor.ts` | Wechsel lang → kurz ohne Fehler; Auswahl geklemmt | Vitest + Playwright `session` (Preload-Stub) |
| W1-7 | Gutter: Nummern, aktuelle Zeile, Markierungsspalte mit Formen + Tooltip | GP | sonnet | medium | W1-6 | ja | `editor/gutter.ts` | Marken wandern beim Tippen mit | Playwright `gutter` |
| W1-8 | Einklappen: `foldRegions.ts` + `foldService`/Gutter, ⋯, alles zu/auf, Aufklappen bei Bearbeitung | GP | opus | high | W1-2, W1-6 | ja | `core/latex/foldRegions.ts`, `editor/folding.ts` | Vektoren grün; Text unverändert | Vitest + Playwright |
| W1-9 | Diagnose: `syntaxChecker.ts`, doppelte Labels, Darstellung in drei Mustern, Worker | GP | sonnet | high | W1-2, W1-6 | ja | `core/latex/syntaxChecker.ts`, `editor/diagnostics.ts`, `workers/analysis.worker.ts` | 0 Fehlalarme in HgbDemo (Kopie) | Vitest |
| W1-10 | Tippen: Port `TextEditing` (Klammern, Enter, Kommentar, Einrücken, Zeilen, Formatierung) | GP | sonnet | high | W0-12, W1-6 | ja | `core/textEditing.ts`, `editor/typing.ts` | Vektoren grün; je ein Undo-Schritt; kein Eingriff während IME | Vitest + Playwright `typing` |
| W1-11 | Farbschemata 4 × hell/dunkel + Kontrasttest; Einstellungs-Store mit Speicherung im Main | GP | sonnet | medium | W1-4 | ja | `editor/theme.ts`, `stores/settings.ts`, `main/settings.ts` | Kontrast ≥ 4,5 bzw. 7 | Vitest `theme`, `settings` |
| W1-12 | Editor-Rahmen: Datei öffnen/speichern (Strg+S), Suche, Zoom, Statusleiste Zeile/Spalte | GP | sonnet | medium | W1-6, W1-11 | nein | `ui/EditorPane.tsx`, `ui/StatusBar.tsx`, `app/` | Handtest W-H: Datei bearbeiten und speichern | Playwright `editor-basic` |
| W1-13 | Performance-Budgets (10.000 Zeilen: Tastendruck, Öffnen, `$` tippen) | GP | sonnet | high | W1-12 | nein | `tests/perf/` | schnellster von 5 Läufen unter Budget | `test-run --filter perf` |
| W1-R | Review M1 (Leistung, Rückkopplung, Undo) | GP | opus | high | W1-* | ja | lesen | – | – |
| W1-D | Doku M1 | GP | sonnet | low | W1-R | nein | Doku | – | – |

### M2 – Projekt, Dateien, Kompilieren

| ID | Aufgabe | Agent | Modell | Effort | Abh. | Par. | Dateien/Ordner | Akzeptanz | Tests |
|---|---|---|---|---|---|---|---|---|---|
| W2-1 | Projekt öffnen: Baum, Dateitypen/Build-Dateien, Hauptdatei, Zuletzt geöffnet | GP | sonnet | medium | W0-4 | ja | `main/project.ts` | HgbDemo-Kopie richtig erkannt | Vitest `project` |
| W2-2 | Dateiüberwachung nach S10 (`fs.watch` + Entpreller oder `chokidar`), Baum-Relevanz (keine `.aux`/`.log`, atomares Speichern) | GP | opus | high | W2-1, W0-14 | ja | `main/watch.ts` | ein Ereignis pro Speichern; kein Ereignissturm beim Build | Vitest `watch` |
| W2-3 | Seitenleiste + Dateibaum (Filter, Dateitypmenü, Symbole, Ordnerzustand im Store) | GP | sonnet | medium | W2-1 | ja | `ui/Sidebar*`, `ui/FileTree*`, `stores/sidebar.ts`, `stores/project.ts` | 1.000 Dateien flüssig | Playwright `tree` |
| W2-4 | Tabs-Logik-Port + TabBar (Vorschau/fest, Gedächtnis je Projekt, Nachfrage beim Schließen) | GP | sonnet | high | W1-6 | ja | `core/tabs.ts`, `ui/TabBar.tsx` | Vektoren `misc.tabs` grün | Vitest + Playwright `tabs` |
| W2-5 | Vektoren `misc.json`, `latex-log.json` | GP | sonnet | medium | W0-2 | ja | `shared/spec/` | wie W0-11 | Schema |
| W2-6 | Gliederung: Parser über Includes, Baum, aktueller Abschnitt, Include-Kette, Liste | GP | sonnet | medium | W2-5, W1-2 | ja | `core/latex/outline.ts`, `ui/OutlineList.tsx`, `stores/outline.ts` | Vektoren grün | Vitest |
| W2-7 | Dateiaktionen im Main inkl. App-Ablage für Rückgängig, Papierkorb über `shell.trashItem` (als Parameter), Import aus dem Explorer | GP | opus | high | W2-1 | ja | `main/fsOps.ts` | NTFS-Groß/klein, nie aus dem Projekt heraus, Wiederherstellung byte-gleich | Vitest `fsOps` (Temp-Ordner) |
| W2-8 | `referenceUpdater.ts` + Namensprüfung | GP | sonnet | high | W2-5 | ja | `core/referenceUpdater.ts`, `core/fileNames.ts` | Vektoren grün | Vitest |
| W2-9 | App-Ebene Dateiaktionen: Dialoge, Verweise anpassen (offen → Editor), Tabs folgen, App-Undo-Stapel | GP | opus | high | W2-4, W2-7, W2-8 | nein | `stores/appUndo.ts`, `app/fileActions.ts`, `ui/dialogs/` | Umbenennen → Projekt kompiliert weiter; Rückgängig stellt alles her | Playwright `file-actions` (Preload-Stub) |
| W2-10 | Build-Pipeline fertig: Warteschlange (nie parallel, zusammenfassen), Speichern vor dem Build, `-synctex=1 … -file-line-error -cd`, `max_print_line`, Ausgabe in Temp-Datei, `latexmk -c` | GP | opus | high | W0-9 | ja | `main/build.ts` | Fake-latexmk-Tests + echter Build der Demo-Kopie | Vitest `build` |
| W2-11 | Log-Parser-Port (Bytes über `Buffer`, im Worker) | GP | sonnet | high | W2-5 | ja | `main/logParser.ts`, `main/workers/parse.worker.ts` | Vektoren grün; 5 MB < 100 ms | Vitest `logParser` |
| W2-12 | Build-UI: Knopf/Status, Fehlerliste, Protokoll, nächste/vorherige Meldung, Marken im Text + Gutter | GP | sonnet | medium | W2-10, W2-11, W1-7 | nein | `stores/build.ts`, `ui/Toolbar.tsx`, `ui/IssueList.tsx` | Sprung zur Zeile aus der Liste | Playwright `build` |
| W2-13 | Extern geänderte offene Dateien + Kompilieren beim Speichern | GP | opus | high | W2-2, W1-6 | nein | `editor/session.ts`, `app/diskSync.ts` | still neu laden mit minimalem Ersatz; Konfliktleiste | Vitest + Playwright |
| W2-14 | Sicherung/Wiederherstellung + Nachfrage beim Beenden (`close`-Ereignis → `app:closeRequested`) | GP | sonnet | high | W1-5, W2-4 | ja | `main/recovery.ts`, `app/recovery.ts` | simulierter Absturz → Wiederherstellen | Vitest `recovery` + Playwright |
| W2-15 | Schnell öffnen + Gehe zu Zeile | GP | sonnet | medium | W2-5 | ja | `core/quickOpen.ts`, `ui/QuickOpen.tsx` | Vektoren grün | Vitest |
| W2-16 | Menüleiste (Electron `Menu`, Befehle als `menu:command`) + Kürzeltabelle Strg/⌘ ohne Strg+Alt+Zeichen (AltGr) | GP | sonnet | medium | W2-12 | nein | `app/commands.ts`, `main/menu.ts` | jeder Toolbar-Befehl auch im Menü | Hand W-H |
| W2-R | Review M2 (Nebenläufigkeit, Prozessabbruch, Datenverlust, Main blockiert nie) | GP | opus | high | W2-* | ja | lesen | – | – |
| W2-D | Doku M2 + Windows-Handtests (TeX-Distributionen, Pfade, OneDrive) | GP | sonnet | low | W2-R | nein | Doku | – | – |

### M3 – PDF und SyncTeX

| ID | Aufgabe | Agent | Modell | Effort | Abh. | Par. | Dateien/Ordner | Akzeptanz | Tests |
|---|---|---|---|---|---|---|---|---|---|
| W3-1 | Vektoren `synctex.json` | GP | sonnet | medium | W0-2 | ja | `shared/spec/synctex.json` | Referenzwerte aus dem Test | Schema |
| W3-2 | SyncTeX fertig: Index je normalisiertem Pfad, Binärsuche, Koordinaten, Nachladen (Fehler → alte Daten), Ereignis | GP | opus | high | W0-8, W3-1 | ja | `main/synctex.ts`, `main/workers/synctex.worker.ts` | Vektoren grün; Win-Pfade | Vitest `synctex` |
| W3-3 | PDF-Ansicht: `PDFViewer`, Laden (S9-Entscheidung, ggf. `main/pdfProtocol.ts`), Neuladen mit Seite/Zoom/Position, Zoom-Leiste | GP | opus | high | W0-7, W0-10 | ja | `pdf/viewer.ts`, `ui/PDFPane.tsx`, `stores/pdf.ts`, `main/pdfProtocol.ts` | unvollständige Datei → alte Ansicht bleibt; nur Projektordner erreichbar | Playwright `pdf` (Fixture-PDF) |
| W3-4 | Arbeitsbereich Editor / Geteilt / PDF mit 14-px-Teiler, beide immer eingehängt | GP | sonnet | medium | W3-3 | nein | `ui/WorkspaceSplit.tsx` | Wechsel behält Seite, Zoom, Auswahl | Playwright `view-mode` |
| W3-5 | SyncTeX-Abläufe: Strg+J, Klick ins PDF → Datei/Zeile (nur Projekt-`.tex`), PDF folgt Cursor (aus, nur wenn unsichtbar), ohne Markierung | GP | opus | high | W3-2, W3-4 | nein | `stores/synctex.ts`, `pdf/viewer.ts` | richtige Datei und Zeile in der Demo-Kopie | Playwright + Hand |
| W3-6 | Links + Sprungverlauf (höchstens 20, klemmen, leeren bei Projektwechsel) | GP | sonnet | medium | W3-3, W2-5 | ja | `pdf/links.ts`, `pdf/history.ts` | Vektoren `misc.history` grün | Vitest |
| W3-7 | Link-Vorschau (Kontextmenü, Alt-Hover 0,6 s, Layoutfunktionen, schließt bei Scrollen/Esc) | GP | sonnet | high | W3-6 | nein | `pdf/preview.ts`, `ui/LinkPreview.tsx` | Vektoren `misc.linkPreview` grün | Vitest + Hand |
| W3-R | Review M3 | GP | opus | high | W3-* | ja | lesen | – | – |
| W3-D | Doku M3 | GP | sonnet | low | W3-R | nein | Doku | – | – |

### M4 – Vervollständigung, Einfügen, Verweise

| ID | Aufgabe | Agent | Modell | Effort | Abh. | Par. | Dateien/Ordner | Akzeptanz | Tests |
|---|---|---|---|---|---|---|---|---|---|
| W4-1 | Vektoren `completion`, `insertion`, `bibliography`, `references` (4 Agents, je eine Datei) | GP | sonnet | medium | W0-2 | ja | `shared/spec/` | wie W0-11 | Schema |
| W4-2 | Kontext-Erkennung (rückwärts ab Cursor, nur die Zeile) | GP | opus | high | W4-1, W1-2 | ja | `core/completion/context.ts` | Vektoren grün; O(Zeilenlänge) | Vitest |
| W4-3 | Rang + Applier (Gerüste, `}` ergänzen, `\begin…\end`, Folgeliste) | GP | sonnet | high | W4-1 | ja | `core/completion/matcher.ts`, `applier.ts` | Vektoren grün | Vitest |
| W4-4 | Bib-Parser + Projektkatalog + Index im Worker (`.tex`/`.cls`/`.sty`/`.bib`) | GP | sonnet | high | W4-1 | ja | `core/bib/parser.ts`, `core/completion/provider.ts`, Worker | meldet sich nur bei Änderung | Vitest |
| W4-5 | Optionen (Katalog + Scanner, HgbThesis `theme=`/`degree=`) | GP | sonnet | medium | W4-1 | ja | `core/completion/options.ts`, `catalog.ts` | Vektoren grün | Vitest |
| W4-6 | CM-Anbindung Vervollständigung (Automatik, Strg+Leertaste, Esc, nie in Kommentar/Verbatim, Schalter) | GP | opus | high | W4-2..5 | nein | `editor/completion.ts` | `\ref{` → Liste → Enter = ein Undo-Schritt | Playwright `completion` |
| W4-7 | Generatoren: Escaping, Labels, Blockplatzierung, Tabelle, Code, Gleichung, Liste, Ref, Cite | GP | sonnet | medium | W4-1 | ja | `core/insertion/*` | Vektoren grün | Vitest |
| W4-8 | Quelle: Formatter, Schlüssel, SourceBuilder, Ziel-`.bib`, Anhängen (Main, sicher) | GP | sonnet | medium | W4-1, W1-5 | ja | `core/bib/*`, `main/textIo.ts` (Anhängen) | unlesbare `.bib` wird nie überschrieben | Vitest |
| W4-9 | Bild-Import (Main) + Drag & Drop aus dem Explorer (`webUtils.getPathForFile` im Preload) | GP | sonnet | medium | W2-7 | ja | `main/images.ts`, `preload/index.ts` | gleicher Inhalt wiederverwendet, sonst nummeriert | Vitest `images` |
| W4-10 | Einfügen-Fenster (Liste, Einstellungen, Vorschau an Ort und Stelle, Blocker ohne `.tex`) + Tabellenraster mit Excel-Einfügen | GP | sonnet | medium | W4-7..9 | nein | `ui/insert/*`, `stores/insert.ts` | ein Undo-Schritt; Fußzeile „Einfügen in …, Zeile n“ | Playwright `insert` |
| W4-11 | Kompiliertest aller Bausteine (27 Sprachen) in einer Demo-Kopie | GP | sonnet | medium | W4-10, W2-10 | nein | `tests/integration/insertion-compile.test.ts` | übersprungen ohne TeX/Demo | `test-run --filter insertion-compile` |
| W4-12 | Verweise prüfen + Hinweise in der Fehlerliste | GP | sonnet | high | W4-4, W1-9 | ja | `core/latex/references.ts`, Worker, `ui/IssueList.tsx` | drei Demo-Fälle sichtbar | Vitest |
| W4-13 | Strg-Klick-Ziele (ref/cite/include; Text → PDF) | GP | sonnet | medium | W4-4, W3-5 | ja | `core/jumpTargets.ts`, `editor/navigation.ts` | Vektoren grün | Vitest + Playwright |
| W4-14 | Projektsuche/Ersetzen (Main-Worker mit Strom `search:hits` + offene Puffer; Ersetzen nur in Sitzungen) | GP | sonnet | high | W2-4 | ja | `main/search.ts`, `main/workers/search.worker.ts`, `stores/search.ts`, `ui/SearchList.tsx` | Platte unverändert, Strg+Z je Datei | Vitest `search` + Playwright |
| W4-R | Review M4 | GP | opus | high | W4-* | ja | lesen | – | – |
| W4-D | Doku M4 | GP | sonnet | low | W4-R | nein | Doku | – | – |

### M5 – PDF-Markierungen

| ID | Aufgabe | Agent | Modell | Effort | Abh. | Par. | Dateien/Ordner | Akzeptanz | Tests |
|---|---|---|---|---|---|---|---|---|---|
| W5-1 | Vektoren `mark-anchor.json` | GP | sonnet | medium | W0-2 | ja | `shared/spec/` | wie W0-11 | Schema |
| W5-2 | Anker + Suche (exakt → ähnlich ≥ 0,7 → Stücke aus ≤ 4 Zeilen, ≤ 64 Kandidaten), Wortzahlen, Auffrischen, `occurrence` | GP | opus | high | W5-1 | ja | `core/marks/anchor.ts`, `locator.ts`, `sourceLines.ts` | Vektoren grün; 5.000 Zeilen / 50 Marken < 2 s | Vitest + Perf |
| W5-3 | Speicher im App-Datenordner (Hash des normalisierten Pfads, `….defekt-<Zeit>.json`, neuere Version bleibt unverändert) | GP | sonnet | medium | W0-4 | ja | `main/marks.ts` | Fälle aus `MarkStorageTests` | Vitest `marks` |
| W5-4 | Textgeometrie je Seite (Wörter mit Rechtecken, Zwischenspeicher je PDF-Stand) | GP | opus | high | W0-7, W3-3 | ja | `pdf/textGeometry.ts` | Ergebnis von S2 erreicht | Playwright (Fixture-PDF) |
| W5-5 | Resolver + Creator (forward/backward, Wörter 3/2/1, placed/pending/orphaned, `keepingPlacement`, Mindesthöhe 8 pt) | GP | opus | high | W5-2, W5-4, W3-2 | nein | `core/marks/resolver.ts`, `creator.ts` | Markierung überlebt Neubuild; ohne Index ändert sich nichts | Vitest (Fake-SyncTeX) |
| W5-6 | Overlay-Schicht: Zeichnen, Treffertest, Kontextmenü, Farben, Markierungsmodus | GP | sonnet | high | W5-5 | nein | `pdf/marksOverlay.ts`, `ui/PDFPane.tsx` | nichts landet in der PDF-Datei | Playwright `marks` |
| W5-7 | Store + App-Undo (anlegen, entfernen, Farbe, ersetzen bei Überlappung > 1 pt, alle entfernen) | GP | sonnet | high | W5-6, W2-9 | nein | `stores/marks.ts`, `stores/appUndo.ts` | je ein Undo-Schritt | Vitest |
| W5-8 | Kommentare, Notizen, Liste (Gruppen, neu zuordnen, entfernen) | GP | sonnet | medium | W5-7 | nein | `ui/MarkPopover.tsx`, `ui/MarkList.tsx`, `core/marks/grouping.ts` | Gruppen wie in Swift | Vitest + Playwright |
| W5-9 | Mitwandern bei Umbenennen/Verschieben, Verwaisen beim Löschen, Undo | GP | sonnet | medium | W5-7, W2-9 | nein | `app/fileActions.ts`, `stores/marks.ts` | Rückgängig stellt die Marken wieder her | Playwright |
| W5-R | Review M5 | GP | opus | high | W5-* | ja | lesen | – | – |
| W5-D | Doku M5 + Handtests (Absatz umformulieren, Umbruch, zweimal überarbeiten) | GP | sonnet | low | W5-R | nein | Doku | – | – |

### M6 – Git

| ID | Aufgabe | Agent | Modell | Effort | Abh. | Par. | Dateien/Ordner | Akzeptanz | Tests |
|---|---|---|---|---|---|---|---|---|---|
| W6-1 | Vektoren `git-status.json`, `line-diff.json` | GP | sonnet | medium | W0-2 | ja | `shared/spec/` | wie W0-11 | Schema |
| W6-2 | Git-Runner: Finden (Git für Windows), Umgebung (`LC_ALL=C`, `GIT_OPTIONAL_LOCKS=0`, `GIT_LITERAL_PATHSPECS=1`, `GIT_TERMINAL_PROMPT=0`, ohne Pager/Editor, SSH `BatchMode`), Warteschlange, Status-Parser (Worker), Projekt-Präfix | GP | opus | high | W6-1, W0-9 | ja | `main/git.ts`, `main/workers/parse.worker.ts` | Index byte-gleich nach Status; temporäre Repositories | Vitest `git` |
| W6-3 | LineDiff (Myers mit Grenze, Wörter über Codepoints, Einklappen) | GP | sonnet | high | W6-1 | ja | `core/diff/*` | Vektoren grün; 600 Zufallsfälle gegen LCS | Vitest |
| W6-4 | Git-Store + Wächter auf `.git` (Index/HEAD/Refs) + Änderungen-Tab + Bereitstellen + Commit + Marken im Baum | GP | sonnet | high | W6-2 | nein | `stores/git.ts`, `ui/Changes*.tsx` | Commit mit Speichern-Nachfrage | Playwright `git` (Preload-Stub) |
| W6-5 | Diff-Tabs (Vorschau-Platz geteilt, Umschalter, schließen nach Commit) | GP | sonnet | medium | W6-3, W6-4, W2-4 | nein | `ui/Diff*.tsx`, `core/tabs.ts` | Diff-Tabs werden nicht gemerkt | Playwright |
| W6-6 | Phase 2: Branch-Menü, Abrufen, Pull `--ff-only`, Push ohne Force mit Upstream | GP | sonnet | high | W6-4 | nein | `main/git.ts`, `ui/BranchMenu.tsx` | Fälle aus `GitRemoteTests` mit lokalem Bare-Repository | Vitest `gitRemote` |
| W6-7 | Auf HEAD zurücksetzen: Plan, Sicherung inkl. ungespeichertem Text, Rückgängig | GP | opus | high | W6-4, W2-9 | nein | `app/gitReset.ts`, `main/git.ts` | Fälle aus `GitResetTests` | Vitest + Playwright |
| W6-8 | Änderungsmarken gegen HEAD (Worker, 0,3 s) | GP | sonnet | medium | W6-3, W1-7 | ja | `workers/analysis.worker.ts`, `editor/gutter.ts` | Marken weg nach Commit | Vitest |
| W6-R | Review M6 | GP | opus | high | W6-* | ja | lesen | – | – |
| W6-D | Doku M6 + Handtests CRLF/autocrlf | GP | sonnet | low | W6-R | nein | Doku | – | – |

### M7 – Politur, Installer, Windows-Installation

| ID | Aufgabe | Agent | Modell | Effort | Abh. | Par. | Dateien/Ordner | Akzeptanz | Tests |
|---|---|---|---|---|---|---|---|---|---|
| W7-1 | Einstellungsfenster (Bereiche, Suche, Live-Vorschau, Standard wiederherstellen) | GP | sonnet | medium | W1-11 | ja | `ui/settings/*` | Änderungen gelten sofort, ohne Neuaufbau aller Dateien | Playwright |
| W7-2 | Spike S8 + Umsetzung Rechtschreibung (de_AT/de_DE, Syntaxfilter, Fachvokabular als JSON aus den Swift-Listen; Weg nach S8: Chromium-Prüfung, `webFrame.setSpellCheckProvider` oder `nspell` im Worker über den sichtbaren Bereich) | GP | opus | high | W1-4 | ja | `editor/spell.ts`, ggf. `workers/spell.worker.ts`, `preload/index.ts`, `shared/spec/vocabulary.json` | nur sichtbarer Bereich; kein Netzzugriff; Lizenz geklärt | Vitest + Playwright |
| W7-3 | Schreibhinweise + Autokorrektur (Vektoren `writing.json`) | GP | sonnet | high | W4-1, W1-9 | ja | `core/latex/writingHints.ts`, `capitalization.ts`, `editor/autocap.ts` | Vektoren grün | Vitest + Playwright |
| W7-4 | Pfadzeile mit Abschnitt, Wortzähler Projekt, Zoom-Feinschliff | GP | sonnet | medium | W2-6 | ja | `ui/PathBar.tsx`, Worker | keine Breitenrückkopplung | Playwright |
| W7-5 | Design-Prüfung der Oberfläche (Skill `apple-design`, Teil Electron/Windows) | GP | opus | medium | W7-1 | ja | lesen | Befundliste | – |
| W7-6 | Installer: electron-builder NSIS je Benutzer (ohne Admin), Icon, Version + Commit in „Über“, kein Auto-Updater und keine Veröffentlichung, Electron-Fuses prüfen (z. B. `RunAsNode` aus) | GP | sonnet | medium | W0-10 | nein | `electron-builder.yml`, `build/icons` | Installation ohne Admin auf frischem Win11 | Hand W-H |
| W7-7 | E2E mit Playwright `_electron.launch` und echten Main-Modulen: Projekt öffnen, kompilieren, Strg+J, Markierung | GP | sonnet | medium | M3, M5 | nein | `tests/e2e/` | 4 Abläufe grün auf Mac und Windows | `test-run --e2e`; auf Windows Hand-Start |
| W7-8 | macOS- und Linux-Build prüfen (unsigniertes `.dmg`, AppImage) | GP | sonnet | medium | W7-6 | nein | `electron-builder.yml` | startet, öffnet die Demo-Kopie | Hand |
| W7-R | Review M7 (Sicherheit: Sandbox, CSP, Navigationssperre, IPC-Absenderprüfung, Fuses; Datenverlustpfade, Doku) | GP | opus | high | W7-* | ja | lesen | – | – |
| W7-D | Doku M7 + Abschluss in `VERLAUF.md` | GP | sonnet | low | W7-R | nein | Doku | – | – |

**Nach M7 (später, nur auf Auftrag):** Umbenennen aller Arten, Verwendungen, Abkürzungen/Glossar, Bildvorschau/-bibliothek, Hover-Vorschau der Seitenleiste, Spaltenhilfslinie.

## 6. Risiken und Spikes zuerst

| Spike | Frage | Entscheidungskriterium | Abbruch / Alternative |
|---|---|---|---|
| S1 CodeMirror-Leistung | Wie schnell ist der Stream-Tokenizer bei 10.000 und 50.000 Zeilen in Electron (Mac und Windows)? | Tastendruck p95 < 16 ms, Öffnen < 200 ms (10.000 Zeilen), 50.000 Zeilen bedienbar | eigenes `ViewPlugin` mit Zeilenzustands-Cache und Dekorationen nur im sichtbaren Bereich; danach Lezer-Grammatik |
| S2 pdf.js-Textebene für Anker | Liefert die Textebene wortgenaue Rechtecke innerhalb des SyncTeX-Rechtecks? | ≥ 95 % der Testmarkierungen wortgenau; < 30 ms je Seite | Breiten aus `getTextContent` (Transform + Breite / Zeichenzahl); sonst zeilengenau (`Precision.lines`) |
| S3 SyncTeX in Node | Pfade in `.synctex.gz` bei MiKTeX/TeX Live (`\`/`/`, Laufwerk, `./`, 8.3-Namen); Tempo des TS-Parsers bei 250.000 Einträgen; Parser im Worker | Vektoren + Live-Abgleich mit `synctex.exe` gleich; Main bleibt bedienbar | Normalisierung erweitern; im Notfall CLI-Rückfall hinter einem Schalter |
| S4 latexmk/MiKTeX | Finden, Perl unter MiKTeX, Paket-Nachinstallation ohne Dialog, Abbruch des Prozessbaums mit `taskkill /PID <eigene Kind-PID> /T /F`; `.bat`/`.cmd` lassen sich in Node ohne Shell nicht starten | Build der Demo-Kopie mit beiden Distributionen; Abbruch < 3 s; keine verwaisten Prozesse | Hinweis „Perl/TeX Live installieren“; sonst eigene Folge pdflatex → biber → pdflatex (L) |
| S5 Electron-Besonderheiten | AltGr-Zeichen (`{[]}\@~` auf deutscher Tastatur), IME, Drag & Drop mit `webUtils.getPathForFile`, Zwischenablage, Sandbox + Preload, CSP (verlangt pdf.js oder CodeMirror `unsafe-eval`?), pdf.js-Worker als Modul | Prüfseite grün unter Windows und macOS (Linux als Hinweis) | Strg+Alt-Kürzel grundsätzlich meiden; CSP gezielt lockern und begründen |
| S6 Windows-Paket | NSIS mit electron-builder: nativ auf Windows bauen oder vom Mac aus | NSIS-Installer läuft ohne Admin auf frischem Win11 | Windows-Rechner des Nutzers; GitHub Actions nur auf sein ausdrückliches Wort |
| S7 Git unter Windows | autocrlf und Diff/Änderungsmarken, Fenster des Credential Managers, `GIT_OPTIONAL_LOCKS` | Status ändert den Index nicht; CRLF-Datei ohne Scheinänderungen | Diff mit normalisierten Zeilenenden; Netzbefehle nur auf Klick |
| S8 Rechtschreibung | Chromium-Prüfung (`session.setSpellCheckerLanguages`; lädt Wörterbücher unter Windows/Linux aus dem Netz, kein Syntaxfilter) gegen eigenen Anbieter (`webFrame.setSpellCheckProvider`, sieht nur Einzelwörter) gegen `nspell` + Wörterbuch im Worker mit eigenen Dekorationen (voller Syntaxfilter); Tempo, Wörterbuchlizenz, Zusammensetzungen | < 20 ms für den sichtbaren Bereich; kein Netzzugriff | nur das Fachvokabular; oder Rechtschreibung entfällt |
| S9 PDF-Transport | eigenes Protokoll (`protocol.handle`, Pfadprüfung nur Projektordner, Range-Anfragen für pdf.js) gegen Lesen per IPC (Bytes) für 10 MB | < 100 ms bis `getDocument` | der jeweils andere Weg |
| S10 Dateiüberwachung | `fs.watch` mit `recursive` + Entpreller 300 ms: Ereignisse bei atomarem Speichern, Stürme beim Build, OneDrive/Virenscanner, `recursive` unter Linux | ein Ereignis pro Speichern, kein Sturm, keine verlorenen Änderungen | `chokidar` als einzige Zusatzbibliothek (Nutzer-OK) |
| weitere Risiken | NTFS-Sperren (OneDrive, Virenscanner) beim atomaren Speichern · lange Pfade > 260 Zeichen · Groß/klein-unabhängige Pfade · Ereignisstürme · Main-Prozess blockiert durch synchrone Aufrufe | Tests in `fsOps`/`watch`; Regel „nur `fs/promises`“ im Review | Wiederholung mit Rückoff, `fs.realpath.native`, normalisierte Schlüssel |

## 7. Teststrategie, Handtests, Definition of Done, erste 10 Aufgaben

| Ebene | Werkzeug | Inhalt |
|---|---|---|
| Logik TS | Vitest, Node-Umgebung (über `scripts/test-run.mjs`) | `shared/core/*` gegen `shared/spec/*.json`; Zufallsabgleich inkrementell = komplett; Kontrast der Schemata |
| Main-Module | Vitest, Node-Umgebung (ohne Electron, Electron-Dinge als Parameter) | SyncTeX- und Log-Vektoren, Text-E/A, fsOps (Temp-Ordner), Git (temporäre Repositories, `GIT_CONFIG_GLOBAL` = `NUL` bzw. `/dev/null`), Build mit Fake-latexmk; echtes TeX nur mit Schalter und mit Überspringen |
| Leistung | Vitest-Bench + Playwright-Messseite | Budgets als benannte Konstanten, schnellster von n Läufen |
| UI-Abläufe | Playwright `_electron.launch` mit Preload-Stub | wenige Abläufe: Tabs, Tippen, Vervollständigung, Einfügen, Build-Liste, PDF-Ansicht, Markierungen |
| Ende-zu-Ende | Playwright `_electron.launch` mit echten Main-Modulen | 4 Abläufe in W7-7 (Mac und Windows) |
| Demo-Daten | `../shared/Testdaten/HgbDemo` nur als Kopie in Temp | Tests überspringen sich ohne den Ordner; nie an Ort und Stelle kompilieren |

**Windows-Handtests (`web/TESTING.md`, Nummern W-H1 …):** Installation ohne Admin · Start ohne TeX/Git (Hinweise) · MiKTeX und TeX Live · Projekt unter Pfad mit Leerzeichen und Umlauten, im OneDrive-Ordner, mit langem Pfad · CRLF- und Latin-1-Datei speichern (byte-gleich) · deutsche Tastatur: AltGr-Klammern, Tottasten, IME · Strg+S/B/P/J/F, F3 · Drag & Drop aus dem Explorer (Bild, Datei) · Papierkorb + Rückgängig · Build abbrechen (keine verwaisten `pdflatex.exe` im Task-Manager) · Strg+J / Klick ins PDF · Markierung nach Umformulieren · Git-Commit, Pull, Push mit Git für Windows · HiDPI 150 %, Hell/Dunkel des Systems · Beenden mit ungespeicherten Änderungen · kein Netzzugriff der App (z. B. mit der Windows-Firewall-Protokollierung).

**Definition of Done insgesamt:** Jede MVP-Zeile der Matrix ist umgesetzt · alle Vektoren grün in Vitest und in der Swift-Gegenprobe · Budgets eingehalten · `tsc --noEmit` ohne Fehler und Warnungen · Handtests W-H alle grün auf Win11 · Installer auf frischem Win11 · Builds für macOS und Linux starten · Doku (`web/CLAUDE.md`, `web/docs/ARCHITEKTUR.md`, `web/TESTING.md`, `VERLAUF.md`) aktuell · kein Zugriff auf die Thesis im Code oder in Tests.

**Erste 10 Aufgaben, sofort startbar:**

| # | ID | Hinweis |
|---|---|---|
| 1 | W0-1 | erledigt |
| 2 | W0-3 | Abhängigkeitsliste (§1) vorher dem Nutzer zeigen |
| 3 | W0-2 | erledigt |
| 4 | W0-4 | nach 2 |
| 5 | W0-5 | nach 2, parallel zu 4 |
| 6 | W0-11 | erledigt |
| 7 | W0-12 | erledigt |
| 8 | W0-6 | nach 2, parallel zu 9/10 (eigener Spike-Ordner) |
| 9 | W0-8 | nach 4 |
| 10 | W0-9 | nach 4; Windows-Teil als Handtest beim Nutzer |

W0-7, W0-10 und W0-14 folgen direkt danach.

## 8. Regeln für die Weiterarbeit

- Jede Umsetzung läuft nach `shared/SUBAGENTS.md` (Agent-Typ, Modell, Effort, Ablauf). Nur `haiku`, `sonnet` und `opus`; **kein `fable`**, Effort höchstens `high`. `haiku` schreibt keinen Code, nur Suche und Doku. Schreiben parallel nur bei verschiedenen Dateien. **Build und Tests nie parallel; nur die Hauptsitzung baut und testet**, und zwar über `web/scripts/test-run.mjs` bzw. `swift/scripts/test-run.sh`.
- Pflichtangaben für Web-Subagents entsprechen denen in `SUBAGENTS.md`, mit Web-Regeln (TS strikt, 4 Spaces, Funktionen ≤ 30 Zeilen, benannte Konstanten, UI-Texte und Kommentare Deutsch, Main-Prozess nur `fs/promises`, nur Main-Randmodule importieren `electron`). Der Vorschlag kommt aus W0-D und wird nur mit OK des Nutzers in `shared/SUBAGENTS.md` übernommen.
- **`Thesis` (Nachbarordner) nie öffnen, lesen, kompilieren, kein git dort.** Getestet wird nur mit Kopien von `shared/Testdaten/HgbDemo`; keine Pfade zur Thesis im Code.
- Prozesse nur über die eigene PID beenden (kein `pkill`, kein `taskkill /IM`); die installierte Swift-App nie beenden.
- Keine Netzwerk-Features: Navigationen und `webRequest` außerhalb von `file:` und dem eigenen Protokoll sind im Main blockiert, kein Auto-Updater, keine Wörterbuch-Downloads.
- Commit, Push und Installation nur auf ausdrückliches Wort des Nutzers; `FEHLER.md` und `shared/Testdaten/` bleiben lokal.
- Ideenspeicher (`shared/VERLAUF.md`) nicht ungefragt umsetzen; gelbe PDF-Markierung und Find-Indicator-Flash nicht wieder einbauen.
- Destruktive Aktionen immer mit Sicherung (auch ungespeicherter Text), Rückgängig in der App und sichtbarer Datei. Die App ändert nie die Git-Konfiguration und fragt nie nach Passwörtern.
- Änderungen in `swift/` (z. B. `SpecVectorTests`) nur mit OK des Nutzers; die Swift-Regeln gelten dort unverändert.
