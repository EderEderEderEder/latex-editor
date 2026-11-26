# Architektur (web/)

## Entscheidungen aus den Spikes

### S1 CodeMirror-Leistung

Entscheidung (W0-6, 2026-11-23): **eigenes `ViewPlugin` mit Zeilenzustands-Cache statt `StreamLanguage`.** Es merkt sich den Endzustand je Zeile, rechnet nach einer Änderung nur bis zur Zustandskonvergenz neu und baut Dekorationen nur für den sichtbaren Bereich; Zeilen hinter dem sichtbaren Bereich rechnet es im Leerlauf nach. Gemessen auf dem Intel-Mac mit Electron 45.4.1, schnellster von 5 Läufen:
- Tastendruck p95 3,5 ms bei 10.000 und 50.000 Zeilen, `$`-Zustandswechsel 4,3–5,4 ms.
- Öffnen 13–15 ms, kalt bis 37 ms.
- Scroll-Rahmen p95 ≤ 15 ms bei 50.000 Zeilen.

`StreamLanguage` ist genauso schnell, lässt aber nach einem Sprung hinter eine Änderung 90–140 ms lang Text ohne Farbe stehen, das `ViewPlugin` nur 9–16 ms. Außerdem bildet es die Konvergenz-Logik des Swift-`SyntaxHighlighter` nicht nach, sodass `highlightEdit`/`tokenizedLineCount` aus `shared/spec` nicht prüfbar wären.

Regeln für den Editor-Kern:
- Tokenizer als reine Funktion (Zeile, Anfangszustand) → (Tokens, Endzustand); Zustand billig vergleichbar.
- Cache (`LineStateCache`) ohne DOM testbar.
- Pro Tastendruck synchron höchstens bis 200 Zeilen hinter den sichtbaren Bereich.
- Kein Lezer-Baum: Einklappen und Kontext nach Swift-Vorbild selbst bauen.

Ungeprüft: Windows (Handmessung mit derselben Messseite), echte Tastatur- und IME-Eingabe, Mehrfachcursor, sehr lange Zeilen. `StreamLanguage` bleibt der Rückfallweg.

Alle Zahlen: `spikes/cm-perf/ERGEBNIS.md`.

### S2 pdf.js-Textebene für Anker

Entscheidung (W0-7, 2026-11-23): **Zeichenrechtecke aus `page.getTextContent()` + Glyphbreiten der eingebetteten Schrift, nicht aus der DOM-Textebene (`TextLayer` + `Range.getClientRects`).** Glyphen in echter Breite (`measureText` mit FontFace `item.fontName`, Größe aus `transform`), der Rest von `item.width` nur auf die Leerzeichen (Blocksatz). Gemessen auf dem Intel-Mac mit Electron 45.4.1 und pdf.js 6.5.438 an 41 Testmarkierungen (Kopie HgbDemo + eigenes Testdokument mit Ligaturen, Mathe, Silbentrennung, Fußnote, Tabelle), Wahrheit: von Hand festgelegter Text plus unabhängige PDFKit-Geometrie, schnellster von 7 Läufen:
- Richtige Wörter überdeckt in 40/41 (Ausnahme Fußnotentext: Rückfall auf Zeilen wie in Swift); Ränder ≤ 2 pt zu PDFKit in 39/39, ≤ 1,5 pt in 34/39.
- 0,9 ms je Seite im Mittel, höchstens 3,0 ms (davon `getTextContent` 0,5 ms); 13 Seiten 12–14 ms über 7 Läufe.
- `TextLayer` nur 26/39 ≤ 1,5 pt, Fehler bis 4,9 pt (Ersatzschrift des Systems, Span nur als Ganzes gestreckt, auf Windows anders); gleichmäßige Breite je Stück 16/39.

Regeln für `pdf/textGeometry.ts` (W5-4):
- Schriften müssen im Dokument liegen: `getDocument({ disableWorkerRendering: true })`, Seite gerendert, `document.fonts.check` vor dem Messen; sonst gleichmäßige Breite und nach dem Rendern neu berechnen.
- Normalisierung von pdf.js lassen (Ligaturen kommen als „fi“, „ffi“), Wörter wie `MarkText` (NFKC, klein, `[\p{L}\p{N}\p{M}]+`), `hasEOL` als Trenner ohne Lage, Leerzeichen nicht in Zeilenrechtecke.
- Ergebnis je Seite und PDF-Stand zwischenspeichern; ohne Treffer bleibt die Zeile (`Precision.lines`).

Nebenbefund Swift (nicht in der App geprüft): `PDFPage.characterBounds(at:)` und `page.string` laufen nach Ligaturen auseinander; `MarkResolver` nutzt beides zusammen. Ungeprüft: Windows/Linux, Type3-Schriften, Fremd-PDFs, mehrspaltiger Satz, Markierungen über Seitengrenzen.

**W3-3a (Review H2, 2026-11-25, Intel-Mac, DPR 2; Windows: Handmessung W-H17): Seiten im Renderer-Hauptthread rendern (`disableWorkerRendering: true`) genügt; kein Render-Worker, keine CSP-Änderung.** Messseite `spikes/pdf-text/csp/` unter exakt `RENDERER_CSP` (Meta) plus `PACKAGED_CSP_HEADER` (Kopf, kam an allen `file:`-Antworten inklusive Worker-Skripten an) und dem Anfragefilter aus `security.ts`; Editor mit den App-Erweiterungen und 10.000 Zeilen; 303-Seiten-PDF aus einer HgbDemo-Kopie.
- Tippen (120 echte Tasten, Taste bis Paint p95, ohne Rahmentakt wie `tests/perf`): ohne PDF 4,7–5,6 ms; während pdf.js **ohne Pause** Seiten rendert (Worst Case) 13,2–17,1 ms bei DPR 2 (2 von 6 Runden ≥ 16), 6,9–9,0 ms bei DPR 1. pdf.js zeichnet in Scheiben von höchstens 15 ms; keine Long Task > 50 ms. Mit Rahmentakt nur +1–2 ms gegenüber ohne PDF.
- Der Render-Worker von pdf.js 6.5 ist **schlechter** (p95 20–26 ms): Er schickt jedes Zwischenbild als `ImageBitmap` zurück, der Hauptthread zeichnet es per `drawImage`. Schriften liegen in beiden Modi im Dokument (S2-Ergebnis unter CSP in beiden Modi je Markierung identisch).
- 303 Seiten im `PDFViewer` (mit Textebene): erste Seite nach 146–211 ms (ab `getDocument`, Bytes im Renderer; IPC aus S9 kommt dazu), Scrollen mit 8.000 px/s rendert alle Seiten rechtzeitig, mit Rahmentakt 0–1 Rahmen > 33 ms in 35 s, Sprung auf ferne Seite 39–76 ms, Renderer-Prozess +130–260 MB beim Scrollen (Spitze aller Prozesse < 1 GB).
- CSP: `cMapUrl`/`standardFontDataUrl`/`wasmUrl` als `file:` neben der `index.html` laden per XHR unter `connect-src 'self'`; Wasm bleibt blockiert (JPX/JBIG2 haben JS-Rückfälle, ICC nicht). Einzige mögliche Änderung: `'wasm-unsafe-eval'` in `script-src`, nur wenn W-H10 scheitert.

Folgen für W3-3 (`pdf/viewer.ts`):
- `getDocument({ data, disableWorkerRendering: true, cMapUrl, cMapPacked: true, standardFontDataUrl, wasmUrl, iccUrl })`; `cmaps/`, `standard_fonts/`, `wasm/`, `iccs/` (~4 MB) aus `pdfjs-dist` offline ins Renderer-Paket kopieren (unter `out/renderer/`, sonst blockiert der Anfragefilter), `GlobalWorkerOptions.workerSrc` auf das gebündelte `pdf.worker.min.mjs`, **kein** `rendererSrc`.
- `PDFViewer` mit Standard-Warteschlange nutzen: sichtbare Seiten zuerst, eine Seite vorrendern, Puffer 10 Seiten; nicht erhöhen. Abbruch beim Scrollen leistet der Viewer selbst (Rendern nicht vorrangiger Seiten pausiert zwischen den Scheiben, Seiten außerhalb des Puffers werden zerstört); kein eigener Abbruch nötig.
- Canvas: `maxCanvasPixels: 2 ** 24` (16,8 MP statt 2^25; bei DPR 2 und 900 CSS-px Seitenbreite greift es erst ab ~200 % Zoom, darüber zeichnet `enableDetailCanvas` nur den sichtbaren Ausschnitt scharf), `maxCanvasDim` Standard. Das Pixelverhältnis nimmt pdf.js fest aus `devicePixelRatio` (keine Viewer-Option); bei DPR > 2 begrenzt `maxCanvasPixels` Speicher und Renderzeit (DPR 1 halbiert die Tipp-Latenz unter Last). Zwischenbilder klein halten: nach einem Build nur die sichtbaren Seiten neu rendern, altes Dokument erst nach dem Paint des neuen mit `destroy()` freigeben.
- Eigenes `l10n` übergeben (sonst lädt `GenericL10n` Sprachdateien nach), Textebene an (`textLayerMode: 1`, mitgemessen).
- W5-4: Geometrie (`getTextContent` + `fontSpaces`) nur für sichtbare Seiten mit Markierungen und nachträglich im Leerlauf (`requestIdleCallback`), je PDF-Stand zwischenspeichern; unter Rendern kostet sie 6–8 ms Wandzeit je Seite.

Alle Zahlen: `spikes/pdf-text/ERGEBNIS.md` (Abschnitt „W3-3a“).

### S3 SyncTeX in Node

Entscheidung (W0-8, 2026-11-23, nur Mac geprüft): **eigener TS-Parser (`main/synctex.ts`, Port von `SyncTeX.swift`), Index in einem `worker_threads`-Worker (`main/workers/synctex.worker.ts`), der `load`/`forward`/`backward` selbst beantwortet**; kein `utilityProcess`, kein CLI-Rückfall. Fixture-Referenzwerte aus `SyncTeXTests.swift` und Gegenprobe mit dem `synctex`-CLI stimmen.

- 250.000 Einträge (7,7 MB, 1 MB gzip), schnellster von 5 Läufen: Einlesen 102–106 ms (Streuung bis 208 ms unter Last), Main-Zeitgeber-Verzögerung währenddessen < 1 ms (im Main wären es ~110 ms Blockade), Abfrage vorwärts 0,004 ms, rückwärts 0,003 ms, Rundlauf über den Worker 0,03 ms; Index ca. 11 MB typisierte Arrays.
- Pfade: Schlüssel über `paths.comparisonKey` (Trenner, `./`, `..`, Laufwerk, NFC, Groß-/Kleinschreibung je Plattform), relative `Input:`-Pfade gegen den Ordner der `.synctex.gz`, CRLF toleriert, unter macOS `/private` abgeschnitten. 8.3-Namen und Symlinks werden nicht aufgelöst (bei Bedarf `resolveRealPath` beim Laden).
- `forward` liefert je PDF-Zeile ein Rechteck (Vertrag `rects[]`), Swift vereinigt sie.
- Offen für W3-2: Main-Client und Worker als eigener electron-vite-Einstieg; Windows-Gegenprobe mit `synctex.exe`/MiKTeX (Pfadkodierung, 8.3).

Alle Zahlen: `spikes/synctex/ERGEBNIS.md`.

### S4 Werkzeuge, latexmk, Abbruch

Entscheidung (W0-9, 2026-11-23, nur Mac geprüft, Windows per Handtest): **`main/tools.ts` findet TeX und Git, `main/build.ts` startet latexmk ohne Shell und bricht über die eigene Kind-PID ab; unter Windows nur `.exe`.**

- Werkzeugsuche: PATH, dann bekannte Orte (MiKTeX `%LOCALAPPDATA%\Programs\MiKTeX\miktex\bin\x64` und `%ProgramFiles%\MiKTeX\…`, TeX Live `C:\texlive\<Jahr>\bin\windows`, macOS `/Library/TeX/texbin`, Linux `/usr/local/texlive/<Jahr>/bin/<Arch>`; Git für Windows `%ProgramFiles%\Git\cmd`). **`/usr/bin/git` wird unter macOS nie genommen** (xcode-select-Platzhalter). `distro` aus dem Pfad (`miktex`, `mactex`, `texlive`, `unknown`).
- MiKTeX unter Windows: latexmk braucht Perl; fehlt es, meldet `tools.ts` das Problem `perl`, und `launchBlocker` verweigert den Start.
- `.bat`/`.cmd` starten in Node seit dem Fix zu CVE-2024-27980 nicht mehr ohne `shell: true`; mit Shell ließen sich Pfade mit `&`, `%`, `^` nicht sicher quoten. Deshalb nur `.exe`; Skript-Funde sind ein Problem, kein Treffer.
- Start: `spawn(latexmk, [-pdf|-xelatex|-lualatex, -synctex=1, -interaction=nonstopmode, -file-line-error, -cd, <Datei>], {shell: false, windowsHide: true, detached: !windows})`; `max_print_line=10000`, `error_line=254`, `half_error_line=238` wie in Swift. Status `idle → running → (cancelling →) idle`, nie parallel (`busy`).
- Abbruch Unix: eigene Prozessgruppe, `SIGTERM`, nach 1 s `SIGKILL` an die Gruppe, beim Ende ein `SIGKILL`-Nachschlag. Windows: `%SystemRoot%\System32\taskkill.exe /PID <eigene Kind-PID> /T /F`. Nie nach Namen.
- Gemessen (macOS): Abbruch Fake-Baum 3 ms (SIGTERM-fester Enkel 1005 ms); echter Build der HgbDemo-Kopie 8,9–10,8 s, einzige Warnung `fig:fehlt`; echter Abbruch eines 40-s-Dokuments 3 ms.
- Offen (Review M4, M5, N3, M6): Windows-`cancel()` ohne Frist (Status bleibt `cancelling`), Abbruch beim Beenden der App, Dateiname mit `-` am Anfang (`./` voranstellen), Abbruchtest mit `process.kill(-pid, 0)` wirkt unter Windows nicht. Ungeprüft: taskkill-Baum, MiKTeX-Paketdialog bei „Nachfragen“ trotz `-interaction=nonstopmode`.

Alle Zahlen und der Windows-Handtest: `spikes/build/ERGEBNIS.md`.

### S5/S9 Electron-Besonderheiten und PDF-Transport

Entscheidung (W0-10, 2026-11-23, nur Mac geprüft; Windows per Handtest `TESTING.md`): **PDF per IPC laden (Main liest, `ArrayBuffer` über `contextBridge` an pdf.js `getDocument({data})`), kein eigenes Protokoll.** 11,1 MB, 400 Seiten, schnellster von 7 Läufen bis `getDocument(...).promise`: IPC 38,8 ms, `latexeditor:` mit Range 44,2 ms, ohne Range 42,5 ms (Worker vorgewärmt, Start einmalig 70–90 ms). Das Protokoll bräuchte `latexeditor:` in `connect-src`, die Rechte `standard/secure/supportFetchAPI/stream/corsEnabled`, CORS-Köpfe, `OPTIONS` und Range; die Pfadprüfung funktionierte (außerhalb, `..`, falscher Host → 403). Rückfallweg bei sehr großen PDFs. Folge: `main/pdfProtocol.ts` entfällt; der Handler `pdf:open` liefert Bytes und prüft den Pfad mit `assertInsideProject`.

Weitere Befunde:
- Sandbox + `contextIsolation` + Preload mit `webUtils.getPathForFile` funktionieren; im Renderer gibt es kein `require`/`process`/`Buffer`.
- Die strenge CSP aus `security.ts` genügt: `data:`/`blob:`-Bilder, `blob:`-Worker und der pdf.js-Worker als Modul aus dem eigenen Bundle laufen, Seite 1 wird gerendert, kein `unsafe-eval` (pdf.js mit `isEvalSupported: false`). **WebAssembly ist blockiert**; `'wasm-unsafe-eval'` nur bei Bedarf (JPX-/Farbprofil-Bilder in PDFs, Handtest W-H10).
- `denyAllPermissions` lehnt auch `navigator.clipboard.read/writeText` ab. Kopieren/Einfügen im Editor nutzt Paste-Ereignisse; für eigene Zwischenablage-Zugriffe IPC mit `clipboard` im Main.
- AltGr-Zeichen (`{ } [ ] \ @ ~ |`) und Compose-Ereignisse (IME) kommen in Textfeld und CodeMirror an (simuliert über CDP); echte Tastatur/IME, Ziehen aus dem Dateimanager und Excel-Einfügen sind Handtests.
- `getLastWebPreferences` existiert in Electron 45 nicht mehr.
- Windows-Paket (S6): `electron-builder.yml` auf NSIS je Benutzer ohne Admin eingestellt, Build nicht ausgeführt.

Prüfseite und Rohwerte: `spikes/electron-check/` (`ERGEBNIS.md`).

### S10 Dateiüberwachung

Entscheidung (W0-14, 2026-11-23): **`fs.watch(root, { recursive: true })` + eigener Entpreller, kein `chokidar`.** Auf macOS gemessen (Node 25 und Electron-Node 24.22.3): ein Stapel je Speichern (direkt und atomar), 300 Hilfsdateien in 2 s ergeben mit Filter keinen Stapel, 1000 Schreibvorgänge ohne verlorenen Namen, 5.000 Dateien im Dauerbetrieb 62 bis 72 MB, 1 ms CPU im Leerlauf, kein Wachstum.

Regeln für `main/watch.ts` (W2-2):
- 300 ms Ruhe (Höchstwartezeit 1,5 s), Menge relativer Pfade, Filter für Build-Hilfsdateien, Editor-Reste, `.git/objects`, Build-PDF.
- **Die Ereignisart (`rename`/`change`) ignorieren:** auf macOS kommt fast alles als `rename`. Neu/geändert/gelöscht per `lstat` gegen einen Index (Schlüssel `normalize('NFC')`); unbekannte, nicht mehr vorhandene Pfade (Temp-Dateien beim atomaren Speichern) verwerfen.
- Ordner-Umbenennen meldet nur alten und neuen Ordnernamen: Teilbaum neu einlesen. Groß-/Kleinschreibung: Existenz per `readdir(Elternordner)`, nicht per `stat`.
- Lesen nach Ereignis mit Wiederholung und Rückoff (OneDrive, Virenscanner); Sicherheitsnetz statt Polling: bei `build:finished`, Fenster-Fokus und Überwacher-Fehler Baum und `mtime` geöffneter Tabs prüfen.
- Ungeprüft: Windows und Linux (Handtest in `spikes/watch/ERGEBNIS.md`); `git status` und `.git`-Rückkopplung. `chokidar` nur mit Nutzer-OK nachrüsten, falls der Handtest scheitert.
- Umgebungshinweis: in der Claude-Sandbox scheitert `fs.watch` mit `EMFILE`; Messungen und Tests der Überwachung außerhalb der Sandbox ausführen.

Alle Zahlen und Tabellen: `spikes/watch/ERGEBNIS.md`.

### S8 Rechtschreibung

Empfehlung (W7-2, Spike 2026-11-26, nur macOS gemessen): **`nspell` + Hunspell-Wörterbuch `dictionary-de-at` (optional `dictionary-de`) im Web Worker über den sichtbaren Bereich, eigene Dekorationen, Filter wie Swift.** Gemessen (Electron 45.4.1, 10.000 Zeilen): sichtbarer Bereich (≈ 200 Wörter) in 1,9 ms geprüft, hin und zurück p95 2,8 ms; Tippen mit Prüfung nach jedem Tastendruck p95 9,4 ms (ohne Prüfung 2,8 ms); Aufbau im Worker ≈ 0,45 s, +55 MB Renderer-Speicher; kein Netzzugriff. Freigegeben (2026-11-26) und umgesetzt in W7-2: `nspell` 2.1.5 (MIT) und `dictionary-de-at` 3.0.0 (Daten GPL-2.0 OR GPL-3.0), `dictionary-de` nicht.

Regeln für die Umsetzung:
- Wörterbuch als eigene Dateien mit Lizenzdatei. Umgesetzt (W7-2) abweichend vom Spike ohne Main: `index.aff`/`index.dic` als Vite-Assets in `out/renderer/assets/`, der Renderer lädt sie bei der ersten Prüfung per `fetch` (`connect-src 'self'`, Anfragefilter nur unter `out/renderer`) und übergibt die Bytes ohne Kopie an den Worker. Vor `nspell(aff, dic)` alle Einträge mit dem ONLYINCOMPOUND-Flag entfernen (`spikes/spell/src/dictionaryFix.ts`): sonst lehnt nspell `gehen`, `stehen`, `prüfen` usw. ab.
- nspell kann die deutschen Kompositaregeln nicht (0 von 30 Zusammensetzungen erkannt): eigene Zerlegung (Teile bekannt, Fugenelemente, Verbstamm; 30/30 erkannt, 10/10 Tippfehler weiter gemeldet).
- Filter: Token-Überlappung (Tokenizer), `TechnicalVocabulary.accepts`, Abkürzungen mit Punkt. HgbDemo: 218 → 28 (Syntax) → 12 (Vokabular) → 6 Meldungen (Zerlegung), der Rest sind keine Wörter (Dateinamen, `lrr`). Benutzerwörterbuch im `userData`, nie das Systemwörterbuch.
- Entprellt prüfen, veraltete Antworten verwerfen, Anfangszustand aus dem `LineStateCache`, Vorschläge (`suggest`, 3–66 ms) nur auf Anforderung.
- `webPreferences.spellcheck: false` bleibt, zusätzlich `session.setSpellCheckerEnabled(false)`.

Verworfen: Chromium-Prüfung (`spellcheck="true"`). Unter Windows/Linux lädt sie Hunspell-Wörterbücher aus einem Google-CDN (Basis-URL änderbar, `file://` undokumentiert, ob `webRequest` den Download sieht, ungeprüft). Unter macOS ist die Sprache nicht wählbar (`en-GB` blieb), geladener Text wird nicht geprüft, nur getippter, und `\textit` meldet `textit`. Ein Syntaxfilter ginge zwar über `spellcheck="false"`-Spans, einen Vokabularfilter gibt es nicht. `webFrame.setSpellCheckProvider` sieht nur Einzelwörter ohne Lage und läuft im Hauptthread.

Umsetzung W7-2: `core/spelling/` (Wortextraktion, Prüfstufen, Worker-Logik), `workers/spell.worker.ts`, `app/spellClient.ts` (lazy, veraltete Antworten verfallen, Ladefehler → Statusleiste), `editor/spell.ts` (Viewport ± 30 Zeilen, 250 ms, eigener `LineStateCache` statt 50 Zeilen Vorlauf, Kontextmenü), Benutzerwörterbuch `spell:words`/`spell:addWord` im Main. Zusätzlich zum Spike ausgelassen wie die macOS-Prüfung: Wörter mit Ziffern, Großbuchstaben nach dem ersten Buchstaben, URLs, E-Mail, Dateinamen, Bezeichner mit `_`, Reste an Akzent-Befehlen (`M\"uller`); Bindestrich-Wörter als Ganzes, sonst je Teil. Sprache bleibt de-AT (die Einstellung `spellingLanguage` wirkt in der Web-Version noch nicht). Ungeprüft: Windows/Linux (W-H27, W-H28), Tipp-Latenz mit Prüfung in der App. Alle Zahlen: `spikes/spell/ERGEBNIS.md`.

## Review M0

Review durch einen Opus-Agenten (W0-R, 2026-11-23): Befunde H1–N12 mit Stand der Einarbeitung und die Liste der nötigen Plan-Änderungen in `REVIEW-M0.md`. Wichtigste Folgen für die Architektur: Der Main hält die Pfad-Gewährungen (Renderer kann keine Pfadherkunft behaupten, H1), `main/pdfProtocol.ts` und das Protokoll `latexeditor:` entfallen, `file:` nur unter dem App-Ordner, DevTools nur unverpackt, Single-Instance-Lock, S2 unter CSP und mit Hauptthread-Rendern nachmessen (H2, W3-3a). Eingearbeitet in `shared/PLAN-WEBUI.md` und `shared/FEATURES.md`.

## M1 Editor-Kern

Stand 2026-11-24 (W1-D). Dateien unter `src/renderer/editor/` (CodeMirror), `src/renderer/stores/`, `src/shared/core/` (reine Logik), Vertrag in `src/shared/contract.ts`. Befunde und Stand der Einarbeitung: `REVIEW-M1.md`.

### Sitzungen (`editor/session.ts`, `stores/editor.ts`)

| Thema | Regel |
|---|---|
| Text | lebt nur im `EditorState` der `EditorSession`; im Store stehen Pfad (Schlüssel), Name, Kodierung, `eol`, `hash`, `isDirty`. Ganzer Text entsteht nur beim Speichern (`snapshotForSave`, danach `markSaved`) |
| Ein View | `SessionView` hält den einen sichtbaren `EditorView` und tauscht beim Tabwechsel mit `view.setState(session.state)`; Undo, Auswahl und Scrollposition bleiben in der Sitzung. Folge: `setState` baut alle ViewPlugins neu, also je Tabwechsel ein neuer `LineStateCache` (offen: Cache je Sitzung halten, REVIEW-M1 M1) |
| `isDirty` | Änderungszähler (`revisionField`): jede Textänderung bekommt eine neue Nummer; Rückgängig/Wiederholen stellen sie über `invertedEffects` wieder her. „Geändert“ = aktuelle Nummer ≠ Nummer beim letzten Speichern. Rückgängig bis zum gespeicherten Stand macht den Tab also wieder „sauber“ |
| Externe Änderung | `reloadFromDisk(file)` → `replaceText` mit `minimalReplacement`: nur der Teil zwischen gemeinsamem Anfang und Ende wird ersetzt (ein eigener Undo-Schritt), Auswahl und Scrollposition bleiben; danach gilt der Stand als gespeichert |
| Zeilenenden | `EditorState.lineSeparator` je Datei aus `eol` (Compartment); Eingefügtes mit fremden Zeilenenden wird in echte Umbrüche verwandelt. Der Renderer hält immer LF-Text |
| Umbenennen | `relocate(newPath, newName)` tauscht Schlüssel, Namen und die Einfärbung (Endung `.bib` ↔ `.tex`); Einklappen und Diagnose bleiben bei alter Sprache und `docId` (offen: `featureExtensions` in ein Compartment, REVIEW-M1 N5) |
| Schlüssel | `path` ist ein `FileTarget` (Projektpfad oder `GrantId`); Titel, Statusleiste, Sprache und Diagnose nutzen `name` (REVIEW-M1 H1) |

### Einfärbung (`editor/language.ts`, `editor/lineStateCache.ts`)

`LineStateCache` (ohne DOM, Vitest `lineStateCache`) hält den Tokenizer-Endzustand je Zeile und rechnet nach einer Änderung (`LineSplice`) nur bis zur Zustandskonvergenz neu. `language.ts` ist das `ViewPlugin` darüber: Dekorationen (nur CSS-Klassen `cm-syntax-*`, Farben aus dem Schema) entstehen nur für den sichtbaren Bereich; synchron wird höchstens `SYNC_MARGIN_LINES` = 200 Zeilen hinter den Sichtbereich nachgerechnet, der Rest im Leerlauf (`IDLE_CHUNK_LINES` 500, Frist 200 ms, Handle bei `destroy` freigegeben). Sprache nach Endung (`core/language.ts`: `.bib` → BibTeX, sonst LaTeX), im selben Mechanismus.

### Einklappen (`editor/folding.ts`, `core/latex/foldRegions.ts`)

Eigenes `StateField` mit `FoldState` (Bereiche wandern mit Änderungen, Bearbeitung im Zugeklappten klappt auf, `adjustedSelection`, `generation`) und `Decoration.replace` (Platzhalter „⋯“) statt `codeFolding`/`foldService`; eigene Gutter-Spalte (Pfeile ▸/▾). Der Text bleibt unverändert. Scan 300 ms nach der letzten Änderung auf dem Hauptthread (`FOLD_SCAN_DELAY_MS`; gemessen 5,6 ms bei 10.000 Zeilen, Worker-Anschluss `FoldScanOptions.scan` falls nötig, M2). Tasten: macOS ⌥⌘←/→ (mit ⇧ alles), sonst Akkord Strg+K, dann Strg+←/→ bzw. Strg+0 / Strg+J.

### Zeilenleiste (`editor/gutter.ts`)

Zeilennummern, aktuelle Zeile, Markierungsspalte mit Formen (Kreis Fehler, Dreieck Warnung, Raute Hinweis, Git-Streifen) und Tooltip. Marken liegen als Dokumentpositionen im `StateField` und wandern per Änderungsabbildung mit; die Breite hängt nie vom Scrollstand ab (feste Spalte, `overflow: hidden`).

### Diagnose (`editor/diagnostics.ts`, `workers/analysis*.ts`)

`diagnosticsField` hält Version und Dekorationen im `EditorState` der Sitzung. `DiagnosticsDriver` entprellt **in der Erweiterung** 0,6 s (`ANALYSIS_DEBOUNCE_MS`, bevor der Text als Zeichenkette entsteht; der Client selbst bekommt `debounceMs: 0`) und fragt über den geteilten `DiagnosticsHub` den `AnalysisClient` an; der `analysis.worker.ts` führt `analysisLogic.ts` aus (Syntaxprüfer, doppelte Labels). Antworten mit veralteter Version werden verworfen. Ohne offene Sitzung beendet der Hub den Worker nach 30 s. Darstellung: rot gestrichelt (Fehler), orange strichpunktiert (Warnung, per `repeating-linear-gradient`-Farbverlauf), blau gepunktet (Hinweis); Meldung als Tooltip. Offen: Hub reicht Worker-Fehler nicht an die Oberfläche (REVIEW-M1 N6).

### Tippen (`editor/typing.ts`, `core/textEditing.ts`)

Die Logik liefert ein `TextEdit`, angewendet als genau eine Transaktion (ein Undo-Schritt, `userEvent` je Art; nur Tippen und Rückschritt verbinden sich mit Nachbarn). Sie sieht nur ein **Fenster um die Auswahl** (`WindowProfile`: z. B. Zeilenblock 1 davor/2 danach, Enter mit 50.000 Zeichen Vorschau), nie das ganze Dokument. **IME-Schutz:** bei laufender Komposition (`isImeActive`) greift nichts ein. Tasten (`Mod` = Strg, macOS ⌘; ohne Strg+Alt wegen AltGr): Backspace, Enter, Tab/⇧Tab, Strg+/ Kommentar, Alt+↑/↓ verschieben, ⇧Alt+↑/↓ doppeln, ⇧Strg+K Zeilen löschen, ⇧Strg+B fett, Strg+I kursiv, ⇧Strg+M Schreibmaschine. Ein-/Ausrücken: Strg+]/[ (macOS ⌘]/⌘[) über den CodeMirror-Standard `indentMore/Less`, `typingCommands.indent` hat keine eigene Taste.

### Einstellungen (`shared/settingsSchema.ts`, `main/settings.ts`, `stores/settings.ts`)

Schema (Schlüssel, Standard, Bereich) liegt in `shared`, damit Main (Prüfung) und Renderer (Standardwerte bis zum Laden) es teilen. `SettingsService` im Main: JSON im `userData`-Ordner, je Schlüssel validiert (Fehlendes/Ungültiges → Standard), unlesbare/neuere Datei beiseitegelegt, atomar und entprellt gespeichert; `settings:set` lehnt Schlüssel wie `__proto__` ab. Der Store (`createSettingsStore`) lädt per `settings:get`. `appearanceController` berechnet daraus Darstellung und schickt nur Geändertes als `reconfigure` an die Compartments (`themeCompartment`, `wrapCompartment`, `displayCompartment`, `typingCompartment`); ein Wechsel baut keine Sitzung neu auf.

### Farbschemata (`editor/theme.ts`, `themeController.ts`)

Vier Schemata (`standard`, `classic`, `solarized`, `highContrast`) je hell/dunkel nach `prefers-color-scheme`; Syntaxfarben als `<style>` mit `cm-syntax-*`-Regeln und CSS-Variablen, CodeMirror-Theme über das Compartment. Kontrast als Vitest-Test (`theme.test.ts`).

### Gewährungen und Dateizugriff (`main/grants.ts`, `handlers/`)

Der Renderer kann dem Main nie eine Pfadherkunft behaupten (REVIEW-M0 H1): Dialoge (`dialog:pickFiles`, `dialog:saveAs`, `dialog:openProject`) liefern `GrantedPath {grantId, name}`; `GrantStore` vergibt eine Kennung je normalisiertem Pfad (Arten sammeln sich: `pickedFile`, `saveTarget`, `importSource`). `fs:readText/readMany/writeText` nehmen ein `FileTarget` (Projektpfad oder `GrantId`; beide überschneiden sich nicht) und antworten mit dem geschickten Ziel in `path` und dem Anzeigenamen in `name`. Gewährte Ziele werden vor dem Schreiben per `resolveRealPath` aufgelöst (Symlink bleibt erhalten). Die Handler stehen in `main/handlers/*` und werden in `appHandlers.ts` verdrahtet; alle übrigen Kanäle bleiben Platzhalter.

### Schließen-Schutz (`main/lifecycle.ts`, `app/closeFlow.ts`, `ui/CloseConfirmDialog.tsx`)

`CloseGuard` (Zustände `open` → `asking` → `confirmed`): `win.on('close')` und `before-quit` (⌘Q, Dock-Beenden) rufen `preventDefault` und senden `app:closeRequested`. Der Renderer (`closeFlow`) bestätigt sofort ohne Ungespeichertes, sonst fragt der Dialog „Speichern / Nicht speichern / Abbrechen“; erst `app:confirmClose` lässt den Main `destroy()` aufrufen. „Abbrechen“ lässt das Fenster offen (der Main erfährt es nicht, ein erneutes Schließen fragt wieder). Ohne Fenster, bei abgestürztem oder noch ladendem Renderer und mit Stub-Preload fragt der Main nicht (`requestCloseConfirmation` liefert `false`, gilt als bestätigt). Offen: Wiederherstellungsdaten beim „Nicht speichern“ (W2-14).

### Zeilenenden, BOM, Kodierung (Regel aus `main/textIo.ts`)

- Lesen: UTF-8 strikt, sonst Latin-1; ein BOM bleibt als U+FEFF am Textanfang (`ignoreBOM`) und wird beim Speichern mitgeschrieben. `eol` entscheidet die Mehrheit (CRLF gegen einzelnes LF, bei Gleichstand LF). Ein einzelnes CR ist kein Zeilenende und bleibt Zeichen; nur echte Paare `\r\n` werden zu LF (`"\r\r\n"` → CR als Zeichen plus Umbruch).
- Schreiben: Der Renderer schickt LF-Text, jedes LF wird zu `eol`. Gemischte Dateien werden damit auf die Mehrheit vereinheitlicht (bewusst: eine Datei, ein `eol`). Atomar (Temp + `rename`, Wiederholung bei `EBUSY`/`EPERM`/`EACCES`), Konflikt bei fremdem `expectedHash`.
- Text, der in Latin-1 nicht darstellbar ist, wird beim Speichern abgelehnt (`notRepresentable`).

### Testzugang und Stub-Preload

- `window.__editorTestApi` (`EditorHost.tsx`: `open`, `activate`, `close`, `text`, `selection`, `select`, `isDirty`, `setGutterMarks`) entsteht nur im Build `--mode e2e` (`.env.e2e`, `RENDERER_VITE_EDITOR_TEST_API=1`); `electron.vite.config.ts` entfernt die Variable in jedem anderen Modus, `scripts/checkNoTestApi.mjs` bricht `npm run package` ab, wenn die Zuweisung im Renderer-Build steht.
- Der Stub-Preload (`preload/stub.ts`, Antworten aus `tests/support/preloadStub.ts`) wird nur unverpackt und nur mit `LATEXEDITOR_STUB_PRELOAD=1` gewählt (`main/preloadChoice.ts`); `stubContract.test.ts` prüft, dass Stub und Main gleich geformt antworten.

## Performance-Budgets M1

Stand 2026-11-24 (W1-13). Gemessen am fertigen Editor mit allen Erweiterungen (Syntaxfarben, Gutter, Einklappen, Diagnose mit Worker, Tippen, Suche) und 10.000 Zeilen synthetischem LaTeX (`tests/perf/syntheticDocument.ts`, fester Seed, ohne Inhalt aus der Thesis; Absätze, Formeln, Umgebungen, Kommentare, Abschnitte, ein doppeltes Label und eine nicht geschlossene Klammer für die Diagnose). Rechner: Intel-Mac (i9, 8 Kerne, 2,3 GHz, 16 GB), macOS 26.7.1, Electron 45.4.1, Stub-Preload, Fenster nicht verdeckt.

Aufruf: `npm run build:e2e`, dann `npm run test:perf` (= `node scripts/test-run.mjs --perf`, ohne Bash-Sandbox), danach wieder `npm run build`. Der normale `--e2e`-Lauf enthält die Messung nicht (eigene Konfiguration `tests/perf/playwright.perf.config.ts`, Dateimuster `*.perf.spec.ts`). Budgets: `tests/perf/budgets.ts`, Plausibilitätsprüfung `tests/unit/perfBudgets.test.ts`. Ein überschrittenes Budget macht den Test rot; erst die Ursache suchen, nicht das Budget erhöhen.

Methode:
- 5 Läufe, jeder mit frischem Electron (Öffnen ist damit „kalt“); je Messung zählt der schnellste Lauf (kleinster p95), Streuung = p95 des schlechtesten Laufs. Chromium-Schalter wie im Spike S1 (`--disable-frame-rate-limit`, `--disable-gpu-vsync`, kein Hintergrund-Drosseln), damit „bis zum Rahmen“ die Arbeit misst und nicht das Warten auf den Rahmentakt.
- Tasten sind echte Tastaturereignisse über Playwright (`keydown` → Eingabebehandlung von CodeMirror), 100 Wiederholungen mit 40 ms Pause, zwei Aufwärmtasten für den Sprung zum Cursor. Messwert „Arbeit“ = `keydown` bis Ende der synchronen Verarbeitung plus Rahmenarbeit bis nach dem Paint (Methode des Spikes). Die Latenz (Taste bis Paint) ist nur 0,0 bis 0,1 ms höher, der Rahmentakt stört also nicht.
- Öffnen: `open` + `activate` bis nach dem Paint des ersten Rahmens. Scrollen: 120 Rahmen zu je 400 px, Arbeit je Rahmen. Suchen: Strg+F, Suchbegriff tippen, Enter bis nach dem Paint des Rahmens, in dem der Cursor am Treffer steht; der Treffer steht in Zeile 9.500 (Worst Case, Cursor am Anfang). Einklapp-Scan: Überschrift in den sichtbaren Text einfügen; Messwert = Beginn der Scan-Aufgabe (längste Lücke einer Nachrichtenschleife nach der Entprellung von 300 ms) bis nach dem Paint der neuen Einklapp-Marke.

| Messung | Messwert p50 / p95 (schnellster Lauf, ms) | Streuung p95 (5 Läufe) | Budget p95 (ms) |
|---|---|---|---|
| Öffnen (Dokument setzen bis erster Rahmen) | 42,5 | 42,5–47,6 | 200 |
| Tastendruck mittig | 4,2 / 4,6 | 4,6–4,8 | 16 |
| Tippen am Anfang | 3,4 / 3,5 | 3,5–3,6 | 16 |
| `$` tippen (öffnet Mathe bis Absatzende) | 5,2 / 5,4 | 5,4–5,5 | 16 |
| Enter einfügen (Zeilen verschieben) | 7,2 / 8,0 | 8,0–8,1 | 16 |
| Scrollen (Rahmenzeit, Arbeit) | 5,4 / 6,8 | 6,8–7,4 | 20 |
| Suchen (Enter bis erster Treffer, Treffer ganz hinten) | 80,5 | 80,5–84,2 | 250 |
| Einklapp-Scan nach Änderung (bis Folgerahmung) | 5,6 | 5,6–6,0 | 20 |

Budgets: etwa das Dreifache des Messwerts, mindestens die Zielwerte des Spikes (Tastendruck p95 < 16 ms, Öffnen < 200 ms). Enter hat wegen der 16 ms nur zweifachen Puffer (3 × 8,0 ms wären 24 ms). Zusatzwerte: Scroll-Rahmenabstand p95 7,9 ms, Scan-Aufgabe (nur der Scan) 5,6 ms, größter Einzelwert bei Enter 12,8 ms.

Befunde:
- Kein Engpass gegen die Ziele: Mit allen Erweiterungen liegen Tippen (3,5 bis 8,0 ms) und Scrollen (6,8 ms) auf dem Niveau des Spikes ohne Erweiterungen (3,5 ms bzw. 8 bis 10 ms), `$` mit 5,4 ms ebenfalls.
- Auffällig, aber im Budget: Enter kostet mit 8,0 ms etwa das Doppelte eines Zeichens (Zeilen verschieben, Marken, Einklapp-Bereiche und Prüfmeldungen werden abgebildet; Einzelwerte bis 12,8 ms). Die Suche nach einem Treffer am Dateiende braucht rund 80 ms (vermutlich durchsucht `@codemirror/search` den Text auf dem Hauptthread in einem Rutsch; Ursache nicht weiter untersucht).
- Der Scan der Einklapp-Bereiche (5,6 ms) läuft auf dem Hauptthread, ist bei 10.000 Zeilen aber weniger als ein Rahmen; bei sehr großen Dateien wäre `FoldScanOptions.scan` der Anschluss für einen Worker.
- Ungemessen: Windows (Handtest W-H14), echte IME-Eingabe, mehrere Dateien gleichzeitig offen, 50.000 Zeilen, dunkles Farbschema (kein Einfluss erwartet).
