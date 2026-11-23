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
