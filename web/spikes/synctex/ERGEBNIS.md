# Spike S3: SyncTeX in Node (W0-8)

Stand 2026-11-23, macOS (Intel i9-9880H, 16 Threads), Node 25.2.1, nur Mac geprüft. Parallel liefen zwei weitere Agenten (pdf.js-Textebene, Electron-Prüfseite), deshalb ist neben dem schnellsten Wert die Streuung angegeben.

## Entscheidung

**Eigener TypeScript-Parser, Index in einem `worker_threads`-Worker, der die Anfragen selbst beantwortet** (kein `utilityProcess`, kein CLI-Rückfall). Der Main-Prozess schickt nur Pfad bzw. Datei+Zeile bzw. Seite+Punkt und bekommt `SyncTexForwardResult`/`SyncTexBackwardResult` aus dem Vertrag zurück.

- Logik: `src/main/synctex.ts` (Port von `swift/Sources/LatexEditor/Model/SyncTeX.swift`, gleiche Regeln: Zeile fehlt → Zeile davor, sonst danach; Blätter vor Boxen; Rechteck der umschließenden hbox; Rückwärts kleinste enthaltende Zeilenbox, sonst vertikal nächste, darin das horizontal nächste Blatt; nur `.tex`).
- Worker: `src/main/workers/synctex.worker.ts`, Anfragen `load`/`forward`/`backward` mit `id`, Antworten in Eingangsreihenfolge (Warteschlange), Fehler als `GeneralError` (`notFound`, `io`, `invalidInput`, `internal`). Schlägt `load` fehl, bleiben die alten Daten.
- Der Index ist strukturiert klonbar (Maps + typisierte Arrays). Falls W3-2 ihn doch im Main halten will, kann der Worker ihn per `postMessage` (Transfer der `ArrayBuffer`) liefern; nötig ist das nach den Zahlen nicht.
- `forward` liefert **mehrere Rechtecke** (je betroffene PDF-Zeile eins, ohne Doppelte) statt wie Swift die Vereinigung; `unionRect` ergibt das Swift-Ergebnis.

## Messwerte (250.001 Einträge synthetisch)

Datei: 923 Seiten, 20 Kapitel-Dateien, je Zeilenbox 6 Einträge (hbox, h, x, g, k, $), 7,7 MB Text, 1,0 MB gzip. Erzeugt im Test in `$TMPDIR`. Jeweils 5 Läufe; Abfragen je Lauf 1.000 (deterministisch zufällig).

| Messung | schnellster | Median | langsamster |
|---|---|---|---|
| Einlesen im Thread (`readFile` + `gunzip` + Zerlegen + Gruppieren) | 106 ms | 112 ms | 117 ms |
| Einlesen über den Worker (Rundlauf ab `postMessage`) | 102 ms | 107 ms | 208 ms |
| Größte Verzögerung eines 5-ms-Zeitgebers im Main während Worker-Einlesen | 0,70 ms | 0,74 ms | 0,85 ms |
| Vorwärtssuche je Abfrage (im Thread) | 0,004 ms | 0,004 ms | 0,007 ms |
| Rückwärtssuche je Abfrage (im Thread) | 0,003 ms | 0,003 ms | 0,006 ms |
| Vorwärtssuche je Abfrage über den Worker (Rundlauf, nacheinander) | 0,032 ms | 0,034 ms | 0,041 ms |

Erster Lauf (vor der Speichermessung) ähnlich: Einlesen 115/117/130 ms, Worker 108/114/157 ms, Verzögerung 0,7–0,9 ms.

Speicher: typisierte Arrays des Index 10,7 MB (41 Byte je Eintrag + 4 Byte je Eintrag in der Pfadgruppe). Heap+`arrayBuffers` nach erzwungener Speicherbereinigung vor/nach dem Laden: +6,1 MB; die Zahl ist unsicher (Prozess-weit, vitest im selben Prozess), die 10,7 MB sind die obere Abschätzung für die Daten.

Ohne Worker würde das Einlesen den Main also rund 110 ms blockieren (bei einer echten Arbeit mit 250.000 Einträgen bei jedem Build); mit Worker < 1 ms.

## Fixture-Abgleich

`tests/unit/synctex.test.ts` (36 Tests grün): alle Swift-Fälle aus `SyncTeXTests.swift` portiert, Referenzwerte nur abgeschrieben: 4 Vorwärts-Referenzen (Seite, linker Rand, Breite, Grundlinie im Rechteck: 16 Werte), 4 Rückwärts-Referenzen (Datei, Zeile: 8 Werte), Struktur (12 Inputs, Seiten 1–3, Magnification 1000), Leerzeile/Ende/negativ, Pfadvarianten (`./`, `/tmp` ↔ `/private/tmp`, `..`, Leerzeichen), unbekannte Datei/Seite, Hin und zurück, gzip mit Dateinamen-Feld (mit gültiger CRC, Node prüft sie), abgeschnittene/fremde Daten, unkomprimiert, CRLF. Zusätzlich Gegenprobe mit `/Library/TeX/texbin/synctex` (überspringt sich ohne): 6 Zeilen von `zwei.tex`, Seite + linker Rand vorwärts und Zeile rückwärts gleich.

`tests/unit/synctexWorker.test.ts`: Worker wird wie im Produkt gebündelt (rolldown nach `$TMPDIR`, CJS), Laden/Suchen, Fehler behält alte Daten, Main-Verzögerung < 50 ms beim Laden der 250.000er-Datei. Die Messung oben: `SYNCTEX_BENCH=1 node scripts/test-run.mjs --filter synctexWorker`, Rohwerte als Zeile `S3-ERGEBNIS {…}` in `.test-logs/last.log`.

## Windows-Pfade (lexikalisch, über `paths.ts` mit `path.win32`, unter macOS geprüft)

Geprüft mit synthetischer SyncTeX-Datei: `C:/…/./main.tex` (Schrägstriche, `./`), `c:\…` (kleines Laufwerk), Kleinschreibung im Editorpfad, Umlaut NFC/NFD (`Einführung.tex`), Leerzeichen + `..` + `.TEX`, relativer Pfad `./relativ/drei.tex` (gegen den Ordner der `.synctex.gz`), UNC `//server/share` ↔ `\\server\share`, CRLF-Zeilenenden. Rückwärts kommen Windows-Pfade mit Laufwerk groß und `\` zurück. Linux unterscheidet Groß-/Kleinschreibung.

## Stolpersteine

- **8.3-Kurznamen** (`C:\PROGRA~1\…`, z. B. wenn MiKTeX aus einem Kurzpfad aufgerufen wird) und Symlinks/Junctions löst der Schlüssel nicht auf. Wenn die echte Windows-Gegenprobe so etwas zeigt: Eingabepfade beim Laden einmal mit `resolveRealPath` (asynchron, `fs.realpath`) auflösen. Unter macOS reicht wie in Swift das Abschneiden von `/private`.
- **Kodierung der Pfade**: gelesen als UTF-8 (TeX Live). Ob MiKTeX Pfade mit Umlauten in der Systemcodepage schreibt, ist ungeprüft; ungültiges UTF-8 wird zu U+FFFD und findet die Datei dann nicht.
- Node prüft beim Entpacken CRC und Länge (Apple nicht); ein abgeschnittenes `.synctex.gz` (Build läuft noch) ergibt sicher einen Fehler → alte Daten bleiben.
- `Int32Array` schneidet Werte bei Überlauf ab (Modulo), deshalb wird vor dem Speichern explizit begrenzt (wie Swift `Int32(clamping:)`).
- Worker aus TypeScript lässt sich in Vitest nicht direkt starten (keine Transformation für `worker_threads`); der Test bündelt ihn deshalb mit rolldown. Für das Produkt muss electron-vite den Worker als eigenen Einstieg bauen (z. B. `?modulePath`-Import) – das gehört zu W3-2 (`index.ts`/Konfiguration waren hier tabu).

## Offen

- Live-Abgleich mit `synctex.exe` und echten MiKTeX-/TeX-Live-Dateien unter Windows (Laufwerk, `\`, 8.3, Umlaute).
- Main-seitiger Client (Worker starten, `id` → Promise, Neustart nach Absturz, Ereignis `synctex:ready`) und Einbindung in den Build: W3-2.
- Koordinatenumrechnung pdf.js (Media-Box, Ursprung unten links) gehört in den Renderer (`pdf/`), analog `SyncTeXCoordinates` in Swift.
