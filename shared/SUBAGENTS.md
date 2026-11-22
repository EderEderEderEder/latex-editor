# Arbeiten mit Subagents

Gilt für **jede Umsetzung in diesem Repo, in `swift/` wie in `web/`** (Feature, Fehlerbehebung, Refactoring). Die Hauptsitzung ist Dirigent: Sie versteht den Auftrag, teilt ihn auf, wählt pro Teil den passenden Subagent und prüft das Ergebnis. Schwere Arbeit machen die Subagents, nicht die Hauptsitzung.

Subagents starten ohne Vorwissen. Deshalb bekommt jeder im Prompt die Regeln aus „Pflichtangaben“ und eine genaue Aufgabe.

## Wer macht was

Aufruf über das Werkzeug `Agent` mit `subagent_type`, `model` und `effort`. Die Werte stehen hier ausdrücklich, damit `effort` gesetzt werden darf. Modelle: `haiku`, `sonnet`, `opus` (stärkstes). **Nicht benutzt werden `fable` und Effort über `high` (`xhigh`, `max`)**: Das Tokenbudget des Nutzers reicht dafür nicht.

| Aufgabe | Agent-Typ | Modell | Effort |
|---|---|---|---|
| Suchen, Lesen, „wo steckt X?“, Aufrufer finden (nur lesen) | `Explore` | `haiku` (bei breiter Suche `sonnet`) | `low` |
| Leichte Änderung: Text, Konstante, eine Datei, Test ergänzen, Handtest-Zeile, Doku | `general-purpose` | `sonnet` | `low` |
| Standard: neue Ansicht, Prüfregel, Einfügen-Baustein, Einstellung, Fehler mit bekannter Stelle (mehrere Dateien, Muster ist da) | `general-purpose` | `sonnet` | `medium` |
| Anspruchsvoll: siehe „Schwere Bereiche“ | `general-purpose` | `opus` | `high` |
| Sehr schwer oder Ursache unbekannt (Hänger, Absturz, Rückkopplung im Layout): in kleine, einzeln prüfbare Schritte zerlegen | `general-purpose` | `opus` | `high` |
| Plan für größere Änderungen (Dateien, Reihenfolge, Risiken) | `Plan` | `opus` | `high` |
| Review mit frischem Blick, nur lesen | `general-purpose` | `opus` | `high` |
| Design-Prüfung der Oberfläche | `general-purpose` mit Skill `apple-design` | `opus` | `medium` |
| Folgearbeit, die den ganzen bisherigen Verlauf braucht | `fork` | erbt Modell der Hauptsitzung | erbt |

`fable` und Effort über `high` nur auf ausdrückliches Wort des Nutzers, auch nicht bei schweren Aufgaben. `haiku` schreibt keinen Swift-Code (Swift 6, strikte Nebenläufigkeit), nur Suchen und Doku.

Das ist eine Faustregel. Stellt sich heraus, dass eine Stufe zu schwach war (Build- oder Testfehler nach zwei Versuchen), nicht wiederholen, sondern eine Stufe hoch (höchstens `opus`/`high`). Reicht auch das nicht, die Aufgabe in kleinere Schritte zerlegen oder beim Nutzer nachfragen, statt Modell oder Effort weiter zu erhöhen.

## Schwere Bereiche (`opus`, `high`)

- Editor, Layout und Zeilenleiste (Rückkopplung Breite → Umbruch → oberste Zeile, siehe `Editor/CLAUDE.md`)
- SyncTeX und PDF-Markierungen (Anker, Zuordnung, PDFKit zeichnet auf Hintergrund-Threads)
- Tokenizer und inkrementelles Einfärben (`LatexTokenizer`, `SyntaxHighlighter`, Einklappen)
- Nebenläufigkeit: Stores, `Task`, FSEvents, Warteschlangen, alles was beim Beenden oder Projektwechsel läuft
- Build-Pipeline (latexmk, Abbruch, Prozesse) und Dateioperationen mit Rückgängig
- Web-Version: IPC-Vertrag Main ↔ Preload ↔ Renderer (Electron) samt Sicherheit (Sandbox, CSP), Worker und Kindprozesse im Main-Prozess, CodeMirror-Erweiterungen (Tokenizer, Einklappen, Diagnose), pdf.js-Markierungen und SyncTeX (siehe `PLAN-WEBUI.md`)
- Neue Architektur, die mehrere Stores verbindet

## Ablauf

1. **Verstehen.** Mehrere `Explore`-Agents parallel (je eine Frage). Eine einzelne bekannte Stelle liest die Hauptsitzung selbst.
2. **Plan.** Bei größeren Änderungen: `Plan`-Agent, Ergebnis kurz dem Nutzer zeigen, **OK abwarten**. Bei kleinen Änderungen entfällt das.
3. **Umsetzen.** Pro Teilaufgabe ein Agent laut Tabelle. Jeder bekommt die Dateien, die er ändern darf, und die Pflichtangaben.
4. **Prüfen.** Hauptsitzung: `swift build` (ohne Warnungen) und `scripts/test-run.sh --fast` oder `--filter …`.
5. **Review.** Bei mehr als einer Datei oder in einem schweren Bereich: Review-Agent. Befunde einarbeiten, nicht wegdiskutieren.
6. **Doku.** `swift/TESTING.md` (Handtests, Nummer weiterzählen, Zahl in `CLAUDE.md` nachziehen), `swift/docs/ARCHITEKTUR.md` und die `CLAUDE.md` des Ordners, wenn sich eine Regel ergeben hat. Leichte Aufgabe für `sonnet`/`low`.
7. **Voller Lauf.** `scripts/test-run.sh` einmal im Hintergrund vor Commit oder Installation.
8. **Bericht.** Kurz (nur das Nötigste). Commit, Push und Installation nur auf ausdrückliches Wort des Nutzers.

## Wann kein Subagent

Eine Änderung an einer bekannten Zeile, ein Tippfehler, eine Antwort aus dem Gedächtnis des Gesprächs: direkt in der Hauptsitzung. Jeder Subagent startet kalt und kostet Zeit und Tokens, das lohnt sich erst ab etwa einer Datei oder einer echten Suche.

## Parallel oder nacheinander

- **Lesen** (`Explore`, Review): parallel, beliebig.
- **Schreiben**: parallel nur bei **verschiedenen Dateien**. Sonst nacheinander oder `isolation: "worktree"` (dort fehlt `shared/Testdaten/`, Tests dazu überspringen sich).
- **Build und Tests: nie parallel.** Es läuft immer nur ein Lauf, und nur über `scripts/test-run.sh`. Parallele Schreib-Agents testen nicht selbst, das macht danach die Hauptsitzung.

## Pflichtangaben im Prompt jedes Subagents

```
Projekt: LaTeX-Editor in zwei Versionen: swift/ (nativ macOS, Swift 6, SwiftPM, SwiftUI + AppKit) und web/ (Electron + TypeScript, siehe shared/PLAN-WEBUI.md). Du arbeitest in <swift/ oder web/>. Lies zuerst CLAUDE.md (Repo-Wurzel), die CLAUDE.md dieses Ordners und die des Unterordners, in dem du arbeitest.
Aufgabe: <genau eine Sache, Ziel und Dateien, die du ändern darfst>
Regeln:
- Thesis (Nachbarordner des Repo-Ordners) ist die echte Arbeit: nie öffnen, lesen, kompilieren, kein git dort. Testen nur mit shared/Testdaten/HgbDemo (Kopien davon).
- Keine Prozesse nach Namen beenden (kein pkill, kein grep auf ps), die installierte App nie beenden.
- swift/: Tests nur über scripts/test-run.sh (nie nacktes swift test), UserDefaults in Tests nur über temporaryDefaults(). web/: Tests nur über die Skripte aus web/CLAUDE.md. Überall: keine Warteschleifen, keine Hilfsskripte in /tmp.
- Kein git commit/push, keine Installation. Keine externen Abhängigkeiten, keine Netzwerk-Features.
- Code: 4 Spaces, Methoden/Funktionen höchstens 30 Zeilen, benannte Konstanten, Kommentare nur für Nicht-Offensichtliches, UI-Texte und Kommentare Deutsch, Identifier Englisch.
- Nur ändern, was beauftragt ist. Nichts „nebenbei“ umbauen.
Rückgabe (höchstens 10 Zeilen, Deutsch): geänderte Dateien, was gemacht wurde, was gebaut/getestet wurde (Ergebnis ehrlich, auch Fehlschläge), offene oder unsichere Punkte.
```

Für reine Such- und Review-Agents entfallen die Code- und Testregeln, es bleiben Thesis, Prozesse und „nur lesen, nichts ändern“.
