# LaTeX-Editor (Repo-Wurzel)

Lokaler LaTeX-Editor in zwei Versionen: `swift/` (nativ macOS, fertig und im Einsatz) und `web/` (Electron + TypeScript, für Windows und andere Plattformen; **im Aufbau**: Meilenstein M0 fast fertig, Gerüst, IPC-Vertrag und Spikes stehen, Editor ab M1; Plan: `shared/PLAN-WEBUI.md`). Gemeinsames liegt in `shared/`.

## Ordner

| Ordner | Inhalt |
|---|---|
| `swift/` | Swift-App: `Package.swift`, `Sources/`, `Tests/`, `scripts/`, `TESTING.md` (Handtests), `docs/ARCHITEKTUR.md`; eigene `CLAUDE.md` mit Befehlen und Konventionen. Alle Swift-Befehle von hier aus starten (`cd swift`). |
| `web/` | Web-UI-Version (Electron, nur TypeScript: Node im Main-Prozess, React, CodeMirror 6, pdf.js); eigene `CLAUDE.md` (Befehle, Landkarte), `docs/ARCHITEKTUR.md` (Spike-Entscheidungen), `docs/REVIEW-M0.md`, `TESTING.md` (Handtests W-H…), `spikes/`. Alle Web-Befehle von hier aus starten (`cd web`). |
| `shared/` | Für beide Plattformen: `SUBAGENTS.md` (Arbeiten mit Subagents), `PLAN-WEBUI.md` (Plan und Aufgabenliste der Web-Version), `FEATURES.md` (Feature-Parität), `VERLAUF.md` (Verlauf, Ideenspeicher, Lehren), `Testdaten/` (Demo-Projekt `HgbDemo`, gitignored, nur lokal), `spec/` (sprachunabhängige Testvektoren als JSON, `README.md`, `schema.json`; die Swift-Gegenprobe `SpecVectorTests` besteht). |

## Harte Regeln (beide Versionen)

- **`Thesis` (Nachbarordner des Repo-Ordners `LatexEditor`) ist die echte Bachelorarbeit: nie öffnen, lesen, kompilieren, kein `git` dort, auch nicht lesend.** Entwickeln und Testen nur mit Kopien von `shared/Testdaten/HgbDemo`.
- Antworten kompakt auf Deutsch (3–6 Zeilen Abschluss). Bei größeren Änderungen erst kurz den Plan zeigen und OK abwarten.
- Commit, Push und Installation nur auf ausdrücklichen Wunsch (Git nur `/usr/local/bin/git`). `FEHLER.md` und `Testdaten/` bleiben lokal.
- Prozesse nur per **eigener PID** beenden, nie `pkill` oder `grep` auf `ps`. Die installierte App nie beenden.
- Destruktive Aktionen: Sicherung (inklusive ungespeichertem Text), Rückgängig in der App und Datei sichtbar lassen.
- **Umsetzungen laufen mit Subagents** nach `shared/SUBAGENTS.md` (Agent-Typ, Modell, Effort, Ablauf, Pflichtangaben). Vor jeder Umsetzung lesen; Kleinstes direkt selbst. Kein `fable`, kein Effort über `high`. Build und Tests nie parallel (swift: `scripts/test-run.sh`, web: `node scripts/test-run.mjs`).
- Ideenspeicher (`shared/VERLAUF.md`) nicht ungefragt umsetzen. Nicht wieder einbauen: gelbe PDF-Markierung, Find-Indicator-Flash.
- Keine Netzwerk-Features, keine unnötigen Abhängigkeiten. Identifier Englisch, UI-Texte und Kommentare Deutsch, 4 Spaces, Funktionen höchstens 30 Zeilen, benannte Konstanten, Early Returns.

## Weiterarbeiten

1. Swift-Version: `swift/CLAUDE.md` (Befehle, Landkarte, Stolpersteine).
2. Web-Version: `shared/PLAN-WEBUI.md` (Meilensteine, Aufgaben mit Subagent-Zuweisung), danach `web/CLAUDE.md`.
3. Verhalten, das beide Versionen gleich haben müssen: `shared/FEATURES.md` und `shared/spec/`.
