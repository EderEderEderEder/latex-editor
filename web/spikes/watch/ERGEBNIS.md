# S10: Dateiüberwachung mit `fs.watch(dir, { recursive: true })` (W0-14)

Stand 2026-11-23. Wegwerfcode in diesem Ordner: `lib.mts` (Überwacher, Entpreller, Filter, Klassifizierung), `pruefungen.mts` (Prüfungen 1 bis 7, 9), `dauerbetrieb.mts` (Prüfung 8). Aufruf aus `web/`: `node spikes/watch/pruefungen.mts [1 2 …]`, `node spikes/watch/dauerbetrieb.mts [Sekunden]` (Node mit Typ-Entfernung, Node 22.18 oder neuer; mit dem Node aus Electron: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron spikes/watch/<datei>.mts`). Kein Paket installiert, `chokidar` nicht gemessen, sondern nur begründet verglichen. Testordner liegen unter `$TMPDIR`, werden gelöscht.

## Messumgebung

- Dieser Mac: Darwin 25.6, x64, APFS (Groß-/Kleinschreibung egal, Normalisierung egal, aber erhaltend), `fs.watch` = FSEvents über libuv.
- Gemessen mit Node 25.2.1 **und** mit dem Node aus Electron 45.4.1 (`process.versions.node` = 24.22.3). Beide lieferten dieselben Zahlen; maßgeblich ist das Node von Electron.
- Andere Agenten liefen parallel. Zählungen (Ereignisse, Stapel) sind lastunabhängig und waren in allen Wiederholungen gleich (Streuung siehe Tabelle); CPU-Zeiten streuen um den Faktor 2.
- Wichtig für Nachprüfer: Innerhalb der Claude-Sandbox scheitert **jedes** `fs.watch` mit `EMFILE` (FSEvents ist gesperrt). Die Messungen liefen deshalb ohne Sandbox. Das ist ein Umgebungseffekt der Werkzeugumgebung, kein Befund über Node.
- Nicht geprüft: Prüfung 9 (läuft `git status` selbst Ereignisse in `.git` aus?). Der Code steht in `pruefungen.mts` (läuft nur mit Argument `9`), wurde wegen der Regel „kein git“ nicht ausgeführt.

## Ergebnisse je Prüfung

| # | Prüfung | Ergebnis auf diesem Mac | Windows/Linux |
|---|---|---|---|
| 1 | Ein Ereignis je Speichern | Mit 300-ms-Entpreller **genau ein Stapel je Speichern** in allen Varianten (je 10 von 10, in 2 Läufen). Rohereignisse je Speichern: direkt 20 KB = 1, direkt 5 MB in 80 Stücken = 2, atomar (Temp + rename) = 3 (Temp, Ziel ×2), Zweischritt mit Temp im Unterordner = 3 bis 4 (plus einmal `.sicher`). Nach Klassifizierung bleibt `changed:main.tex`; die Temp-Datei fällt weg (nicht im Index, existiert beim Auswerten nicht mehr). Ein Lauf zeigte 0 bis 7 Rohereignisse je Zeitfenster: Ereignisse wandern ins Nachbarfenster (FSEvents-Latenz), verloren geht nichts. | ungeprüft; Handtest. Erwartet: unter Windows mehr Rohereignisse je Speichern (Kürzen + Schreiben + Attribute), vom Entpreller aufgefangen. |
| 2 | Build-Sturm | 300 Hilfsdateien in 2 s (schreiben, ein Drittel gleich löschen): 303 bis 309 Rohereignisse; **am Stück** 2 entprellte Stapel (einer davon nachgelieferte Ereignisse einer Datei, die kurz vor dem Start des Überwachers geschrieben wurde); **drei Läufe mit 500 ms Pause**: 5 Stapel ohne Filter, **mit Filter 2** (der erste nachgeliefert, der zweite die echte Quelländerung nach dem Build). Der Filter entfernt damit alle Hilfsdateien; die Quelle `kapitel.tex`, während des Builds geändert, geht nicht verloren. Bleibt die Build-PDF ungefiltert, liefert jeder Lauf einen Stapel `main.pdf` (3 Läufe = 3 Stapel): die PDF muss als bekannte Build-Ausgabe ebenfalls herausgefiltert werden (die Oberfläche lädt sie nach `build:finished`). | ungeprüft; Handtest. Windows kann bei Stürmen Ereignisse zusammenfassen oder verlieren (Puffer); deshalb Sicherheitsnetz (siehe Entscheidung). |
| 3 | Rekursion, neue/umbenannte/gelöschte Ordner | Neuer Ordner mit sofort danach angelegten Dateien: Ordner und alle 3 Dateien gemeldet, nichts verloren. Verschachtelt (`tief/a/b/z.tex`) gemeldet. Spätere Änderungen in neuen Ordnern kommen an. **Ordner umbenennen: nur zwei Ereignisse (alter und neuer Ordnername), keine für die Kinder.** Ordner löschen: Ereignisse für jede Datei und die Ordner. Folge: Eine Datei-Index-Menge (`known`) wird beim Umbenennen eines Ordners **veraltet** (im Test blieben `neu/a.tex` usw. stehen). | `recursive` unter Linux: siehe Plattformlimits. Windows: natives `ReadDirectoryChangesW` mit Teilbaum, ungeprüft. |
| 4 | Leerzeichen, Umlaute, NFC/NFD | Leerzeichen, CJK, Emoji, NFC und NFD kein Problem. **Der Ereignisname hat die Form, in der der Name gespeichert ist** (NFC-Datei kommt als NFC, NFD-Datei als NFD; `readdir` genauso). `stat` mit der jeweils anderen Normalform findet dieselbe Datei; Schreiben unter der anderen Form erzeugt keine zweite Datei, das Ereignis trägt die gespeicherte Form. Regel: **Vergleichsschlüssel immer `normalize('NFC')`**, für Dateizugriffe den gemeldeten Namen unverändert nehmen. | NTFS und ext4 kennen NFC und NFD als **verschiedene** Dateien; der NFC-Schlüssel würde zwei solche Namen zusammenlegen (im Alltag praktisch nie). Ungeprüft. |
| 5 | Groß-/Kleinschreibung umbenennen | `Datei.tex` → `datei.tex` und Ordner `Bilder` → `bilder`: je zwei Ereignisse (alter und neuer Name). **`stat(alter Name)` gelingt weiter** (Dateisystem ohne Groß-/Kleinunterscheidung); die naive Klassifizierung ergab deshalb `changed:Datei.tex` und `created:datei.tex`, der alte Name blieb im Index. Lösung: Existenz **per `readdir(Elternordner)` mit exaktem Namen** prüfen, nicht per `stat`. | Windows verhält sich wie macOS (gleiche Regel); Linux unterscheidet, dort geht `stat`. Ungeprüft. |
| 6 | Zuverlässigkeit | 1000 verschiedene Dateien in 205 bis 233 ms geschrieben: 1004 Rohereignisse, **1000 verschiedene Namen, 0 fehlend** (Node 25 und Electron-Node). 1000-mal dieselbe Datei im Abstand 5 ms: 123 bis 128 Rohereignisse (FSEvents fasst zusammen), der **letzte Stapel enthält die Datei**, Inhalt `stand 999`. Zusammenfassung ist harmlos: wichtig ist das Ereignis nach dem letzten Schreiben, und das kam jedes Mal. | ungeprüft. Windows: Puffer-Überlauf bei vielen schnellen Änderungen kann Ereignisse kosten (aus dem Gedächtnis, unsicher), deshalb Sicherheitsnetz. |
| 7 | Ereignisart und Bestimmung neu/geändert/gelöscht | **Auf macOS ist die Art unbrauchbar:** fast alles kommt als `rename` (neu, überschreiben, anhängen, nur Zeitstempel, löschen, kopieren, Ordner anlegen/löschen). `change` kam nur selten (einmal nach Ordner-Umbenennen). Daher: Art ignorieren, per `lstat` bestimmen: Pfad existiert und ist im Index → geändert; existiert, nicht im Index → neu; existiert nicht, im Index → gelöscht; existiert nicht, nicht im Index → verwerfen (Temp-Datei). Ordner: immer `treeChanged` und Teilbaum neu einlesen. | Auf Windows/Linux liefert Node laut Dokumentation `change` für Inhaltsänderungen und `rename` für Anlegen/Löschen/Umbenennen (aus dem Gedächtnis); die stat-Regel gilt unabhängig davon, deshalb portabel. Ungeprüft. |
| 8 | Speicher/CPU, 5.000 Dateien in 50 Ordnern, Dauerbetrieb | Überwacher im eigenen Kindprozess. Start: RSS 62 MB (Electron-Node 59 MB), 133 bis 178 ms CPU einmalig. **Leerlauf 15 s: 1 ms CPU, RSS unverändert.** 4 Runden mit je 5.000 angefassten Dateien (20.000 Ereignisse): je 5.000 Ereignisse/5.000 Namen, 1 Stapel je Runde, CPU 38 bis 90 ms je Runde, RSS 64 bis 72 MB und danach wieder 66 bis 70 MB: **kein Wachstum, kein Leck**. Schreiber braucht 190 bis 280 ms je 5.000 Dateien. | ungeprüft. |

Messdateien: Ausgaben nur im Terminal (Wegwerfmessung); die Skripte sind wiederholbar.

## Plattformlimits (Unsicherheit ehrlich)

- **macOS (FSEvents):** ein Strom für den ganzen Baum, kein Handle je Ordner; Ereignisse kommen mit kleiner Latenz gebündelt; kurz vor dem Start geschriebene Dateien können als Ereignis nachgeliefert werden (harmlos, der Index-Vergleich macht daraus `changed`). Ereignisart unbrauchbar (Prüfung 7). Gilt nicht in der Claude-Sandbox (`EMFILE`).
- **Linux:** Electron 45 bringt Node 24 mit. `recursive` unter Linux gibt es nach meiner Erinnerung seit Node 19.1/20 (Dokumentation: „Added recursive support for Linux“); es ist in JavaScript umgesetzt (ein inotify-Watch je Ordner, neue Ordner werden erst nachträglich überwacht). **Nicht auf Linux gemessen.** Zu erwartende Schwächen: Rennen bei Dateien, die unmittelbar nach `mkdir` in einem neuen Ordner entstehen (FSEvents zeigte das nicht), und das inotify-Limit `fs.inotify.max_user_watches` (ältere Kerne 8.192; je Ordner ein Watch, nicht je Datei, für LaTeX-Projekte unkritisch). Bei `ENOSPC`/Fehlerereignis: Hinweis „Dateiüberwachung nicht verfügbar“, manuelles Aktualisieren.
- **Windows:** `ReadDirectoryChangesW` mit Teilbaum (nativ, ein Handle). Aus dem Gedächtnis, ungeprüft: fester kleiner Puffer, bei Überlauf gehen Ereignisse still verloren; mehrere `change` je Schreibvorgang; Löschen oder Umbenennen des überwachten Wurzelordners liefert einen Fehler (`EPERM`) statt Ereignisses; Pfade kommen mit Rückwärtsstrich. **OneDrive und Virenscanner sperren Dateien kurz** (`EBUSY`/`EPERM`/`EACCES` beim Lesen direkt nach dem Ereignis); das löst weder `fs.watch` noch `chokidar`, nötig ist **Lesen mit Wiederholung und Rückoff**.
- **Electron-Node:** In Electron 45 gemessen mit `ELECTRON_RUN_AS_NODE`; im Main-Prozess der App selbst nicht eigens gemessen (gleiche Node-Bibliothek, gleiches libuv).

## Entscheidung: `fs.watch` + eigener Entpreller, **kein `chokidar`**

Begründung:

1. Alle auf dem Mac gemessenen Kriterien sind erfüllt: ein Stapel je Speichern (auch atomar), kein Sturm beim Build (mit Filter), keine verlorenen Namen bei 1000 Schreibvorgängen, kein Speicher- oder CPU-Problem bei 5.000 Dateien.
2. Was bleibt (Ereignisart unbrauchbar, Ordner-Umbenennen ohne Kind-Ereignisse, Groß-/Kleinschreibung, NFC/NFD, Temp-Dateien) löst **auch `chokidar` nicht für uns**: wir müssten ohnehin per `lstat`/`readdir` gegen einen Index prüfen. Vergleich ohne Installation (aus dem Gedächtnis, nicht geprüft): `chokidar` 4 baut auf `fs.watch` je Ordner (kein eigenes FSEvents mehr, anders als 3), liefert `add/change/unlink/addDir/unlinkDir`, `atomic` und `awaitWriteFinish`; unter Windows und Linux wäre es also dieselbe Grundlage. Der Nutzen wäre die fertige Ereignisübersetzung, der Preis eine Abhängigkeit (Nutzer-OK nötig) und mehr Handles unter Linux.
3. „Kein Polling“ aus `PLAN-WEBUI.md` bleibt eingehalten; `chokidar` würde bei `awaitWriteFinish` intern abfragen.

Bedingungen (sonst `chokidar` nachrüsten, mit Nutzer-OK):

- Windows-Handtest (unten) besteht: 1 Stapel je Speichern auch mit Virenscanner/OneDrive, keine fehlenden Namen in Prüfung 6, keine Fehlerereignisse.
- Unter Linux funktioniert `recursive` mit Node 24 und neue Ordner liefern Ereignisse (gleicher Test).
- Umsetzung `main/watch.ts` hinter einer kleinen Schnittstelle (`start(root, onChanged)`/`stop()`), damit ein Tausch gegen `chokidar` die Aufrufer nicht berührt (kein Vorratsbau: nur diese eine Funktion).
- Sicherheitsnetz statt Polling: bei `build:finished`, beim Fenster-Fokus und nach jedem Überwacher-Fehler Baum neu einlesen und `mtime`/Größe der **geöffneten** Tabs prüfen. Damit sind auch verlorene Ereignisse (Windows-Puffer) unkritisch.

## Vorschlag Entpreller und Filter

**Entpreller:** Menge der relativen Pfade (`Set`), Zeitgeber wird bei jedem Ereignis neu gestartet, ruft nach **300 ms Ruhe**. Zusätzlich **Höchstwartezeit 1,5 s** (bei Dauerfeuer, z. B. Kopieren eines großen Ordners, wird trotzdem geliefert; nicht gemessen, nur als Schutz). Beim Auswerten je Pfad:

1. Filter anwenden (unten).
2. `lstat` (Ordner: `treeChanged` und Teilbaum per `readdir` mit `recursive` neu einlesen, Index ersetzen).
3. Datei: Index vergleichen (NFC-Schlüssel) → `created`/`changed`/`deleted`/verwerfen. Existenz bei Namen, die sich nur in Groß-/Kleinschreibung unterscheiden, per `readdir(Elternordner)` prüfen.
4. Lesen von Dateiinhalten nach einem Ereignis mit Wiederholung und Rückoff (50, 100, 200, 400, 800 ms; danach Fehler anzeigen und bei nächstem Ereignis erneut versuchen).
5. `fs:changed` = `{paths, kinds, treeChanged, gitChanged}` höchstens einmal je Stapel; leere Stapel (alles gefiltert) senden nichts.

**Filterliste (nur für `fs:changed`):**

- Endungen: `aux log toc lof lot out fls fdb_latexmk synctex.gz synctex synctex(busy) bbl blg bcf run.xml idx ilg ind nav snm vrb xdv dvi lol loa glo gls glg acn acr alg ist brf auxlock pyg` sowie Editor-Reste `tmp swp swx bak` und Namen mit `~` am Ende oder `.#` am Anfang.
- Namen: `.DS_Store`, `Thumbs.db`, `desktop.ini`, `4913` (Vim-Testdatei).
- Ordner: `_minted*`, `node_modules/`, `.git/objects/`, `.git/logs/`, `*.lock` in `.git`.
- **Build-PDF** des Projekts (bekannter Pfad aus dem Build) und ihre `.synctex.gz`: nicht über Dateiereignisse, sondern nach `build:finished`. Andere PDFs im Baum (Abbildungen) bleiben **nicht** gefiltert.
- `.git`: nur `HEAD`, `index`, `refs/**`, `packed-refs` setzen `gitChanged`. **Hypothese, nicht gemessen:** `git status` kann den Index neu schreiben und so eine Rückkopplung `git:changed` → `git status` auslösen; Abhilfe: Status mit `GIT_OPTIONAL_LOCKS=0` aufrufen und `gitChanged` für eigene Git-Aufrufe kurz unterdrücken. Mit `node spikes/watch/pruefungen.mts 9` prüfbar (ruft `git` in einem Testordner unter `$TMPDIR` auf).
- Die Filterliste wirkt nur auf Ereignisse. Zeigt die Baumansicht `.log`/`.aux` ohnehin nicht, ist das gewollt; sonst müssten diese Dateien den Baum aktualisieren (dann nur `treeChanged`, nicht `changed`).

## Handtest Windows in 5 Schritten

Voraussetzung: Windows mit `npm install` im Ordner `web/`, Node 22.18 oder neuer (oder das Electron aus `node_modules`), Virenscanner an.

1. PowerShell in `web\`: `node spikes\watch\pruefungen.mts 1 2 3 4 5 6 7`. Die Testordner entstehen im `%TEMP%` (lokal, nicht in OneDrive). Erwartung: Prüfung 1 je Variante `entprellte Stapel 10`, Prüfung 6 `fehlend 0`, Prüfung 2 mit Filter keine Hilfsdateien in den Stapeln.
2. Dasselbe mit Testordner **in OneDrive**: `mkdir "$env:OneDrive\s10test"`, `$env:TEMP="$env:OneDrive\s10test"`, Schritt 1 wiederholen. Auf Fehlerausgaben `EBUSY`/`EPERM`, doppelte Stapel oder fehlende Namen achten.
3. `node spikes\watch\dauerbetrieb.mts 15`: RSS und CPU notieren (Mac: 62 MB, 1 ms CPU im Leerlauf, 38 bis 90 ms je 5.000 Ereignisse).
4. Mit Electron-Node wiederholen: `$env:ELECTRON_RUN_AS_NODE=1; .\node_modules\electron\dist\electron.exe spikes\watch\pruefungen.mts 1 3 5`, danach `Remove-Item Env:ELECTRON_RUN_AS_NODE`. Prüfung 3 beachten (Ordner umbenennen, löschen) und 5 (Groß-/Kleinschreibung).
5. Ergebnisse in die Spalte „Windows“ der Tabelle oben eintragen. Fällt Schritt 1, 2 oder 3 durch (mehr als ein Stapel je Speichern, fehlende Namen, Fehlerereignisse), `chokidar` mit Nutzer-OK einplanen. Ebenso auf Linux (`node spikes/watch/pruefungen.mts 1 2 3 6`).
