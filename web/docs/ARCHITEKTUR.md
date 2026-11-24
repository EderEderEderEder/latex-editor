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

Nebenbefund Swift (nicht in der App geprüft): `PDFPage.characterBounds(at:)` und `page.string` laufen nach Ligaturen auseinander; `MarkResolver` nutzt beides zusammen. Ungeprüft: Windows/Linux, Rendern im Worker, Type3-Schriften, Fremd-PDFs, mehrspaltiger Satz, Markierungen über Seitengrenzen. **Offen (Review H2):** `disableWorkerRendering` rendert im Renderer-Hauptthread; ungemessen gegen das Tippbudget und 300 Seiten, Spike-Seite ohne CSP → Messung W3-3a, Wiederholung unter `RENDERER_CSP` und auf Windows in W5-4.

Alle Zahlen: `spikes/pdf-text/ERGEBNIS.md`.

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

## Review M0

Review durch einen Opus-Agenten (W0-R, 2026-11-23): Befunde H1–N12 mit Stand der Einarbeitung und die Liste der nötigen Plan-Änderungen in `REVIEW-M0.md`. Wichtigste Folgen für die Architektur: Der Main hält die Pfad-Gewährungen (Renderer kann keine Pfadherkunft behaupten, H1), `main/pdfProtocol.ts` und das Protokoll `latexeditor:` entfallen, `file:` nur unter dem App-Ordner, DevTools nur unverpackt, Single-Instance-Lock, S2 unter CSP und mit Hauptthread-Rendern nachmessen (H2, W3-3a). Eingearbeitet in `shared/PLAN-WEBUI.md` und `shared/FEATURES.md`.

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
