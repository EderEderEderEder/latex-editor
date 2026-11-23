# W0-10: Electron-Prüfseite (Spike S5, S6 vorbereitet, S9)

Rechner: Intel-Mac, macOS, Electron 45.4.1 (Chromium 156), pdfjs-dist 6.5.438. Windows und Linux **nicht** geprüft.
Aufruf (aus `web/`): `node spikes/electron-check/build.mts`, dann `node spikes/electron-check/run.mts 7` (Electron nur ohne Bash-Sandbox startbar). Rohwerte: `results/mac-*.json`. Die Seite lässt sich auch von Hand öffnen: `node_modules/.bin/electron spikes/electron-check/out/main.cjs` (Umgebungsvariablen `SPIKE_PAGE`, `SPIKE_PDF`, `SPIKE_ALLOWED_DIR`, `SPIKE_OUTSIDE` setzen; ohne sie bleiben PDF-Prüfungen leer).
Zwei Seiten: `index.html` (CSP exakt `RENDERER_CSP` aus `security.ts`) und `index-protocol.html` (nur `connect-src` zusätzlich `latexeditor:`).

## Prüfungen

| Prüfung | automatisch | Ergebnis (Mac) | Handtest nötig | Hinweis |
|---|---|---|---|---|
| (a) AltGr `{ } [ ] \ @ ~ \|` Textfeld und CodeMirror | teilweise: simulierte Tasten über CDP mit Strg+Alt (Windows-AltGr-Modell) und Alt (Mac) | alle 8 Zeichen kommen an, in Textfeld und CodeMirror, bei beiden Modifikator-Mustern. Protokoll `event.key/code/ctrlKey/altKey` liegt in `window.checks.keyRecords()` und im Feld der Seite | **ja, Windows (echte deutsche Tastatur mit AltGr)** und Mac (Option) | Echtes AltGr meldet unter Windows `ctrlKey=true, altKey=true` und `getModifierState('AltGraph')`; Kürzel mit Strg+Alt meiden. CodeMirror ohne `closeBrackets` getestet |
| (b) IME | teilweise: `Input.imeSetComposition` + `insertText` | `compositionstart/update/end` kommen in Textfeld und CodeMirror, Endtext „日本“ landet im Dokument | **ja**, echte IME (Mac japanisch/Pinyin, Windows MS-IME, Emoji-Auswahl) | Zeilen wie `beforeinput/insertCompositionText` stehen im Protokoll |
| (c) Drag & Drop, `webUtils.getPathForFile` | teilweise: `setInputFiles` (echte Datei) + simulierte `drop`-Ablage | Pfad stimmt für Eingabefeld und Ablage; synthetisches `new File()` liefert `''` | **ja**, echtes Ziehen aus Explorer/Finder (Windows: Laufwerkspfad, Umlaute, Leerzeichen) | Sandbox-Preload genügt, kein `file.path` nötig |
| (d) Zwischenablage | teilweise | `navigator.clipboard.readText/writeText` im Renderer **abgelehnt** (`NotAllowedError`), weil `denyAllPermissions` alles ablehnt; Lesen/Schreiben über IPC (`clipboard` im Main) funktioniert mit Tabulator und Sonderzeichen. Einfügen per Strg/Cmd+V ist nicht automatisierbar (Tastenbefehl erreicht das unfokussierte Fenster nicht, das Textfeld bleibt leer) | **ja**: Excel-Zellen (Tabulatoren, Zeilenumbrüche) in Textfeld und CodeMirror einfügen | Das normale Paste-Ereignis (Strg/Cmd+V) braucht erwartungsgemäß keine Berechtigung, ist aber ungeprüft (Handtest); betroffen ist die Async-API. Kopieren/Ausschneiden im Editor geht über Chromium selbst |
| (e) Sandbox + Preload | ja | `sandbox` und `contextIsolation` aktiv (Preload meldet `process.sandboxed`, `process.contextIsolated`); `require`, `process`, `module`, `Buffer`, `global`, `ipcRenderer` im Renderer undefiniert; `window.spike` enthält nur die freigegebenen Funktionen | nein (Windows einmal bestätigen) | `getLastWebPreferences` gibt es in Electron 45 nicht mehr |
| (f) CSP | ja | unter strenger CSP: `data:`- und `blob:`-Bilder erlaubt, `blob:`-Worker erlaubt, Modul-Worker aus dem Bundle erlaubt, pdf.js-Worker (`pdf.worker.min.mjs` per `workerSrc`, Modul) läuft, Seite 1 wird gerendert, Textebene liefert 102 Elemente. Blockiert wie gewollt: Inline-Skript, `eval`, `fetch` auf `blob:`/`data:`/fremde Hosts. **WebAssembly ist blockiert** (`script-src -> wasm-eval`), auch im Worker | ja: Konsole beim Arbeiten ohne Verstöße | `wasm-unsafe-eval` in `script-src` (und Worker) nur ergänzen, wenn pdf.js Wasm braucht (JPEG2000, Farbprofile); Test-PDF ohne solche Bilder lief ohne. Bei Verstößen später mit PDF aus LaTeX mit JPX-Bildern prüfen. Kein `unsafe-eval` nötig (`isEvalSupported: false`) |
| (g) PDF-Transport S9 | ja | siehe unten | nein (Windows-Zahlen einmal nachmessen) | |
| (h) NSIS-Testbuild S6 | nein (nicht ausgeführt, lädt Werkzeuge) | `electron-builder.yml` angepasst, Ablauf in `TESTING.md` | **ja**, auf dem Windows-Rechner | |

Auffälligkeiten:
- Variante 1 braucht `latexeditor:` in `connect-src` der CSP (unter der heutigen strengen CSP gibt es `connect-src -> latexeditor`-Verstöße und `Unexpected server response (0)`), außerdem Schema-Rechte `standard`, `secure`, `supportFetchAPI`, `stream` und **`corsEnabled`** (ohne sie scheitert `fetch` mit `TypeError`) sowie CORS-Antwortköpfe, solange die Seite von `file://` kommt, plus Behandlung von `OPTIONS` und `Range`.
- Pfadprüfung des Protokolls (`assertInsideProject`): innerhalb 200, außerhalb 403, `..`-Umgehung 403, falscher Host 403.
- Die Zeitwerte stammen von einem 400-Seiten-Test-PDF (synthetisch, 11,1 MB, unkomprimierte Textseiten), nicht von einem LaTeX-PDF mit Schriften und Bildern.

## S9: PDF-Transport (11,1 MB, 400 Seiten, Zeit bis `getDocument(...).promise`, gemeinsamer Worker vorgewärmt, 7 Läufe je Variante, schnellster Wert)

| Variante | schnellster Lauf | übrige Läufe |
|---|---|---|
| 2: Lesen im Main + binäre IPC (`ArrayBuffer` über `contextBridge`) | 38,8 ms | 38,8–47,3 ms |
| 1a: `latexeditor:` mit Range (pdf.js Standard) | 44,2 ms | 44,2–53,5 ms |
| 1b: `latexeditor:` ohne Range/Stream (ganze Datei) | 42,5 ms | 42,5–57,6 ms |

Worker-Start (einmalig): 70–90 ms. Beide Wege liegen deutlich unter dem Ziel von 100 ms.

**Entscheidung S9: Variante 2 (IPC mit `ArrayBuffer`).** Sie ist etwas schneller, braucht weder `latexeditor:` in der CSP noch Schemarechte, CORS, Range- und `OPTIONS`-Behandlung, und die Pfadprüfung läuft im bestehenden IPC-Handler. Kosten: die Datei liegt zweimal im Speicher (Main und Renderer), bei 10 MB unkritisch. Rückfallweg: Variante 1 (Code in `main.ts`), falls sehr große PDFs (hunderte MB) oder Teilladen nötig werden. Damit entfällt `main/pdfProtocol.ts`; `security.ts` behält `latexeditor:` in `APP_PROTOCOL` ungenutzt (Anpassung ist Sache der Hauptsitzung).

## Handtest-Liste

Steht in `web/TESTING.md` (W-H1 ff.), Windows und Mac.

## Nicht geprüft

Windows und Linux, echte Tastatur/IME/Ziehen, Excel-Einfügen, `wasm-unsafe-eval`-Bedarf von pdf.js mit echten PDFs, NSIS-Build, Fuses.
