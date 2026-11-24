# Sprachunabhängige Testvektoren (`shared/spec/`)

## Zweck

Die Swift-Tests sind die Referenz für das Verhalten. Reine Logik daraus liegt hier als JSON, damit die Web-Version (Electron, durchgehend TypeScript) dieselben Fälle prüft. Die Swift-Seite prüft dieselben Dateien als Gegenprobe (`SpecVectorTests`). Ein Vektor gilt erst als gültig, wenn ihn Swift besteht. Quellenliste und Einstufung: `QUELLEN.md`. Plan: `../PLAN-WEBUI.md` §3.

## Schema

Formal in `schema.json` (JSON Schema Draft 7), ein Beispiel in `example.json`.

```
{ suite, version, source, notes?, skipped?, cases: [ { id, name, source?, input, expect, sourceLine? } ] }
```

| Feld | Bedeutung |
|---|---|
| `suite` | Name der Suite, gleich dem Dateinamen ohne `.json` |
| `version` | Ganzzahl ab 1, bei inkompatibler Änderung des Falllayouts erhöhen |
| `source` | Swift-Testdatei als Zeichenkette oder, bei mehreren Dateien, als Array von Zeichenketten (je Pfad ein Eintrag, kein „;“ und kein „und“), z. B. `swift/Tests/LatexEditorTests/LatexTokenizerTests.swift`. Erläuterungen gehören nach `notes`, nicht in den Pfad. |
| `notes` | optional: Freitext für Verbraucher (Markierungsnotation, Indexbasis, Fälle mit Nicht-ASCII-Text). Nur Text, nie prüfbare Werte. |
| `skipped` | optional: `[{name, reason, source?, sourceLine?}]` für bewusst ausgelassene Tests (Zufall, Pixel, Fenster, Prozesse, Zeit) |
| `cases[].id` | eindeutig innerhalb der Datei, stabil (Swift-Funktionsname, bei mehreren Fällen je Test mit Suffix, z. B. `keyArgument-label`) |
| `cases[].name` | Text aus `@Test("…")` |
| `cases[].source` | optional, wie `source`: Swift-Datei dieses Falls, wenn die Suite mehrere Quellen hat. `sourceLine` bezieht sich dann auf diese Datei. Ohne das Feld gilt `source` der Suite. |
| `cases[].input`, `expect` | beliebiges JSON, Form je Suite und `op` (siehe „Operationen und Erwartungen“) |
| `cases[].sourceLine` | 1-basierte Zeile des `@Test` in der Swift-Datei |

### Allgemeine Regeln für Werte

- **Offsets und Längen** sind UTF-16-Einheiten (wie `NSString`/JavaScript-`String`). Siehe „Offsets und Nicht-ASCII“.
- **Zeilenindizes** in Erwartungen (`startLine`, `endLine`, Schlüssel von `endStates`/`endStatesAfterEdit`/`endStatesPartial`) sind **0-basiert**. 1-basiert sind nur `sourceLine` und Zeilennummern in Meldungstexten (z. B. „Zeile 1“).
- Enum-Namen exakt wie in Swift (`command`, `keyArgument`, `mathEnvironment` …). Zustandskodierung siehe „Zustände“.
- **Fehlt ein Schlüssel in `expect` (oder in einem `steps`-Eintrag), wird er nicht geprüft.** Beispiel: `keyArgument-label` prüft nur `tokens`, nicht `state`. Ein vorhandener Schlüssel muss genau gelten, auch `[]` (leere Liste) und `null` (kein Ergebnis).
- Texte stehen als JSON-Zeichenketten; `\n`, `\t`, `\r\n` sind echte Steuerzeichen. Keine persönlichen Pfade.
- `op` steht in `input` und wählt die Operation. Eine Datei darf Fälle mehrerer `op` mischen; Verbraucher verzweigen über `input.op`. Fälle ohne `op` gibt es nur in `syntax-checker.json` (siehe dort).

## Zustände (Lexer-Zustand am Zeilenende)

Zustände kommen in `input.state` und in `expect` (`state`, `endStates`, `endStatesAfterEdit`, `endStatesPartial`, `steps[].state`) vor. Kodierung: **ein Zustand ohne Wert ist eine Zeichenkette, ein Zustand mit Wert ein Objekt mit genau einem Schlüssel** (Name des Swift-Falls) und dem Wert dazu. Quelle: `LexState` in `swift/Sources/LatexEditor/Syntax/LatexTokenizer.swift`.

| JSON | Swift | Bedeutung |
|---|---|---|
| `"normal"` | `.normal` | Zeile endet im Fließtext |
| `{"math": "dollar"}` | `.math(.dollar)` | offene Inline-/Display-Mathe. Wert: `dollar`, `doubleDollar`, `parenthesis`, `bracket` (in den Vektoren bisher nur `dollar`). Eine Leerzeile beendet sie. |
| `{"mathEnvironment": "align*"}` | `.mathEnvironment("align*")` | offene Mathe-Umgebung, Wert ist der Umgebungsname. Eine Leerzeile beendet sie. |
| `{"verbatimEnvironment": "lstlisting"}` | `.verbatimEnvironment("lstlisting")` | offene Code-/Verbatim-Umgebung. Eine Leerzeile beendet sie nicht. |
| `{"bibtex": {…}}` | `.bibtex(BibLexState)` | `.bib`-Zustand, siehe unten |

`BibLexState` (`BibTokenizer.swift`) als Objekt mit den Feldern `phase`, `kind`, `depth`, `inQuotes`, `closesWithParenthesis`:

| Feld | Werte |
|---|---|
| `phase` | `outside`, `entryOpening`, `key`, `fieldName`, `equals`, `value`, `comment` |
| `kind` | `regular`, `withoutKey` (`@string`, `@preamble`), `comment` |
| `depth` | Ganzzahl, Klammertiefe im Eintrag (die Klammer des Eintrags selbst ist 1) |
| `inQuotes`, `closesWithParenthesis` | Wahrheitswerte |

Der Anfangszustand `BibLexState()` ist `{phase: "outside", kind: "regular", depth: 0, inQuotes: false, closesWithParenthesis: false}`. Wo `endStates` einen Bib-Zustand angibt, steht er vollständig; `endStatesPartial` gibt nur einen Teil der Felder an (siehe Teil-Prüfungen).

Ein Token-Objekt hat die Form `{"kind": <Art>, "text": <Text>}` (Art: `command`, `delimiter`, `optionalArgument`, `keyArgument`, `math`, `comment`, `verbatim`; `text` ist der Textausschnitt des Tokens) oder, nur bei `tokensByRange`, `{"kind", "location", "length"}`.

## Operationen und Erwartungen je Vektordatei

### `latex-tokenizer.json`

`input.op` und Form:

| `op` | `input` | Bedeutung |
|---|---|---|
| `tokenizeLine` | `{line, state}` | Eine Zeile mit `LatexTokenizer.tokenize` ab Anfangszustand `state` zerlegen. |
| `tokenizeChain` | `{lines: [..], state}` | Mehrere Zeilen nacheinander tokenisieren; der Endzustand jeder Zeile ist der Anfangszustand der nächsten, die erste startet mit `state`. |
| `tokenizeLineWithOffset` | `{line, lineOffset, state}` | Wie `tokenizeLine`, aber Token-Positionen sind absolut (`lineOffset` + Position in der Zeile). |
| `highlightAll` | `{text}` | Ganzen Text mit `SyntaxHighlighter` komplett einfärben (eine Zeile je `\n`) und die gespeicherten Endzustände je Zeile prüfen. |
| `highlightEdit` | `{text, edit: {locationOfSubstring, offset, length, replacement}}` | Text komplett einfärben, dann die Stelle `Position des ersten Vorkommens von locationOfSubstring + offset` mit der Länge `length` durch `replacement` ersetzen (hier: einfügen) und inkrementell neu einfärben. |

`expect` je `op`:

| `op` | `expect` |
|---|---|
| `tokenizeLine` | `tokens` (vollständige Liste in Reihenfolge) und/oder `state` (Endzustand); jeder Schlüssel optional (nicht genannt = nicht geprüft). |
| `tokenizeChain` | `steps`: Liste, ein Eintrag je Zeile in Reihenfolge, jeder mit beliebigen der Schlüssel `tokens`, `state`, `lastToken`. |
| `tokenizeLineWithOffset` | `tokensByRange` (vollständige Liste `{kind, location, length}`). |
| `highlightAll` | `endStates`: **Liste** mit einem Zustand je Zeile des Texts (Länge = Zeilenzahl), exakt zu vergleichen. |
| `highlightEdit` | `tokenizedLineCount`, `allTokenKinds`, `endStatesAfterEdit` (siehe Teil-Prüfungen). |

### `bib-tokenizer.json`

| `op` | `input` | Bedeutung |
|---|---|---|
| `highlightAll` | `{language: "bibtex", source, visibleOnly}` | `.bib`-Text (`source`, nicht `text`) mit `SyntaxHighlighter(language: .bibtex)` komplett einfärben und die Tokens als `(kind, text)` lesen. Bei `visibleOnly: true` werden Tokens verworfen, deren Text nur aus Leerraum besteht (Leerzeilen zwischen Einträgen sind sonst Kommentar-Tokens). |
| `languageFromPath` | `{path}` | Sprache anhand der Dateiendung bestimmen (Groß-/Kleinschreibung egal). |

`expect`: bei `highlightAll` beliebige der Schlüssel `tokens`, `tokensPrefix`, `tokensSuffix`, `tokensContain`, `tokensNoneContainText`, `endStates`, `endStatesPartial` (Semantik unten); bei `languageFromPath` `{language: "bibtex" | "latex"}` (`.bib` und `.BIB` ergeben `bibtex`, `.tex` `latex`). Bei `endStates` und `endStatesPartial` ist hier ein **Objekt** `{"<Zeilenindex 0-basiert>": Zustand}`, geprüft werden nur die genannten Zeilen (anders als bei `highlightAll` in `latex-tokenizer.json`, wo `endStates` eine Liste aller Zeilen ist).

### `latex-source.json`

| `op` | `input` | `expect` | Bedeutung |
|---|---|---|---|
| `commentStart` | `{line}` | `{offset: Zahl \| null}` | Position des ersten wirksamen `%` in der Zeile; `\%` zählt nicht, `\\%` (Zeilenumbruch + Kommentar) schon; `null` = kein Kommentar. |
| `masking` | `{text}` | `{sameUtf16Length, contains, notContains, hasSuffix}` | Kommentare im Text unkenntlich machen (`LatexComments.masking`); Ergebnis wird gegen die Schlüssel geprüft. |
| `isInComment` | `{line, lineStart, location}` | `{isInComment: bool}` | Liegt die absolute Position `location` in einem Kommentar der Zeile, die bei `lineStart` beginnt? |
| `referenceKeys` | `{text}` | `{keys: [..]}` | Schlüssel aller Referenzbefehle (`\ref`, …) im Text in Reihenfolge, ohne Kommentare und ohne Inhalt von `\verb` (`LatexReferences.scan`); `[]` = keine. |
| `isInsideCode` | `{text, at: "end"}` | `{isInsideCode: bool}` | Liegt die Position in einer offenen Code-Umgebung? `"end"` bedeutet das Textende (UTF-16-Länge); andere Werte kommen nicht vor. |

### `fold-regions.json`

| `op` | `input` | `expect` | Bedeutung |
|---|---|---|---|
| `regions` | `{text}` | `{regions: [{kind, startLine, endLine}]}` | Zuklappbare Bereiche (`FoldScanner.regions`). Die Liste muss vollständig, in dieser Reihenfolge (nach Startzeile) und exakt übereinstimmen; `[]` = keine. |
| `hiddenRange` | `{text, region: {kind, startLine, endLine}}` | `{hiddenRange: {location, length}, hiddenText}` | Der beim Zuklappen ausgeblendete Bereich (`FoldRegion.hiddenRange`) in UTF-16 und der darin liegende Text. |

`kind` ist **`"section"`** (Kapitel/Abschnitt), **`"comments"`** (Kommentarblock) oder **`{"environment": "<Name>"}`** (Umgebung, z. B. `{"environment": "itemize"}`), wie `FoldRegion.Kind` (`.section`, `.comments`, `.environment(name)`). `startLine` ist die Kopfzeile, `endLine` die letzte zugehörige Zeile, beide 0-basiert und eingeschlossen.

### `syntax-checker.json`

Hier gibt es **kein `op`**. Jeder Fall ist: `input: {text}` → Text mit `LatexMasking.scannable` maskieren und `SyntaxChecker.marks(masked:)` anwenden (Markierungen nach Position aufsteigend, höchstens 200). `expect` beschreibt die Markierungen mit beliebigen der folgenden Schlüssel:

| Schlüssel | Bedeutung |
|---|---|
| `count` | genaue Anzahl Markierungen (`0` = Text ist korrekt) |
| `allSeverity` | alle Markierungen haben diesen Schweregrad (`"error"`) |
| `firstLocation` | `range.location` der ersten Markierung (UTF-16, Textposition) |
| `foundTexts` | Liste von Zeichenketten; für **jede** gibt es mindestens eine Markierung, deren Bereich im Originaltext genau diese Zeichenkette ist. Weitere Markierungen sind erlaubt, sofern `count` nichts anderes verlangt. |
| `firstMessageContains` | die Meldung der ersten Markierung enthält diesen Text (Meldungen sind deutsch, Zeilennummer 1-basiert) |

### `text-editing.json`

Jeder Fall beschreibt eine Editieraktion auf Text mit Markierung. `input.marked` ist der Text samt Auswahl in der **Markierungsnotation**: `|` = Cursor (leere Auswahl), `«…»` = markierte Auswahl. Die Zeichen `|`, `«`, `»` gehören nicht zum Text; Verbraucher entfernen sie und merken sich die Auswahl als UTF-16-Bereich. `expect` ist der Text nach der Aktion, wieder mit Markierung der neuen Auswahl (`|` bei leerer, `«…»` sonst), oder **`null`**, wenn die Aktion keine Bearbeitung liefert (der Editor verhält sich normal; Swift: `nil`). Verglichen wird die ganze Zeichenkette (Tabulator `\t`, Zeilenumbruch `\n`).

| `op` | zusätzliche `input`-Felder | Bedeutung |
|---|---|---|
| `typed` | `character` | Zeichen tippen: öffnende Klammer ergänzt das Paar, schließende überspringt, `$` öffnet/schließt, mit Auswahl wird umschlossen. |
| `deleteBackward` | – | Rückschritt; in einem leeren Paar werden beide Zeichen gelöscht. |
| `newline` | – | Enter: Einrückung übernehmen, nach `\begin{x}` `\end{x}` ergänzen, Listenpunkte fortsetzen. |
| `toggleComment` | – | Kommentar `% ` für die betroffenen Zeilen ein-/ausschalten. |
| `indent`, `outdent` | – | Zeilen der Auswahl um einen Tab ein- bzw. ausrücken. |
| `moveLines` | `up` (bool) | Zeilen nach oben (`true`) oder unten (`false`) verschieben. |
| `duplicateLines`, `deleteLines` | – | Zeilen der Auswahl verdoppeln bzw. löschen. |
| `wrap` | `command` | Auswahl mit `\<command>{…}` umschließen; ohne Auswahl leere Klammern; steht die Auswahl schon darin, wird das entfernt. |

### `latex-log.json`

| `op` | `input` | Bedeutung |
|---|---|---|
| `parseLog` | `{file \| text, baseDirectory, onlySeverity?}` | LaTeX-Log mit `LatexLogParser.parse(_, baseDirectory:)` auswerten. `file` ist ein Fixture-Pfad relativ zu `shared/spec/` (`fixtures/errors.log`), `text` der Logtext direkt. `onlySeverity` filtert vor der Prüfung auf diese Art. |
| `parseBiberLog` | `{file, firstID}` | `.blg`-Datei mit `BiberLogParser.parse(_, firstID:)` auswerten. |

`expect` (alle Schlüssel optional): `summary` (vollständige Liste von Zeichenketten `"<severity> <Dateiname oder -><:Zeile oder -> <message>"`; `severity` ist `error`, `warning` oder `badBox`, Dateiname ohne Ordner), `isEmpty` (keine Meldungen), `files` (`{Index: Pfad relativ zu baseDirectory}` der Meldung, Index 0-basiert in der Meldungsliste), `details` (`{Index: detail}`), `fileList`/`lineList` (Datei bzw. Zeile jeder Meldung in Reihenfolge, Pfad relativ zu `baseDirectory`), `firstLine` (Zeile der ersten Meldung), `lastFile`/`lastLine` (der letzten Meldung), `contains` (Liste `{messageContains, line}`; zu jedem Eintrag gibt es mindestens eine Meldung mit diesem Teilstring und dieser Zeile). Bei `parseBiberLog`: `messages` (vollständig), `firstSeverity`, `firstId`. Zeilennummern der Meldungen sind **1-basiert** (wie in Swift). Das Ergebnis `fileURL` kann `null` sein.

### `misc.json`

Pfade sind relativ zur Projektwurzel (`""` = Wurzel), Dateiinhalte stehen als Text im Vektor. Fehlende Erwartungsschlüssel werden nicht geprüft.

| `op` | `input` | `expect` | Bedeutung |
|---|---|---|---|
| `tabsScript` | `{tabs: [Name], active?, preview?, steps: [..]}` | `{steps: [..]}` | `EditorTabs`. Aufbau: jeder Name wird nacheinander als dauerhafter Tab geöffnet, dann `preview` als Vorschau-Tab, dann `active` aktiviert. Schritte `{do, name?, onto?, asPreview?}` mit `do` = `open`, `promote`, `activate`, `close`, `closeAllExcept`, `closeAll`, `activateNext`, `activatePrevious`, `move` (`name` auf Platz von `onto`). `expect.steps` hat je Eingabeschritt einen Eintrag (`{}` = nichts prüfen) mit `names` (Tabreihenfolge), `active`, `preview`, `replaced` (Ergebnis von `open`: ersetzter Vorschau-Tab oder `null`), `returned` (Ergebnis von `close`: neu aktiver Tab oder `null`), `isEmpty`, `unchanged` (Zustand gleich dem vor dem Schritt). Namen ohne Pfad und Endung. |
| `quickOpenRank` | `{files: [{path, isOpen?}], query, limit?}` | `paths` (vollständige Liste), `first`, `contains`, `count` | `QuickOpenMatcher.rank`. |
| `outline` | `{main, files: {Pfad: Text}}` | `titles`, `levels` (`chapter`, `section`, `subsection`), `lines` (1-basiert), `files`, `includingFileIsEmpty` | `OutlineParser.outline`, folgt `\include`/`\input` in den gegebenen Dateien. |
| `outlineRefresh` | `{main, files, rewrite: {Pfad: Text}}` | `titlesBefore`, `titlesAfter` | Gliederung mit demselben Parser (Cache) zweimal bilden, dazwischen Dateien ersetzen. |
| `includeChain` | `{main, files, target}` | `chain: [Pfad]` | `OutlineStore.includeChain` aus der Gliederung der Dateien. |
| `updateReferences` | `{moving, to, mainFile, graphicsDirectories, texts: {Pfad: Text}}` | `texts: {Pfad: neuer Text}` | `ReferenceUpdater.edits` + `apply` je Datei. |
| `referenceEdits` | wie `updateReferences` | `lines` (1-basiert), `oldTexts`, `applied` (neuer Text der einzigen Datei) | Die einzelnen Änderungen in Reihenfolge. |
| `relativePath` | `{path, from}` | `{result}` | `ReferenceUpdater.relativePath(of:from:)`. |
| `masking` | `{text}` | `{sameUtf16Length}` | wie in `latex-source.json`. |
| `fileNameValidate` | `{name}` | `{result}` oder `{error}` | `FileOperations.validateName`. `error` ist der Fallname von `FileOperationError` (`emptyName`, `invalidCharacters`, `hiddenName`, `nameTooLong`). |
| `fileNameNew`, `fileNameRenamed` | `{name}` bzw. `{name, original, originalIsDirectory}` | `{result}` | `newFileName(from:)`, `renamedFileName(from:original:)`. |
| `jumpTarget` | `{marked}` oder `{text, location}` | `target`, `rangeText` | `JumpTargetFinder.target(at:in:)`. `marked`: `\|` ist die Klickstelle (gehört nicht zum Text). `target`: `null` oder Objekt mit einem Schlüssel `label`, `citation`, `acronym`, `file` und dem Wert. `rangeText`: Text des Zielbereichs. |
| `linkPreviewViewport` | `{mainViewSize: {width, height}}` | `{width, height}` | `LinkPreviewLayout.viewportSize`. Werte: Zahl, `{constant: "widthRange.lowerBound"}` (Konstante aus `LinkPreviewLayout`) oder `{mainWidthMinusConstant: "widthMargin"}` (Breite der Eingabe minus Konstante); Höhe sonst halbe Eingabehöhe. |
| `linkPreviewScale` | `{mainScale}` | `{scale}` | `LinkPreviewLayout.scale(forMainScale:)`, Werte wie oben. |
| `pdfHistory` | `{steps: [..]}` | `{steps: [..]}` | `PDFJumpHistory`. Zustand `{pageIndex, x, y, scale, autoScales}`. Schritte: `push {state}`, `back {from}`, `forward {from}`, `clamp {pageCount}`, `clear`, `inspect`, `pushRange {first, last}` (je Seite ein Zustand mit x 10, y 20, scale 1, autoScales true). Erwartung je Schritt: `returned` (Zustand oder `null`), `canGoBack`, `canGoForward`, `backPageIndex`, `backStack`, `forwardStack` (Zustandslisten), `backStackCount`, `backStackFirstPageIndex`, `maximumDepth`. |
| `fileTypeSections` | `{files, emptyFolders, hidden}` | `sectionTitles`, `sectionEntries: {Abschnittstitel: [{fileExtension, count?, title?}]}` | `FileTypeCatalog.sections` auf dem aus den Dateipfaden geladenen Baum. Je Eintrag zählen nur die genannten Felder; die Listenlänge ist exakt. |
| `hideFileTypes` | `{files, emptyFolders, hidden, keeping?}` | `names`, `namesIn: {Ordner: [..]}`, `namesEqualUnfiltered` | `FileNode.hidingFileTypes`. `names`: Kinder der Wurzel, Ordner mit `/` am Ende. `namesEqualUnfiltered`: `names` gleich dem Baum ohne Filter. |
| `renameOccurrences` | `{kind, name, text, isBibliography?, newName?}` | `count`, `texts` (Teilstrings der Fundstellen), `result` (voller Text nach `Renamer.apply`), `resultContains` (Liste von Teilstrings, alle müssen vorkommen) | `Renamer.occurrences`. `kind`: `label`, `citation`, `acronym`, `command`, `environment`. |
| `definedNames` | `{kind: "acronym" \| "environment", text}` | `{names}` | `Acronyms.definedKeys`, `EnvironmentNames.definedNames`. |
| `commandNameAt` | `{text, location}` | `{name}` (`null` = keiner) | `CommandNames.name(at:in:)`. |
| `environmentPair` | `{text, at}` | `endText`, `endLocation`, `beginLocation`, `pair: null` | `EnvironmentNames.pair(at:in:)`. Ortsangabe `{find, occurrence: "first" \| "last", offset}` = UTF-16-Position des ersten bzw. letzten Vorkommens von `find` plus `offset` (ASCII-Texte); `find: ""` = Textanfang, also absolute Position `offset`. `endText` Text des `end`-Bereichs, `endLocation`/`beginLocation` dessen Position. `pair: null` = kein Paar. |
| `renameDetect` | `{text, marker, offset, isBibliography?}` | `{candidates: [..]}` | `Renamer.candidates` an der Position des ersten `marker` plus `offset`. Eintrag: `{project: {kind, name}}` oder `{pair: {name}}` (weitere Felder des Paars werden nicht geprüft). |
| `renameValidate` | `{newName, kind, old, existing: [..]}` | `error: null` / `error: "<Text>"` / `errorPresent: true` | `Renamer.validate`. `errorPresent`: irgendeine Fehlermeldung, Text nicht geprüft. |
| `renameNormalize` | `{newName, kind}` | `{result}` | `Renamer.normalized`. |

## Teil-Prüfungen (Schlüssel in `expect`)

Alle Schlüssel sind optional und unabhängig; mehrere in einem Fall müssen alle gelten. Listenelemente sind Token-Objekte `{kind, text}`, sofern nicht anders genannt.

| Schlüssel | Vorkommen | Semantik |
|---|---|---|
| `tokens` | tokenize*, bib `highlightAll` | Die Token-Liste ist gleich (Länge, Reihenfolge, Art und Text). |
| `lastToken` | `steps[]` | Das letzte Token der Zeile ist gleich diesem Objekt; frühere Tokens werden nicht geprüft. |
| `tokensPrefix` | bib | Die ersten *n* Tokens (*n* = Länge der Liste) sind gleich der Liste (`prefix(n) == Liste`). |
| `tokensSuffix` | bib | Die letzten *n* Tokens sind gleich der Liste (`suffix(n) == Liste`). |
| `tokensContain` | bib | Jedes Element der Liste kommt irgendwo unter den Tokens vor (Position egal). |
| `tokensNoneContainText` | bib | Liste von Zeichenketten; kein Token hat einen Text, der eine davon enthält (Teilstring). |
| `tokensByRange` | `tokenizeLineWithOffset` | Gesamte Token-Liste als `{kind, location, length}` mit absoluten UTF-16-Positionen. |
| `state` | tokenize*, `steps[]` | Endzustand der Zeile ist gleich. |
| `endStates` | `highlightAll` | latex-tokenizer: Liste, ein Zustand je Zeile, vollständig. bib-tokenizer: Objekt `{Zeilenindex: Zustand}`, nur genannte Zeilen, Zustand vollständig gleich. |
| `endStatesPartial` | bib | Objekt `{Zeilenindex: Teilzustand}`; für die genannte Zeile müssen nur die angegebenen Felder (hier `phase`, `depth` innerhalb von `bibtex`) gleich sein, andere Felder werden nicht geprüft. |
| `tokenizedLineCount` | `highlightEdit` | Anzahl der beim inkrementellen Einfärben neu tokenisierten Zeilen (`HighlightUpdate.tokenizedLineCount`). |
| `allTokenKinds` | `highlightEdit` | Alle bei der Bearbeitung neu erzeugten Tokens (`HighlightUpdate.tokens`) haben diese Art. |
| `endStatesAfterEdit` | `highlightEdit` | Objekt `{Zeilenindex: Zustand}` der Endzustände des Highlighters **nach** der Bearbeitung, nur genannte Zeilen. |
| `sameUtf16Length`, `contains`, `notContains`, `hasSuffix` | latex-source `masking` | Ergebnis hat dieselbe UTF-16-Länge wie die Eingabe; enthält jede Zeichenkette aus `contains`; enthält keine aus `notContains`; endet auf `hasSuffix`. |
| `count`, `allSeverity`, `firstLocation`, `foundTexts`, `firstMessageContains` | syntax-checker | siehe dort |

Bedeutung unklar bzw. aus dem Test abgeleitet: `allTokenKinds` und `tokenizedLineCount` sind aus `SyntaxHighlighterTests.openDollarStopsAtParagraph` abgelesen; bei weiteren Fällen dort ggf. den Swift-Test prüfen.

## Offsets und Nicht-ASCII

- **Verbraucher rechnen immer in UTF-16-Einheiten.** TypeScript-Strings sind das bereits (`length`, `charCodeAt`, `slice`), im Renderer wie im Main-Prozess. Nie Byte-Offsets (aus `Buffer`/`Uint8Array`), Codepoint- oder Graphem-Offsets verwenden.
- In Swift verwenden manche Funktionen **Character-Offsets** statt UTF-16 (bekannt: `LatexComments.commentStart` in `latex-source.json`). Ein Vektor darf nur dann Offsets prüfen, wenn Swift sie in UTF-16 liefert oder der Text rein ASCII ist (dann sind beide gleich).
- Enthält ein Vektor Text mit Nicht-ASCII (Umlaute, Emoji, `«»`), muss das in `notes` der Datei stehen, mit Fall-ID und dem Hinweis, ob Offsets geprüft werden. Aktuell: `misc.json` (siehe dessen `notes`, ohne UTF-16-Offsets außer ASCII-Positionen), `latex-tokenizer.json` (`absoluteUTF16Offsets` mit Umlaut und Emoji, prüft UTF-16-`location`), `latex-source.json` (`masking`, nur Länge/Teilstrings), `bib-tokenizer.json` (`percentComments`, `multilineValue`, ohne Offsets), `text-editing.json` (Markierungen `«»`, ohne Offsets).

## Vektordateien

Stand 2026-11-22. „Fälle“ = Einträge in `cases`, „übersprungen“ = Einträge in `skipped`. Die Swift-Gegenprobe `SpecVectorTests.swift` existiert noch nicht; bis dahin gilt jeder Vektor als noch nicht gegen Swift bestanden.

| Datei | Quelle | Fälle | übersprungen | Status |
|---|---|---|---|---|
| `latex-tokenizer.json` | `LatexTokenizerTests.swift`, `SyntaxHighlighterTests.swift` | 35 | 4 | Schema und IDs geprüft, Swift-Gegenprobe offen |
| `bib-tokenizer.json` | `BibTokenizerTests.swift` | 9 | 2 | Schema und IDs geprüft, Swift-Gegenprobe offen |
| `latex-source.json` | `RobustnessTests.swift` (Suite `LatexSourceTests`), `WritingHintsTests.swift` (`insideCode`) | 13 | 2 | Schema und IDs geprüft, Swift-Gegenprobe offen |
| `fold-regions.json` | `FoldingTests.swift` | 14 | 28 | Schema und IDs geprüft, Swift-Gegenprobe offen |
| `syntax-checker.json` | `SyntaxCheckerTests.swift` | 13 | 4 | Schema und IDs geprüft, Swift-Gegenprobe offen |
| `text-editing.json` | `TextEditingTests.swift` (Fälle), `TypingTests.swift` (nur übersprungen) | 50 | 8 | Schema und IDs geprüft, Swift-Gegenprobe offen |
| `latex-log.json` | `LatexLogParserTests.swift` | 12 | 0 | Schema und IDs geprüft, Swift-Gegenprobe offen |
| `misc.json` | `EditorTabsTests`, `QuickOpenTests`, `OutlineParserTests`, `ReferenceUpdaterTests`, `FileOperationsTests`, `JumpTargetTests`, `LinkPreviewTests`, `PDFJumpHistoryTests`, `FileTypeFilterTests`, `RenamingTests` (alle `.swift`) | 148 | 20 | Schema und IDs geprüft, Swift-Gegenprobe offen |
| `example.json` | `LatexTokenizerTests.swift` | 3 | 0 | nur Beispiel für das Format (ohne `op`) |

## Namen der Vektordateien

`<bereich>.json` in `shared/spec/`, die Liste steht in `QUELLEN.md` und `../PLAN-WEBUI.md` §3 (z. B. `latex-tokenizer.json`, `insertion.json`, `latex-log.json`). Fixtures liegen in `fixtures/` und werden aus den Vektoren relativ zu `shared/spec/` referenziert (`"file": "fixtures/errors.log"`).

## Regeln für Umwandler

Je Vektordatei ein Durchgang (Subagent `general-purpose`, `sonnet`, `medium`):

1. Genau eine Swift-Testdatei lesen (ganz, nicht nur nach Schlagwörtern); bei mehreren Dateien in `source` je Datei `cases[].source` setzen.
2. Nur `#expect`-Vergleiche mit Literalen übernehmen. Zufalls-, Pixel- und Fenstertests auslassen und in `skipped` mit Grund nennen.
3. Erwartete Werte nie selbst ausrechnen, nur aus dem Test abschreiben.
4. Den `@Test`-Namen als `name` übernehmen, `source` und `sourceLine` setzen, `id` eindeutig vergeben.
5. Neue `op`-Werte und neue `expect`-Schlüssel in diesem README (Abschnitte „Operationen“ und „Teil-Prüfungen“) ergänzen, neue Zustände unter „Zustände“; Vektoren mit Nicht-ASCII-Text in `notes` vermerken.
6. Datei gegen `schema.json` prüfen und Eindeutigkeit der `id` prüfen (siehe unten).

## Verbraucher

- Vitest (TypeScript, Node-Umgebung): JSON aus `shared/spec/<suite>.json` per `JSON.parse(readFileSync(…))` laden, je Fall ein `it(case.name)`, über `input.op` verzweigen, Pfade relativ zum Repo-Wurzelordner. Das gilt für die reine Logik (`src/shared/core/`) und für die Main-Module (SyncTeX, Log-Parser, Git-Status); `source` als Zeichenkette oder Array behandeln, Fixtures aus `fixtures/`.
- Swift-Gegenprobe: `swift/Tests/LatexEditorTests/SpecVectorTests.swift` lädt dieselben Dateien und prüft die Swift-Implementierung (nur die Hauptsitzung führt sie aus, siehe PLAN §3).

## Prüfen

Alle Vektoren und das Beispiel gegen das Schema, ohne Netzwerk (Python mit `jsonschema`, im Ordner `shared/spec/`):

```
python3 -c "import json,glob,jsonschema; s=json.load(open('schema.json')); jsonschema.Draft7Validator.check_schema(s); [print(f,'ok') for f in sorted(glob.glob('*.json')) if f!='schema.json' for d in [json.load(open(f))] if (jsonschema.validate(d,s) is None) and len({c['id'] for c in d['cases']})==len(d['cases'])]"
```

Alternative: `npx ajv validate -s schema.json -d <datei>` (lädt ggf. Paket aus dem Netz). Die Eindeutigkeit der `id` kann das Schema nicht ausdrücken; die Zeile oben prüft sie mit (eine Datei mit doppelter `id` wird nicht ausgegeben).

## Fixtures

`fixtures/` enthält unveränderte Kopien aus `swift/Tests/LatexEditorTests/Fixtures/` (`*.log`, `biber.blg`, `two-chapters.synctex.gz`). Nur kopieren, nie hier ändern: Änderungen gehören in die Swift-Fixtures, danach neu kopieren.

Prüfung auf persönliche Pfade (Stand 2026-11-22): kein `/Users/maxieder` oder Benutzername in den Fixtures. `two-chapters.synctex.gz` enthält Pfade unter `/private/tmp/LatexEditor SyncTeX Fixture/` und `/usr/local/texlive/2026/…`; das sind keine persönlichen Pfade und bleiben unverändert (die SyncTeX-Tests brauchen sie).
