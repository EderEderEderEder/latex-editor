# Tests

## Automatische Tests

Ohne Xcode gibt es kein XCTest und keine UI-Tests. Die Tests nutzen **Swift Testing** aus den Command Line Tools.

```bash
scripts/test.sh                                  # alle Tests (Debug)
scripts/test.sh --filter Performance             # nur Performance-Tests
scripts/test.sh --filter LatexTokenizer          # eine Suite
scripts/test.sh -c release -Xswiftc -enable-testing --filter Performance   # Release-Vergleichswerte
```

Wichtig: **nicht** `swift test` direkt aufrufen. Ohne die Flags aus dem Skript wird der Test-Runner ohne Swift Testing gebaut, und es laufen still 0 Tests. Das Skript bricht in diesem Fall mit Fehler ab, ebenso bei einem `--filter` ohne Treffer. `--filter` vergleicht mit Typ- und Funktionsnamen (z. B. `WindowLayoutTests`), nicht mit den deutschen Anzeigenamen.

| Datei | Inhalt |
| --- | --- |
| `OutlineParserTests` | Includes mit/ohne `.tex`, Reihenfolge, Kommentare und `\%`, Zeilennummern, Titelbereinigung, Zyklen, Cache, Include-Kette |
| `ProjectLoadingTests` | FileTreeLoader (Filter, versteckte und leere Ordner, Sortierung), MainFileDetector |
| `LatexTokenizerTests` | Grenzfälle: `\%`, `$` in Kommentaren, verschachtelte Klammern, `\verb`, Mathe-Umgebungen, Verbatim, unvollständige Eingaben, UTF-16 |
| `LineIndexTests` | Einfügen/Löschen über Zeilengrenzen, leere Datei, ohne abschließenden Umbruch, 500 zufällige Bearbeitungen gegen Neuaufbau |
| `SyntaxHighlighterTests` | eine Zeile pro Tastendruck, offenes `$` endet am Absatz, Verbatim bis Dateiende, 500 zufällige Bearbeitungen gegen Komplett-Einfärben |
| `EditorIntegrationTests` | echter TextKit-Stapel ohne Fenster: Farben nach Bearbeitung, Index-Synchronität, Rechtschreibfilter, Ruler (Umbruch, letzte Zeile, nur sichtbarer Bereich, Breite) |
| `WindowLayoutTests` | echtes Hauptfenster offscreen: Editor füllt die Höhe, Text beginnt rechts vom Ruler, im Textbereich wird tatsächlich gezeichnet (fängt Übermalen ab); Sprünge durch das echte SwiftUI-Fenster, wiederholt und dateiübergreifend, mit Tab- und Projektwechsel; Tabs durch das Fenster (Vorschau/fest, Wechsel mit Auswahl, Nachfrage beim Schließen, Wiederherstellung nach Projektneuöffnung, leere Anzeige); mit MacTeX: ⌘J (Seite + Markierung, die wieder verschwindet), PDF folgt Cursor, ⌘-Klick ins PDF → richtige Datei und Zeile |
| `SessionSwitchTests` | echter `EditorCoordinator` im Offscreen-Fenster: Wechsel lang → kurz (Regressionstest für den Absturz `Range … out of bounds`), Auswahl pro Datei, veraltete Auswahl/Scrollposition, Projektwechsel, wiederholte Sprünge über Dateigrenzen, Zeile hinter Dateiende, extern gelöschte Dateien |
| `TextPositionsTests` | Klemm-Logik für Bereiche, Zeilennummern und Positionen (auch `NSNotFound`, leerer Text) |
| `SidebarModelTests` | Gliederungsbaum (Ebenen, fehlende Ebene, Einträge vor dem ersten Kapitel), aktueller Abschnitt zur Cursorposition, „Zuletzt geöffnet“, Tab pro Projekt |
| `LatexLogParserTests` | echte Logs (MacTeX 2026) als Fixtures: Fehler mit Datei/Zeile auch im `\include`-Kapitel, fataler Fehler (fehlendes Paket), Warnungen, mehrzeilige Package-Warnung, Over-/Underfull, biblatex/biber; Grenzfälle (Klammern im Fehlerkontext und Box-Inhalt, Pfade mit Leerzeichen, abgeschnittenes Log) |
| `BuildTests` | Build-Store mit Fake-latexmk (nie parallel, Aufträge zusammengefasst, Status, fehlendes MacTeX, Projektwechsel während Build) und echte latexmk-Builds (nur mit MacTeX): Mini-Dokument in Pfad mit Leerzeichen, Fehler im Kapitel mit Datei/Zeile, „alles aktuell“-Build behält Warnungen |
| `SyncTeXTests` | gzip (auch Kopf mit Dateiname, abgeschnittene/fremde Daten), Parser, Vorwärts- und Rückwärtssuche gegen Referenzwerte der `synctex`-Kommandozeile (Fixture `two-chapters.synctex.gz`), Leerzeile/Zeile hinter dem Ende, Pfade mit `./`, Symlink und Leerzeichen, Koordinatenumrechnung, Nachladen bei kaputter Datei; mit MacTeX zusätzlich frisch kompiliertes Dokument live gegen die Kommandozeile |
| `InsertionTests` (3 Suites) | Maskierung, Label-Namen (eindeutig, Umlaute), Blockplatzierung, alle Generatoren gegen exakte Muster aus dem HgbThesis-Tutorial, Tabelle (Größe, Excel-Einfügen, Linien), Projektkatalog (Labels, .bib mit einzeiligen Einträgen, graphicspath), Bild-Import (Bereinigung, Nummerierung, gleicher Inhalt, nicht unterstützte Formate) |
| `EditorInsertionTests` | echter Coordinator: Block in eigenen Zeilen, ein Undo-Schritt (Undo/Redo), Markierung ersetzen vs. dahinter, Fließtext, keine Doppelausführung, markierter Text |
| `InsertionCompileTests` | nur mit MacTeX: alle Bausteine (inkl. aller 27 Sprachumgebungen, Bild-Kopie, Verweise, Zitat) in einer **Kopie** des Demo-Projekts (`Testdaten/HgbDemo`, Nachbau der HgbThesis-Vorlage) kompilieren |
| `EditorTabsTests` (3 Suites) | Tab-Logik (Datei- und Diff-Tabs): Öffnen rechts vom aktiven, Vorschau-Tab ersetzen/festhalten, Schließen (Nachbar), Andere/Alle, Wechsel mit Umbruch, Verschieben, Gedächtnis pro Projekt |
| `EditorTabStoreTests` | mit echten Dateien: Sitzung des ersetzten Vorschau-Tabs wird freigegeben, Bearbeitung hält fest, Wechsel behält Änderungen, Schließen, gleiche Datei in zwei Schreibweisen, schnelles Öffnen ohne verwaiste Sitzungen, gelöschte Dateien, Wiederherstellung, Änderungsmeldung |
| `FileOperationsTests` | Namensprüfung, `.tex` ergänzen, Anlegen/Kollision, Umbenennen (auch nur Groß-/Kleinschreibung), Duplizieren, Verschieben und seine Grenzen, Zielordner, leere Ordner im Baum |
| `ReferenceUpdaterTests` | include/input mit und ohne Endung, Kommentare, Bilder mit graphicspath, bibliography mit Liste, Ordner, relative Pfade, Umlaute/Emoji, ähnliche Namen bleiben |
| `FileActionsTests` (unter `AppModelSuite`) | App-Ebene mit Ersatz-Papierkorb: Neue Datei, Umbenennen mit Tabs/Änderungen/Verweisen, „Nur umbenennen“/Abbrechen, Hauptdatei, Ordner, Verschieben, Papierkorb inkl. Schutz, Duplizieren, Dialog-Fehler; mit MacTeX: nach Umbenennen kompiliert das Projekt weiter |
| `LineDiffTests`, `DiffLayoutTests` | Zeilen-Diff (Nummern, leere Seiten, `\r\n`, verschobene Zeilen), Wort-Hervorhebung (nur geänderte Wörter, LaTeX-Befehle als ein Token, keine bei völlig verschiedenen Zeilen), 600 Zufallsfälle: Diff ergibt alten und neuen Text exakt und ist minimal (gegen Referenz-LCS), Grenze für Bearbeitungsschritte; Einklappen unveränderter Bereiche |
| `GitStatusTests` (2 Suites) | Parser für `git status --porcelain=v2 -z` (Branch, neues Repository, losgelöster HEAD, alle Statusarten, Leerzeichen/Umlaute, Umbenennung) plus echte Git-Ausgabe; Git finden, Umgebung, Fehlermeldungen, relevante Ereignisse in `.git`, Projekt im Unterordner |
| `GitStoreTests` | echte temporäre Repositories (ohne globale Git-Konfiguration des Nutzers): Status und Markierungen, Bereitstellen/Zurücknehmen (auch ohne ersten Commit), Commit (mehrzeilig, Sonderzeichen, alles inkl. neuer Dateien), Fehler (Identität, Hook, leere Nachricht), Diff-Tabs (Index/HEAD, neu, gelöscht, umbenannt, binär, folgt beim Bereitstellen, Umschalten der Seite, schließt nach Commit, aufgeklappte Bereiche pro Tab), Unterordner, Status schreibt den Index nicht |
| `GitActionsTests` (unter `AppModelSuite`) | App-Ebene: Commit mit Speichern-Nachfrage und „Alle committen“, Abbrechen, Diff als Tab (Vorschau-Platz mit Dateien geteilt, fester Diff-Tab, Wechsel ohne Sitzung, folgt beim Bereitstellen, schließt nach Commit, wird nicht gemerkt), externe Änderungen und Commits im Terminal erscheinen per FSEvents, ohne Repository fällt die Seitenleiste auf Dateien zurück; Diff ohne gespeicherten Inhalt deckt den Editor vollständig ab (Pixelmessung) |
| `GitRemoteTests` | gegen ein lokales Bare-Repository plus zweiten Klon („anderer Rechner“): Abrufen → ↓, Pull (Vorspulen), Push, Upstream beim ersten Push eines neuen Branches, auseinandergelaufen (Pull bricht ab, Push abgelehnt, nichts geht verloren), Pull würde überschreiben (Datei genannt), Branches wechseln/anlegen inkl. ungültiger und doppelter Namen, ohne Remote, Stand aus HEAD |
| `ChangeMarksTests`, `DiskSyncTests` | Marken (neu, geändert, gelöscht darüber/am Ende, unverändert); offene Dateien: stilles Neuladen nur des geänderten Teils (Undo geleert), eigenes Speichern ignoriert, Konflikt mit „Behalten“/„Neu laden“, Verwerfen ohne Plattenänderung, Latin-1, gelöschte Datei |
| `GitPhase2Tests` (unter `AppModelSuite`) | App-Ebene: Pull lädt unveränderte offene Dateien neu und markiert geänderte, Branch-Wechsel schließt Tabs fehlender Dateien, Branch aus dem Terminal erscheint, FSEvents lädt neu, Änderungsmarken beim Tippen und nach dem Commit weg, Marken im echten Ruler gezeichnet (Pixelprüfung) |
| `GitResetTests` (Plan + unter `AppModelSuite`) | Zurücksetzen auf den letzten Commit: Plan (HEAD vs. neu, Umbenennung, Konflikt, ohne Commit); bereitgestellte Änderung in einem Schritt (Fall vorwort.tex) mit Datei-Tab statt Diff, Sicherung und Rückgängig; ungespeicherter Text in Sicherung und Rückgängig; neue Dateien (Papierkorb, Tab zu, zurück samt Tab); gelöscht/umbenannt; Abbrechen |
| `GitDemoProjectTests` | Repository aus einer Kopie des Demo-Projekts (Commit, bereitgestellt, nicht bereitgestellt, neu): Status und alle Diffs lesen ändert in `.git` nichts (Index byte-gleich); Statuslauf-Budget |
| `DemoProjectTests` | Das Demo-Projekt hat den vorausgesetzten Aufbau: Hauptdatei, Labels, Literatur, `graphicspath`, genau ein unbekannter Verweis, ungenutztes Label und Quelle, Klassenoptionen lesbar, alle 27 Sprachumgebungen definiert |
| `CompletionTests` (mehrere Suites, App-Ebene unter `AppModelSuite`) | Kontext (Befehle, `\\`, Argumente mit `[…]`/`*`, Listen, Kommentare, UTF-16), Sortierung, Einfügen (Gerüste, Klammern, Komma, `\begin` mit Einrückung, kein doppeltes `\end`), Projektindex (Makros/Umgebungen aus `.tex` und `.sty`, Bilder, Dateien), offene Umgebungen, ungespeicherte Labels; echter Editor: `\ref{` → Liste → Filtern → Return (ein Undo-Schritt), `\beg` + Tab → Umgebungen → Gerüst, Tastatur/Esc/Menü, keine Liste in Kommentaren/ohne Automatik/bei Einfügen; Popup pixelgleich mit frisch aufgebauter Liste (Regression: Reste früherer Treffer); Index folgt Projekt und Speichern |
| `CompletionOptionTests` | Optionen in `[…]`: Erkennung (Bilder, Gleitumgebungen, tabular, Zitate mit zwei Klammern, Klasse/Paket mit Namen dahinter, Schlüssel vs. Wert) und Abgrenzung (`\section[`, `\\[`, Kommentar, `itemize`); Einfügen (`key=`, vorhandenes `=`, Wert, Schalter in Listen, `]` bei Einzelwerten); Scanner gegen HgbThesis-Ausschnitte (`\DeclareKeys` ohne veraltete auch über zwei Zeilen, Registrierung, true/false, Themes, Studienrichtungen, Kommentar-Werte); Vorschläge; echter Editor: `\includegraphics[wi` → `width=` → Werte → `0.8\textwidth`, `\begin{figure}[` → `H]` |
| `BibliographyTests` (mehrere Suites, App-Ebene unter `AppModelSuite`) | `.bib`-Parser (verschachtelt, `"…"`, Zahl, `#`, Kommentare), Katalog mit Autor/Jahr, Autoren-Umwandlung, Schlüssel (Umlaute, eindeutig, Titelwort), Formatierung und Maskierung, Zieldatei aus `\bibliography`, Abstand beim Anhängen; „Quelle“: Formular Buch exakt, Pflichtfelder, Webseite mit heutigem Abrufdatum, BibTeX einfügen (Felder unverändert, Schlüssel ersetzt), eigener Schlüssel; Zitat-Suche nach Autor/Titel/Jahr; App: Eintrag ans Ende der `.bib` + `\cite[S.~3]{…}` im Editor, offene geänderte `.bib` im Editor mit Undo |
| `TextEditingTests`, `TypingTests` | Klammern (Paar, überspringen, `$`, `\{`, Auswahl umschließen, Paar löschen), Enter (Einrückung, `\end` mit Argumenten, kein doppeltes, `\item` fortsetzen/beenden), Kommentar (Einrückung, gemischt), Ein-/Ausrücken (Leerzeichen), Zeilen verschieben/verdoppeln/löschen am Rand, Formatierung umschalten; echter Editor mit **echten Tastatur-Ereignissen**: Klammern zusammen mit der Vervollständigung, Enter in `itemize`, Tab/⇧Tab, Menübefehle mit Undo, abschaltbar |
| `RecoveryTests` | Sicherung kurz nach der Eingabe, Speichern löscht; Absturz → Wiederherstellen (ungespeichert) bzw. Verwerfen; „Nicht speichern“ löscht, veraltete verschwinden (Regression: Tabs-Wiederherstellen löschte die Sicherung vor der Rückfrage) |
| `BuildCancelTests`, `RealLatexmkTests` (echtes latexmk, übersprungen ohne MacTeX) | Abbrechen: Status, Vorgemerktes entfällt, kein PDF-Neuladen; Meldungsreihenfolge mit Umlauf; **echter Abbruch** eines 40-s-Dokuments beendet latexmk samt pdflatex binnen Sekunden (Gegenprobe: ohne Signal 40 s); Hilfsdateien löschen lässt PDF und Text stehen, „Abbrechen“ ändert nichts |
| `QuickOpenMatcherTests`, `PaletteTests` | unscharfe Suche (Name vor Pfad, Reihenfolge, offene zuerst, Grenze), Kandidaten nur .tex/.bib, Gehe zu Zeile |
| `WordCounterTests`, `WordCountStoreTests`, `StatusBarTests` | Wörter (Satzzeichen, Zahlen, Bindestrich, Kommentare, Präambel, Befehle und Schlüssel, Formeln, Code, Umgebungsargumente, Akzente), entprellte Zählung offener Dateien, Projektsumme mit Platte/Editor, Cache nach Änderungsdatum, Cursormeldung mit Spalte und Auswahlwörtern, Zahlenformat, Zoom |
| `ProjectSearchTests`, `SearchStoreTests`, `SearchActionsTests`, `EditorFindTests` | Treffer (Zeile, Auszug, ganzes Wort, Grenze, lange Zeilen, Surrogatpaare), Ersetzen (veraltete Treffer, Längenänderung), entprellte Suche mit offenen Texten, **Ersetzen nur ungespeichert und mit ⌘Z, Platte unverändert, aktiver Tab bleibt**; ⌘F-Kürzel und Suchleiste erscheint |
| `LatexReferencesTests`, `ReferenceCheckTests` | Schlüssel mit Bereich (Listen, Optionen, Stern, hyperref, Kommentare, Code, `\verb`, `#1`, `\nocite{*}`), Prüfung, Bib-Zeilen, benutzte Labels/Zitate im Index, Unterstreichung als temporäre Attribute (Bereich, Tooltip, kein Text geändert), Hinweise, Projekt-Ende-zu-Ende |
| `RenamingOccurrenceTests`, `RenamingDetectionTests` | Umbenennen: Fundstellen je Art (Labels, Zitate in Text und .bib mit `crossref`/`xdata`, ohne auskommentierte Einträge und `@string`; Abkürzungen aus acronym/acro/glossaries; Befehle ohne längere Namen und ohne `\\name`; Umgebungen mit Definition), Paar mit Verschachtelung, Erkennung unter dem Cursor, Namensprüfung je Art |
| `JumpTargetTests`, `CommandClickTests`, `NavigationActionsTests` | Ziele im Text (Ränder, Listen, mehrzeilig), Dateiauflösung, ⌘-Klick auf Text zeigt im PDF, Kontextmenü mit allen Umbenennen-Möglichkeiten; Umbenennen auf App-Ebene: Label (nur dieses Label, keine Zitate, ungespeichert, ⌘Z, Platte bleibt), echter ⌘-Klick und Kontextmenü |
| `InterfaceZoomTests`, `FontSizeTests` (Zoom) | Stufen und Enden, Übernahme der alten Editorschrift, Text/leerer Zustand/Tab-Leiste wachsen bei 150 %, Wurzel liest den gemerkten Zoom; Editor, offene Datei und Ruler folgen dem Zoom |
| `StabilizationTests` (teils App-Ebene unter `AppModelSuite`) | Text ohne Text-View ersetzen mit Undo/Redo; Verweise anpassen in geänderter offener Datei ist eigener Rückgängig-Schritt, früheres Tippen bleibt rückgängig machbar; Git erholt sich nach kaputtem `HEAD`; Quelle anlegen mit `.bib` vorne (Zitieren blockiert); aufgeklappte Ordner überstehen Tabwechsel, Projektwechsel setzt zurück; Build-Dauer mit Komma; Einfügen-Blocker |
| `BibTokenizerTests`, `BibSessionTests` | BibTeX-Farben: Typ, Schlüssel, Feldnamen, Klammern, `"`, `#`, `@string`-Makros, `\TeX` in Werten, Text außerhalb und `@comment` als Kommentar, runde Eintragsklammern, mehrzeilige Werte (Zustand), kaputter Eintrag erholt sich, Zufallsabgleich inkrementell gegen komplett; Sprache nach Endung, Sitzung färbt `.bib`, Umbenennen in `.tex` färbt neu (ohne „geändert“) |
| `CapitalizationTests`, `WritingHintsTests`, `AutoCapitalizationTypingTests` | Satzanfang (nach `.!?`, Zeilenende, Absatz, Klammer/`\enquote` davor) und „ZWei“ Großbuchstaben; keine Korrektur nach Abkürzungen, Zahlen, „…“, Komma, am Textanfang, bei „IDs“/„API“/„LaTeX“/„iOS“, nach Befehlen, in Code-Umgebungen. Schreibhinweise je Regel samt Ausnahmen, nur Fließtext (Präambel, Mathe, Schlüssel, Optionen, Kommentare, Code, `\verb` frei). Im echten Editor: Korrektur beim Weitertippen und mit Enter, ⌘Z nimmt nur die Korrektur zurück und lässt den Cursor stehen, Wiederholen; Befehle/Mathe/Kommentar/Code/Abkürzung bleiben; abschaltbar |
| `EditorSettingsValueTests`, `EditorThemeTests`, `EditorSettingsEditorTests`, `IndentationTypingTests`, `SettingsWindowTests` | Einstellungen: Standardwerte und ungültige Werte (eigene UserDefaults-Suite, nie die echten), Kontrast aller Farbschemata hell/dunkel (≥ 4,5:1, Hoher Kontrast ≥ 7:1), Standard = bisherige Farben; Absatzstil (Zeilenabstand, Tabbreite), Übernehmen ohne Bearbeitungsschritt, Zeilenumbruch aus/an, Zeilennummern und aktuelle Zeile abschaltbar, Rechtschreibung aus/Sprache; Einrückung mit Leerzeichen bei Tab-Taste, Enter, ⌘]/⌘[; Fenster baut sich auf |
| `LatexSourceTests`, `FileEventTreeTests`, `IndexChangeTests`, `RecoveryFailureTests` (+ `referenceEditsEncodingAndFailures`, `appendKeepsBibliography`) | Eine Kommentar-Regel (Escapes, `\r\n`, gleiche Länge, Byte-Fassung der Gliederung stimmt überein), `\verb|%|` versteckt nichts, Latin-1 lesen; Baum nur bei echten Änderungen (nicht bei `.aux`/`.log`, nicht bei atomarem Speichern); Index meldet sich nur bei Änderung, Hinweise nur nach Textänderung; Sicherungsfehler einmal gemeldet; Verweise in Latin-1-Dateien bleiben Latin-1, Schreibfehler gemeldet; `.bib` in Latin-1 bleibt erhalten, unlesbare wird nie überschrieben |
| `PerformanceTests` | 10.000-Zeilen-Dokument mit festen Budgets (siehe unten) |

Testdaten entstehen in temporären Ordnern (`TemporaryProject`) oder als Kopie des Demo-Projekts `Testdaten/HgbDemo` (`DemoProject.copy(to:)`). `../Thesis` (die echte Abschlussarbeit) wird nie verwendet, auch nicht lesend.

Die Log-Fixtures in `Tests/LatexEditorTests/Fixtures/` sind echte Logs. Neu erzeugen: Mini-Dokument in einem Ordner anlegen und mit denselben Einstellungen wie die App kompilieren (`PATH=/Library/TeX/texbin:… max_print_line=10000 error_line=254 half_error_line=238 latexmk -pdf -synctex=1 -interaction=nonstopmode -file-line-error -cd main.tex`), dann `main.log` bzw. `main.blg` kopieren. Keine persönlichen Pfade einchecken.

`@MainActor`-Tests laufen selbst auf der Main-Queue. Vorgemerkte Arbeit (`DispatchQueue.main.async`) läuft deshalb nur, wenn der Test per `await Task.sleep` die Queue freigibt, nicht mit `RunLoop.run`.

### Performance-Budgets

Budgets gelten für den Debug-Build und haben etwa 3-fachen Puffer zum Messwert (Intel-Mac, 14.10.2026). Ein Test schlägt fehl, wenn der schnellste von mehreren Läufen das Budget überschreitet (unabhängig von Lastspitzen im Gesamtlauf).

| Messung | Debug | Release | Budget |
| --- | --- | --- | --- |
| Zeilenindex aufbauen | 2,7 ms | 0,7 ms | 10 ms |
| Zeilenindex, eine Bearbeitung | 0,033 ms | 0,014 ms | 0,25 ms |
| Komplett tokenisieren (Hintergrund) | 40 ms | 6,7 ms | 120 ms |
| BibTeX komplett färben, 2.000 Einträge (Hintergrund) | 47 ms | – | 150 ms |
| Schreibhinweise komplett ohne Sitzung (fast nur ICU-Regex, Release kaum schneller) | 300 ms | – | 1.000 ms |
| Prüfung einer offenen Datei: einmal maskieren, Verweise, Hinweise mit Zeilenzuständen (Hintergrund, 0,6 s nach der Eingabe) | 282 ms | – | 850 ms |
| Datei öffnen inkl. Einfärben | 64 ms | 26 ms | 200 ms |
| Einstellung geändert: Schrift und Absatzstil übernehmen | 9,6 ms | – | 30 ms |
| **Tastendruck** (Index + Highlighting + Attribute) | 0,125 ms | 0,06 ms | 0,5 ms |
| `$` tippen und löschen (je ein Absatz neu) | 0,9 ms | 0,7 ms | 3 ms |
| Rechtschreib-Tokens für einen Absatz | 0,11 ms | 0,02 ms | 0,5 ms |
| Ruler, sichtbarer Bereich | 0,036 ms | 0,026 ms | 0,25 ms |
| Sprung zu Zeile 9.000 inkl. Layout + Ruler | 9–17 ms | 7 ms | 40 ms |
| Gliederung parsen (Hintergrund) | 34 ms | 6,7 ms | 100 ms |

| Log-Parser, 5-MB-Log (Hintergrund) | 785 ms | 53 ms | 2.000 ms |
| SyncTeX laden, 400 Seiten / 250.000 Einträge (Hintergrund) | 1.425 ms | 180 ms | 4.000 ms |
| SyncTeX: eine Vorwärts- + eine Rückwärtsabfrage | 0,47 ms | 0,084 ms | 1,5 ms |
| Git-Diff, 10.000 Zeilen, 100 verstreute Änderungen (Hintergrund) | 116 ms | 24 ms | 350 ms |
| Git-Diff, 10.000 Zeilen, jede Zeile geändert (Hintergrund) | 1.300 ms | 231 ms | 4.000 ms |
| Git-Diff, ungünstigster Fall (umsortierte Bausteine, Grenze greift) | 890 ms | 155 ms | 2.700 ms |
| Git-Status des Demo-Projekts inkl. Prozessstart (einzeln; im parallelen Komplettlauf bis ca. 150 ms) | 18 ms | – | 300 ms |
| Vervollständigung: Kontext pro Tastendruck (Argument am Ende einer 2.000-Zeichen-Zeile) | 0,015 ms | 0,013 ms | 0,05 ms |
| Vervollständigung: 5.000 Vorschläge filtern und sortieren | 9,7 ms | 2,1 ms | 30 ms |
| latexmk Mini-Dokument (Info, kein Budget) | ca. 1,2–1,4 s | – | – |

Nicht abgedeckt: Layout und Zeichnen in einem echten Fenster beim Tippen. Das lässt sich nur manuell oder mit Instruments prüfen (siehe unten).

## Messen in der laufenden App

```bash
/usr/bin/log stream --level debug --style compact --predicate 'subsystem == "de.maxieder.LatexEditor"'
```

Zeigt pro Bearbeitung `Edit: x ms, n Zeilen` sowie `FileTreeLoad`, `OutlineParse`, `PrepareDocument`, `ApplyInitialColors`, `SaveFile` und `PDFReload`. Unter zsh `/usr/bin/log` schreiben, `log` ist dort ein Builtin.

```bash
sample LatexEditor 5 -file ~/Desktop/sample.txt
```

Während des Samplings tippen oder scrollen. In `sample.txt` unter „Sort by top of stack“ sollten keine eigenen Funktionen (`LatexEditor`) weit oben stehen.

## Manuelle UI-Checkliste

Vorbereitung: `scripts/build-app.sh`, dann `open build/LatexEditor.app`. Für Belastungstests eine große Datei in einem **eigenen Testordner** anlegen, nicht in `../Thesis`. Am einfachsten legst du mit `scripts/demo-projekt.sh` die Arbeitskopie an (`Testdaten/Arbeitskopie`) und kopierst ein Kapitel 50-mal hintereinander in eine `test.tex`.

### Sitzung 1: Grundfunktionen

| # | Aktion | Erwartung |
| --- | --- | --- |
| 1 | App starten | Zuletzt geöffnetes Projekt wird geladen, Hauptdatei ist offen. Editor und PDF füllen die ganze Fensterhöhe, der Text beginnt rechts neben den Zeilennummern |
| 2 | ⌘O, anderen Ordner wählen | Baum, Gliederung und PDF wechseln, bei ungespeicherten Änderungen erscheint eine Nachfrage |
| 3 | Filterfeld unten: „ein“ | Flache Liste mit relativen Pfaden; ✕ leert den Filter |
| 4 | Gliederung: Kapitel anklicken | Datei öffnet sich, Zeile ist ausgewählt und kurz hervorgehoben |
| 5 | Datei A bearbeiten, zu B wechseln, ⌘Z | Undo betrifft nur B. Zurück zu A: Undo-Verlauf, Auswahl und Scrollposition von A sind erhalten |
| 6 | Tippen | Oranger Punkt in der Pfadzeile. ⌘S lässt ihn verschwinden, die Gliederung aktualisiert sich |
| 7 | Pfadzeile in eingebundener Datei | `main.tex › einleitung.tex`, Klick auf `main.tex` öffnet die Hauptdatei |
| 8 | Ansichtsmodus und ⌘0 | Editor/Geteilt/PDF wechseln, Seitenleiste ein/aus, Trenner verschiebbar |
| 9 | PDF neu schreiben (kompilieren oder Datei ersetzen) | PDF lädt neu, Seite, Position und Zoom bleiben erhalten |
| 10 | Beenden mit ungespeicherten Änderungen | Nachfrage Speichern / Nicht speichern / Abbrechen |

### Sitzung 2: Syntaxfarben

| # | Aktion | Erwartung |
| --- | --- | --- |
| 11 | Datei öffnen | Sofort eingefärbt: Befehle blau, `{}` grau-blau, Labels/Zitate/Umgebungsnamen und `[…]` lila, Mathe grün, Kommentare grau, `\verb` und Verbatim braun. Prosa in `\section{…}` bleibt in Textfarbe |
| 12 | `50\% Rabatt` tippen | `\%` blau, kein Kommentar danach |
| 13 | In einem Absatz `$` tippen | Rest des Absatzes wird grün, aber **nicht** der nächste Absatz nach der Leerzeile. Zweites `$` beendet die Mathe |
| 14 | `\begin{equation}` tippen | Folgezeilen grün bis zur nächsten Leerzeile bzw. bis `\end{equation}` |
| 15 | `\begin{verbatim}` am Dateianfang tippen | Ganze Datei braun, `\end{verbatim}` tippen nimmt es zurück. Kurzer Ruckler beim ersten Mal ist bei sehr großen Dateien akzeptabel |
| 16 | `% Kommentar mit $x$ und \section{}` | Ganze Zeile grau, kein Grün |
| 17 | `\verb|$x$ % y|` | Alles braun, kein Kommentar |
| 18 | Hell/Dunkel in den Systemeinstellungen umschalten | Farben passen sich ohne Neustart an, alles gut lesbar |
| 19 | Undo/Redo nach Bearbeitungen | Farben stimmen nach jedem Schritt |
| 20 | Großen Text einfügen (z. B. 2.000 Zeilen) | Wird eingefärbt, keine spürbare Verzögerung |

### Sitzung 2: Zeilennummern

| # | Aktion | Erwartung |
| --- | --- | --- |
| 21 | Fenster schmal machen, lange Zeile | Nummer nur an der ersten visuellen Zeile, umbrochene Folgezeilen ohne Nummer |
| 22 | Cursor bewegen | Aktuelle Nummer kräftiger, sehr dezenter Streifen über die ganze logische Zeile (auch umbrochen), in Hell und Dunkel |
| 23 | Text markieren | Kein Streifen, solange eine Auswahl besteht |
| 24 | Datei mit 9 bzw. 100+ / 10.000+ Zeilen | Leiste wird bei mehr Stellen breiter, Nummern rechtsbündig |
| 25 | Leere Datei, Datei mit abschließendem Umbruch | Leere Datei zeigt „1“, nach letztem Umbruch erscheint eine Nummer für die leere letzte Zeile |
| 26 | Enter / Zeilen löschen | Nummern darunter aktualisieren sofort |
| 27 | Schnell scrollen, Scrollbalken ans Ende ziehen | Nummern laufen synchron mit, keine Lücken, kein Flackern |
| 28 | Gliederungsklick auf Kapitel weit unten | Sprung ohne spürbare Verzögerung, Nummern sofort korrekt |
| 29 | Datei wechseln | Nummern und Breite passen sofort zur neuen Datei |

### Sitzung 2: Rechtschreibung

| # | Aktion | Erwartung |
| --- | --- | --- |
| 30 | `\textbf{Fehlerr}` und `\label{sec:einleitng}` | „Fehlerr“ rot unterstrichen, Befehlsnamen und Label **nicht** |
| 31 | Mathe `$\alpha + \beta$` und `% Kommentr` | Keine Markierung |
| 32 | Falls Befehle doch markiert werden | Bitte melden: Dann greift weder der Delegate noch `setSpellingState`, ein dritter Weg ist nötig |

### Sitzung 2: Tipp-Performance (mit Instruments, sobald Xcode installiert ist)

| # | Aktion | Erwartung |
| --- | --- | --- |
| 33 | Große Datei (10.000 Zeilen), in der Mitte schnell tippen und Enter halten | Kein Ruckeln. Im Log `Edit:` unter 0,5 ms und meist „1 Zeilen“ |
| 34 | Instruments → Time Profiler beim Tippen | Hauptlast bei AppKit-Layout/Zeichnen, eigene Funktionen klein |
| 35 | Instruments → Points of Interest | Intervalle `Edit`, `PrepareDocument` usw. sichtbar |

### Sitzung 3: Dateiwechsel (Absturz-Regression)

| # | Aktion | Erwartung |
| --- | --- | --- |
| 36 | In einer langen Datei ans Ende gehen, dann im Baum eine kurze Datei öffnen | Kein Absturz, Cursor am Anfang bzw. an der gemerkten Stelle der kurzen Datei |
| 36a | Im Dateibaum mitten auf den Dateinamen bzw. das Icon klicken (nicht auf den Zeilenrand) | Datei öffnet sich beim ersten Klick; Doppelklick auf Bild/PDF öffnet es extern, Rechtsklick zeigt „Öffnen“ und „Im Finder zeigen“ |
| 37 | 10-mal abwechselnd über den Baum **und** die Gliederung zwischen Dateien wechseln | Jeder Klick wirkt, die UI bleibt bedienbar, Tabs lassen sich jederzeit wechseln |
| 38 | Denselben Gliederungseintrag mehrmals hintereinander anklicken (dazwischen scrollen) | Jeder Klick springt wieder zur Überschrift |
| 39 | Geöffnete, unveränderte Datei im Finder löschen | Editor wechselt zur Hauptdatei, Baum aktualisiert sich |
| 40 | Geöffnete Datei mit ungespeicherten Änderungen im Finder löschen | Datei bleibt offen, Pfadzeile zeigt „Gelöscht“, ⌘S legt sie neu an |

### Sitzung 3: Seitenleiste

| # | Aktion | Erwartung |
| --- | --- | --- |
| 41 | App ohne Projekt starten (in Ablage → Zuletzt geöffnet „Liste löschen“, `defaults delete de.maxieder.LatexEditor lastProjectPath`) | Seitenleiste zeigt „Kein Projekt geöffnet“ mit Button, der Button öffnet den Ordnerdialog |
| 42 | Ablage → Projekt öffnen … (⌘O) und Ablage → Zuletzt geöffnet | Öffnet das Projekt; die Liste zeigt die letzten Projekte, neueste zuerst |
| 43 | Icon-Tabs Dateien / Gliederung / Fehler durchklicken | Gewählter Tab blau gefüllt, Liste wechselt; Fehler-Tab zeigt Badge mit Anzahl |
| 44 | Tab wählen, anderes Projekt öffnen, zurück | Jedes Projekt merkt sich seinen Tab |
| 45 | Gliederung: Kapitel auf-/zuklappen | Hierarchie Kapitel (K) > Abschnitt (§) > Unterabschnitt (§§), Zustand bleibt beim Tabwechsel |
| 46 | Cursor im Editor durch mehrere Abschnitte bewegen | Nach kurzer Pause wird der aktuelle Abschnitt in der Gliederung blau hervorgehoben, auch dateiübergreifend |
| 47 | Statistikzeilen | Dateien, Abschnitte und Meldungen stimmen mit Baum, Gliederung und Fehlerliste überein |
| 48 | Filter in jedem Tab | Filter gilt nur für den aktiven Tab und bleibt pro Tab erhalten |

### Sitzung 3: Kompilieren und Fehlerliste

| # | Aktion | Erwartung |
| --- | --- | --- |
| 48a | Toolbar vor dem ersten Build | Rechts nur der Hammer, kein leeres Feld; genau ein Seitenleisten-Button (in der Seitenleiste, ⌃⌘S) |
| 49 | ⌘B bzw. Hammer in der Toolbar | Status „Kompiliert …“, danach „Erfolgreich“ oder „n Fehler · m Warnungen“; PDF lädt **einmal** neu, Seite/Position bleiben |
| 50 | Fehler einbauen (z. B. `\gibtsnicht` in einem Kapitel), ⌘S | Kompiliert automatisch („Beim Speichern kompilieren“), Status rot, Fehler-Tab mit Datei:Zeile, roter Punkt neben der Zeilennummer |
| 51 | Klick auf den Fehler in der Liste | Richtige Datei öffnet sich an der richtigen Zeile, auch mehrfach hintereinander |
| 52 | Klick auf die Statusanzeige in der Toolbar | Seitenleiste wechselt zum Fehler-Tab |
| 53 | Fehler beheben, ⌘S | Status grün, Liste leer, Punkt verschwindet |
| 54 | Mehrmals schnell hintereinander ⌘S / ⌘B | Nie zwei Builds gleichzeitig (Aktivitätsanzeige: nur ein `latexmk`), am Ende ein Build mit dem letzten Stand |
| 55 | Menü Ablage: „Beim Speichern kompilieren“ ausschalten, ⌘S | Kein Build; Einstellung bleibt nach Neustart erhalten |
| 56 | „Log anzeigen“ (Fehler-Tab oder Menü Ablage → Build-Log anzeigen) | Sheet mit latexmk-Ausgabe und `main.log`, scrollbar, Esc schließt |
| 57 | Warnungen in Paketdateien (TeX-Live-Pfade) | Eintrag ist nicht anklickbar (nur Info) |
| 58 | MacTeX vorübergehend unauffindbar (nur theoretisch) | Status „MacTeX fehlt“ mit Hinweis im Tooltip und im Fehler-Tab |
| 59 | Nach dem Test mit der Arbeitskopie | Eingebaute Testfehler entfernt, `git -C Testdaten/Arbeitskopie status` zeigt nur die bewusst angelegten Änderungen |

### Sitzung 4: SyncTeX (PDF folgt Cursor, ⌘J, ⌘-Klick)

Vorher einmal kompilieren (⌘B), damit `main.synctex.gz` existiert.

| # | Aktion | Erwartung |
| --- | --- | --- |
| 60 | In `einleitung.tex` Cursor in eine Textzeile, ⌘J (oder Darstellung → Im PDF zeigen) | PDF springt auf die Seite, Stelle etwa mittig, **ohne gelbe Markierung** |
| 61 | Dasselbe in mehreren Kapiteln nacheinander | Jedes Mal die richtige Seite |
| 62 | Pfeil-Schalter in der PDF-Leiste einschalten, durch ein Kapitel scrollen/klicken | PDF folgt nach kurzer Pause; solange die Stelle schon sichtbar ist, bleibt das PDF ruhig |
| 63 | Schalter aus, App neu starten | Schalter bleibt aus; an → bleibt an |
| 64 | ⌘-Klick auf einen Absatz im PDF | Richtige `.tex`-Datei öffnet sich (auch eingebundene Kapitel), Cursor in der richtigen Zeile |
| 65 | ⌘-Klick auf Inhaltsverzeichnis/Titelseite | Springt in `main.tex` oder passiert nichts – nie eine `.toc`/`.aux`-Datei |
| 66 | Normaler Klick und Textauswahl im PDF (ohne ⌘) | Verhalten wie bisher |
| 67 | Text ändern, ohne zu kompilieren, dann ⌘J | Kein Absturz; Position ggf. leicht daneben, nach ⌘S/⌘B wieder genau |
| 68 | ⌘J bzw. ⌘-Klick, während ein Build läuft | Kein Absturz; es gelten die Daten des letzten Builds |
| 69 | Projekt ohne bisherigen Build öffnen, ⌘J | Passiert nichts, kein Fehler |

### Sitzung 5: Einfügen-Menü

| # | Aktion | Erwartung |
| --- | --- | --- |
| 70 | Toolbar „Einfügen“ (Symbol, Pfeil daneben) und Menü Einfügen in der Menüleiste | Ganz oben „Einfügeoptionen …“ (⇧⌘I) öffnet das Fenster mit dem zuletzt benutzten Baustein, darunter die einzelnen Bausteine; ohne geöffnete .tex-Datei sind alle deaktiviert |
| 70a | Aussehen des Fensters (Hell und Dunkel) | Seitenleiste mit farbigen Symbolen, Kopf mit Titel und Beschreibung, Einstellungen auf Karten, Vorschau mit Farben wie im Editor, „Kopieren“ legt den Code in die Zwischenablage |
| 71 | Tabelle: Größe ändern, Zellen tippen (mit Tab springen), Ausrichtung pro Spalte | Vorschau unten ändert sich sofort; Kopfzeile fett |
| 72 | In Excel/Numbers Zellen kopieren, „Aus Zwischenablage einfügen“ | Raster passt sich an und enthält die Zellen |
| 73 | Zeichen wie `%`, `&`, `_`, `#` in Zellen und Beschriftung | In der Vorschau maskiert (`\%` …); mit abgeschaltetem Haken unverändert |
| 74 | Einfügen drücken | Code steht an der Cursorposition in eigenen Zeilen, Cursor dahinter, ⌘Z macht alles in einem Schritt rückgängig |
| 75 | Bild: Datei wählen oder per Drag & Drop ziehen (außerhalb des Projekts) | Beim Einfügen liegt es in `images/` (Dateibaum aktualisiert sich), Pfad ist nur der Dateiname (graphicspath) |
| 76 | Dasselbe Bild nochmal einfügen / anderes Bild mit gleichem Namen | Gleiches Bild: keine zweite Kopie; anderes: `…-2.png` |
| 77 | HEIC/SVG-Datei ziehen | Verständliche Meldung, nichts wird kopiert |
| 78 | Code markieren, Einfügen → Codeblock | Markierter Text ist der Inhalt und wird ersetzt; Sprache wählbar |
| 79 | Gleichung, Aufzählung (Punkte, Texte) | Passende Umgebung, Label nur bei nummerierter Gleichung |
| 80 | Verweis | Liste der Labels des Projekts; „Abbildung~\ref{…}“ mit Vorsatz |
| 81 | Zitat (mehrere Einträge mit ⌘ wählen, Seitenangabe) | `\cite[S.~12]{a,b}`; Titel der Einträge sichtbar |
| 82 | Eingefügte Tabelle/Bild/Code kompilieren (⌘B) | Keine Fehler; Verweise lösen auf |

### Sitzung 6: Tabs

| # | Aktion | Erwartung |
| --- | --- | --- |
| 83 | Datei im Baum einfach anklicken, dann eine andere | Es gibt nur einen kursiven Vorschau-Tab, er wird ersetzt |
| 84 | Doppelklick auf einen Tab oder auf die Datei im Baum | Tab wird fest (nicht mehr kursiv), der nächste Klick öffnet einen neuen Tab daneben |
| 85 | In einem Vorschau-Tab tippen | Tab wird fest, oranger Punkt statt Schließen-Symbol |
| 86 | Zwischen Tabs wechseln (Klick, ⇧⌘], ⇧⌘[) | Jede Datei behält Cursor, Scrollposition und Undo-Verlauf |
| 87 | ⌘W bei geänderter Datei | Nachfrage Speichern / Nicht speichern / Abbrechen; „Abbrechen“ lässt den Tab offen |
| 88 | Rechtsklick auf einen Tab | Schließen, Andere schließen, Alle schließen, Festhalten, Im Finder zeigen |
| 89 | Tabs per Ziehen umsortieren | Reihenfolge ändert sich, aktiver Tab bleibt aktiv |
| 90 | Projekt schließen/App beenden und neu öffnen | Dieselben Tabs sind wieder da, der aktive Tab ist aktiv |
| 91 | Gliederungs-Eintrag oder Fehler anklicken, dessen Datei schon als Tab offen ist | Wechselt zum vorhandenen Tab (kein zweiter) und springt zur Zeile |
| 92 | Viele Tabs öffnen | Leiste scrollt horizontal, der aktive Tab bleibt sichtbar |
| 93 | Alle Tabs schließen | Leere Anzeige mit Hinweis, kein Absturz; Datei im Baum öffnet wieder |
| 94 | Geöffnete Datei im Finder löschen | Tab verschwindet, Nachbar wird angezeigt; mit Änderungen bleibt er (durchgestrichen) |

### Sitzung 7: Dateien verwalten

| # | Aktion | Erwartung |
| --- | --- | --- |
| 95 | Rechtsklick auf Ordner → Neue Datei … („kapitel2“) | Datei `kapitel2.tex` entsteht im Ordner, öffnet in festem Tab, Ordner klappt auf |
| 96 | Name eingeben, der schon existiert | Meldung beim Tippen, „Anlegen“ deaktiviert; Name mit `/` wird abgelehnt |
| 97 | Neue Datei mit Haken „Kapitelüberschrift“ | Inhalt `\chapter{name}` |
| 98 | Neuer Ordner …, dann leer im Baum | Ordner erscheint auch leer |
| 99 | Datei umbenennen, die in `main.tex` per `\include` steht | Liste „Verweise anpassen?“ mit alt → neu; „Verweise anpassen“ ändert `main.tex`, Tab trägt den neuen Namen, ungespeicherte Änderungen bleiben |
| 100 | Dasselbe mit „Nur umbenennen“ und „Abbrechen“ | Nur umbenennen: Verweise bleiben (Build zeigt dann den Fehler); Abbrechen: nichts ändert sich |
| 101 | Bild im Ordner `images/` umbenennen | `\includegraphics{…}` wird angepasst, auch ohne Endung geschrieben |
| 102 | Ganzen Ordner (z. B. `chapters`) umbenennen | Alle Verweise darauf und alle offenen Tabs darin folgen |
| 103 | Hauptdatei umbenennen | Projekt kompiliert weiter mit neuem Namen, PDF heißt wie die neue Hauptdatei |
| 104 | Datei per Ziehen in anderen Ordner verschieben, auch auf freie Fläche (Projektordner) | Datei zieht um, Verweise werden angepasst; Ordner in sich selbst verschieben wird abgelehnt |
| 105 | Datei markieren, Entf bzw. Rechtsklick → In den Papierkorb legen | Rückfrage; Datei liegt im Papierkorb (wiederherstellbar), Tab schließt; mit Änderungen steht ein Hinweis |
| 106 | Hauptdatei oder Ordner mit offenen Tabs löschen | Zusätzlicher Hinweis; danach Hauptdatei bzw. Nachbar wird angezeigt |
| 107 | ⌘N und ⇧⌘N im Menü Ablage | Neue Datei bzw. Ordner im markierten Ordner oder Projektordner |
| 108 | Duplizieren | „name Kopie.tex“, wird geöffnet |
| 109 | Nach den Operationen kompilieren (⌘B) | Keine neuen Fehler durch kaputte Verweise |

### Sitzung 8: Git Phase 1

| # | Aktion | Erwartung |
| --- | --- | --- |
| 110 | Arbeitskopie des Demo-Projekts öffnen (`scripts/demo-projekt.sh`) | Toolbar zeigt `main` (ggf. ↑/↓), Seitenleiste hat den Tab „Änderungen“ mit Zahl; geänderte Dateien im Baum mit M/A/U, Ordner darüber mit Punkt |
| 111 | Ordner ohne Git öffnen | Kein Branch in der Toolbar, kein Änderungen-Tab |
| 112 | Datei bearbeiten und speichern (⌘S) | Erscheint nach spätestens ca. 1 s unter „Nicht bereitgestellt“ |
| 113 | Datei in der Liste anklicken | Diff öffnet als kursiver Tab mit ±-Symbol: rot/grün, geänderte Wörter kräftiger, „… n unveränderte Zeilen“ klappt per Klick auf; Kopfzeile mit +/−-Zahlen |
| 114 | Andere Datei in der Liste oder im Baum einfach anklicken | Ersetzt den kursiven Diff-Tab (ein gemeinsamer Vorschau-Platz); Doppelklick in der Liste hält den Diff-Tab fest |
| 114a | Zwischen Diff- und Datei-Tabs wechseln (Klick, ⇧⌘], ⌘W) | Dateien behalten Cursor und Scrollposition, Diffs ihre aufgeklappten Bereiche; im Diff-Tab ist Einfügen aus und Tippen landet nirgends |
| 115 | Datei mit ungespeicherten Änderungen im Diff | Hinweis „Ungespeicherte Änderungen sind nicht enthalten (⌘S)“ |
| 115a | Neue Datei anlegen, etwas tippen, **nicht** speichern, im Änderungen-Tab anklicken | „Noch kein Inhalt gespeichert“ auf leerer Fläche, kein Text des Editors sichtbar; nach ⌘S erscheinen die Zeilen grün mit + |
| 116 | + / − beim Darüberfahren, „Alle bereitstellen“ / „Alle zurücknehmen“; Datei mit beiden Seiten | Datei wandert zwischen den Gruppen, der Diff-Tab folgt; bei beiden Seiten Umschalter in der Kopfzeile. Nach dem Commit schließt der Diff-Tab von selbst. Nach Neustart sind nur Datei-Tabs wieder da |
| 117 | Nachricht tippen, ⌘↩ mit Bereitgestelltem | Commit nur des Bereitgestellten, Feld leert sich; `git log` im Terminal zeigt ihn |
| 118 | Nichts bereitgestellt, „Alle committen“ | Rückfrage mit Anzahl, danach alles committet (auch neue Dateien) |
| 119 | Commit mit ungespeicherter Datei | Nachfrage Speichern / Nicht speichern / Abbrechen |
| 120 | Im Terminal `git commit` oder `git checkout -b test` | Liste bzw. Branch in der Toolbar aktualisieren sich von selbst |
| 121 | Commit ohne gesetzte `user.email` (anderes Repo) oder mit ablehnendem Hook | Verständliche Meldung, nichts committet, Nachricht bleibt im Feld |
| 122 | Bild ändern und anklicken | „Binärdatei geändert“ |
| 123 | Hell/Dunkel umschalten | Diff-Farben bleiben gut lesbar |

### Sitzung 8: Git Phase 2

| # | Aktion | Erwartung |
| --- | --- | --- |
| 124 | Branch-Eintrag in der Toolbar anklicken | Menü mit Branches (aktueller mit Haken), „Neuer Branch …“, Abrufen, Pull, Push, „Änderungen anzeigen“ |
| 125 | Abrufen (Projekt mit Remote, nachdem auf einem anderen Rechner/GitHub gepusht wurde) | ↓-Zahl erscheint; ohne Abrufen fragt die App nie selbst |
| 126 | Pull mit unveränderter offener Datei | Datei zeigt sofort den neuen Stand, Cursor bleibt in der Nähe |
| 127 | Pull, während eine geöffnete Datei ungespeicherte Änderungen hat, „Nicht speichern“ | Pfadzeile: „Auf der Platte geändert – Neu laden / Meine behalten“; beides funktioniert |
| 128 | Lokal und Remote beide mit neuen Commits, Pull bzw. Push | Verständliche Meldung („auseinandergelaufen“ bzw. „Erst Pull“), nichts verändert |
| 129 | Push mit gespeicherter Anmeldung (Schlüsselbund) | Läuft durch, ↑ verschwindet; ohne gespeicherte Anmeldung: Meldung mit Hinweis aufs Terminal |
| 130 | Neuer Branch …, Name mit Leerzeichen bzw. vorhandener Name | Fehlermeldung; gültiger Name: Toolbar zeigt den neuen Branch, erster Push richtet den Upstream ein |
| 131 | Branch wechseln mit offenen Tabs | Inhalte folgen, Tabs von Dateien, die es dort nicht gibt, schließen; Baum und Gliederung aktualisieren sich |
| 132 | Bereitgestellte Datei: ↶ beim Darüberfahren (oder Rechtsklick, Dateibaum, „Zurücksetzen …“ im Diff-Tab) | Rückfrage nennt, was verloren geht („2 geänderte Zeilen gehen verloren“); danach Stand des letzten Commits, die Datei ist im Tab zu sehen, im Papierkorb liegt „name (verworfen …).tex“ |
| 133 | Direkt danach im Änderungen-Tab „Rückgängig“ | Inhalt wie vorher (auch vorher ungespeicherter Text), neue Dateien samt Tab zurück; die Datei steht wieder unter „Nicht bereitgestellt“ |
| 134 | In einer versionierten Datei tippen (ohne Speichern) | Nach ca. 0,3 s: oranger Streifen an geänderten, grüner an neuen Zeilen, rotes Dreieck, wo Zeilen gelöscht wurden; nach dem Commit verschwinden sie |
| 135 | Datei in einem anderen Editor ändern und speichern | Unveränderte offene Datei lädt von selbst neu; eigenes ⌘S löst keinen Hinweis aus |

### Sitzung 9: Autovervollständigung

| # | Aktion | Erwartung |
| --- | --- | --- |
| 136 | `\sec` tippen | Liste unter dem Cursor (`\section{…}`, `\section*{…}`, …), ↑↓ wählen, Return/Tab: `\section{}` mit Cursor in den Klammern; ⌘Z nimmt nur die Übernahme zurück |
| 137 | `\ref{` bzw. `\cref{a,` tippen | Labels des Projekts mit Datei:Zeile; „einl“ findet `cha:einleitung`; ein eben getipptes, ungespeichertes `\label{…}` ist schon dabei |
| 138 | `\cite{` mit Einträgen in der `.bib` | Schlüssel mit Titel; ohne Einträge (wie aktuell in `hgbreferences.bib`) erscheint keine Liste |
| 139 | `\includegraphics[width=…]{` | Bilder aus `images/` ohne Ordnerpräfix (wegen `\graphicspath`) |
| 140 | `\beg` + Tab, dann „item“ + Return | `\begin{itemize}` mit eingerücktem `\item` und `\end{itemize}`, Cursor nach `\item` |
| 141 | In einer offenen Umgebung `\end{` | Die innerste offene Umgebung steht oben |
| 142 | In `% Kommentar` oder `\begin{verbatim}` tippen | Keine Liste |
| 143 | Esc (ohne Liste), ⌃Leertaste bzw. Bearbeiten → Vervollständigen | Liste öffnet von Hand; Esc schließt sie wieder; Klick daneben oder Fensterwechsel schließt sie |
| 144 | Bearbeiten → „Automatisch vervollständigen“ aus | Keine Liste mehr beim Tippen, von Hand geht es weiter |
| 145 | Befehle der Vorlage (`\advisor`, `\MakeBibliography` …) und eigene `\newcommand` | Erscheinen als „aus dem Projekt“; neue Makros nach dem Speichern |
| 146 | Liste am unteren Fensterrand | Erscheint über statt unter der Zeile; Klick auf einen Eintrag übernimmt ihn |
| 147 | In `\documentclass[…]{hgbthesis}` hinter einem Komma tippen | `type=`, `degree=`, `theme=`, `language=` … (veraltete wie `oneside` fehlen); nach `type=` die Werte bachelor, master, …; nach `degree=` die 11 Studienrichtungen |
| 148 | `\includegraphics[` | `width=`, `height=`, `scale=` … und Schalter; Return auf `width=` öffnet die Werte (`\textwidth`, `0.8\textwidth` …) |
| 149 | `\begin{figure}[` bzw. `\begin{table}[` | `H`, `htbp`, `h` … mit Beschreibung wie im Einfügen-Menü; Übernahme schließt mit `]` |
| 150 | `\usepackage[|]{babel}` (Cursor zwischen den Klammern) | `ngerman`, `english` …; bei unbekannten Paketen keine Liste |
| 151 | `\cite[` | `S.~`, `vgl.` …, danach `]` |

### Sitzung 10: Quellen, Tippgefühl, Sicherung

| # | Aktion | Erwartung |
| --- | --- | --- |
| 152 | In `\cite{` einen Autornamen oder ein Titelwort tippen | Passende Einträge mit „Autor Jahr · Titel“, Treffer im Schlüssel stehen vorne |
| 153 | Einfügen → Quelle, Formular Buch ausfüllen, Einfügen | Eintrag am Ende von `hgbreferences.bib` im Stil der Vorlage, `\cite{Nachname2024}` an der Cursorposition; Kompilieren zeigt ihn im Literaturverzeichnis |
| 154 | Quelle → „BibTeX einfügen“ mit einem Eintrag aus Google Scholar | Wird übernommen, Schlüssel bei Umlauten/Dopplung angepasst |
| 155 | Pflichtfeld leer lassen | Hinweis „Bitte noch ausfüllen: …“, Einfügen gesperrt |
| 156 | `{`, `[`, `(`, `$` tippen; `}` tippen, wenn es schon dasteht; Rückschritt in `{}` | Paar mit Cursor dazwischen; Überspringen statt Verdoppeln; beide weg. Vor einem Wort kein Paar |
| 157 | Wort markieren, `{` bzw. `$` tippen | Wird umschlossen, bleibt markiert |
| 158 | `\begin{itemize}` + Enter, Text, Enter, Enter auf leerem `\item` | `\item` und `\end{itemize}` erscheinen, Liste setzt sich fort, leerer Punkt beendet sie |
| 159 | ⌘/, ⌘], ⌘[, ⌥↑/⌥↓, ⇧⌥↓, ⇧⌘K mit und ohne Auswahl | Wie im Menü Bearbeiten beschrieben, jeweils ein ⌘Z |
| 160 | Wort markieren, ⇧⌘B / ⌘I / ⇧⌘T, nochmal | `\textbf{…}`, `\emph{…}`, `\texttt{…}` und wieder zurück; ⌘B kompiliert weiterhin |
| 161 | ⌘+ / ⌘− / ⌥⌘0 | Schrift im Editor, in allen offenen Dateien und in den Zeilennummern ändert sich, bleibt nach Neustart |
| 162 | Tippen, ohne zu speichern, App per Aktivitätsanzeige „Sofort beenden“, neu öffnen | Rückfrage „Ungespeicherte Änderungen wiederherstellen?“; Text ist wieder da (ungespeichert) |
| 163 | Ablage → „Beim Verlassen der App speichern“, tippen, in eine andere App wechseln | Datei ist gespeichert |

### Sitzung 11: Aufräumen und Verständlichkeit

| # | Aktion | Erwartung |
| --- | --- | --- |
| 164 | Bild im Dateibaum umbenennen, während eine geänderte Datei es per `\includegraphics` nutzt, danach ⌘Z in dieser Datei | Erst wird nur die Verweis-Anpassung zurückgenommen, ein weiteres ⌘Z nimmt das eigene Tippen zurück; kein Absturz |
| 165 | `hgbreferences.bib` vorne, Einfügen → Quelle mit „Gleich zitieren“ | Hinweis, dass zum Zitieren eine .tex-Datei vorne sein muss; ohne den Haken „Quelle anlegen“ möglich |
| 166 | Ordner im Dateibaum aufklappen, zur Gliederung und zurück wechseln | Ordner bleiben aufgeklappt; ebenso zugeklappte Kapitel in der Gliederung |
| 167 | Filter mit Unsinn füllen, in allen vier Tabs | „Keine Treffer“ statt leerer Liste; Platzhalter nennt den Tab |
| 168 | App starten, noch nicht kompilieren | Toolbar „Noch nicht kompiliert“, Statistik „Meldungen: nicht kompiliert“; Klick auf eine Statistikzeile wechselt den Tab |
| 169 | Diff einer Datei öffnen, die auch als Datei-Tab offen ist | Tab heißt „name – Änderungen“; „Zurücksetzen …“ steht rot rechts, getrennt von „Datei öffnen“ |
| 170 | Rechtsklick auf „Bereitgestellt“/„Nicht bereitgestellt“ | „Alle auf letzten Commit zurücksetzen …“ nur dort, im Kopf nur + bzw. − |
| 171 | Kommentare im hellen Modus lesen | Deutlich lesbar, aber zurückgenommen gegenüber dem Text |
| 172 | Git im Terminal kurz kaputt machen (z. B. `.git/HEAD` umbenennen und zurück), dann eine Datei speichern | Änderungen-Tab erholt sich ohne Neustart |

### Sitzung 12: Zoom

| # | Aktion | Erwartung |
| --- | --- | --- |
| 173 | ⌘+ mehrmals, dann ⌘− und ⌥⌘0 | Editor, Zeilennummern, Seitenleiste (Symbole, Statistik, Listen, Filter), Tab-Leiste, Pfadzeile, PDF-Leiste wachsen und schrumpfen gemeinsam; bei 200 % bzw. 85 % ist der Menüpunkt ausgegraut |
| 174 | Zoom auf 150 %, App beenden und neu starten | Zoom bleibt, auch die Zeilennummern sind sofort groß |
| 175 | Bei 150 %: Diff öffnen, `\sec` tippen | Diff-Zeilen und Vervollständigungsliste in passender Größe, Liste sitzt unter dem Cursor |
| 176 | Bei 150 %: Einfügen-Fenster, Umbenennen-Dialog | Dialoge in normaler Größe |

### Sitzung 13: Kompilieren, Suchen, Verweise

| # | Aktion | Erwartung |
| --- | --- | --- |
| 177 | ⌘B, noch während es läuft ⌘. (bzw. Knopf „Abbrechen“ in der Toolbar) | Build bricht ab, Anzeige „Abgebrochen“, kein kaputtes PDF in der Vorschau; nächstes ⌘B läuft normal |
| 178 | Nach einem Build mit Meldungen ⌥⌘↓ und ⌥⌘↑ | Springt durch Fehler und Warnungen (Boxen nicht), die Zeile in der Fehlerliste ist hervorgehoben, nach der letzten geht es von vorn los |
| 179 | Ablage → „Hilfsdateien löschen …“ | Rückfrage; .aux/.log/.toc weg, `main.pdf` und Texte bleiben; nächstes Kompilieren geht |
| 180 | ⌘P, Teil eines Dateinamens tippen, ↑↓, ↩; Esc | Datei öffnet; Esc schließt; ⌘L, Zahl, ↩ springt (zu große Zahl: Dateiende); Ablage hat keinen Eintrag „Drucken“ mehr |
| 181 | Cursor bewegen, Text markieren, tippen und kurz warten | Statusleiste unten: Zeile/Spalte, „n Wörter ausgewählt“, Wörter der Datei und „Projekt: …“ ändern sich erst nach einer kurzen Pause; Zoom ⌘+ vergrößert sie mit |
| 182 | ⌘F im Editor, Begriff tippen, ⌘G, ⇧⌘G, Lupe → „Groß-/Kleinschreibung ignorieren“, ⌥⌘F | Suchleiste erscheint, Treffer werden markiert, Ersetzen-Zeile; **die Leiste darf die Zeilennummern nicht überdecken** (nur hier prüfbar) |
| 183 | ⇧⌘F, Begriff tippen; Klick auf einen Treffer; „Aa“, „ab“; Pfeil links für Ersetzen | Seitenleiste „Suchen“ mit Treffern nach Datei, Klick springt zur Zeile, Optionen filtern; Auswahl im Editor wird als Suchbegriff übernommen |
| 184 | Ersetzen: „Alle ersetzen“, dann in den Tabs ⌘Z; Finder oder `git status` ansehen | Rückfrage; alle betroffenen Dateien öffnen als Tabs mit Punkt (ungespeichert), ⌘Z nimmt zurück, auf der Platte ändert sich erst mit ⌘S etwas |
| 185 | `\ref{gibtsnicht}` und `\cite{unbekannt}` tippen | Nach etwa 1 s rot gestrichelt unterstrichen, Tooltip beim Darüberfahren (Tooltip nur hier prüfbar); Label anlegen oder Schlüssel korrigieren: Unterstreichung verschwindet |
| 186 | Fehler-Tab nach einem Projektstart | Abschnitt „Hinweise“: ungenutzte Labels und nicht zitierte Quellen, Klick springt zur Stelle |
| 187 | ⌘-Klick auf `\ref{…}`, `\cite{…}`, `\input{…}` | Sprung zum Label, zum Eintrag in der .bib bzw. zur Datei; bei gedrückter ⌘ zeigt der Mauszeiger über dem Ziel eine Hand (**nur hier prüfbar**); bei Tippfehler im Schlüssel ein Piepton |
| 188 | Rechtsklick auf ein Label bzw. ⌥⌘R mit Cursor darin | „Label „…“ umbenennen …“ mit Zahl der Stellen; danach alle Dateien als ungespeicherte Änderung, ⌘Z nimmt zurück; vorhandener Name wird abgelehnt |

### Sitzung 15: BibTeX-Farben, Autokorrektur, Schreibhinweise

| # | Aktion | Erwartung |
| --- | --- | --- |
| 189 | Sprung über Gliederung, Fehlerliste, Suche, ⌘L | Cursor steht in der Zielzeile, **kein gelbes Aufblitzen** mehr |
| 190 | `hgbreferences.bib` öffnen (Hell und Dunkel) | `@book` blau, Schlüssel und Feldnamen lila, Klammern grau, Werte normal; Text zwischen Einträgen grau; Rechtschreibung prüft Titel, nicht Feldnamen |
| 191 | Im Fließtext „Ende. das “ tippen, dann ⌘Z, dann weitertippen | „Das“ erscheint; ⌘Z macht nur „das“ daraus, Cursor bleibt hinter dem Leerzeichen, Weitertippen überschreibt nichts; Menü Bearbeiten zeigt „Autokorrektur widerrufen“ |
| 192 | „DIe “, „z. B. das “, „3. kapitel “, `\ref{x}. das`, in `$…$` und in `% …` tippen | Nur „DIe“ wird „Die“; nach Abkürzung, Zahl, in Befehlen, Mathe und Kommentar bleibt alles klein |
| 193 | Menü Bearbeiten → „Groß-/Kleinschreibung automatisch korrigieren“ aus | Nichts wird mehr korrigiert; nach Neustart bleibt es aus |
| 194 | „das das“, „Wort ,Wort“, „z.B.“, „...“, `"Zitat"` im Fließtext; kurz warten; darüberfahren | Blau gepunktet unterstrichen, Tooltip erklärt den Hinweis (**nur hier prüfbar**); in Präambel, Mathe, Code-Umgebungen und Kommentaren nichts |
| 195 | Menü Bearbeiten → „Schreibhinweise anzeigen“ aus und wieder an | Blaue Linien verschwinden sofort und kommen wieder; rote Linien unbekannter Verweise bleiben |
| 196 | Nach dem Kompilieren ⌘-Klick auf ein Wort im Fließtext; dann ⌘-Klick auf `\ref{…}` | PDF springt zur Stelle (ohne gelbe Markierung), Cursor steht am Klickpunkt; beim `\ref` springt der Editor zum Label statt ins PDF |
| 197 | Rechtsklick auf `@book{schluessel,` in der .bib bzw. auf `\cite{schluessel}`, „Quelle … umbenennen …“ | Dialog nennt Stellen und Dateien; danach .bib und alle .tex mit Zitaten als ungespeicherte Tabs, ⌘Z pro Datei; vorhandener Schlüssel wird abgelehnt |
| 198 | Rechtsklick auf `\begin{itemize}` | „Umgebung „itemize“ umbenennen (dieses Paar) …“, „enumerate“ eingeben: nur dieses `\begin` und das passende `\end` ändern sich (auch bei verschachtelten Listen) |
| 199 | Eigener Befehl (`\newcommand{\tool}`), eigene Umgebung (`\newenvironment`) und `\ac{…}` umbenennen | Definition und alle Verwendungen im Projekt; bei der eigenen Umgebung zwei Einträge (Paar / überall); auf `\section` oder Befehlen der Vorlage gibt es keinen Eintrag |

### Sitzung 15: Einstellungen

| # | Aktion | Erwartung |
| --- | --- | --- |
| 200 | ⌘, (bzw. LatexEditor → Einstellungen …) | Fenster mit vier Reitern; oben in „Darstellung“ eine Vorschau mit Zeilennummern |
| 201 | Farbschema durchschalten, Erscheinungsbild Hell/Dunkel/System | Vorschau und Editor wechseln sofort die Farben (auch Hintergrund und Zeilennummern-Leiste), Datei bleibt „unverändert“, ⌘Z hat nichts Neues |
| 202 | Schriftart (z. B. Menlo), Größe 16 pt, Zeilenabstand Weit | Editor, alle offenen Tabs und die Zeilennummern passen sich sofort an; ⌘+/⌘− zoomt weiter darüber hinaus |
| 203 | Zeilen umbrechen aus | Lange Zeilen laufen weiter, waagerechter Scroller erscheint; wieder an: umbricht am Fensterrand |
| 204 | Einrückung „2 Leerzeichen“, dann Tab-Taste, Enter nach `\begin{itemize}`, ⌘], Einfügen → Tabelle | Überall zwei Leerzeichen statt Tabulator; Tabbreite 8 verbreitert vorhandene Tabulatoren |
| 205 | Rechtschreibung: Sprache Englisch, dann aus | Deutsche Wörter werden rot unterstrichen (Englisch), danach gar keine Unterstreichung mehr |
| 206 | Zeilennummern bzw. aktuelle Zeile aus | Leiste bzw. dezenter Streifen verschwinden sofort |
| 207 | „Standard wiederherstellen“ in jedem Reiter; Menü Bearbeiten ansehen | Werte springen auf Standard zurück; im Menü Bearbeiten stehen die vier Schreib-Schalter nicht mehr |
| 208 | Teiler zwischen Editor und PDF greifen (auch knapp daneben), ziehen; ganz nach links/rechts ziehen | Der Mauszeiger wird über einer etwa 14 pt breiten Spalte zum Spalten-Pfeil, Ziehen klappt überall darin; Editor mindestens 180 pt, PDF mindestens 150 pt breit; die Scrollleiste des Editors bleibt greifbar |

### Sitzung 17: Einklappen

| # | Aktion | Erwartung |
| --- | --- | --- |
| 209 | Mit der Maus über die Zeilennummern fahren | Bei jeder Zeile mit `\chapter`/`\section`/…, `\begin`, Kommentarblock erscheint rechts neben der Nummer ein Dreieck; ohne Maus bleiben nur zugeklappte sichtbar |
| 210 | Dreieck bei `\section{…}` anklicken | Alle Zeilen bis zur nächsten Überschrift gleicher oder höherer Ebene verschwinden, hinter der Kopfzeile steht ein „⋯“-Feld; Leerzeilen vor der nächsten Überschrift bleiben; die Zeilennummern überspringen die Lücke |
| 211 | Auf das „⋯“-Feld klicken; nochmal Dreieck anklicken | Bereich klappt wieder auf, alles steht wie vorher, Cursor und Scrollposition bleiben |
| 212 | Cursor in einer Liste, ⌥⌘← mehrfach; dann ⌥⌘→ auf der Kopfzeile | Erst klappt `\begin{itemize} … \end{itemize}` zu, dann der umgebende Abschnitt (der Cursor steht an der Kopfzeile); ⌥⌘→ klappt den Bereich der Kopfzeile auf |
| 213 | Menü Bearbeiten → Einklappen → „Alles zuklappen“ in der Hauptdatei, danach „Alles aufklappen“ | Nur noch Überschriften sichtbar (`\begin{document}` bleibt offen); aufklappen stellt alles wieder her |
| 214 | Zugeklappte Kopfzeile: Pfeil rechts, ⌥→, Pfeil links von der Zeile dahinter, Ende-Taste | Pfeil rechts springt hinter den Bereich, links wieder an die Kopfzeile; Ende bleibt am Ende der Kopfzeile; ⇧→ markiert den ganzen Bereich in einem Schritt |
| 215 | Zugeklappt: Suchen (⌘F) nach einem Wort im Ausgeblendeten, Sprung über Gliederung/Fehlerliste/⌘L in die Lücke | Der Bereich klappt von selbst auf, der Treffer bzw. die Zeile ist sichtbar |
| 216 | Am Ende der zugeklappten Kopfzeile tippen; dann Rückschritt am Anfang der Zeile hinter dem Bereich | Tippen ergänzt die Kopfzeile, der Bereich bleibt zu; der Rückschritt klappt vorher auf (man sieht, was zusammenwächst) |
| 217 | Zugeklappten Bereich mit gedrücktem ⇧ von oberhalb bis unterhalb markieren, kopieren, in neue Datei einfügen | Der ganze Text inklusive Ausgeblendetem wird kopiert; die Datei ist weiter „unverändert“ (Zuklappen ist keine Änderung), speichern schreibt den vollen Text |
| 218 | Zuklappen, dann Tab wechseln und zurück; Datei schließen und neu öffnen | Beim Tabwechsel bleibt der Zustand; nach Schließen/Neustart sind alle Bereiche wieder offen (nur zur Laufzeit gemerkt) |
| 219 | Eine zugeklappte Kopfzeile bearbeiten (z. B. `\section{…}` umbenennen), Zeile darüber mit Enter einfügen | Bereich bleibt zu und wandert mit; Dreiecke und Nummern stimmen nach einer Sekunde |
| 220 | Datei mit großem Kapitel (>2.000 Zeilen) zuklappen und aufklappen, Scrollen | Kein Ruckeln, Scrollbalken passt sich an |

### Sitzung 18: Fachvokabular

| # | Aktion | Erwartung |
| --- | --- | --- |
| 221 | Im Fließtext tippen: „Eigenwertproblem“, „Hamiltonoperator“, „Qubits“, „Quantenfouriertransformation“, „Zufallszahlengenerator“, „Matrizen“, „Mutex“ | Keine rote Rechtschreib-Unterstreichung (**nur in der echten App prüfbar**: Ob der Filter in `didCheckTextIn` oder in `setSpellingState` greift, ist nicht automatisierbar) |
| 222 | „Eigenwertt“, „Matrixmultiplikazion“, „Algoritmus“, „Quatsch“ | Weiterhin rot unterstrichen |
| 223 | Einstellungen → Editor → Rechtschreibung: Sprache Englisch, dann wieder Deutsch | Beim Wechsel werden Wörter neu bewertet; keine Abstürze, Fachwörter bleiben unmarkiert |
| 224 | Fachwort, das im Vokabular fehlt, mit Rechtsklick „Rechtschreibung lernen“ | Wirkt wie bisher (persönliches Wörterbuch von macOS) |

### Sitzung 18: Position beim Wechsel der Ansicht

| # | Aktion | Erwartung |
| --- | --- | --- |
| 225 | Geteilt, PDF auf Seite 10 mit anderem Zoom scrollen, dann „Nur PDF“, dann zurück zu „Geteilt“ | PDF steht überall auf Seite 10 an derselben Stelle mit demselben Zoom |
| 226 | Im Editor weit nach unten scrollen und Cursor setzen, „Nur PDF“, dann „Nur Editor“ | Cursor und Scrollposition wie zuvor |
| 227 | Während „Nur Editor“ kompilieren, dann zu „Nur PDF“ | Neues PDF erscheint an der zuvor gemerkten Stelle (Seite bleibt, wenn sie noch existiert) |

### Sitzung 19: Design-Durchsicht, Einfügen-Fenster, Einstellungen

| # | Aktion | Erwartung |
| --- | --- | --- |
| 228 | Menü Darstellung: ⌘1, ⌘2, ⌘3; ⌥⌘1 bis ⌥⌘5 | Nur Editor / Geteilt / Nur PDF (Haken beim aktiven); Seitenleiste wechselt Dateien, Gliederung, Suchen, Meldungen, Änderungen |
| 229 | Menüs „Kompilieren“ und „Git“ öffnen (mit und ohne Git-Repository) | Alle Befehle aus Toolbar und Branch-Menü da; ohne Repository ist „Git“ ausgegraut; „Committen …“ ohne Nachricht springt in den Änderungen-Tab |
| 230 | Fehler, Warnung, Box und Git-Änderungen in der Zeilenleiste; Maus darüber | Kreis/Dreieck/Raute und gestrichelter Streifen für „geändert“; Tooltip mit Meldungstext bzw. „Geändert seit dem letzten Commit“ |
| 231 | Badge am Meldungen-Tab bei Warnungen (orange) und Fehlern (rot) | Zahl gut lesbar (schwarz auf Orange, weiß auf Rot) |
| 232 | Eine Datei umbenennen, die es schon gibt; Git-Push ohne Netz | Dialogtitel beschreibt die Lage („… konnte nicht …“), Grund darunter – nicht nur „Datei“/„Git“ |
| 233 | Einfügen-Fenster (⇧⌘I) mit Cursor mitten in einer .tex: Tabelle, dann Codeblock, Verweis | Rechts die echten Zeilen um den Cursor, der neue Code grün markiert an der richtigen Stelle; Beschriftung tippen ändert die Vorschau sofort; Fußzeile nennt Datei und Zeile; Einfügen ergibt genau das |
| 234 | Einfügen-Fenster: Quelle | Vorschau zeigt nur den BibTeX-Eintrag, Fußzeile „Neuer Eintrag in ….bib“ |
| 235 | ⌘, : Bereiche durchklicken, Suchfeld „tab“, „pdf“, „xyz“ | Systemeinstellungen-Optik (Symbol, Titel, Beschreibung); Suche zeigt passende Bereiche bzw. „Keine Treffer“; nach Schließen und Öffnen ist der letzte Bereich wieder da |
| 236 | Darstellung: Farbschema-Karten anklicken; System auf Dunkel umschalten | Editor und Vorschau wechseln sofort; Karten zeigen die dunklen Farben; kein eigener Hell/Dunkel-Schalter mehr |
| 237 | Seitenleiste einklappen (Button oder ⌃⌘S), Maus auf den Seitenleisten-Button, dann nach unten in die Vorschau, dann weg | Seitenleiste schwebt über dem Editor, bleibt beim Wechsel von Button zu Vorschau, verschwindet kurz nach dem Verlassen; Klick auf den Button klappt sie fest wieder aus; Dateien/Tabs in der Vorschau sind bedienbar |
| 238 | Seitenleiste ausgeklappt: Maus auf den Button | Keine Vorschau |
| 239 | Im Text `\textbf{a` tippen, dann `\begin{figure}` ohne `\end`, dann `Ein $x` und Leerzeile | Kurz nach der Tipp-Pause rot gestrichelt (`{a`, `\begin{figure}`, `$x`), Tooltip erklärt; nach der Korrektur weg |
| 240 | Dasselbe `\label{x}` in zwei Dateien; Seitenleiste Meldungen | Orange strichpunktiert, Tooltip nennt die andere Datei und Zeile; unter „Hinweise“ „Doppelte Labels (2)“ |
| 241 | Kompilieren mit einem Fehler und einer Warnung | Die Zeilen sind im Text unterstrichen (rot bzw. orange) zusätzlich zur Marke in der Zeilenleiste; Box-Warnungen nur in der Leiste |
| 242 | Einstellungen › Schreibhilfen: „Fehler und Warnungen im Text markieren“ aus | Alle roten/orangen Unterstreichungen außer unbekannten Verweisen verschwinden |
| 243 | Darstellung › Spaltenhilfslinie; Einstellungen › Editor › Spalte 100 | Feine Linie hinter dem Text bei Spalte 80 bzw. 100; aus: weg |
| 244 | Lange Datei scrollen | Rechts in der Pfadleiste „Kapitel › Abschnitt“ der obersten sichtbaren Zeile; Klick springt zur Überschrift; die Breite des Editors ändert sich dabei nie |
| 245 | Rechtsklick auf `\ref{…}`/`\label{…}`/`\cite{…}`/`\gls{…}` → „Verwendungen von … anzeigen …“; ⌥⌘U mit Cursor im Schlüssel | Popover am Text: Definition oben, Verwendungen nach Datei, Treffer fett; Klick springt hin und schließt |
| 246 | Projekt mit `.csv`, `.zip`, `.py`; nach dem Kompilieren | Alle erscheinen mit passendem Symbol; `.aux`, `.log` … nicht. Filtersymbol › „Build-Dateien zeigen“ blendet sie ein (Symbol gefüllt, blau) |
| 247 | Im Dateibaum: Datei umbenennen, dann ⌘Z (Fokus im Baum); ⇧⌘Z | Alter Name zurück samt Verweisen, Datei im Baum markiert; Wiederholen benennt wieder um. Im Editor bleibt ⌘Z beim Text |
| 248 | Datei in den Papierkorb, dann Ablage › „In den Papierkorb legen“ rückgängig machen (⌥⌘Z) | Datei kommt aus dem Papierkorb zurück |
| 249 | Bild aus dem Finder auf einen Ordner im Baum ziehen; ein zweites mit gleichem Namen | Ordner hebt sich beim Darüberziehen hervor; Kopie landet dort, das zweite als „name 2.png“; Original bleibt im Finder; ⌘Z entfernt die Kopie |
| 250 | Maus auf eine Bilddatei im Baum, dann auf den Pfad in `\includegraphics{…}` | Nach kurzer Pause Popover mit Bild, Maßen und Größe; Maus weg, Klick oder Tippen schließt |
| 251 | Einfügen › Bildbibliothek … (⌥⌘I), suchen, Doppelklick | Raster aller Projektbilder (ohne das PDF der Hauptdatei); Doppelklick öffnet das Einfügen-Fenster mit dem Bild |
| 252 | `\newacronym{api}{API}{…}` anlegen, `\gls{a` tippen; `\gls{xyz}`; ⌘-Klick auf `api` | Vorschlag „api – API – Application …“; `xyz` rot mit Tooltip; Sprung zur Definition; ungenutzte Abkürzungen unter „Hinweise“ |
| 253 | Toolbar links neben dem Projektnamen, Seitenleiste ein- und ausgeklappt | Genau ein Seitenleisten-Button (der des Systems); Hover darauf zeigt eingeklappt die Vorschau (#237), auch nach mehrmaligem Ein-/Ausklappen und Projektwechsel |
| 254 | Seitenleiste › Dateien: Filtersymbol links unten öffnen, `.sty` und `.cls` abwählen; dann `.sty` wieder wählen | Menü gruppiert die Endungen mit Anzahl, Häkchen = sichtbar; abgewählte Dateien verschwinden sofort samt leer gewordener Ordner; Symbol gefüllt und blau, Tooltip „2 Dateitypen sind ausgeblendet“; „Alle Dateitypen zeigen“ ist nur dann aktiv. Nach App-Neustart und in einem anderen Projekt bleibt die Auswahl. Alles abgewählt: Hinweis „Alle Dateien ausgeblendet“ mit Knopf |
| 255 | Dateityp ausblenden, dessen Datei gerade offen ist; dann im Filterfeld nach einer ausgeblendeten Datei suchen | Die offene Datei bleibt im Baum; die Suche findet ausgeblendete Dateien nicht und sagt „Ein Dateityp ist ausgeblendet“. Ob das Menü beim Umschalten offen bleibt: nein, es schließt sich (ein Typ pro Öffnen) |
