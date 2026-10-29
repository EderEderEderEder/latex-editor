# LatexEditor

Nativer macOS-LaTeX-Editor nach dem Vorbild von Texifier, nur für lokale Nutzung (Swift 6, SwiftPM, SwiftUI + AppKit/TextKit 1, PDFKit). Keine externen Abhängigkeiten, keine Netzwerk-Features, Ziel macOS 15+, nur Command Line Tools (kein Xcode). Identifier Englisch, UI-Texte und Kommentare Deutsch.

## Harte Regeln

- **`../Thesis` ist die echte Bachelorarbeit: nie öffnen, lesen, kompilieren, kein `git` dort, auch nicht lesend.** Entwickeln und Testen nur mit `Testdaten/HgbDemo` (gitignored, nur lokal; Aufbau und Pflege: `docs/ARCHITEKTUR.md`).
- Antworten kompakt auf Deutsch (3–6 Zeilen Abschluss). Bei größeren Änderungen erst kurz den Plan zeigen und OK abwarten.
- Commit und Push nur auf ausdrücklichen Wunsch (Git nur `/usr/local/bin/git`). `FEHLER.md` und `Testdaten/` bleiben lokal.
- Der Nutzer startet evtl. parallel einen eigenen Xcode-Build: Prozesse nur per **eigener PID** beenden, nie `pkill` oder `grep` auf `ps`. Die installierte App in `/Applications` nie beenden (das Installationsskript bricht dann ab).
- Destruktive Aktionen: Sicherung (inklusive ungespeichertem Text), Rückgängig in der App und Datei sichtbar lassen.
- `swift build` ohne Warnungen, alle Tests grün, universal binary (arm64 + x86_64).
- Ideenspeicher (`docs/VERLAUF.md`) nicht ungefragt umsetzen. Nicht wieder einbauen: gelbe PDF-Markierung, Find-Indicator-Flash.

## Befehle

```bash
swift build                  # Debug, ohne Warnungen
scripts/test.sh              # alle Tests; --filter <Name> für einzelne (nie nacktes `swift test`)
scripts/build-app.sh         # Universal-App nach build/LatexEditor.app (ad-hoc signiert)
scripts/install-app.sh       # baut und installiert nach /Applications
scripts/demo-projekt.sh      # Testdaten/Arbeitskopie/ zum Ausprobieren neu anlegen
```

Es gibt keinen Linter. Voller Testlauf: ca. 100 s; hängt er (siehe `Tests/CLAUDE.md`), nicht blind wiederholen. Handtests und UI-Checkliste: `TESTING.md` (fortlaufend nummeriert, zuletzt #253).

## Landkarte (`Sources/LatexEditor/`)

- `App/` – `LatexEditorApp` (Fenster, Menüs), `AppModel` (verdrahtet die Stores), Aktionen als Erweiterungen (Dateien, Suchen, Umbenennen, ⌘-Klick, Git, Einfügen, Rückgängig für Dateien in `FileUndo`).
- `Model/` – Projekt, Dateibaum, Gliederung, Kompilieren (latexmk), SyncTeX, Git, Verweise/Labels/Abkürzungen, Suche.
- `Editor/` – `DocumentSession` (Text = NSTextStorage), `EditorTextView` (+ Coordinator), `LatexTextView`, Zeilenleiste, Einklappen, Einstellungen/Farbschemata.
- `Syntax/` – Tokenizer, `LineIndex`, Kommentar-Regel (`LatexSource`), `SyntaxChecker`, Fachvokabular.
- `Completion/`, `Insertion/` – Autovervollständigung bzw. Einfügen-Fenster (Generator, Vorschau, Bildimport).
- `PDF/` – PDFKit-Ansicht und Vorschau-Store. `UI/` – SwiftUI-Ansichten (Seitenleiste, Dateibaum, Einstellungen, Sheets, Popover).
- `Tests/LatexEditorTests/` – Swift Testing, `Support/` mit Fixtures und Demo-Projekt. `scripts/`, `Resources/` (Icon), `docs/`.

Einstiegspunkte: `App/LatexEditorApp.swift` → `App/AppModel.swift` (alle Stores) → `UI/RootView.swift` (Fensteraufbau) → `Editor/EditorTextView.swift` (Editor) → `Editor/DocumentSession.swift` (Text und Undo je Datei).

## Konventionen

- 4 Spaces, Methoden höchstens 30 Zeilen, benannte Konstanten statt Zahlen, Early Returns, Kommentare nur für Nicht-Offensichtliches.
- Stores sind `@MainActor @Observable` und getrennt. Eigenschaften nur setzen, wenn sich der Wert ändert (jede Zuweisung zeichnet sonst neu).
- Nie den Text pro Tastendruck in SwiftUI-State spiegeln; Dateisystem nie auf dem Main-Thread; kein Polling (FSEvents).
- Alles pro Tastendruck proportional zur Änderung, nicht zur Dateigröße. Performance-Budgets stehen in `PerformanceTests`; ein überschrittenes Budget ist ein Fehler.
- Testbare Logik ohne AppKit in `Syntax/` und `Model/`. Text ändern ohne Text-View: über `DocumentSession.replaceText`, nie direkt im `textStorage`.
- UserDefaults in Tests nur über `temporaryDefaults()`, Tests mit `AppModel.shared` unter `AppModelSuite`.

## Stolpersteine (Details in den `CLAUDE.md` der Unterordner)

- Anzeige-Rückkopplung: Eine Zusatzzeile oder Breitenänderung am Editor kann den vollen Testlauf hängen lassen (`Editor/CLAUDE.md`).
- Ansichtswechsel Editor ↔ PDF: SwiftUI baut zuerst neu, dann ab. Deshalb liegen beide immer im Baum (`UI/CLAUDE.md`).
- `NSApp` ist in Tests `nil`; Offscreen-Fenster früherer Tests bleiben am gemeinsamen Modell hängen.
- Rechtschreibung: eine Sprache für alle Dateien (Einstellungen); ob der Syntax-Filter in der echten App greift, ist nur manuell prüfbar.

## Weiterlesen

- `docs/ARCHITEKTUR.md` – Architektur pro Feature, Stil-/Performance-Regeln, Demo-Projekt (ausführlich).
- `docs/VERLAUF.md` – Sitzungsverlauf, Einschränkungen, Ideenspeicher, Lehren und Sackgassen.
- `TESTING.md` – Handtests.
