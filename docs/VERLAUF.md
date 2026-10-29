# Verlauf, Einschränkungen und Roadmap

Aus der früheren `CLAUDE.md` ausgelagert. Neueste Sitzung (20) zuerst im Abschnitt „Aktueller Stand“.

## Aktueller Stand

Fertig (Sitzung 1):
- Dreigeteiltes Fenster (Seitenleiste | Editor | PDF), Ansichtsmodus Editor/Geteilt/PDF, Seitenleiste ein/aus (⌃⌘S)
- Projekt öffnen (⌘O), letztes Projekt wird beim Start geladen, Hauptdatei per `\documentclass` bzw. `main.tex`
- Seitenleiste: Dateibaum (.tex, .bib, Bilder) mit Filter und Dateianzahl, Gliederung (chapter/section/subsection über Includes) mit Sprung zur Zeile
- Editor: Pfadzeile mit Include-Kette, Monospace, weicher Umbruch, Undo pro Datei, ⌘S / ⌥⌘S, Anzeige ungespeicherter Änderungen, deutsche Rechtschreibprüfung (de_AT, sonst de_DE/de)
- PDF: PDFKit, Neuladen bei Dateiänderung mit Seite/Position/Zoom, Zoom-Buttons, "Seite X von Y", Hinweis wenn kein PDF existiert

Fertig (Sitzung 2):
- Test-Infrastruktur: Swift Testing über `scripts/test.sh`, 67 Tests (Unit, Integration mit echtem TextKit, Zufallsabgleich inkrementell gegen komplett, Performance mit Budgets)
- Syntaxfarben, inkrementell pro Zeile mit Zustandskonvergenz, Hell/Dunkel über dynamische Farben
- Zeilennummern mit weichem Umbruch, nur sichtbarer Bereich, Breite nach Stellenzahl, aktuelle Zeile hervorgehoben (Nummer + dezenter Streifen im Editor)
- Rechtschreibfilter für LaTeX-Syntax
- Layout-Fix nach Nutzertest: Editor und PDF nutzen die volle Fensterhöhe, der Ruler übermalt den Text nicht mehr, und der Text beginnt rechts vom Ruler
- Messwerte (10.000 Zeilen, Intel, Debug / Release): Tastendruck 0,125 / 0,06 ms, Öffnen inkl. Einfärben 64 / 26 ms, Sprung zu Zeile 9.000 inkl. Ruler 9–17 / 7 ms

Fertig (Sitzung 3):
- Absturz beim Dateiwechsel behoben (Ursache: Ruler-Refresh vor dem Setzen der Auswahl → `Range out of bounds` → reentrantes Layout, UI hing). Klemm-Logik + Regressionstests; extern gelöschte Dateien werden behandelt.
- Seitenleiste neu: Icon-Tabs mit Fehler-Badge, Statistik, `.sidebar`-Listen, Filter unten, hierarchische Gliederung mit Ebenen-Kennzeichnung und aktuellem Abschnitt, leerer Zustand mit „Projekt öffnen“, Menü „Zuletzt geöffnet“, Tab pro Projekt
- Kompilieren mit latexmk (⌘B, beim Speichern), Statusanzeige in der Toolbar, Fehlerliste mit Sprung, Log-Sheet, Markierungen in der Zeilennummernleiste
- 110 Tests. Messwerte: Thesis-Build mit Fehler 3,9 s, „alles aktuell“ 0,3 s; Log-Parser 5 MB 785 ms Debug / 53 ms Release; Thesis-Log 1.791 Zeilen → exakt die eine echte Warnung

Fertig (Sitzung 3, Nachträge):
- Dateibaum: ganze Zeile klickbar (Tap-Geste entfernt), Doppelklick auf Ordner klappt auf/zu, Kontextmenü; Toolbar ohne leere Kapsel und ohne doppelten Seitenleisten-Button, Build-Optionen im Menü Ablage; App-Icon (`Resources/AppIcon.png` → `AppIcon.icns` im Build-Skript)

Fertig (Sitzung 4): SyncTeX ohne externe Werkzeuge
- „PDF folgt Cursor“ (Schalter in der PDF-Leiste und im Menü Darstellung), ⌘J „Im PDF zeigen“, ⌘-Klick ins PDF → Textstelle
- Abgeglichen mit der `synctex`-Kommandozeile (nur in Tests als Referenz): Fixture, frisch kompiliertes Dokument und die echte Thesis liefern dieselben Seiten/Positionen/Zeilen
- Messwerte: Thesis laden 62 ms (Debug); synthetisch 400 Seiten / 250.000 Einträge: Laden 1.425 / 180 ms, Abfrage 0,47 / 0,084 ms (Debug / Release)
- 130 Tests

Fertig (Sitzung 7): Dateien anlegen, umbenennen, verschieben, duplizieren, in den Papierkorb legen, mit Anpassung der Verweise (siehe Architektur). Nicht dabei: Rückgängig für Dateioperationen (Papierkorb ist das Netz), Umbenennen direkt in der Zeile (stattdessen Dialog), mehrere Einträge gleichzeitig, Verweise in `.bib` oder `.cls`.

Fertig (Sitzung 20, mit Skill `apple-design`): Hover-Vorschau der eingeklappten Seitenleiste (`SidebarPeek`). Diagnose im Text: `SyntaxChecker` (Klammern, `\begin`/`\end`, `$`/`$$`/`\(`/`\[`; Argumente von Definitionen wie `\newenvironment` zählen nicht für Umgebungen, 0 Fehlalarme im Demo-Projekt samt .cls/.sty), `DuplicateLabelChecker` (orange, auch in der Meldungsliste), Build-Fehler/-Warnungen unterstreichen die Zeile; alle Marken als `TextMark` mit Schwere: Fehler rot gestrichelt, Warnung orange strichpunktiert, Hinweis blau gepunktet (Muster statt nur Farbe), Schalter „Fehler und Warnungen im Text markieren“ (`errorsInText`). Spaltenhilfslinie (`columnGuideColumn`, Standard aus, Spalte 40–200). Abschnitt der obersten sichtbaren Zeile (`OutlineTree.sectionChain`, `OutlineStore.updateViewport`, Koordinator meldet entprellt) rechts in der Pfadleiste – **als `.overlay` des Spacers**: Als eigene Zeile oder normaler HStack-Teil beeinflusste er die Editorbreite → anderer Umbruch → andere oberste Zeile → anderer Abschnitt: Endlosschleife (Testlauf hing in `LineNumberRulerView.visibleLabels`). Bounds-Beobachtung des Clip-Views per Selektor statt Block-Observer, gemeldet wird nur bei geändertem Scroll-Ursprung und geänderter Zeile. **Ungesichert:** Dass der Block-Observer die Breitenberechnung störte, war nur eine Vermutung, nicht belegt (siehe „Lehren aus Sitzung 20“). „Verwendungen anzeigen“ (⌥⌘U, Rechtsklick; `UsageFinder`, Popover `UsageListView`) für Labels, Quellen, Abkürzungen, Befehle, Umgebungen. Dateibaum zeigt alle Dateien außer Build-Hilfsdateien (`BuildArtifacts`, Schalter im Filtermenü, `showsBuildFiles`), Symbole nach Art (`FileGlyph`). Rückgängig für Dateioperationen (`FileUndo`: Undo-Manager des Hauptfensters, ⌘Z bei Fokus im Baum, Ablage ⌥⌘Z/⇧⌥⌘Z; Angelegtes geht in den Papierkorb, Gelöschtes kommt daraus zurück; Umbenennen/Verschieben mit denselben Verweisanpassungen; `revealURL` zeigt das Ergebnis). Ziehen aus dem Finder kopiert (Namenskonflikt nummeriert), innerhalb verschiebt. Bildvorschau (`ImagePreviewLoader`, `GraphicsResolver`): Hover im Baum und auf `\includegraphics{…}`, Bildbibliothek (⌥⌘I, `ImageLibrarySheet`). Abkürzungen/Glossar: `Acronyms.definitions` (Kurz-/Langform), Vervollständigung in `\gls{`/`\ac{` …, unbekannte rot (nur wenn das Projekt überhaupt Definitionen hat), ungenutzte als Hinweis (`\glsaddall` = alle benutzt), ⌘-Klick zur Definition.

Fertig (Sitzung 19): Design-Durchsicht nach den Apple-Richtlinien (Skill `apple-design`) und Umsetzung: jeder Toolbar-Befehl auch in der Menüleiste (Darstellung: ⌘1/⌘2/⌘3 Ansicht, ⌥⌘1–5 Seitenleiste, Einklappen, PDF-Zoom; neue Menüs „Kompilieren“ und „Git“), Markierungen in der Zeilenleiste mit Form und Tooltip, Badge 10 pt mit lesbarer Schrift, Zeilennummern und untere Leisten kontrastreicher und gleich hoch (`BottomBar`), Dialogtitel aus der Meldung (`AlertText`), kein eigener Hell/Dunkel-Schalter, „Protokoll“ statt „Build-Log“, Fenstertitel „Kein Projekt“ statt App-Name. Neues Einfügen-Fenster mit Vorschau an Ort und Stelle und neues Einstellungsfenster im Stil der Systemeinstellungen (siehe Architektur). Bewusst nicht geändert: ⌘B (Kompilieren) und ⌘P (Schnell öffnen) belegen Systemkürzel für Fett und Drucken. 579 Tests.

Fertig (Sitzung 18): Fachvokabular für die Rechtschreibprüfung (siehe Architektur, Abschnitt Rechtschreibung): rund 4.000 Fachwörter mit Beugung und Zusammensetzungen, ohne das Systemwörterbuch zu verändern. 563 Tests.

Fertig (Sitzung 17): Einklappen von Abschnitten, `\begin…\end` und Kommentarblöcken (siehe Architektur): Dreiecke in der Zeilennummernleiste, „⋯“-Feld hinter der Kopfzeile, ⌥⌘←/→ und „Alles zu-/aufklappen“, nur zur Laufzeit gemerkt. Der Text bleibt unverändert, ausgeblendet wird über Glyph-Eigenschaften des Layout-Managers. 556 Tests (42 neue; Prüflauf 57 ms, pro Tastendruck bei 1.538 zugeklappten Stellen 0,45 ms im Debug-Build).

Fertig (Sitzung 16): Teiler zwischen Editor und PDF mit breiterer Greiffläche (`WorkspaceSplit` statt `HSplitView`). Aus der Code-Durchsicht (FEHLER.md, lokal) behoben, Punkte 1 und 3–12 (offen nur 2: Tokenizer kennt `PythonCode` & Co. nicht): Baum und Analysen nicht mehr bei jedem Build/⌘S; eine Kommentar-Regel und ein Dateileser statt sechs Kopien, `\verb` vor Kommentaren, Kommentare bei `\r\n`; Fehler beim Anpassen von Verweisen, beim Anhängen an die `.bib` (vorher Datenverlust bei Latin-1/unlesbar) und bei der Sicherung werden gemeldet; Index meldet sich nur bei echter Änderung, Schreibhinweise nur nach Textänderung; Hintergrundprüfung einmal maskiert und ohne komplettes Neu-Einfärben (≈ 450 → 280 ms bei 10.000 Zeilen), Kommentar-Maskierung über die NSString-Suche (9 ms statt 280); Umgebungspaar ohne Maskieren; Beobachter werden abgemeldet; Einstellungen nur mit Neu-Layout, wenn sich der Text ändert; Dateizugriffe von Verweise anpassen, `.bib` anhängen, Wiederherstellung und Zurücksetzen im Hintergrund; Zeitbudgets mit schnellstem Lauf, `AppModel()` als eigene Instanz; `InsertSheet` und `AppModel` aufgeteilt. 513 Tests.

Fertig (Sitzung 15): Einstellungsfenster (⌘,) mit Darstellung (Erscheinungsbild, Farbschemata, Schrift, Größe, Zeilenabstand, Zeilennummern, aktuelle Zeile, Live-Vorschau), Editor (Umbruch, Einrückung, Tabbreite, Rechtschreibung mit Sprache), Schreiben und Kompilieren & PDF; Standard-Zeilenabstand jetzt 1,2. „Über LatexEditor“ zeigt Commit und Build-Zeit, `scripts/install-app.sh`; Tab-Leiste blendet an Rändern mit verdeckten Tabs kurz aus (`EdgeFade`, `onScrollGeometryChange`), Hover-Fläche eines Tabs nicht mehr bis in die Titelleiste; keine gelbe Markierung mehr im PDF (⌘J, ⌘-Klick, „PDF folgt Cursor“); „Umbenennen …“ für Labels, Quellen (auch in der .bib), Abkürzungen, eigene Befehle und Umgebungen sowie für ein `\begin`/`\end`-Paar (ersetzt „Label umbenennen“); ⌘-Klick im Editor auf normalen Text zeigt die Stelle im PDF (wie TeXShop/Texifier); kein gelbes Aufblitzen mehr beim Springen (`showFindIndicator` in `scroll(toLine:)` entfernt, war für den Nutzer störend); BibTeX-Farben, Autokorrektur der Groß-/Kleinschreibung und Schreibhinweise (siehe Architektur). 495 Tests.

Fertig (Sitzung 14): Die echte Thesis wird nicht mehr zum Entwickeln und Testen benutzt. Dafür das Demo-Projekt `Testdaten/HgbDemo` (eigener Nachbau im Stil der HgbThesis), `scripts/demo-projekt.sh` für eine Arbeitskopie mit Git, `DemoProject.copy(to:)` für Tests; `GitThesisTests` wurde zu `GitDemoProjectTests`, `InsertionCompileTests` kompiliert die Demo-Kopie. Nebenbei: `SearchStore.waitUntilIdle` wartet auf die jeweils letzte Suche (eine durch ein Dateiereignis ausgelöste neue Suche brach die laufende ab, der Test sah dann 0 Treffer). 448 Tests.

Fertig (Sitzung 13): Kompilieren abbrechen (⌘.), Nächste/Vorherige Meldung (⌥⌘↓/↑), Hilfsdateien löschen; ⌘P Schnell öffnen und ⌘L Gehe zu Zeile; Statusleiste mit Zeile/Spalte und Wortzähler (Datei, Projekt, Auswahl); Suchen: ⌘F abgesichert und projektweite Suche/Ersetzen (⇧⌘F, ungespeichert und rückgängig); Prüfung auf unbekannte `\ref`/`\cite` mit Unterstreichung und „Hinweise“ zu ungenutzten Labels/Quellen; ⌘-Klick auf Verweise, Zitate, Dateipfade und „Label umbenennen“ (siehe Architektur). Nebenbei: Der Git-Zeittest für die Thesis prüft jetzt den schnellsten statt des mittleren von fünf Läufen (im Gesamtlauf schwankt die Wandzeit je nach Last zwischen 160 und 400 ms, allein sind es 23 ms; schon auf dem Commit davor lag der Mittelwert bei 189–297 ms bei einem Budget von 300). 442 Tests.

Fertig (Sitzung 12): Zoom ⌘+/⌘−/⌥⌘0 für Editor und Oberfläche gemeinsam (siehe Architektur), Dialoge in Systemgröße. Nebenbei: Zeilennummern übernehmen einen schon vergrößerten Zoom auch beim Neuaufbau des Editors (vorher erst nach der nächsten Änderung). 370 Tests.

Fertig (Sitzung 11): Aufräumen und Stabilisieren ohne neue Features, nach Code-Durchsicht und offscreen gerenderter Bilder-Tour aller Ansichten. Fehler: Verweise anpassen und Quelle anhängen sind echte Rückgängig-Schritte (vorher konnte ⌘Z danach mit veralteten Positionen arbeiten); ein fehlgeschlagener `git status` sperrt den Änderungen-Tab nicht mehr dauerhaft (`scheduleRefresh` braucht nur einen Runner, ein erfolgreicher Status setzt `.ready`); „Quelle anlegen“ geht ohne .tex vorne (`AppModel.canPresentInsert`, `InsertStore.blocker`). Bedienung: Baumzustand im `SidebarStore`, „Keine Treffer“, Kontextmenü „Öffnen“ wie Doppelklick, ausgeschriebene Statistik („nicht kompiliert“, „Warnungen“, „Boxen“, anklickbar), Build-Status „Noch nicht kompiliert“ in der Toolbar, Kommentarfarbe hell `#737373` (4,7:1). Verständlichkeit: Diff-Tab „Datei – Änderungen“, ± für den Änderungen-Tab, „Zurücksetzen …“ rot und abgesetzt bzw. für alle nur im Rechtsklickmenü, PDF-Leiste „Breite“/„Folgen“, „Querverweis (\ref)“/„Zitieren (\cite)“, Knopf „Quelle anlegen“, Gliederung ohne Kürzel. Dazu: SyncTeX-Pfadnormalisierung unabhängig davon, ob die Dateien existieren (die Fixture-Tests liefen nur dank Resten in `/tmp`, bis macOS sie aufräumte). 366 Tests.

Fertig (Sitzung 10): Quellen (Suche in `\cite{` nach Autor/Titel/Jahr, Baustein „Quelle“ mit Formular oder BibTeX), Tippgefühl (Klammern, Enter mit `\end`/`\item`, Kommentar, Einrücken, Zeilen, Formatierung, Schriftgröße) und automatische Sicherung mit Wiederherstellung (siehe Architektur). 359 Tests.

Fertig (Sitzung 9): Autovervollständigung Stufe 1 und 2 (siehe Architektur): Argumente (Labels, Literatur, Bilder, Dateien, Umgebungen) und Befehle mit Gerüsten, eigene Makros und die der Vorlage; danach Optionen in `[…]` (Klasse inkl. HgbThesis-Schlüssel mit Werten, Pakete, Bilder, Platzierung, Zitate). 325 Tests. Nicht dabei, bewusst: Mathe-Symbole, Tab-Sprung zwischen Platzhaltern.

Fertig (Sitzung 8): Git Phase 1 (siehe Architektur): Branch mit ↑/↓ in der Toolbar, Seitenleisten-Tab „Änderungen“ (Commit-Nachricht, Bereitgestellt / Nicht bereitgestellt, +/− pro Datei und für alle), Markierungen im Dateibaum, Diff untereinander mit Wort-Hervorhebung und eingeklapptem Kontext, Commit (⌘↩). Diffs als Tabs (Vorschau/fest wie Dateien, ein Tab pro Datei mit Umschalter, schließt nach dem Commit). Danach Phase 2: Abrufen/Pull (nur Vorspulen)/Push, Branches wechseln und anlegen, Zurücksetzen auf den letzten Commit mit Sicherung und Rückgängig, Änderungsmarken gegen HEAD, extern geänderte Dateien werden übernommen. 293 Tests. Nicht dabei, bewusst: Merge/Rebase/Konflikte lösen, Branch löschen, Stash, Abruf im Hintergrund, einzelne Blöcke bereitstellen oder verwerfen.

Fertig (Sitzung 6): Tabs pro Datei (siehe Architektur). Nicht dabei: Tabs per Mittelklick schließen, Tab-Gruppen/geteilte Ansicht.

Fertig (Sitzung 5): Einfügen-Menü (siehe Architektur), danach: „Einfügeoptionen …“ (⇧⌘I, Toolbar-Menü und Menüleiste) und überarbeitetes Fenster (Karten mit `SettingsCard`/`SettingRow`, farbige Baustein-Symbole, Vorschau mit den Farben des Editors über `SyntaxTheme`; `SettingRow` nutzt eine Datei-Konstante, weil generische Typen keine statischen Eigenschaften haben). Nicht dabei, bewusst: verbundene Zellen (`\multicolumn`), Bearbeiten bestehender Tabellen, Algorithmen, Tastenkürzel pro Baustein, Vorschau-Bild der Tabelle. Alle Bausteine (auch alle 27 Sprachumgebungen) kompilieren in einer Kopie der Thesis-Vorlage (Integrationstest, ca. 26 s).

Bekannte Einschränkungen:
- Sprachumgebungen (`PythonCode`, …) und `program` gibt es nur in der HgbThesis-Vorlage; in anderen Projekten fehlen sie.
- SyncTeX bezieht sich auf den letzten Build; nach Bearbeitungen ohne Speichern/Kompilieren können Positionen leicht daneben liegen. Bei Makro-Zeilen (z. B. `\MakeBibliography`) führt die Rückwärtssuche auf die Zeile, die SyncTeX dem erzeugten Inhalt zuordnet (wie die `synctex`-Kommandozeile).
- Markierungen und Fehlerzeilen beziehen sich auf den Stand des letzten Builds; nach Bearbeitungen ohne Neukompilieren können sie verrutschen (wie bei Texifier).
- Klicks/Tastenkürzel in der echten App lassen sich ohne Bedienungshilfen-Freigabe nicht automatisieren; die Handtests in TESTING.md (36–59) sind daher wichtig.
- Rechtschreibprüfung: eine Sprache für alle Dateien (wählbar in den Einstellungen). Ob der Syntax-Filter bei der laufenden Prüfung greift, ist noch nicht manuell bestätigt.
- Mathe-Inhalt ist einfarbig (keine eigene Farbe für Befehle in Mathe). Argumente, die über mehrere Zeilen gehen, werden nur bis zum Zeilenende als Argument erkannt.
- Typing-Tempo in der echten App (inklusive Layout und Zeichnen) ist ohne UI-Automation nicht gemessen, nur der Bearbeitungspfad bis zum Storage.
- Dateien in Nicht-UTF-8/Latin-1-Kodierung werden nicht geöffnet. Latin-1-Dateien werden wieder als Latin-1 gespeichert.

## Lehren aus Sitzung 20 (Fehlversuche und Entscheidungen)

- **Abschnittsanzeige**: Erst als eigene Zeile über dem Editor gebaut. Das ließ den vollen Testlauf hängen (`LineNumberRulerView.visibleLabels` → `ensureLayout` → `setFrameSize` in einer Schleife, Hauptthread dauerhaft belegt). Als normaler Teil der Pfadleiste-HStack ebenfalls Probleme; erst als `.overlay` des `Spacer` ist die Breite des Editors von der Anzeige entkoppelt. Vermutete Kette: Anzeige ändert Breite → anderer Umbruch → andere oberste Zeile → anderer Abschnitt. Auswirkung nur im Testfenster nachgewiesen.
- **Offener Hänger**: Der volle Testlauf blieb mehrfach hängen, auch noch nach der Umstellung auf das Overlay und nach der Korrektur „nur bei echtem Scrollen und geänderter Zeile melden“ (ein weiterer Hänger danach). Danach liefen drei volle Läufe grün (634 Tests, ca. 100–115 s), allerdings mit eingebautem Messcode (Rekursionstiefe in `setFrameSize`), der nie ausgelöst hat, und entfernt wurde. Auf dem letzten Commit ohne die Änderungen aus Sitzung 20 lief genau ein voller Lauf ohne Hänger (nicht mehr geprüft). Die Ursache wurde nie direkt gesehen. Wenn es wieder auftritt: `sample <PID> 3 -file x.txt` und im Hauptthread nach `visibleLabels`/`setFrameSize` suchen.
- **Wo der Hänger nicht auftritt**: In Teilmengen (nur `AppModelSuite`, alles außer `AppModelSuite`, Performance/Zoom/Einklappen) nie. Nur im vollen Lauf mit allem parallel.
- **Nicht zusammenhängendes Layout** (`allowsNonContiguousLayout`): `characterIndexForInsertion` an einer weit entfernten Stelle liefert im Test geschätzte Werte. Für Tests die oberste Zeile unabhängig über `glyphRange(forBoundingRect:)` berechnen und nach `displayIfNeeded()` vergleichen.
- **Zeilenumbruch-Test** (`EditorSettingsTests.lineWrapping`) und **Git-Zeittest** sind unzuverlässig, ersterer auch auf dem letzten Commit ohne die Änderungen aus Sitzung 20. Ein einzelner Fehlschlag dort ist kein Hinweis auf eigene Fehler.
- **Rückgängig für Dateien** nutzt den Undo-Manager des Hauptfensters (`NSApp?.mainWindow?.undoManager`). `NSApp` ist in Tests `nil` → `NSApp?`. Das Fenster antwortet auf `undo:`, daher gilt ⌘Z automatisch, wenn der Dateibaum Fokus hat; der Texteditor hat einen eigenen Manager je Sitzung. Angelegtes (Datei, Ordner, Kopie, aus dem Finder gezogenes) geht beim Rückgängig in den Papierkorb, nichts wird endgültig gelöscht. `moveToTrash` liefert dafür die Papierkorb-URL zurück.
- **Fehlalarme der Syntaxprüfung** sind die größte Gefahr: Argumente von `\newcommand`, `\newenvironment`, `\def` … dürfen ein einzelnes `\begin`/`\end` enthalten und zählen nicht für die Umgebungsprüfung. Geprüft an `Testdaten/HgbDemo` (12 Dateien inklusive .cls/.sty): 0 Markierungen.
- **Bildvorschau im Text**: `shownImagePreviewURL` statt `NSPopover.isShown` prüfen (im Offscreen-Fenster nie wahr).
- **Prozesse beenden**: Ein volles Testlauf-Skript soll nur seinen eigenen Prozessbaum beenden (PID merken, `pgrep -P` rekursiv). Nie nach Namen (`pkill`, `grep` auf `ps`). `timeout` gibt es auf macOS nicht. `rm -rf` blockiert ein Hook, für Worktrees `git worktree remove --force`.
- **Anzeige-Entscheidungen**: Fehler rot gestrichelt, Warnung orange strichpunktiert, Hinweis blau gepunktet (Muster plus Farbe). Spaltenhilfslinie standardmäßig aus. Der Seitenleisten-Button ist der des Systems, Hover per Tracking-Bereich (`SidebarButtonHover`); ein eigener Button ergab in der App zwei Buttons, weil `.toolbar(removing: .sidebarToggle)` nicht griff.

## Roadmap

### Ideenspeicher (vom Nutzer als „gut“ markiert, noch nicht beauftragt)

Der Nutzer will erst mit der App schreiben und dann entscheiden. Nicht ungefragt umsetzen.

- **Tippen** (Einrückung mit Tabs/Leerzeichen und Tabbreite seit Sitzung 15, Spaltenhilfslinie seit Sitzung 20): Groß-/Kleinschreibung umwandeln, Zeilen sortieren, Absatz umbrechen, Bild aus Zwischenablage/Finder direkt in den Editor. (Mehrfach-Cursor: ausdrücklich nicht.)
- **Suchen/Navigieren** (⌘F, projektweite Suche/Ersetzen, ⌘P, ⌘L, ⌘-Klick seit Sitzung 13, Umbenennen aller Arten seit Sitzung 15, Einklappen seit Sitzung 17, Verwendungen und Abschnitt in der Pfadleiste seit Sitzung 20 gebaut): ⌘⇧O Symbole, Cursor-Historie, Lesezeichen, geteilter Editor, Marken am Scrollbalken, zuletzt geöffnete Dateien.
- **Qualität** (Wortzähler, unbekannte Verweise/Zitate mit Hinweisen auf ungenutzte Labels und Quellen seit Sitzung 13, Schreibhinweise/Typografie seit Sitzung 15, Syntaxfehler, doppelte Labels und Build-Meldungen im Text seit Sitzung 20): ungenutzte Bilder markieren, unbekannte Befehle nur als Hinweis, eigenes Wörterbuch, TODO-Liste, Sprache pro Abschnitt.
- **Kompilieren/PDF** (Abbrechen, Aufräumen und „Nächste Meldung“ sind seit Sitzung 13 gebaut): Live-Ansicht nach Tipp-Pause, Hauptdatei/Engine wählen, Benachrichtigung, PDF-Suche/Miniaturen/Lesezeichen, PDF dunkel, exportieren/drucken.
- **Dateien**: alle in Sitzung 20 gebaut. (Dateihistorie, neues Projekt aus Vorlage: nicht gewünscht.)
- **Oberfläche** (Einstellungsfenster ⌘, mit Farbschemata und Schrift seit Sitzung 15; eigene Schemata anlegen/importieren, proportionale Schriften, unsichtbare Zeichen noch nicht): Befehlspalette, Statusleiste (Zeile:Spalte, Wörter …), Schreibmodus, Fokus-Hervorhebung, Tastenkürzel anpassbar, Tab per Mittelklick schließen/in eigenes Fenster, Dock-Menü, Kodierung/Zeilenenden.
- **Quellen (falls gewünscht)**: DOI/ISBN/URL-Abruf (Internet, Crossref/Open Library), Quellen-Seitenleiste, Hover/⌘-Klick auf `\cite`, Prüfung der Einträge.
- **Git**: reicht wie es ist.

### Bisherige Reihenfolge

Reihenfolge und empfohlenes Modell (Plan Pro, sparsam mit Opus):

1. ~~Syntaxfarben~~ und 2. ~~Zeilennummern~~: erledigt (Sitzung 2). Offen: manueller Test laut TESTING.md, sobald Xcode/Instruments verfügbar ist.
3. ~~Kompilieren mit latexmk~~ und 4. ~~Fehlerliste~~: erledigt (Sitzung 3). Offen: Kompilieren nach Tipp-Pause (aktuell nur ⌘B/⌘S).
4a. ~~Tabs pro Datei~~ erledigt (Sitzung 6), ~~Dateien verwalten~~ (Sitzung 7), ~~Git Phase 1~~ (Sitzung 8). ~~Git Phase 2~~ (Sitzung 8), **Tabelle bearbeiten/verbundene Zellen** (später).
5. ~~SyncTeX~~: erledigt (Sitzung 4) mit eigenem Parser, bewusst ohne `synctex`-Programm (Wunsch: nicht von installierten Werkzeugen abhängen). Offen: „Live-Ansicht“ (Kompilieren nach Tipp-Pause) – später entscheiden.
6. ~~Wortzähler~~ erledigt (Sitzung 13, eigener Zähler ohne `texcount`).
7. ~~Autovervollständigung~~ inkl. Optionen (Sitzung 9, ohne TexLab/externe Werkzeuge).
8. ~~Kleinigkeiten: Schriftgröße einstellbar~~ (Sitzung 10), Autovervollständigung inkl. Optionen erledigt (Sitzung 9).

