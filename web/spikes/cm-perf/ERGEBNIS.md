# Spike S1: CodeMirror-Leistung (W0-6)

**Entscheidung: eigenes `ViewPlugin` mit Zeilenzustands-Cache.** Die Dekorationen entstehen nur für den sichtbaren Bereich. `StreamLanguage` erfüllt die Zielwerte genauso, wird aber nicht genommen (Begründung unten).

## Rechner und Aufbau

- Mac: Intel Core i9, 8 Kerne, 2,3 GHz, 16 GB, macOS 26.7.1
- Electron 45.4.1 (Chrome 156.0.8078.100), CodeMirror `@codemirror/view` 6.43.15, `@codemirror/language` 6.13.1
- Fenster 1200 × 900, Editor 640 px hoch. Mit Zeilennummern, Zeilenumbruch, Verlauf, `drawSelection` und aktiver Zeile, also wie der spätere Editor.
- Dokumente werden synthetisch per Code erzeugt (`src/documentGenerator.ts`, fester Zufallssamen). Sie enthalten Präambel, Abschnitte, Absätze mit Inline-Mathe, `\cite`/`\ref`, Kommentare, `equation`, `align*`, `\[…\]`, `lstlisting`, `figure`, `itemize` und `comment`. Es gibt genau 10.000 bzw. 50.000 Zeilen.
- Der Tokenizer `src/tokenizer.ts` arbeitet zeilenweise mit einem Zustand am Zeilenende (normal, Mathe `$`/`$$`/`\(`/`\[`, Mathe-Umgebung, Verbatim, `comment`). Eine Leerzeile beendet Mathe, wie in Swift. Beide Varianten nutzen denselben Schritt `scanToken`.
- Gemessene Varianten:
  - `plain`: ohne Einfärbung, als Grundlinie
  - `stream`: `StreamLanguage` mit `HighlightStyle`
  - `viewPlugin`: eigener Cache in `src/lineStateCache.ts`. Nach einer Änderung wird neu berechnet, bis der Zustand konvergiert, synchron höchstens bis 200 Zeilen hinter den sichtbaren Bereich, der Rest im Leerlauf (`requestIdleCallback`, 8-ms-Scheiben).

## Methode

- 5 Läufe. Jeder Lauf startet ein frisches Electron per Playwright `_electron.launch` mit der installierten Binärdatei und misst alle Varianten und Größen. Die Reihenfolge der Varianten wechselt von Lauf zu Lauf.
- Die Tabelle zeigt je Kennzahl den **schnellsten Lauf**, in Klammern den langsamsten (Streuung). Rohwerte: `results/mac-run0..4.json`, Zusammenfassung `results/mac-summary.md`.
- Auf dem Rechner liefen gleichzeitig andere Agenten (bei den Läufen 1–5 zwei leichte Node-Agenten). Die Ausreißer bei „Öffnen 10.000“ (bis 43 ms) stammen vom kalten ersten Öffnen im frischen Prozess (JIT) und von dieser Last.
- **Öffnen**: Zeit von `EditorState.create` bis nach dem Paint des ersten Rahmens (rAF und danach eine MessageChannel-Nachricht).
- **Tastendruck**: 100 Mal ein Zeichen per `dispatch` (`input.type`), 40 ms Pause dazwischen. „Arbeit“ ist der synchrone Teil plus die Rahmenarbeit ab Rahmenbeginn bis nach dem Paint. „Latenz“ ist die Zeit bis nach dem Paint. Beide sind fast gleich, weil `disable-frame-rate-limit` und `disable-gpu-vsync` das Warten auf VSync weitgehend ausschalten.
  - „mittig“: Fließtextzeile ab der Dokumentmitte
  - „Anfang“: Position 0
  - „`$`“: `$` am Zeilenanfang mitten im Dokument, abwechselnd eingefügt und gelöscht. Das öffnet Mathe bis zum Absatzende und ist damit der Zustandswechsel.
- **Scrollen**: 120 Rahmen, je 400 px per `scrollTop`. „Arbeit“ zählt ab Rahmenbeginn bis nach dem Paint, dazu der Rahmenabstand.
- **Sprung Ende**: Cursor ans Dokumentende, zwei Rahmen.
- **Speicher**: JS-Heap nach `gc()` (mit `--expose-gc` und `enable-precise-memory-info`). Gezählt wird der Zuwachs durch die geöffnete Ansicht; der Dokumenttext lag vorher schon im Speicher. Zusätzlich das Working Set des Renderers nach dem Lauf, aus `app.getAppMetrics`.
- Nicht gemessen: echte Tastaturereignisse (`beforeinput` → CodeMirror). Gemessen wurde nur `dispatch`, ohne IME und ohne Eingabepfad des Betriebssystems.

## Messwerte (Mac, ms; schnellster Lauf, in Klammern der langsamste)

| Variante | Zeilen | Öffnen | Taste mittig Arbeit p50 / p95 | Taste Anfang p95 | `$` mittig p95 | Scrollen Arbeit p95 | Scrollen Rahmenabstand p95 | Sprung Ende | Heap-Zuwachs MB | Renderer MB |
|---|---|---|---|---|---|---|---|---|---|---|
| plain | 10.000 | 6,1 (31,6) | 1,4 / 2,6 (2,8) | 1,6 (3,3) | 2,6 (2,7) | 5,7 (6,4) | 7,2 (8,3) | 7,9 (12,8) | < 1 | 116–151 |
| stream | 10.000 | 15,6 (43,1) | 3,2 / 3,5 (3,9) | 3,4 (4,0) | 5,2 (5,6) | 5,9 (7,4) | 7,9 (9,1) | 9,6 (11,7) | < 1,1 | 133–153 |
| viewPlugin | 10.000 | 13,3 (37,4) | 2,8 / 3,5 (3,7) | 3,1 (3,9) | 5,4 (5,6) | 8,0 (9,3) | 9,9 (11,6) | 11,6 (14,8) | < 1 | 148–155 |
| plain | 50.000 | 8,2 (12,3) | 2,7 / 3,0 (3,3) | 1,7 (2,6) | 2,5 (2,6) | 6,5 (8,3) | 8,1 (9,7) | 8,4 (10,7) | 0,7 (0,9) | 142–174 |
| stream | 50.000 | 14,5 (15,6) | 3,1 / 3,3 (3,6) | 3,3 (3,4) | 4,1 (4,6) | 7,4 (11,1) | 8,4 (12,4) | 7,3 (12,1) | 0,9 (0,9) | 151–188 |
| viewPlugin | 50.000 | 15,3 (15,8) | 2,9 / 3,5 (3,7) | 3,0 (3,2) | 4,3 (4,4) | 8,5 (14,3) | 9,9 (15,4) | 9,9 (12,0) | 0,9 (1,0) | 186–199 |

Größter Einzelwert („max“) über alle Läufe:

- Taste mittig: 4,9 ms (beide Varianten)
- `$`: 6,9 ms (stream) bzw. 6,8 ms (viewPlugin)
- Scroll-Rahmen: 21,2 ms (stream, 50.000) bzw. 21,5 ms (viewPlugin, 50.000)

**Zusatzmessung „Einfärbung nach Sprung“** (`results/mac-color-delay.json`, 5 Wiederholungen): öffnen, 0,5 s Ruhe, ein Zeichen an Position 0 tippen, sofort ans Ende springen. Gemessen wurde die Zeit, bis das Ende eingefärbt ist.

| Variante | 10.000 Zeilen | 50.000 Zeilen |
|---|---|---|
| stream | 91–120 ms (6–7 Rahmen ohne Farbe) | 115–137 ms |
| viewPlugin | 11–16 ms (schon im ersten Rahmen eingefärbt) | 9–12 ms |

Auch ohne vorheriges Tippen zeigt `stream` bei 50.000 Zeilen nach dem Sprung ans Ende 50 ms lang keine Farbe; nach 250 ms ist alles eingefärbt.

## Zielwerte

| Ziel | stream | viewPlugin |
|---|---|---|
| Tastendruck p95 < 16 ms | erfüllt (≤ 4,6 ms, auch bei 50.000 und beim Zustandswechsel `$`) | erfüllt (≤ 4,4 ms) |
| Öffnen < 200 ms bei 10.000 | erfüllt (15,6 ms, kalt bis 43 ms) | erfüllt (13,3 ms, kalt bis 37 ms) |
| 50.000 Zeilen bedienbar | ja; Scroll-Rahmen p95 ≤ 12,4 ms, max 21 ms | ja; Scroll-Rahmen p95 ≤ 15,4 ms, max 22 ms |

## Entscheidung und Begründung

Beim Tippen und Öffnen sind beide Varianten gleich schnell. Den Ausschlag geben andere Punkte:

1. **Keine ungefärbten Stellen.** `StreamLanguage` parst nach einer Änderung im Hintergrund weiter. Springt man danach weit (Gehe zu Zeile, Suche, Klick in Gliederung oder PDF), steht der Text 90–140 ms lang ohne Farbe da. Der Cache des `ViewPlugin` ist nach der Konvergenz sofort wieder gültig, die Farbe ist also schon im ersten Rahmen da.
2. **Gleiches Verhalten wie Swift.** Zustand je Zeilenende und Neuberechnung nur bis zur Zustandskonvergenz entsprechen dem `SyntaxHighlighter` in Swift. Damit lassen sich die Vektoren in `shared/spec/latex-tokenizer.json` 1:1 prüfen, auch `highlightEdit` mit `tokenizedLineCount`. `StreamLanguage` bricht nicht bei Konvergenz ab und gibt diese Zahl nicht heraus.
3. **Wenig Code, unabhängig von CodeMirror-Interna.** Cache und Plugin haben zusammen etwa 200 Zeilen und sind in Vitest ohne DOM testbar (`LineStateCache`).
4. **Preis.** Es gibt keinen Lezer-Syntaxbaum: `syntaxTree`, `bracketMatching` und baumbasiertes Einklappen fehlen. Einklappen und Kontext (Vervollständigung, Prüfung) baut die Web-Version ohnehin nach Swift-Vorbild selbst (`fold-regions.json`, `latex-source.json`). Das Scrollen kostet etwas mehr Arbeit (p95 8,5 statt 7,4 ms bei 50.000), weil das Plugin die Dekorationen bei jedem Viewport-Wechsel neu baut. Falls nötig, lässt sich das mit Tokens je Zeile im Cache senken.

`StreamLanguage` bleibt Rückfallweg. Eine Lezer-Grammatik ist nicht nötig.

## Offen und nicht geprüft

- **Windows-Messung fehlt** (siehe Anleitung).
- Echte Tastatur- und IME-Eingabe; geprüft wurde nur `dispatch`.
- Sehr lange Einzelzeilen.
- Mehrfachcursor.
- Einfügen von 50.000 Zeilen.
- CPU-Last im Hintergrund nach Änderungen: `StreamLanguage` parst neu, beim `viewPlugin` ist es die Leerlaufarbeit.
- Unter macOS hielt der Rahmenabstand im Leerlauf trotz der Schalter bei etwa 17,5 ms (VSync). Unter Last kamen die Rahmen ungebremst (Scroll-Rahmenabstand p50 4–7 ms).

## Anleitung Windows (von Hand)

Im Ordner `web` zuerst `node spikes/cm-perf/build.mts` ausführen und dann `npx --no-install electron spikes/cm-perf/out/main.cjs` starten. Im Fenster auf „Alle Messungen starten“ klicken und etwa 10 Minuten nichts anderes am Rechner tun. Danach die Tabelle unter dem Editor (Spalten wie oben, ohne Renderer-MB) samt Kopfzeile kopieren und hier unter „Messwerte (Windows)“ eintragen.

## Dateien

- `src/tokenizer.ts`: Wegwerf-Tokenizer
- `src/streamVariant.ts`: Variante A
- `src/lineStateCache.ts` und `src/viewPluginVariant.ts`: Variante B
- `src/documentGenerator.ts`: Testdokumente
- `src/measure.ts`, `src/summary.ts`, `src/page.ts`, `index.html`: Messseite
- `main.ts`: Electron-Hauptprogramm
- `build.mts`: Bündeln mit rolldown nach `out/`
- `run.mts`: Playwright-Treiber, ein Lauf je Aufruf (`node spikes/cm-perf/run.mts 0` … `4`, danach `… summary`)
- `tsconfig.json`: eigene Typprüfung mit `tsc --noEmit -p spikes/cm-perf/tsconfig.json`. Die Projekt-tsconfigs schließen `spikes/` nicht ein; `npm run typecheck` bleibt grün.
