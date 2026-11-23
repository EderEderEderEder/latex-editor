# Handtests Web (Electron), Mac und Windows

Nummerierung W-H1 ff. Prüfseite für W-H3 bis W-H8: `node spikes/electron-check/build.mts`, dann `node_modules/.bin/electron spikes/electron-check/out/main.cjs` (Windows: `node_modules\.bin\electron.cmd`). Für W-H8 vorher eine PDF-Datei (~10 MB) in einen Ordner legen und `SPIKE_PDF=<Datei>`, `SPIKE_ALLOWED_DIR=<Ordner>` setzen; Ergebnisse stehen in `spikes/electron-check/ERGEBNIS.md`.

## NSIS-Testbuild auf dem Windows-Rechner (S6)

1. Node.js (LTS) installieren, Repo auf den Rechner kopieren, in `web/`: `npm ci`. Beim ersten `npm run package` lädt electron-builder auf Windows NSIS und Hilfswerkzeuge selbst nach (Netz nötig; vom Mac aus nicht ausführen).
2. `npm run package` (= `electron-vite build && electron-builder`). Ergebnis: `dist\LatexEditor Web-Setup-0.1.0.exe`. `electron-builder.yml` setzt `oneClick: false`, `perMachine: false`, `requestedExecutionLevel: asInvoker`, keine Dateizuordnungen.
3. Installer als normaler Benutzer (ohne „Als Administrator ausführen“) starten. Kein UAC-Dialog darf erscheinen; Ziel `%LOCALAPPDATA%\Programs\...`.
4. Start über Startmenü. Ein WebView2-Hinweis entfällt, Electron bringt Chromium mit. SmartScreen-Warnung (unsigniert) mit „Weitere Informationen“ → „Trotzdem ausführen“ ist erwartet.

## Liste

| Nr. | Test | Mac | Windows | Erwartung |
|---|---|---|---|---|
| W-H1 | Installation ohne Admin: Installer als normaler Benutzer ausführen (Windows), dmg ziehen (Mac) | ☐ | ☐ | kein UAC-/Passwort-Dialog, App startet, Deinstallation über Einstellungen möglich |
| W-H2 | Start ohne TeX und ohne Git (PATH ohne beide) | ☐ | ☐ | Fenster öffnet, Hinweis „TeX/Git nicht gefunden“ statt Absturz, Editor nutzbar |
| W-H3 | AltGr: in Prüfseite Feld (a) und Editor `{ } [ ] \ @ ~ \|` tippen (Windows: AltGr + 7 8 9 0 ß Q + \<), Mac: Option-Belegungen | ☐ | ☐ | alle acht Zeichen erscheinen in Textfeld und CodeMirror; Protokoll zeigt `key`, `code`, `ctrlKey`, `altKey` (Windows: beide true); keine Kürzel lösen aus |
| W-H4 | IME: japanisch/chinesisch/koreanisch und Emoji-Auswahl in Feld (b) und im Editor | ☐ | ☐ | Vorschlagsfenster am Cursor, `compositionstart/update/end`, Endtext im Dokument, Rücktaste mitten in der Komposition zerstört nichts |
| W-H5 | Drag & Drop: Datei (Pfad mit Leerzeichen und Umlaut) aus Finder/Explorer auf Feld (c) ziehen | ☐ | ☐ | angezeigter Pfad = echter Pfad (Windows: `C:\...`); mehrere Dateien liefern mehrere Pfade |
| W-H6 | Zwischenablage: Zellbereich aus Excel kopieren, in Feld (d) und Editor einfügen (Strg/Cmd+V); Text aus Editor kopieren und in anderer App einfügen | ☐ | ☐ | Tabulatoren und Zeilenumbrüche bleiben erhalten; Kopieren/Ausschneiden/Einfügen im Editor gehen |
| W-H7 | Sandbox/Preload: Schaltfläche „Sandbox“ | ☐ | ☐ | alle Zeilen OK |
| W-H8 | PDF-Laden 10 MB: Schaltfläche „PDF-Transport (5 Läufe)“ | ☐ | ☐ | alle Varianten unter 100 ms (schnellster Lauf notieren) |
| W-H9 | CSP-Konsole: gebauter, unverpackter Start (Abschnitt unten), in der echten App ein PDF laden, tippen, scrollen, DevTools-Konsole prüfen | ☐ | ☐ | keine Meldungen „Refused to …“ (CSP) außer den bewussten Tests der Prüfseite (Inline, eval, blob-fetch, wasm); im verpackten Build lassen sich DevTools nicht öffnen (gewollt) |
| W-H10 | Wasm-Bedarf: PDF mit JPEG2000-/CMYK-Bildern in der App öffnen | ☐ | ☐ | Bilder sichtbar; bei Verstoß `wasm-eval` in der Konsole: `script-src` um `'wasm-unsafe-eval'` ergänzen (Entscheidung melden) |
| W-H11 | Single-Instance: App starten, dann ein zweites Mal starten (Startmenü/Doppelklick) | ☐ | ☐ | keine zweite Instanz; das erste Fenster kommt nach vorn (aus dem Minimierten wiederhergestellt) |
| W-H12 | Beenden während eines Builds: langes Dokument (40 s) kompilieren, App schließen | ☐ | ☐ | App beendet sich; im Task-Manager/Aktivitätsanzeige bleiben kein `latexmk`, `perl`, `pdflatex` zurück (Windows: Spalte PID; nichts nach Namen beenden) |
| W-H13 | UNC-Pfad als Projekt (nur Windows): `\\server\freigabe\projekt` bzw. `\\localhost\c$\…` über „Projekt öffnen“ und aus „Zuletzt geöffnet“ | – | ☐ | wird als Projekt abgelehnt (Fehlermeldung), keine Netzwerkverbindung/kein NTLM-Anmeldeversuch; macOS: `/net/…` (autofs) löst kein Mounten aus |

## Unverpackter Start für W-H9 (DevTools, CSP-Konsole)

Das Standardmenü mit „Toggle Developer Tools“ entfällt (Review M3): `devTools` ist nur unverpackt an, bis W2-16 hat die App kein Menü. Für W-H9 deshalb gebaut, aber unverpackt starten, im Ordner `web/`:

1. `npm run build` (strikte CSP aus `index.html`, nicht der Dev-Modus mit gelockerter CSP).
2. `npx electron .` (Windows: `npx electron .` in PowerShell). Die App läuft aus `out/`, `app.isPackaged` ist `false`, also sind DevTools erlaubt.
3. DevTools öffnen: Strg+Umschalt+I / Cmd+Opt+I wirkt nur, wenn die App ein Menü oder Kürzel dafür hat. Bis zum eigenen Menü (W2-16) ist das Standardmenü abgeschaltet; ein unverpackter Öffnungsweg (z. B. Startschalter) legt der Code-Agent fest und trägt ihn hier ein. Reiter Konsole: PDF laden, tippen, scrollen, nach „Refused to …“ suchen.
4. Im Installer-Build (`npm run package`) darf kein DevTools-Fenster aufgehen: Strg+Umschalt+I bleibt wirkungslos.
