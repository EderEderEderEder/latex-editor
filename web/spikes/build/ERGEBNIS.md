# Spike S4: Werkzeuge finden, latexmk starten und abbrechen (W0-9)

Stand 2026-11-23, gemessen auf macOS (Darwin 25.6, Node 25.2.1, MacTeX unter `/Library/TeX/texbin`). Windows ist **nicht geprüft**, siehe Handtest unten.

## Dateien

| Datei | Inhalt |
|---|---|
| `src/main/tools.ts` | `detectTools(context)` → `ToolsInfo {latexmk, git, synctexRef, distro, problems[]}`; Plattform, Umgebung und Dateisystem (`ToolsFileSystem`) als Parameter |
| `src/main/build.ts` | `BuildRunner` (Rohfassung): Start ohne Shell, Ausgabe zeilenweise, Status `idle → running → (cancelling →) idle`, nie parallel; reine Funktionen `buildArguments`, `buildEnvironment`, `launchBlocker`, `spawnOptionsFor`, `killPlanFor`, `createLineSplitter`; Prozessstart (`spawn`) und Signale (`signal`) einspeisbar |
| `tests/unit/tools.test.ts` | 20 Tests: künstliche Windows-, macOS- und Linux-Umgebungen |
| `tests/unit/build.test.ts` | 19 Tests ohne TeX + 2 echte TeX-Läufe hinter `LATEXEDITOR_REAL_TEX=1` |
| `tests/support/fakeLatexmk.mjs` | Fake-latexmk (Node): Zeilen in halben Stücken, CRLF, stderr, Exit-Code, Hängen, Enkelprozess (optional SIGTERM-fest) |

## Werkzeugsuche

- Reihenfolge: PATH (relative Einträge und Anführungszeichen bereinigt), dann bekannte Orte; Git unter macOS: zuerst `/usr/local/bin`, `/opt/homebrew/bin`, dann PATH. **`/usr/bin/git` wird unter macOS nie genommen** (xcode-select-Platzhalter), unter Linux schon.
- Windows: MiKTeX `%LOCALAPPDATA%\Programs\MiKTeX\miktex\bin\x64` und (Ergänzung) `%ProgramFiles%\MiKTeX\miktex\bin\x64`; TeX Live `C:\texlive\<Jahr>\bin\windows` (neuestes Jahr zuerst, Ergänzung `bin\win32` für TeX Live ≤ 2022); Git `%ProgramFiles%\Git\cmd` und `%LOCALAPPDATA%\Programs\Git\cmd`; Perl zusätzlich `C:\Strawberry\perl\bin`. Umgebungsvariablen unter Windows ohne Groß/klein-Unterschied (`Path`).
- macOS/Linux: `/Library/TeX/texbin` (nur macOS), `/usr/local/texlive/<Jahr>/bin/<Arch>`.
- Unter Windows zählen nur `<name>.exe`. Liegt nur `.bat`/`.cmd` da, gibt es keinen Treffer, aber ein Problem „liegt nur als Skript vor“.
- `distro` aus dem Pfad: `…\miktex\…` → `miktex`, `/Library/TeX/texbin` → `mactex`, `…/texlive/…` → `texlive`, sonst `unknown`.
- Perl-Prüfung nur bei MiKTeX unter Windows (MiKTeX liefert latexmk.exe ohne Perl; TeX Live bringt eigenes Perl mit). Fehlt Perl, steht ein Problem `perl` in `problems`, und `launchBlocker` verweigert den Start.

## Start und Abbruch

- `spawn(latexmk, ['-pdf'|'-xelatex'|'-lualatex', '-synctex=1', '-interaction=nonstopmode', '-file-line-error', '-cd', <Dateiname>], {cwd: Ordner der Hauptdatei, shell: false, stdio: ['ignore','pipe','pipe'], windowsHide: true, detached: !windows})`. PATH beginnt mit dem Ordner von latexmk; `max_print_line=10000`, `error_line=254`, `half_error_line=238` wie in Swift.
- **`.bat`/`.cmd`:** Node startet sie seit dem Fix zu CVE-2024-27980 (Node 18.20.2/20.12.2/21.7.3, also auch Electron 45) ohne `shell: true` nicht mehr, `spawn` wirft synchron `EINVAL`. Mit Shell wären die Argumente (Pfade mit `&`, `%`, `^`) nicht sicher zu quoten. Entscheidung: nur `.exe` starten; `launchBlocker` lehnt unter Windows jede andere Endung vor dem Start ab, `tools.ts` meldet Skript-Funde als Problem. Wirft `spawn` trotzdem, wird daraus `{kind: 'rejected', reason: 'launchFailed'}` (auf dem Mac geprüft mit nicht vorhandenem latexmk, `ENOENT`).
- Abbruch Unix: Kind in eigener Prozessgruppe, `process.kill(-pid, 'SIGTERM')`, nach `KILL_GRACE_MS = 1000` `SIGKILL` an die Gruppe; beim Ende des Laufs zusätzlich ein `SIGKILL`-Nachschlag an die Gruppe (fängt Enkel, die SIGTERM ignorieren und keine Pipe mehr halten), danach Timer weg. Fertig gilt der Lauf bei `close` (alle Pipes zu, also auch Enkel mit geerbter Ausgabe beendet).
- Abbruch Windows: `%SystemRoot%\System32\taskkill.exe /PID <eigene Kind-PID> /T /F` (voller Pfad, ohne Shell, über dieselbe einspeisbare `spawn`-Funktion). Nie nach Namen.
- Zweiter Start während eines Laufs: `{kind: 'rejected', reason: 'busy'}`, kein zweiter Prozess. Zusammenfassen von Aufträgen kommt in W2-10.

## Messungen (macOS)

| Fall | Ergebnis |
|---|---|
| Fake-latexmk „40-s-Dokument“ mit Enkel, Abbruch | 3 ms bis Kind und Enkel per `process.kill(pid, 0)` verschwunden |
| dito, Enkel ignoriert SIGTERM und hält stdout | 1005 ms (SIGKILL nach der Frist), beide PIDs verschwunden |
| echter latexmk auf Kopie von HgbDemo in `$TMPDIR` | kompiliert, 8,9–10,8 s (zwei Läufe), Exit 0, 451 Ausgabezeilen, einzige Verweis-Warnung `fig:fehlt`, PDF vorhanden |
| echter latexmk, 40-s-Dokument (Schleife wie in Swift `BuildCancelTests`), Abbruch nach 1,5 s | 3 ms, Prozessgruppe (latexmk + pdflatex) per `process.kill(-pid, 0)` weg; latexmk endet mit Exit 4 |

Befehle (im Ordner `web/`): `node scripts/test-run.mjs --filter tools`, `node scripts/test-run.mjs --filter build`, echter Lauf mit `LATEXEDITOR_REAL_TEX=1 node scripts/test-run.mjs --filter build`.

## Windows-Handtest (offen, beim Nutzer)

Voraussetzung: Repo auf dem Windows-Rechner, `npm ci` in `web/`, Kopie von `HgbDemo` (nicht das Original kompilieren).

1. **Tests:** In PowerShell im Ordner `web/` erst `node scripts/test-run.mjs --filter tools` und `--filter build` (ohne TeX; die Fake-Abbruchtests laufen dann über den echten `taskkill`-Weg), dann `$env:LATEXEDITOR_REAL_TEX='1'; node scripts/test-run.mjs --filter build`. Erwartet: alles grün; die Konsole zeigt `Abbruch (…): … ms`, `Echter TeX-Lauf: …` und `Echter Abbruch: … ms` (< 3000). Hinweis: Der echte Abbruchtest prüft die Prozessgruppe mit `process.kill(-pid, 0)`; Prozessgruppen gibt es unter Windows nicht, die Prüfung ist dort wirkungslos, deshalb Schritt 4 von Hand.
2. **MiKTeX ohne Perl:** Strawberry Perl vorübergehend aus PATH nehmen. Erwartet: `problems` enthält `perl` mit der Meldung „MiKTeX braucht für latexmk ein Perl …“, kein Start.
3. **MiKTeX-Paketnachinstallation:** In MiKTeX Console „Fehlende Pakete installieren: Immer“ prüfen. Bei „Nachfragen“ öffnet MiKTeX trotz `-interaction=nonstopmode` ein Dialogfenster; das Verhalten notieren (Dialog sichtbar? Build hängt?).
4. **Abbruch-Baum:** Während eines langen Laufs (40-s-Dokument) im Task-Manager (Details, Spalte PID) `latexmk.exe`, `perl.exe`, `pdflatex.exe` sehen, dann abbrechen. Erwartet: < 3 s, alle drei verschwunden; nichts anderes beendet.
5. **TeX Live für Windows:** dieselben Schritte mit `C:\texlive\<Jahr>\bin\windows\latexmk.exe`; `distro` = `texlive`, kein Perl-Problem.
6. **`.bat`:** Eine `latexmk.bat` in einen Ordner vorn im PATH legen, ohne `.exe` daneben. Erwartet: Meldung „liegt nur als Skript vor“, kein Start, kein Konsolenfenster.
7. **Git:** Git für Windows unter `C:\Program Files\Git\cmd\git.exe` wird gefunden, auch wenn PATH es nicht enthält.

## Entscheidungen und offene Punkte

- Nur `.exe` unter Windows, nie `shell: true`; Abbruch nur über die eigene Kind-PID (taskkill `/T /F` bzw. Prozessgruppe).
- `close` statt `exit` als Ende: Ein Enkel, der die Ausgabe-Pipe erbt und SIGTERM ignoriert, verzögert das Ende bis zum SIGKILL (1 s), bleibt aber nicht übrig.
- Offen für W2-10: Warteschlange/Zusammenfassen, Speichern vor dem Build, Ausgabe zusätzlich in Temp-Datei, `latexmk -c`, Log-Auswertung, laufenden Build beim Beenden der App abbrechen, Status `queued`.
- Offen: MiKTeX-Nachinstallation ohne Dialog (kein verlässlicher Schalter bekannt; Handtest 3 entscheidet, ggf. Hinweis in der Oberfläche). Dekodierung der Ausgabe ist UTF-8 mit Ersatzzeichen; Latin-1-Meldungen von TeX erscheinen dann verstümmelt (für Rohausgabe vertretbar, die Log-Auswertung liest die `.log`-Datei selbst).
- Unter Windows kann ein Enkel, der aus dem Baum ausbricht (eigener Job/Elternwechsel), von `taskkill /T` nicht erfasst werden; für latexmk/perl/pdflatex nicht zu erwarten, Handtest 4 prüft es.
