# Spike S8: Rechtschreibung (de_AT/de_DE) ohne Netzwerkzugriff (W7-2)

Frage: Welcher Weg liefert in der Electron-Version eine deutsche Rechtschreibprüfung, die ohne Netz funktioniert, LaTeX-Syntax ausfiltert (wie Swift: Treffer, die ein Token überlappen, und Fachwörter aus `TechnicalVocabulary` fallen weg) und das Tippen nicht bremst?

**Antwort: eigener Weg (b): `nspell` + `dictionary-de-at` (bzw. `-de`) im Web Worker über den sichtbaren Bereich, mit eigenem Syntaxfilter, Fachvokabular und eigener Zerlegung von Zusammensetzungen.** Der sichtbare Bereich ist in etwa 2 ms geprüft (Ziel < 20 ms), Tippen p95 9,4 ms mit laufender Prüfung (Ziel < 16 ms), kein Netz. Die Chromium-Prüfung (a) fällt aus: Unter Windows/Linux lädt sie Wörterbücher aus dem Netz, unter macOS lässt sich die Sprache nicht wählen, geladener Text wird nicht geprüft und LaTeX-Befehle werden als Fehler gemeldet.

Gemessen am 2026-11-26 auf dem Intel-Mac (macOS, Electron 45.4.1 / Chromium 156, Node 25.2.1). **Windows und Linux ungemessen** (Handtest W-H27 in `web/TESTING.md`).

## Aufbau

- Pakete **nur zum Messen** in einem Wegwerf-Ordner im Scratchpad (`npm install --ignore-scripts nspell dictionary-de dictionary-de-at`), nicht in `web/package.json`. `build.mts` bindet `nspell` per Alias aus `SPELL_SPIKE_MODULES` ein.
- `src/words.ts`: Wörter (`\p{L}+`, ab 2 Buchstaben) mit Lage; „in Syntax“, wenn ein Token des Tokenizers aus `src/shared/core/latex/tokenizer.ts` sie überlappt (Befehl, Schlüssel-Argument, optionales Argument, Mathe, Kommentar, Verbatim), wie Swift `EditorTextView.textView(_:didCheckTextIn:…)`.
- `src/checker.ts`: Stufen Wörterbuch → Fachvokabular (`getStandardVocabulary().accepts(word, isKnown)`, wie Swift `SpellingVocabulary`) → eigene Zerlegung (Vorderteil bekannt groß/klein, mit Fugenelement `s/es/n/en/e/er` oder als Verbstamm `+en`; Rest bekannt oder wieder zerlegbar; Teile ≥ 3 Buchstaben, höchstens 4 Teile). Abkürzungen mit Punkt (`bzw.`) werden mit Punkt nachgefragt.
- `src/dictionaryFix.ts`: Umgehung eines nspell-Fehlers (siehe unten).
- `src/nodeBench.ts`: Messungen ohne Fenster. `main.ts`, `preload.ts`, `src/page.ts`, `src/spell.worker.ts`, `run.mts`: Electron-Fenster mit CodeMirror und strikter CSP wie `RENDERER_CSP`, Playwright `_electron.launch` mit eigenem `--user-data-dir` und `--log-net-log` im Scratchpad. Tastendrücke wie `spikes/cm-perf` (200 Zeichen, 30 ms Abstand, ohne VSync), Dokument 10.000 Zeilen aus den HgbDemo-Kapiteln.
- Testdaten: Kopie von `shared/Testdaten/HgbDemo` im Scratchpad (nur gelesen); Zusatzkorpus `shared/PLAN-WEBUI.md` (6.371 Wörter deutscher Fachtext, Code in Backticks entfernt, nur gelesen).

Aufruf (aus `web/`, Electron-Läufe außerhalb der Sandbox):

```
SPELL_SPIKE_MODULES=<Ordner mit node_modules/nspell> node spikes/spell/build.mts
SPELL_SPIKE_MODULES=… SPELL_SPIKE_DEMO=<HgbDemo-Kopie> node --expose-gc spikes/spell/out/nodeBench.mjs node
SPELL_SPIKE_MODULES=… SPELL_SPIKE_DEMO=… SPELL_SPIKE_SCRATCH=<Ordner> node spikes/spell/run.mts chromium|chromium-syntax|provider|worker
```

Rohdaten: `results/bench-node.json`, `results/electron-*.json`, Bildschirmfotos `results/probe-*.png` (geladener Text) und `results/typed-*.png` (getippter Text).

## (a) Chromium-Prüfung in Electron

| Beobachtung (macOS) | Ergebnis |
|---|---|
| Sprache | `getSpellCheckerLanguages()` = `en-GB` (OS-Locale); `setSpellCheckerLanguages(['de-AT','de-DE'])` wirft nicht, ändert aber nichts (Doku: auf macOS keine Sprachwahl, das System erkennt die Sprache). `availableSpellCheckerLanguages` kennt nur `de` und `de-DE`, **kein `de-AT`** |
| Netz | Net-Log und `webRequest`: keine einzige `http(s)`-Anfrage, kein Ordner `Dictionaries` im Benutzerordner (macOS nutzt den Systemprüfer) |
| `setSpellCheckerDictionaryDownloadURL('file:///…')` | wirft nicht, ist auf macOS laut Doku ein No-op; ob Windows/Linux `file://` annehmen, ist **nicht dokumentiert und ungemessen** |
| Geladener Text (`EditorView` mit `spellcheck="true"`) | **nicht geprüft**: nach 2,5 s mit Fokus (`document.hasFocus()` = true) keine Unterstreichung, Kontextmenü ohne `misspelledWord` für alle 7 Fehler im Prüftext |
| Getippter Text | geprüft („hot mode“): `Nochainfehler`, `Zweitfeler` unterstrichen, **aber auch `textit` aus `\textit`** |
| Syntaxfilter | möglich: Syntax-Tokens als `Decoration.mark` mit `attributes: { spellcheck: 'false' }` → `textit` nicht mehr gemeldet, Fließtext weiter (`typed-chromium-syntax.png`). Da CodeMirror nur den sichtbaren Bereich ins DOM bringt, wirkt die Prüfung ohnehin nur dort |
| Fachvokabular | kein Filter-Haken für Treffer; nur `addWordToSpellCheckerDictionary`, das laut Doku auf macOS **und Windows ins Benutzerwörterbuch des Systems** schreibt (nicht ausprobiert, um das System des Nutzers nicht zu ändern) |
| `webFrame.setSpellCheckProvider` (Sandbox-Preload) | ersetzt den Systemprüfer (getippte Fehler nicht mehr unterstrichen, nur was der Anbieter meldet), bekommt nur Einzelwörter ohne Lage: `["Nochainfehler","Tippen","Zweitfeler","textit","und","weiter"]`; `spellcheck="false"`-Spans halten `textit` nicht vom Anbieter fern. Läuft im Hauptthread des Renderers (Preload); auch er prüft geladenen Text nicht |
| Tippen (10.000 Zeilen) | Prüfung aus 3,0 ms / an 2,8 ms p95 (Arbeit = Latenz ohne VSync): kostet nichts messbar |

Windows/Linux laut Electron-Doku: Hunspell-Wörterbücher, „downloaded from a Google CDN by default“ (Session-Doku: „Chromium CDN“), beim ersten Gebrauch einer Sprache. `setSpellCheckerDictionaryDownloadURL` nimmt eine Basis-URL (`${url}${filename}`, `*.bdic` aus `hunspell_dictionaries.zip` je Release). Der Download geht vom Browser-Prozess aus; ob `session.webRequest.onBeforeRequest` aus `src/main/security.ts` ihn überhaupt sieht und abbricht, ist **ungemessen** (Net-Log auf Windows, W-H27). Folge für die Regel „keine Netzwerk-Features“: Weg (a) braucht unter Windows entweder ein mitgeliefertes `.bdic` (eigener Pfad, Lizenz wie (b), Dateiname/Ablage im Benutzerordner undokumentiert) oder einen eigenen lokalen Server/Handler – beides unsicher. `webPreferences.spellcheck: false` (Plan §2) bleibt deshalb Pflicht.

## (b) nspell + dictionary-de / dictionary-de-at

### Ladezeit und Speicher (Node 25, schnellster/alle von 3 Läufen)

| Wörterbuch | Einträge entfernt | Lesen | `nspell(aff, dic)` | Heap danach |
|---|---|---|---|---|
| de, roh | 0 | 6 ms | 746 / 816 / 792 ms | +43,8 MB |
| de, bereinigt | 21.346 | 29 ms | 498 / 516 / 468 ms | +38,7 MB |
| de-at, bereinigt | 21.468 | 34 ms | 473 / 484 / 502 ms | +38,7 MB |

In Electron (Worker, de-at bereinigt): Wörterbuch per IPC 8 ms (1,1 Mio. Zeichen), Aufbau im Worker 422 ms, gesamt 443 ms; Renderer-Arbeitsspeicher 106 → 161 MB (+55 MB). Der Hauptthread bleibt dabei frei; einmal je App-Start (bzw. Sprachwechsel).

### Tempo

| Messung | Wert |
|---|---|
| je 1000 Wörter, Demo-Fließtext (227 Wörter) | kalt 11,4 ms, warm 9,9 ms |
| je 1000 Wörter, Zusatzkorpus (6.371 Wörter) | kalt 6,3 ms, warm 5,8 ms |
| sichtbarer Bereich im Worker (≈ 185–200 Wörter, 50 Zeilen Vorlauf tokenisiert) | Prüfung p95 1,9 ms, Hin und zurück p95 2,8 ms (max 5,5) |
| Tippen, 10.000 Zeilen, ohne Prüfung | Latenz p95 2,8 ms |
| Tippen mit Prüfung nach **jedem** Tastendruck (ohne Entprellen, Ergebnis als Dekoration zurück) | Latenz p95 9,4 ms (max 11,4), Hauptthread-Arbeit p95 4,4 ms |
| `suggest` (Vorschläge, nur bei Bedarf) | 3–15 ms, bei langen Zusammensetzungen bis 66 ms (`Rechtschreibfeler`: keine Vorschläge) |

### nspell-Fehler mit dem deutschen Wörterbuch (wichtig)

igerman98 führt viele Wörter doppelt, einmal normal und einmal mit ONLYINCOMPOUND (`gehen/DIVXW` und `gehen/Sozm`). nspell 2.1.5 legt gleiche Wörter zusammen und vereinigt die Flags; danach gilt `gehen`, `stehen`, `öffnen`, `prüfen`, `zählen`, `lokal`, `breite` als „nur in Zusammensetzungen“ und wird **abgelehnt**. Umgehung `dictionaryFix.ts`: Einträge mit dem ONLYINCOMPOUND-Flag vor dem Laden entfernen (21.346 Zeilen). Das beseitigt den Fehler und macht das Laden schneller (≈ 490 statt ≈ 790 ms).

### Zusammensetzungen

nspell kann COMPOUNDBEGIN/-MIDDLE/-END nicht (README: nicht unterstützt), das deutsche Wörterbuch beschreibt Zusammensetzungen aber genau so. Ergebnis:

| Testliste (`src/corpus.ts`) | nur nspell | mit Vokabular + eigener Zerlegung |
|---|---|---|
| 30 richtige Zusammensetzungen (`Bachelorarbeit`, `Literaturverwaltung`, `Universitätsbibliothek`, `Kundenzufriedenheitsumfrage` …) | 0 erkannt | 30 erkannt |
| 10 Tippfehler darin (`Rechtschreibprüfnug`, `Hochschulbiblothek` …) | 10 gemeldet | 10 gemeldet |

Einzelwörter: `Jänner`, `Matura`, `Paradeiser` nur mit `dictionary-de-at`; `Fließtext` fehlt als Eintrag in beiden Wörterbüchern (nur gegen das Wörterbuch geprüft; die Zerlegung `Fließ|text` über den Verbstamm `fließen` sollte es annehmen, einzeln nicht gemessen). Die Zerlegung ist großzügig (jede Folge bekannter Teile gilt); ein Tippfehler, der zufällig wieder zwei Wörter ergibt, rutscht durch, wie bei Hunspell selbst.

### Lizenzen und Größe

| Paket | Version | Lizenz | Größe (entpackt) | Bemerkung |
|---|---|---|---|---|
| `nspell` | 2.1.5 | MIT | 112 KB | CommonJS, keine Typen; einzige Abhängigkeit `is-buffer` |
| `is-buffer` | 2.0.5 | MIT | 20 KB | transitiv |
| `dictionary-de-at` | 3.0.0 | Wörterbuch **GPL-2.0 OR GPL-3.0** (igerman98, Björn Jacke), Rest MIT | 1,1 MB (gzip 334 KB) | `index.js` liest per `node:fs`, also im Renderer nicht direkt nutzbar: Dateien als Ressource mitliefern, Main liest, IPC |
| `dictionary-de` | 3.0.0 | wie oben | 1,1 MB (gzip 333 KB) | nur falls de_DE wählbar sein soll |

GPL: Die Wörterbuchdateien sind Daten, die das Programm zur Laufzeit liest; sie werden nicht mit dem Programmcode verbunden. Üblich (LibreOffice, Firefox-Sprachpakete) ist, sie als eigene Dateien mit Lizenztext beizulegen. Für den Installer heißt das: `index.aff`/`index.dic` als `extraResources` mit `license` daneben, Quelle nennen; der Editor-Code bleibt davon unberührt. **Entscheidung des Nutzers nötig** (Rechtsfrage, hier nicht abschließend bewertet).

Installer: +≈ 0,5 MB komprimiert je Sprache (Worker-Bündel mit nspell, Tokenizer und Vokabular 144 KB unminifiziert).

## (c) Fehlalarme mit Syntaxfilter und Fachvokabular (HgbDemo-Kopie, de-at bereinigt)

| Stufe | geprüfte Wörter | gemeldet | verschiedene |
|---|---|---|---|
| alle Wörter (wie Chromium ohne Filter: `chapter`, `label`, `textbf` …) | 463 | 218 | 103 |
| ohne Syntax (Tokenizer) | 227 | 28 | 26 |
| + Fachvokabular `accepts` | 227 | 12 | 12 |
| + eigene Zerlegung | 227 | 6 | 6 |

Übrig bleiben `hgbthesis`, `cls`, `hgbreferences`, `bib` (Dateinamen in `\verb`/Fließtext), `lrr` (Tabellenspalten-Angabe im zweiten `{}` von `tabular`) und die absichtliche Zeile `AAAA…` aus `fehlerbeispiele.tex`: keine echten deutschen Wörter. Der Syntaxfilter allein streicht 87 % der Meldungen, Vokabular und Zerlegung halbieren den Rest noch zweimal. Mit dem rohen Wörterbuch kämen `stehen`, `zählen`, `breite` dazu (nspell-Fehler oben).

Zusatzkorpus (Plan, viel englischer Fachjargon): ohne Syntax 502 verschiedene Meldungen, + Vokabular 316, + Zerlegung 216; der Rest sind überwiegend englische Begriffe (`Electron`, `Worker`, `Stub`) und Bezeichner. Für Abschlussarbeiten heißt das: ein eigenes Benutzerwörterbuch („Wort lernen“, je Projekt oder App) ist nötig.

## Empfehlung für W7-2

1. **Weg (b)**: `nspell` im Web Worker (`workers/spell.worker.ts`), Wörterbuch `dictionary-de-at` (Standard) und optional `dictionary-de`, als Ressource mitgeliefert; der Main liest die zwei Dateien einmal und gibt sie per IPC; Bereinigung (`dictionaryFix`) beim Laden im Worker.
2. Prüfen nur den sichtbaren Bereich (+ Rand), entprellt (z. B. 150–300 ms), Anfangszustand aus dem `LineStateCache` statt 50 Zeilen Vorlauf; veraltete Antworten verwerfen; eigene Dekorationen (`Decoration.mark`), Kontextmenü mit `suggest` auf Anforderung.
3. Filter wie Swift: Token-Überlappung, `TechnicalVocabulary.accepts`, eigene Zerlegung, Abkürzungen mit Punkt; dazu ein Benutzerwörterbuch (Datei im `userData`, nie das Systemwörterbuch).
4. `webPreferences.spellcheck: false` bleibt; `setSpellCheckerEnabled(false)` zusätzlich, damit unter Windows/Linux nie ein Download startet.

**Alternative**, falls der Nutzer die GPL-Wörterbücher nicht freigibt: nur das Fachvokabular und Syntaxprüfung ohne allgemeine Rechtschreibung (Plan S8, Abbruchkriterium). Die Chromium-Prüfung (a) ist keine gute Alternative: Netz unter Windows/Linux, keine Sprachwahl unter macOS, geladener Text ungeprüft, kein Vokabularfilter.

## Neue Abhängigkeiten (Freigabe durch den Nutzer nötig, nicht in `web/package.json` eingetragen)

| Paket | Version | Lizenz | Größe | Warum |
|---|---|---|---|---|
| `nspell` (+ `is-buffer`) | 2.1.5 (2.0.5) | MIT | 112 KB + 20 KB | Hunspell-Prüfung in reinem JS, läuft im Web Worker, kein Wasm (CSP bleibt ohne `wasm-unsafe-eval`), keine nativen Module |
| `dictionary-de-at` | 3.0.0 | GPL-2.0 OR GPL-3.0 (Daten), MIT (Hülle) | 1,1 MB | österreichisches Wörterbuch (Jänner, Matura …) |
| `dictionary-de` (optional) | 3.0.0 | wie oben | 1,1 MB | de_DE, falls wählbar |

Alternative ohne Paket: die drei Dateien (`index.aff`, `index.dic`, `license`) direkt nach `resources/dictionaries/` kopieren statt per npm; nspell (≈ 1.000 Zeilen) bliebe die einzige Code-Abhängigkeit.

## Risiken und offene Punkte

- Windows/Linux ungemessen: Speicher und Ladezeit auf schwächeren Rechnern, Chromium-Download und `webRequest` (W-H27).
- nspell ist seit Jahren unverändert (2.1.5); den ONLYINCOMPOUND-Fehler umgehen wir selbst, weitere Lücken (CHECKSHARPS, CIRCUMFIX) nicht geprüft.
- +55 MB Renderer-Speicher, ≈ 0,45 s Aufbau im Worker beim Start.
- GPL-Lizenz der Wörterbücher (Nutzerentscheidung).
- Die eigene Zerlegung ist eine Näherung von Hunspell-Kompositaregeln: wenige Tippfehler rutschen durch, wenn sie zwei gültige Teile ergeben.
- Gleiches Verhalten wie Swift nur annähernd: macOS-`NSSpellChecker` hat ein anderes Wörterbuch (Vektoren in `shared/spec` wären nur für Filter und Zerlegung sinnvoll, nicht für das Wörterbuch).
