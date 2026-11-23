# Spike S2: pdf.js-Textebene für Markierungsanker (W0-7)

Frage: Liefert pdf.js (`pdfjs-dist` 6.5.438, Electron 45.4.1 / Chromium 156, macOS, DPR 2) Zeichenlagen, mit denen der
Ablauf aus `MarkResolver` (SyncTeX-Rechteck → Zeichen darin → Wörter 3/2/1 → Zeilenrechtecke) wortgenau funktioniert?

**Antwort: ja, aber nicht über die gerenderte Textebene (`TextLayer` + `Range`), sondern über `getTextContent` plus
Glyphbreiten der eingebetteten Schrift (Variante `fontSpaces`).** Ziel < 30 ms je Seite klar erreicht.

## Aufbau

- Testdaten (nur in `$TMPDIR/s2-pdftext/`): Kopie von `shared/Testdaten/HgbDemo` (11 Seiten) und `testdoc/s2test.tex`
  (2 Seiten: Ligaturen fi/fl/ff/ffi/fff, Umlaute/ß, Blocksatz über mehrere Zeilen, Mathe im Text und abgesetzt,
  Silbentrennung in schmaler `minipage`, Fußnote, Auszeichnung, Anführungszeichen, Tabelle, Liste). Beide mit
  `latexmk -pdf -synctex=1`, T1-Schriften (cm-super bzw. lmodern), `microtype` im Testdokument.
- 41 Testmarkierungen in `marks.json`: Quellzeile Anfang/Ende und der markierte Text, von Hand aus Quelltext und
  PDF festgelegt. Anker-Wörter wie `MarkCreator`: erste/letzte 3 Wörter, `MarkText.tokens`-Normalisierung (NFKC, klein).
- SyncTeX-Rechteck: `synctex view` (CLI, nur im Spike) → Vereinigung aller Zeilenboxen der Quellzeile auf der ersten
  Seite wie `SyncTeXIndex.forward`; Box = `h, v−H, W, H` (v = Grundlinie + Tiefe, H = Höhe + Tiefe).
- Wahrheit doppelt: (1) der von Hand festgelegte Text muss genau überdeckt sein, (2) unabhängige Geometrie aus PDFKit
  (`reference/pdfkitReference.swift`, gleiche Logik wie `MarkResolver`, eigenständig nachgebaut). `pdftotext` ist nicht
  installiert.
- Messseite in Electron (`src/main.mts`, `page.html`, `src/page.mts`), gestartet über Playwright `_electron.launch`
  mit der installierten Electron-Binärdatei. 7 Wiederholungen, je Seite der schnellste Lauf.

Varianten (`src/geometry.mts`):

| Variante | Zeichenlage |
|---|---|
| `textLayer` | `TextLayer` rendern, je Zeichen `Range.getBoundingClientRect()` (Ersatzschrift des Browsers, Span auf Stückbreite gestreckt) |
| `uniform` | `getTextContent`: Transform + `width` / Zeichenzahl |
| `fontMetrics` | `getTextContent` + `measureText` mit der eingebetteten Schrift (FontFace `item.fontName`), auf `width` gestreckt |
| `fontSpaces` | wie `fontMetrics`, Glyphen in echter Breite (Schriftgröße aus Transform), der Rest der Stückbreite nur auf Leerzeichen |

## Ergebnis

39 der 41 Markierungen hat PDFKit wortgenau zugeordnet; t14 und t22 fallen dort auf Zeilen zurück (siehe unten).

| Variante | ≤ 1,5 pt zu PDFKit | ≤ 2 pt | ≤ 3 pt | Text genau überdeckt | ms/Seite Mittel | ms/Seite max | davon `getTextContent` | alle 13 Seiten, 7 Läufe min–max |
|---|---|---|---|---|---|---|---|---|
| `textLayer` | 26/39 (67 %) | 31/39 | 32/39 | 40/41 | 2,27 | 7,5 | 0,71 | 31–69 ms |
| `uniform` | 16/39 (41 %) | 23/39 | 26/39 | 40/41 | 0,48 | 1,7 | 0,46 | 7–10 ms |
| `fontMetrics` | 33/39 (85 %) | 35/39 | 39/39 | 40/41 | 0,88 | 3,1 | 0,51 | 12–40 ms |
| **`fontSpaces`** | **34/39 (87 %)** | **39/39 (100 %)** | 39/39 | **40/41** | **0,86** | **3,0** | 0,48 | 12–14 ms |

- „Text genau überdeckt“: Die gefundenen Wörter und alles dazwischen ergeben exakt den Text aus `marks.json`. Einzige
  Ausnahme in allen Varianten ist t22 (Wörter in der Fußnote, Quellzeile = Absatzzeile mit `\footnote`): Rückfall
  auf Zeilen, **genau wie PDFKit/Swift**.
- t14 (`… hat genau eine Nullstelle`): pdf.js trifft Text und beide Zeilen; PDFKit fällt zurück, weil die Referenz
  Mittelpunkte der Auswahl-Rechtecke (volle Zeilenhöhe) nimmt und die zweite Zeile knapp außerhalb des SyncTeX-
  Rechtecks liegt. Artefakt der Referenz, nicht von pdf.js.
- Wortgenau im Sinne von M5 (richtige Wörter, Ränder unter einem halben Wortabstand ≈ 2 pt bei 11 pt):
  `fontSpaces` 40/40 Markierungen mit Wörtern, also ≥ 95 %. Mit der strengen Grenze 1,5 pt 87 %; die Reste
  (1,5–1,9 pt: Mathe abgesetzt, Anführungszeichen, Zeilenanfang nach Umbruch, Listenpunkt) können ebenso Ungenauigkeit
  der PDFKit-Referenz sein (Auswahl-Rechtecke enthalten Seitenabstand/Teile der Leerzeichen).
- Zuordnen aller 41 Markierungen auf fertiger Geometrie: 1,1–1,7 ms. Rendern der 13 Seiten ins Canvas (nötig, damit
  die Schriften geladen sind, im Viewer ohnehin): 354 ms gesamt, nicht in den Seitenzeiten enthalten.
- Streuung: andere Agenten liefen parallel; der erste Lauf ist jeweils langsamer (Worker, JIT), z. B. `fontMetrics`
  39,6 ms gegen 12–15 ms danach, `textLayer` 68,8 ms gegen 30–47 ms.

## Entscheidung

`pdf/textGeometry.ts` (W5-4) baut die Zeichenrechtecke aus **`page.getTextContent()` + Glyphbreiten der eingebetteten
Schrift** (Variante `fontSpaces`), nicht aus der DOM-Textebene. Rückfall je Textstück, wenn die Schrift nicht geladen ist:
gleichmäßige Breite (`uniform`); ohne Treffer bleibt wie in Swift die Zeile (`Precision.lines`).

## Empfehlung für `pdf/textGeometry.ts`

1. Je Seite einmal `getTextContent()` (Standard-Normalisierung lassen: Ligaturen kommen als „fi“, „ffi“ usw.),
   Ergebnis je PDF-Stand zwischenspeichern (Schlüssel: Datei + mtime/Größe, Seite).
2. Je Textstück: Grundlinie und Größe aus `transform` (`[a,b,c,d,e,f]`, x = e − view[0], y oben = view[3] − f);
   Glyphbreite = `measureText(zeichen).width` mit `font = "100px \"" + item.fontName + "\""` × hypot(a, b) / 100;
   Leerzeichen bekommen den Rest von `item.width` (Blocksatz). Bei `hasEOL` ein `\n` ohne Lage einfügen.
3. Eingebettete Schriften müssen als FontFace im Dokument liegen: `getDocument({ …, disableWorkerRendering: true })`
   und die Seite (oder eine Seite mit denselben Schriften) muss gerendert worden sein; vorher
   `document.fonts.check(font)` prüfen, sonst `uniform`-Rückfall und nach dem Rendern neu berechnen.
4. Text der Seite = Verkettung der `str` ohne zusätzliche Trenner (pdf.js liefert Leerzeichen selbst); Wörter mit
   `[\p{L}\p{N}\p{M}]+` und NFKC + `toLowerCase()` wie `MarkText`.
5. Zeilen bilden: Zeichen in Lesereihenfolge, neue Zeile, sobald ein Zeichen die laufende Zeile senkrecht nicht mehr
   überlappt; Leerzeichen nicht mitzählen (sonst ragt das Rechteck in den Wortabstand).
6. Die gerenderte `TextLayer` bleibt für Auswahl und Kopieren; für die Lage von Markierungen nicht verwenden.

Code-Vorlage: `src/geometry.mts` (`fontSpacesGeometry`), `src/matcher.mts` (Nachbau von `MarkResolver`).

## Stolpersteine

- **`TextLayer` ist ungenau** (bis 4,9 pt): Spans nutzen die Ersatzschrift des Systems (`sans-serif`/`serif`) und
  werden nur als Ganzes auf die PDF-Breite gestreckt. Auf Windows (Arial statt Helvetica) wäre das Ergebnis anders;
  die eingebettete Schrift ist plattformunabhängig.
- **`uniform` ist zu grob**, weil pdf.js ganze Zeilenstücke mit mehreren Wörtern liefert.
- **Blocksatz**: Ohne Sonderbehandlung der Leerzeichen streut `fontMetrics` stärker (40 % der Stücke weichen > 2 %
  von `item.width` ab, Median 0,984); der Rest gehört den Wortabständen.
- **PDFKit-Befund (Swift, nur in der Referenz nachgestellt, nicht in der App geprüft):** `PDFPage.characterBounds(at:)`
  und `page.string` laufen nach Ligaturen auseinander (im Testdokument um ~17 Zeichen ab der Mitte des ersten
  Absatzes). `MarkResolver.characterCenters` nutzt genau diese Kombination; auf Seiten mit vielen Ligaturen könnten
  Swift-Markierungen auf Zeilen zurückfallen oder verrutschen. `page.selection(for: NSRange)` liegt im Indexraum von
  `string` und war richtig. Prüfen lohnt sich (eigene Aufgabe in `swift/`).
- Fußnote: Die Quellzeile mit `\footnote{…}` hat ein SyncTeX-Rechteck vom Absatz bis zur Fußnote; Wörter der Fußnote
  werden in beiden Versionen nicht gefunden (Rückfall auf Zeilen).
- Mathe: Wörter aus Formeln (`f (x) = x2 + 2x`) werden gefunden, weil pdf.js wie PDFKit Unicode liefert; abgesetzte
  Formeln haben zerstreute Lesereihenfolge (Grenzen, Bruch), dort ±1,5 pt.
- Silbentrennung: Der Trennstrich bleibt im Text (`kur-` / `sives`), die Wörter des Ankers enthalten die Hälften.
  Konsistent, solange die Anker aus dem PDF stammen (wie in `MarkCreator`).
- Electron startet nicht in der Bash-Sandbox von Claude Code (Seatbelt); Läufe nur ohne Sandbox.
- Das Messfenster ist unsichtbar (`show: false`, `backgroundThrottling: false`).

## Ungeprüft

- Windows und Linux; HiDPI 150 %; andere Zoomstufen (`textLayer` mit `scale` 1,5 gemessen, die anderen sind zoomfrei).
- Rendern im Worker (Standard von pdf.js 6 mit OffscreenCanvas): Dort landen die FontFaces vermutlich nicht im
  Dokument; mit `disableWorkerRendering: true` gemessen.
- Type3-/Bitmap-Schriften, Fremd-PDFs (nicht pdfTeX), mehrspaltiger Satz, gedrehte Seiten, `lualatex`/`xelatex`.
- Größere Dokumente (hier 13 Seiten, wenige Zeichen je Seite); die Zeit wächst linear mit den Zeichen.
- Der SyncTeX-Teil lief über die CLI, nicht über den TS-Parser (S3).
- Markierungen über Seitengrenzen (Code vorhanden, kein Testfall).

## Ausführen

```
cd web
node_modules/.bin/tsc -p spikes/pdf-text/tsconfig.json     # baut nach spikes/pdf-text/build/*.mjs
node spikes/pdf-text/build/run.mjs 7                       # 7 Wiederholungen; außerhalb der Claude-Sandbox
```

Der Lauf kopiert und kompiliert die Testdokumente in `$TMPDIR/s2-pdftext/`, baut die PDFKit-Referenz mit `swiftc`
(einmalig, ~80 s) und schreibt `results/results.json` und `results/table.md` (Einzelwerte je Markierung).
Ohne eigenes `package.json`: alle Quellen sind `.mts`, damit Node und Electron sie als ESM laden.
