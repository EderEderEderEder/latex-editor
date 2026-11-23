# Architektur (web/)

## Entscheidungen aus den Spikes

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

Nebenbefund Swift (nicht in der App geprüft): `PDFPage.characterBounds(at:)` und `page.string` laufen nach Ligaturen auseinander; `MarkResolver` nutzt beides zusammen. Ungeprüft: Windows/Linux, Rendern im Worker, Type3-Schriften, Fremd-PDFs, mehrspaltiger Satz, Markierungen über Seitengrenzen.

Alle Zahlen: `spikes/pdf-text/ERGEBNIS.md`.

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

### S3 SyncTeX in Node

Entscheidung (W0-8, 2026-11-23, nur Mac geprüft): **eigener TS-Parser (`main/synctex.ts`, Port von `SyncTeX.swift`), Index in einem `worker_threads`-Worker (`main/workers/synctex.worker.ts`), der `load`/`forward`/`backward` selbst beantwortet**; kein `utilityProcess`, kein CLI-Rückfall. Fixture-Referenzwerte aus `SyncTeXTests.swift` und Gegenprobe mit dem `synctex`-CLI stimmen.

- 250.000 Einträge (7,7 MB, 1 MB gzip), schnellster von 5 Läufen: Einlesen 102–106 ms (Streuung bis 208 ms unter Last), Main-Zeitgeber-Verzögerung währenddessen < 1 ms (im Main wären es ~110 ms Blockade), Abfrage vorwärts 0,004 ms, rückwärts 0,003 ms, Rundlauf über den Worker 0,03 ms; Index ca. 11 MB typisierte Arrays.
- Pfade: Schlüssel über `paths.comparisonKey` (Trenner, `./`, `..`, Laufwerk, NFC, Groß-/Kleinschreibung je Plattform), relative `Input:`-Pfade gegen den Ordner der `.synctex.gz`, CRLF toleriert, unter macOS `/private` abgeschnitten. 8.3-Namen und Symlinks werden nicht aufgelöst (bei Bedarf `resolveRealPath` beim Laden).
- `forward` liefert je PDF-Zeile ein Rechteck (Vertrag `rects[]`), Swift vereinigt sie.
- Offen für W3-2: Main-Client und Worker als eigener electron-vite-Einstieg; Windows-Gegenprobe mit `synctex.exe`/MiKTeX (Pfadkodierung, 8.3).

Alle Zahlen: `spikes/synctex/ERGEBNIS.md`.
