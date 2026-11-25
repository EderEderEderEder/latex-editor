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
- ~~Rendern im Worker~~ und CSP: in W3-3a geprüft (Abschnitt unten): FontFaces liegen auch mit Render-Worker im
  Dokument, Ergebnis unter `RENDERER_CSP` identisch. Die Seite `page.html` (Import-Map inline) läuft nur ohne CSP;
  unter CSP gilt `csp/` (gebündelt).
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

## W3-3a: Hauptthread-Rendern unter `RENDERER_CSP` (2026-11-25)

Frage (Review H2): Stört `disableWorkerRendering: true` (Seiten im Renderer-Hauptthread) das Tippen, trägt es 300 Seiten,
und gilt S2 auch unter der echten CSP? **Antwort: ja, Hauptthread genügt; der Render-Worker von pdf.js 6.5 bringt nichts.**

Rechner: Intel-Mac i9-9880H (8 Kerne, 2,3 GHz), macOS 26.7.1, Electron 45.4.1 / Chromium 156, pdf.js 6.5.438, DPR 2.
Windows: Handmessung W-H17 in `TESTING.md` (offen).

### Aufbau (`csp/`)

- `csp/main.ts`: Fenster wie im Paket, Sicherheit unverändert aus `src/main/security.ts` (`installRequestFilter` mit
  `file:` nur unter `csp/out/`, `onHeadersReceived` mit `PACKAGED_CSP_HEADER`, `denyAllPermissions`, `lockNavigation`);
  im `<meta>`-Tag exakt `RENDERER_CSP`. **Keine Lockerung der CSP.** Der CSP-Kopf kam an allen 25 `file:`-Antworten an
  (Seite, CSS, `page.js`, beide Worker-Skripte, cmaps/standard_fonts/wasm), gilt also auch für die Worker.
- `csp/src/`: Editor mit den Erweiterungen der App (Einfärbung, Zeilenleiste, Einklappen, Tippen, Suche, Darstellung;
  ohne Diagnose-Worker) und dem 10.000-Zeilen-Dokument aus `tests/perf/syntheticDocument.ts`; pdf.js aus dem Bündel,
  `pdf.worker.min.mjs`, `pdf.renderer.min.mjs`, `cmaps/`, `standard_fonts/`, `wasm/`, `iccs/` neben der Seite;
  `PDFViewer` aus `pdfjs-dist/web/pdf_viewer.mjs` mit Textebene; S2 (`src/page.mts`) im selben Bündel.
- Testdokument: Kopie von `shared/Testdaten/HgbDemo` in `$TMPDIR/w33a/HgbDemo300`, `long.tex` wiederholt die vier
  Kapitel 56-mal → **303 Seiten, 595 KB** (pdfTeX, Schriften und Bild geteilt; echte Arbeiten mit vielen Bildern sind
  größer). `latexmk` nur auf der Kopie.
- Tippen: 120 echte Tastendrücke über Playwright (`keyboard.type`, 40 ms Abstand), Cursor in Zeile 5.000; je `keydown`
  ab `event.timeStamp` gemessen: Eingangsverzug (bis der Hauptthread das Ereignis annimmt) und Taste bis nach dem
  Paint (rAF + MessageChannel wie `tests/perf`). Last: pdf.js rendert **ohne Pause** eine Seite nach der anderen
  (650 CSS-px breit × DPR) und baut je Seite `getTextContent` + `fontSpacesGeometry` (Worst Case; in der App rendert
  der Viewer nur nach Build/Scrollen). 3 Runden je Last, Läufe ohne Rahmentakt (`--disable-frame-rate-limit`,
  `--disable-gpu-vsync` wie `tests/perf`, misst Arbeit) und mit Rahmentakt (`--vsync`, misst gefühlte Latenz).
- Scrollen: `PDFViewer` (Seitenbreite, ~940 px je Seite) gleichmäßig mit 8.000 px/s von oben bis unten
  (285.000 px, 35,6 s, ≈ 8,5 Seiten/s), Rahmenabstände per rAF; danach 7 Sprünge auf ferne Seiten (wie SyncTeX
  vorwärts) bis nach dem Paint; Speicher per `app.getAppMetrics()` (Working Set) alle 500 ms. 2 Runden je Modus.

### (1) Tippen während des Renderns (ms, je Runde p95 der 120 Tasten; Spanne über 2 Läufe × 3 Runden)

| Last | Taste bis Paint p95, ohne Rahmentakt | Eingangsverzug p95 | mit Rahmentakt p95 | Seite rendern p50 |
|---|---|---|---|---|
| ohne PDF | 4,7–5,6 | 0,4–0,5 | 17,9–19,1 | – |
| **Hauptthread, DPR 2** | **13,2–17,1** (2 von 6 Runden ≥ 16) | 6,4–7,3 | 19,3–20,3 | 9,8–17,3 |
| Hauptthread, DPR 1 | 6,9–9,0 | 2,2–2,8 | 19,5–20,5 | 4,0–4,4 |
| Render-Worker, DPR 2 | 20,1–25,9 | 4,7–6,9 | 25,7–26,9 | 17,4–26,3 |

- Hauptthread: pdf.js arbeitet die Operatorliste in Scheiben von höchstens 15 ms ab (`EXECUTION_TIME`, je Scheibe ein
  rAF); eine Taste wartet höchstens eine Scheibe. Keine Long Task > 50 ms in allen Runden. Max. Einzelwert 26,6 ms.
- **Render-Worker ist schlechter:** pdf.js 6.5 rendert dort in ein OffscreenCanvas, schickt aber jedes Zwischenbild als
  `ImageBitmap` zurück und zeichnet es im Hauptthread per `drawImage` in ein Canvas mit `willReadFrequently`
  (`RendererWorker` → `drawFrame`). Der Eingangsverzug sinkt (p50 0,2 ms), die Zeit bis zum Paint steigt.
  Ungeprüft: `enableHWA: true`.
- Mit Rahmentakt kommen zu jedem Wert bis zu 16,7 ms Warten auf den nächsten Rahmen; Hauptthread-Rendern kostet dann
  1–2 ms p95 mehr als ohne PDF, der Worker 7–8 ms.
- Geometrie für Markierungen (`getTextContent` + `fontSpaces`, Wandzeit inklusive Warten auf den PDF-Worker):
  6–8 ms je Seite im Hauptthread-Modus (DPR 2), 2,6–3,5 ms bei DPR 1; reine Rechenzeit aus S2: 0,9 ms.

### (2) 303 Seiten scrollen (`PDFViewer` mit Textebene)

| Messung | Hauptthread | Render-Worker |
|---|---|---|
| `getDocument` (Bytes schon im Renderer) | 83–106 ms | 82–98 ms |
| erste Seite sichtbar (ab `getDocument`, nach dem Paint) | 146–211 ms | 145–177 ms |
| Rahmen > 16 ms ohne Rahmentakt (von ~84.000–107.000) | 107–164 | 46–152 |
| Rahmen > 33 ms ohne Rahmentakt | 15–26 | 13–25 |
| mit Rahmentakt: Rahmen (≈ 59,4 Hz), Abstand p95 / max, Rahmen > 33 ms | 2.113–2.123, 17,8 / 33,8 ms, 0–1 | 2.118–2.119, 17,8 / 25,2 ms, 0 |
| Long Tasks > 50 ms | 0–1 (85 ms, nur im ersten Lauf) | 0–1 (63 ms) |
| Seiten gerendert / Renderfehler | 300 / 0 | 300 / 0 |
| letzte Seite sichtbar nach Scroll-Ende | sofort (schon fertig) | sofort |
| Sprung auf ferne Seite bis Paint, p50 / max | 39–64 / 56–76 ms | 42–53 / 52–62 ms |
| Renderer-Prozess: Viewer offen → Spitze beim Scrollen | +130–260 MB (bis 700 MB) | +160–210 MB (bis 770 MB) |
| alle Prozesse, Spitze | 765–959 MB | 875–1.037 MB |

- Bei 8.000 px/s rendert der Viewer jede Seite rechtzeitig; mit Rahmentakt fällt höchstens ein Rahmen aus (Hauptthread),
  im Worker-Modus keiner. Ohne Rahmentakt zählen die > 16-ms-Rahmen die Scheiben des Seitenrenderns und den Aufbau der
  Textebene (~0,4 je Seite).
- Speicher: Der Viewer behält bis zu 10 Seiten-Canvas (DPR 2: ~1.300 × 1.880 px ≈ 10 MB je Seite) plus Textebenen.
  Nach `closeViewer` (`setDocument(null)`, `loadingTask.destroy()`) sinkt der Renderer nur teilweise (GC/Canvas
  verzögert); Speicher zwischen den Runden summiert sich (die Messung lief in einem Fenster, Tipp-Runden vorher).
  `performance.memory` ist ohne `--enable-precise-memory-info` gerundet (konstant 42,6 MB) und nicht aussagekräftig.

### (3) S2 unter `RENDERER_CSP`

`node build/run.mjs 7 --csp` (Ergebnisse `results/table-csp-hauptthread.md`, `results/table-csp-worker.md`):
**gleiches Ergebnis wie ohne CSP**, je Markierung identisch (Genauigkeit, Abweichungen, Urteil), in beiden
Render-Modi. `fontSpaces` 34/39 ≤ 1,5 pt, 0,86 ms/Seite (Hauptthread) bzw. 0,75 ms (Worker), 13 Seiten 11–20 ms.
34 FontFaces im Dokument, **auch mit Render-Worker** (pdf.js 6 bindet die Schriften immer zusätzlich im Hauptdokument,
`fontLoader.bind`; die Annahme aus „Ungeprüft“ oben ist damit widerlegt). Keine CSP-Verstöße in der Konsole.

### CSP-Befunde

- `RENDERER_CSP` reicht ohne Änderung: Modul-Worker `pdf.worker.min.mjs` und `pdf.renderer.min.mjs` aus `'self'`,
  FontFaces aus Binärdaten (kein `font-src` nötig), Textebene, `PDFViewer`-CSS aus `'self'`.
- `cMapUrl`, `standardFontDataUrl`, `wasmUrl` als `file:`-URL unter dem App-Ordner: pdf.js lädt sie im Hauptthread per
  XMLHttpRequest (bei `file:` kein Worker-Fetch); XHR und `fetch` liefern unter `connect-src 'self'` Status 200
  (Probe: bcmap 41 KB, `FoxitSerif.pfb` 19 KB, `openjpeg.wasm` 221 KB), der Anfragefilter lässt sie durch.
- **WebAssembly bleibt blockiert** (`script-src` → `wasm-eval`, die 2 Verstöße im Lauf stammen nur vom eigenen
  Wasm-Test; HgbDemo braucht kein Wasm). Für JPX und JBIG2 hat pdf.js 6 JS-Rückfälle (`*_nowasm_fallback.js` aus
  `wasmUrl`, Laden unter `script-src 'self'` erlaubt, nicht mit echtem JPX-PDF geprüft); ICC-Farbprofile (`qcms`) haben
  keinen Rückfall. **Minimal nötige Änderung nur, falls W-H10 scheitert: `'wasm-unsafe-eval'` in `script-src`** (gilt
  über den Kopf auch für die Worker); sonst keine.
- `PDFViewer` ohne eigenes `l10n` erzeugt `GenericL10n`, das Sprachdateien per `fetchData` nachlädt; in der Messung ein
  stummer Ersatz (`silentL10n` in `csp/src/scrollProbe.ts`).

### Ausführen (W3-3a)

```
cd web
node spikes/pdf-text/csp/build.mts                       # Bündel + pdf.js-Dateien nach spikes/pdf-text/csp/out/
node spikes/pdf-text/csp/run.mts                         # ohne Rahmentakt → results/w33a-ohne-rahmentakt.json (~5 min)
node spikes/pdf-text/csp/run.mts --vsync                 # mit Rahmentakt  → results/w33a-vsync.json
node spikes/pdf-text/csp/summary.mts spikes/pdf-text/results/w33a-ohne-rahmentakt.json   # Tabellen je Runde
node_modules/.bin/tsc -p spikes/pdf-text/tsconfig.json && node spikes/pdf-text/build/run.mjs 7 --csp   # S2 unter CSP (nur Mac: PDFKit-Referenz)
```

Alle Electron-Läufe außerhalb der Claude-Sandbox. Windows: W-H17 (`TESTING.md`), latexmk aus dem PATH.

Empfohlene Einstellungen für W3-3 (`getDocument`-Optionen, Hilfsdaten offline, `maxCanvasPixels`, Vorrendern,
Abbruch beim Scrollen, `l10n`) und für W5-4 (Geometrie nur sichtbar und im Leerlauf): `docs/ARCHITEKTUR.md`, Abschnitt S2.
