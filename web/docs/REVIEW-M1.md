# Review M1 (W1-R), Stand 2026-11-24

Review durch einen Opus-Agenten, nur lesend, Befunde am Code belegt. Spalte „Stand“ wird beim Abarbeiten gepflegt.

## Befunde

| # | Schwere | Stelle | Befund | Fix | Stand |
|---|---|---|---|---|---|
| K1 | Kritisch | `main/index.ts` (kein `close`-Handler, `window-all-closed` beendet), `lifecycle.ts`, `contract.ts` (`app:closeRequested` ungenutzt) | Fenster schließen verliert ungespeicherten Text ohne Nachfrage (Swift fragt: `LatexEditorApp.swift` `applicationShouldTerminate` → `confirmUnsavedChanges`) | `win.on('close')` → `preventDefault`, `app:closeRequested` an den Renderer; Renderer prüft `isDirty` und fragt nach; neuer Kanal `app:confirmClose` → `win.destroy()`; Test | erledigt: `CloseGuard` in `lifecycle.ts` (`close` und `before-quit` → `app:closeRequested`, `app:confirmClose` → `destroy`), Nachfrage `ui/CloseConfirmDialog.tsx` + `app/closeFlow.ts`; Vitest + `e2e/closeConfirm.spec.ts` (auch echtes Fenster-Schließen und `app.quit()`); mit Stub-Preload schließt das Fenster ohne Nachfrage |
| H1 | Hoch | `handlers/fsHandlers.ts`, `app/fileActions.ts`, `stores/editor.ts`, `core/language.ts`, `folding.ts`, `diagnostics.ts`, `grants.ts`, `preloadStub.ts` | Sitzungspfad einer Dialog-Datei ist die GrantId: Tab-Titel/Statusleiste zeigen die UUID; `.bib` wird als LaTeX behandelt (Farben, Einklappen, Fehlalarme in der Diagnose); „Speichern unter“ schlägt die UUID als Namen vor; Doppelt-offen-Prüfung greift nie; `GrantStore.grant` vergibt bei jedem Öffnen eine neue Kennung (dieselbe Datei in zwei Tabs); der Stub liefert den echten Pfad statt `target` (E2E merkt nichts) | `TextFile` um `name` (Anzeigename mit Endung) erweitern; Sitzung hält `target` als Schlüssel, Titel und Sprache aus `name`; `GrantStore.grant` liefert für gleichen normalisierten Pfad und Art dieselbe Kennung; Stub gibt `path: target` zurück; Vertragstest „Stub- und Main-Antwort gleich geformt“ | erledigt: `TextFile.name`/`ReadManyItem.name`, Titel/Statusleiste/Sprache/Einklappen/Diagnose aus `name`, „Speichern unter“ schlägt den Namen vor; `GrantStore` eine Kennung je Pfad (Arten sammeln sich); Stub antwortet wie der Main (`stubContract.test.ts`) |
| M1 | Mittel | `session.ts` (`view.setState`), `language.ts` | `setState` baut alle ViewPlugins neu: bei jedem Tabwechsel neuer `LineStateCache` (O(Zeilen)); bei gescrollter 10.000-Zeilen-Datei tokenisiert `ensureValid` fast die ganze Datei synchron | Cache je Sitzung halten (Facet oder `WeakMap`), Plugin übernimmt ihn bei gleichem `doc`; Budget „Tabwechsel zu gescrollter 10.000-Zeilen-Datei“ in W1-13 | offen |
| M2 | Mittel | `folding.ts`, `foldRegions.ts` | Einklapp-Scan im UI-Thread (ganzer `doc.toString()` 300 ms nach Tipp-Pause) | im Perf-Test messen; bei > ~8 ms über den Analyse-Worker | offen (Messung W1-13) |
| M3 | Mittel | `package.json` (`build:e2e`, `package`), `electron-builder.yml`, `EditorHost.tsx` | Der aktuelle `out/` kann den Testzugang eingeschaltet enthalten; `electron-builder` ohne Neubau würde ihn ausliefern; `build:e2e` mit POSIX-Zuweisung geht unter Windows nicht | `electron-vite build --mode e2e` mit `.env.e2e`; im Paketlauf Variable leeren und vor `electron-builder` prüfen, dass `out/renderer` kein `__editorTestApi = ` enthält | erledigt (Build-Prüfung steht aus) |
| N1 | Niedrig | `textIo.ts`, `session.ts` | gemischte Zeilenenden werden auf die Mehrheit umgeschrieben (undokumentiert); `"\r\r\n"` verliert ein CR | Regel in ARCHITEKTUR; beim Lesen nur echte Paare normalisieren; Test mit `\r\r\n` | erledigt: Regel im Kommentar `textIo.ts`, Schreiben normalisiert nicht mehr; Test `\r\r\n` (ARCHITEKTUR offen) |
| N2 | Niedrig | `textIo.ts`, `grants.ts` | atomares `rename` ersetzt einen Symlink durch eine normale Datei | Ziel vor dem Schreiben per `realpath` auflösen | erledigt: gewährte Ziele vor dem Schreiben per `resolveRealPath` (Projektpfade schon durch `assertInProject`); Tests |
| N3 | Niedrig | `fileActions.ts` | Strg+S während eines laufenden Speicherns wird stumm verworfen | Nachspeichern vormerken | erledigt: Nachspeichern je Datei vorgemerkt (`saveFile`); Tests |
| N4 | Niedrig | `gutter.ts` | `mapMarks` legt bei jeder Änderung ein neues Array an, auch ohne Marken | bei leerer Liste dasselbe Array zurückgeben | erledigt |
| N5 | Niedrig | `session.ts` | `relocate` tauscht nur die Einfärbung; Einklappen/Diagnose bleiben bei alter Sprache und alter `docId` | `featureExtensions` in einen `Compartment` | offen |
| N6 | Niedrig | `diagnostics.ts`, `analysisClient.ts` | Hub reicht kein `onError` weiter (Diagnose verschwindet stumm); `latestVersions` wächst je `docId` | Fehler melden; beim Schließen `forget(docId)` | offen |
| N7 | Niedrig | `main/settings.ts` | Main importiert `renderer/stores/settingsSchema.ts` (verkehrte Schichtrichtung) | Schema nach `src/shared/settingsSchema.ts` | erledigt (Rest: `renderer/app/zoom.ts` + Verweis `renderer/stores/settingsSchema.ts`) |
| N8 | Niedrig | `search.ts` | `Mod-h` ist unter macOS ⌘H („Ausblenden“) | unter macOS ⌥⌘F (Vorschlag) | erledigt (⌥⌘F unter macOS) |
| N9 | Niedrig | `fileActions.ts` | Kommentare „LÜCKE im Vertrag“ seit `FileTarget` veraltet | entfernen | erledigt |

## Parität mit Swift (belegte Abweichungen)

| Thema | Swift | Web | Dokumentiert? |
|---|---|---|---|
| Zoom | ⌘+/⌘−, Original ⌥⌘0, Editor und Oberfläche (`InterfaceZoom`) | Mod+0 ohne Alt; nur `editorZoom`, `--ui-scale` unverändert | nein; FEATURES verspricht „Editor + Oberfläche“ |
| Schreibmaschine | ⇧⌘T | `Shift-Mod-m` | nein |
| Ein-/Ausrücken | ⌘]/⌘[ → `indentLines` | `typingCommands.indent` ohne Taste; ⌘]/⌘[ über CodeMirror `indentMore/Less` | nein |
| Beenden mit Ungespeichertem | fragt nach | nichts (K1) | Plan W2-14 |
| Tab schließen ⌘W, Alle speichern ⌥⌘S | vorhanden | fehlen | nein (W2-16) |

Gleich: Diagnose-Muster, Einklapp-Tasten unter macOS, Breite der Zeilennummern, Latin-1 als ISO-8859-1.

Stil (Stichprobe): über 30 Zeilen nur `ui/EditorTabs.tsx:12-49` (JSX); Zahlen im Verlaufsmuster `diagnostics.ts` ohne Konstante; 2-Spaces-Ausrichtung in Typ-Unions (`analysisLogic.ts`, `settingsSchema.ts`); ein Test in `src/` statt `tests/` (`renderer/ipc/events.test.ts`). **Stand: erledigt** (EditorTabs in Teilkomponenten, Konstanten im Verlaufsmuster, `events.test.ts` nach `tests/unit/`, Typ-Unions mit 4 Spaces).

## Nötige Plan-/Doku-Änderungen

Wurzel-`CLAUDE.md` (M1 funktional fertig); `web/CLAUDE.md` (Titel, Landkarte: Handler, `renderer/{app,editor,stores,ui,workers}`, `main/handlers/*`, `preloadChoice.ts`, `preload/stub.ts`, `tests/perf/`, `build:e2e` geht nicht unter Windows); `web/docs/ARCHITEKTUR.md` (Abschnitt M1: Sitzungen/`isDirty`, `LineStateCache`, Einklappen als `StateField`, Diagnose-Hub/Worker, `FileTarget`/Gewährungen, Testzugang, Regel für Zeilenenden/BOM); `web/TESTING.md` (Handtest W-H15: `.tex`/`.bib` öffnen, bearbeiten, speichern; Latin-1/CRLF byte-gleich; Speichern unter; Konflikt; Fenster schließen mit Ungespeichertem); `shared/FEATURES.md` (strichpunktiert per Farbverlauf; Zoom-Umfang/Tasten; ⌘E; Schreibmaschine/Einrücken); PLAN §2 Ordnerbaum/IPC-Tabelle (echte Dateien, `FileTarget`, `dialogHandlers`, `app:confirmClose`); K1 als W1-12c in M1 vorziehen; W1-13 um Tabwechsel-Budget ergänzen, 1000-ms-Budgets für Frame/Fold-Scan sind kein echtes Budget (Plan verlangt ~3-fachen Puffer).

## Was gut ist

Text nie im Store, Statusleiste entprellt; „geändert“ über Änderungszähler mit `invertedEffects`; `LineStateCache` verschiebt korrekt (500 Zufallsbearbeitungen geprüft), Idle-Handle bei `destroy` freigegeben; Tippen nur im Fenster um die Auswahl, ein Undo-Schritt, IME-Schutz; Einstellungen per `Compartment`, robuste `settings:set`-Prüfung; `textIo` mit UTF-8 strikt, BOM-Erhalt, atomarem Schreiben, Konflikt per Hash; Aufräumen von Zeitgebern, Hub und Worker vollständig.
