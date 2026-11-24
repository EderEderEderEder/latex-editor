# Feature-Parität: Swift-Version → Web-Version

Pflegeliste für beide Plattformen: Was die Swift-App kann, welches Pendant die Web-Version (`web/`, Electron) bekommt, Priorität (MVP / später / entfällt), Aufwand (S/M/L) und Besonderheiten. Spalte „Stand“: `nicht begonnen` / `M1 fertig` (bzw. Meilenstein) / `später` / `entfällt`; beim Umsetzen eines Features pflegen. Plan und Aufgaben: `PLAN-WEBUI.md`.

### Feature-Paritätsmatrix (Swift → Web)

| Bereich / Feature (Swift) | Web-Pendant | Prio | Aufw. | Besonderheiten | Stand |
|---|---|---|---|---|---|
| Syntaxfarben LaTeX (`LatexTokenizer`, `SyntaxHighlighter`, Zustandskonvergenz) | `core/latex/tokenizer.ts` + eigenes CM-`ViewPlugin` mit `LineStateCache` (S1; `StreamLanguage` nur Rückfall) | MVP | L | Offsets UTF-16 (in JS gleich); Mathe endet am Absatz; Prosa-Argumente bleiben ungefärbt | M1 fertig |
| BibTeX-Farben (`BibTokenizer`, `BibLexState`) | `core/bib/tokenizer.ts`, im selben `ViewPlugin`-Mechanismus wie LaTeX (keine eigene Stream-Sprache) | MVP | M | Sprache nach Endung, beim Umbenennen neu färben | M1 fertig |
| Zeilennummern, aktuelle Zeile, Markierungen (Kreis/Dreieck/Raute, Git-Marken), Tooltip | CM `gutter` + `GutterMarker`, Markierungen per `RangeSet.map` | MVP | M | Form statt nur Farbe; nur sichtbarer Bereich (CM-Standard) | M1 fertig |
| Einklappen (Abschnitte, `\begin…\end`, Kommentarblöcke, ⋯, alles zu/auf) | `core/latex/foldRegions.ts` (`FoldState`) + `editor/folding.ts` (eigenes `StateField`, `Decoration.replace`, eigene Gutter-Spalte; kein `foldService`) | MVP | M | Text bleibt unverändert; eine Bearbeitung im Zugeklappten klappt auf; Tasten macOS ⌥⌘←/→ (mit ⇧ alles), sonst Strg+K dann Strg+←/→, Strg+0, Strg+J (Strg+Alt ist AltGr) | M1 fertig |
| Diagnose (`SyntaxChecker`, doppelte Labels, Build-Meldungen, rot gestrichelt / orange strichpunktiert / blau gepunktet) | `editor/diagnostics.ts` (Dekorationen, Worker, 0,6 s entprellt) | MVP | M | 0 Fehlalarme im Demo-Projekt samt `.cls`/`.sty`; strichpunktiert per Farbverlauf (`repeating-linear-gradient`-Unterstreichung, keine SVG) | M1 fertig |
| Rechtschreibung + Syntaxfilter + Fachvokabular (4.000 Wörter) | nach Spike S8: Chromium-Prüfung oder eigener Anbieter (`webFrame.setSpellCheckProvider` bzw. `nspell` im Worker über den sichtbaren Bereich) mit `de_AT`/`de_DE` | später (M7) | L | bis S8 `spellcheck: false`; die Chromium-Prüfung lädt unter Windows/Linux Wörterbücher aus dem Netz und kennt keinen Syntaxfilter; Wörterbuchlizenz prüfen | später |
| Tippen (Klammern, Enter mit `\end`/`\item`, Kommentar, Einrücken, Zeilen verschieben/doppeln/löschen, Fett/Kursiv/Mono) | `editor/typing.ts` (Keymaps + `inputHandler`) | MVP | M | je ein Undo-Schritt; nicht während IME-Eingabe; Fett ⇧Strg+B, Kursiv Strg+I, Schreibmaschine ⇧Strg+M (Swift: ⇧⌘T), Kommentar Strg+/, Zeilen Alt+↑/↓ (⇧ doppeln), ⇧Strg+K löschen; Ein-/Ausrücken ohne eigene Taste (CodeMirror-Standard Strg+]/[, macOS ⌘]/⌘[) | M1 fertig |
| Autokorrektur Groß-/Kleinschreibung | `transactionExtender` im nächsten Tick | später | M | ⌘Z nimmt nur die Korrektur zurück | später |
| Schreibhinweise | Worker + Dekoration | später | M | regelt nur Fließtext, Tokens aus dem Syntaxbaum | später |
| Spaltenhilfslinie | CSS-Hintergrund | später | S | standardmäßig aus | später |
| Suchen in der Datei (⌘F/⌘G/⌘E) | `@codemirror/search` mit deutschen Texten | MVP | S | Strg+F, F3, Strg+G; Ersetzen Strg+H (macOS ⌥⌘F, weil ⌘H „Ausblenden“ ist); ⌘E (Auswahl als Suchbegriff) nicht umgesetzt; ohne `searchKeymap` (kein Mehrfach-Cursor) | M1 fertig |
| Zoom Editor + Oberfläche (85–200 %) | Editor: Einstellung `editorZoom` mit Strg+Plus/Minus, Strg+0 (Strg+Alt+0 entfällt, AltGr); Oberfläche: CSS-Variable `--ui-scale` aus `interfaceZoom` (offen, ab M2) | MVP | S | M1 skaliert nur den Editor; PDF hat einen eigenen Zoom | M1 fertig (nur Editor) |
| Statusleiste + Wortzähler | `core/wordCount.ts` im Worker, 0,5 s, Zwischenspeicher nach mtime | MVP | S | Projekt = Hauptdatei + Includes | M1 fertig (Zeile/Spalte; Wortzähler M2) |
| Pfadzeile (Include-Kette, Abschnitt der obersten Zeile) | Kopfleiste über dem Editor | MVP | S | darf die Editorbreite nicht beeinflussen (Lehre aus Sitzung 20: feste Höhe, `overflow:hidden`) | nicht begonnen |
| Extern geänderte offene Dateien (still neu laden / Konflikt) | `fs:changed` → Inhalt vergleichen → minimaler Ersatz | MVP | M | eigenes Speichern löst nichts aus (Hash) | nicht begonnen |
| Automatische Sicherung + Wiederherstellung | Main `recovery.ts` (App-Datenordner `userData`), 5 s | MVP | M | nicht beim Öffnen löschen | nicht begonnen |
| Ungespeichertes beim Beenden / Projektwechsel | `CloseGuard` (`close` und `before-quit`) → `app:closeRequested` → Nachfrage (Speichern / Nicht speichern / Abbrechen) → `app:confirmClose` → `destroy()` | MVP | S | Wiederherstellungsdaten beim „Nicht speichern“: W2-14 | M1 fertig |
| Strg-Klick (ref/cite/include → Ziel; Text → PDF) | `core/jumpTargets.ts` + CM-Mausbehandlung | MVP | M | – | nicht begonnen |
| Umbenennen (Label, Quelle, Abkürzung, Befehl, Umgebung, Paar) | `core/renaming/*` | später | L | wie Ersetzen: in Sitzungen, ungespeichert | später |
| Verwendungen anzeigen, Abkürzungen/Glossar | `core/usages.ts`, `core/acronyms.ts` | später | M | – | später |
| Bildvorschau (Hover, Bildbibliothek) | `<img>` mit `blob:`-URL aus IPC-Bytes (S9: kein eigenes Protokoll; Quelle nur im Projektordner) | später | S | – | später |
| Vervollständigung (Befehle mit Gerüst, Labels, `\cite` mit Autor/Titel, Bilder über `graphicspath`, Dateien, Umgebungen, innerstes `\end`) | `core/completion/*` + `@codemirror/autocomplete` | MVP | L | pro Tastendruck nur Kontext der Zeile; nie in Kommentar/Verbatim, entschieden über den Zustand im `LineStateCache` (nicht über `syntaxTree`, es gibt keinen Lezer-Baum) | nicht begonnen |
| Optionen in `[…]` (`OptionScanner`, `OptionCatalog`, HgbThesis-Schlüssel) | `core/completion/options.ts` | MVP | M | Folgeliste nach `key=` | nicht begonnen |
| Projektindex aus `.tex`/`.cls`/`.sty` | Worker + Main `fs:readMany` | MVP | M | meldet sich nur bei echter Änderung | nicht begonnen |
| Einfügen-Fenster (Bausteinliste, Einstellungen, Vorschau an Ort und Stelle, Fußzeile) | `ui/insert/*` | MVP | M | 3 Spalten, gleiche Farben wie der Editor | nicht begonnen |
| Generator Tabelle (Raster, Ausrichtung, Einfügen aus Excel per Tab-Text) | `core/insertion/table.ts` + Raster-UI | MVP | M | booktabs mit `@{}`, `\caption` vor `\label` | nicht begonnen |
| Generator Bild (aus Projekt, Datei, Drag & Drop, Kopie nach `images/`) | `core/insertion/figure.ts` + Main `images.ts`, Drag & Drop über `webUtils.getPathForFile` | MVP | M | Duplikate per Hash; nur PNG/JPG/PDF | nicht begonnen |
| Generator Code (`program` + 27 Sprachumgebungen) | `core/insertion/code.ts` | MVP | S | `lstlisting` ist gesperrt | nicht begonnen |
| Generatoren Gleichung, Liste, Querverweis, Zitat | `core/insertion/*.ts` | MVP | S | markierter Text wird Inhalt | nicht begonnen |
| Generator Quelle (Formular je Typ, BibTeX einfügen, an `.bib` anhängen, `\cite`) | `core/bib/sourceBuilder.ts` + Main `textIo.ts` (Anhängen) | MVP | M | unlesbare `.bib` nie überschreiben | nicht begonnen |
| Verweise prüfen + Hinweise (ungenutzte Labels/Quellen) | `core/references.ts` im Worker | MVP | M | Zitate nur prüfen, wenn das Projekt Einträge hat | nicht begonnen |
| Gliederung (hierarchisch, Includes, aktueller Abschnitt, Sprung) | `core/outline.ts` + `ui/OutlineList` | MVP | M | Cursor 150 ms entprellt | nicht begonnen |
| Dateibaum (Filter, Dateitypen ausblenden, Build-Dateien, Symbole) | `ui/FileTree` (virtualisiert) | MVP | M | Ordnerzustand im Store, nicht in der Komponente | nicht begonnen |
| Dateiaktionen (anlegen, umbenennen, duplizieren, verschieben, Papierkorb, Import aus dem Explorer) | Main `fsOps.ts`, Papierkorb über `shell.trashItem` | MVP | L | Groß-/Kleinschreibung über Zwischennamen (NTFS) | nicht begonnen |
| Verweise anpassen (`ReferenceUpdater`) | `core/referenceUpdater.ts` | MVP | M | Liste „alt → neu“, offene Dateien im Editor ändern | nicht begonnen |
| Rückgängig für Dateiaktionen (`FileUndo`) | App-Undo-Stapel `stores/appUndo.ts` + App-Ablage im Main (`fsOps.ts`) | MVP | L | Gelöschtes kommt aus der App-Ablage zurück (siehe W2-7) | nicht begonnen |
| Tabs (Vorschau kursiv, fest, Reihenfolge, Gedächtnis pro Projekt, Nachfrage beim Schließen, Diff-Tabs) | `core/tabs.ts` + `stores/editor.ts` | MVP | M | ein `EditorState` je Tab (eigener Undo) | M1 fertig (Tabs, Vorschau; Rest M2) |
| Suchen/Ersetzen im Projekt | Main `search.ts` im Worker (Treffer als Ereignis `search:hits`) + offene Puffer im Renderer | MVP | M | Ersetzen nur in Sitzungen, ungespeichert | nicht begonnen |
| Schnell öffnen, Gehe zu Zeile | `core/quickOpen.ts` | MVP | S | Strg+P, Strg+G | nicht begonnen |
| Kompilieren (latexmk, nie parallel, Aufträge zusammengefasst, beim Speichern, abbrechen, Hilfsdateien löschen) | Main `build.ts` | MVP | L | Abbruch des Prozessbaums: Windows `taskkill /PID <eigene Kind-PID> /T /F`, Unix eigene Prozessgruppe | nicht begonnen |
| Fehlerliste, Log-Parser, Protokoll, nächste/vorherige Meldung | Main `logParser.ts` (im Worker) + `ui/IssueList` | MVP | M | Byte-Parser über `Buffer`, Fixtures als Vektoren | nicht begonnen |
| PDF-Ansicht (Neuladen mit Seite/Zoom/Position, Zoom, „Seite X von Y“, Ansicht Editor/Geteilt/PDF mit Teiler) | `pdf/viewer.ts` + `ui/WorkspaceSplit` | MVP | L | beide Seiten bleiben immer eingehängt; unvollständige Datei → alte Ansicht bleibt | nicht begonnen |
| SyncTeX (Strg+J, Klick ins PDF, PDF folgt Cursor) | Main `synctex.ts` (eigener Parser, `node:zlib`, Index im Worker) + `stores/synctex.ts` | MVP | L | ohne Markierung; Pfade normalisieren (Laufwerk, `\`) | nicht begonnen |
| Link-Vorschau + Sprungverlauf | `pdf/links.ts`, `pdf/history.ts`, `pdf/preview.ts` | MVP (spät in M3) | M | Force Click entfällt → Alt-Hover 0,6 s + Kontextmenü; Strg+Alt+←/→ vermeiden (Konflikt mit AltGr) → Alt+←/→ | nicht begonnen |
| PDF-Markierungen (Anker, Zuordnung placed/pending/orphaned, Farben, Modus, Undo, ersetzen, Kommentare, Notizen, Liste, neu zuordnen, mitwandern) | `core/marks/*` + `pdf/marksOverlay.ts` + Main `marks.ts` | MVP (M5) | L | Overlay statt Annotation, nie in die PDF-Datei schreiben | nicht begonnen |
| Git Phase 1 (Status, Änderungen-Tab, Bereitstellen, Diff mit Wort-Hervorhebung, Commit, Marken im Baum) | Main `git.ts` (Parser im Worker) + `core/diff/*` + `ui/Changes`, `ui/Diff` | MVP (M6) | L | `GIT_OPTIONAL_LOCKS=0`, die Konfiguration nie ändern | nicht begonnen |
| Git Phase 2 (Branches, Abrufen, Pull nur `--ff-only`, Push ohne Force, auf HEAD zurücksetzen mit Sicherung + Undo, Änderungsmarken) | wie oben | MVP (M6) | L | die App fragt nie nach Passwörtern | nicht begonnen |
| Einstellungen (Bereiche, Suche, Live-Vorschau, Standard wiederherstellen) | `ui/settings/*` + `stores/settings.ts` | MVP (Kern in M1, Fenster in M7) | M | folgt Hell/Dunkel des Systems | M1 fertig (Kern; Fenster M7) |
| Farbschemata (Standard, Klassisch, Solarized, Hoher Kontrast; je hell/dunkel) | CSS-Variablen + `HighlightStyle` | MVP | S | Kontrast ≥ 4,5:1 bzw. 7:1 als Vitest-Test | M1 fertig |
| Seitenleiste (Icon-Tabs, Statistik, Filter je Tab, Fehler-Badge) | `ui/Sidebar` | MVP | M | „Änderungen“ nur bei Git | nicht begonnen |
| Hover-Vorschau der eingeklappten Seitenleiste | – | später | S | – | später |
| Zuletzt geöffnet, Hauptdatei-Erkennung | Main `project.ts` + `settings.ts` | MVP | S | – | nicht begonnen |
| Signposts / `sample` | `performance.mark` im Renderer und im Main (`node:perf_hooks`), Chromium-Profiler über die DevTools | MVP | S | – | nicht begonnen |
| macOS-Eigenheiten (Universal Binary, NSSpellChecker, Responder-Kette, Force Click) | – | entfällt | – | – | entfällt |
