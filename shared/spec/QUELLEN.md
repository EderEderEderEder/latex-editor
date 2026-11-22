# Swift-Tests als Quelle für Testvektoren (Ergebnis W0-1)

Stand 2026-11-22, Pfad der Tests: `swift/Tests/LatexEditorTests/`. Die Einstufung beruht auf Dateinamen, Imports und Schlagwort-Suche, nicht auf vollständigem Lesen; wer eine Datei in einen Vektor umwandelt, prüft sie ganz. Im Plan (`../PLAN-WEBUI.md` §3) genannt, aber nicht vorhanden: `LatexSourceTests`, `CapitalizationTests`, `DiffLayoutTests` (Inhalte evtl. in `LatexTokenizerTests`, `WritingHintsTests`, `LineDiffTests`).

## (A) Gut geeignet (reine Logik, Vergleiche gegen Literale)

| Datei | @Test | Bereich | Schw. | Vektordatei |
|---|---|---|---|---|
| LatexTokenizerTests | 18 | Tokenizer | leicht | latex-tokenizer |
| InsertionTests | 26 | Insertion | mittel | insertion |
| InsertionContextTests | 7 | Insertion-Kontext | leicht | insertion |
| TextEditingTests | 13 | Texteditier-Aktionen | mittel | text-editing |
| LatexReferencesTests | 8 | Referenzen | leicht | references |
| WritingHintsTests | 13 | Schreibhinweise | leicht | writing |
| WordCounterTests | 9 | Wortzahl | leicht | writing |
| MarkAnchorTests | 8 | Mark-Anker | mittel | mark-anchor |
| MarkAnchorSimilarLineTests | 1 | Anker | mittel | mark-anchor (`.random` prüfen) |
| MarkListGroupingTests | 1 | Mark-Gruppierung | leicht | mark-anchor |
| LatexLogParserTests | 10 | Log-Parser | mittel (Fixtures) | latex-log |
| OutlineParserTests | 8 | Gliederung | leicht | misc |
| ReferenceUpdaterTests | 11 | Referenz-Umbenennung | leicht | misc |
| EditorTabsTests | 13 | Tabs | leicht | misc |
| JumpTargetTests | 5 | Sprungziele | leicht | misc |
| PDFJumpHistoryTests | 10 | Sprungverlauf | leicht | misc |
| FileTypeFilterTests | 6 | Dateitypen | leicht | misc (FileManager prüfen) |
| GitStatusTests | 10 | Git-Status-Parser | mittel | git-status |
| LineDiffTests | 11 | Diff | mittel | line-diff (`.random` auslassen) |
| SyntaxCheckerTests | 13 | Syntaxprüfung | leicht | syntax-checker |
| RenamingTests | 9 | Namensprüfung | leicht | misc |
| UsageFinderTests | 6 | Verwendungssuche | leicht | **fehlt im Plan** (neu: usages) |
| TextPositionsTests | 4 | Offsets | leicht | **fehlt** (neu: positions) |
| AcronymTests | 6 | Akronyme | leicht | **fehlt** (writing oder acronyms) |
| ProjectLoadingTests | 8 | Projekt laden | mittel | **fehlt** |

## (B) Teilweise geeignet (nur der genannte Teil)

| Datei | @Test | Übernehmbar | Schw. | Vektordatei |
|---|---|---|---|---|
| BibTokenizerTests | 9 | Literal-Tests, ohne `.random`/AppKit | mittel | bib-tokenizer |
| BibliographyTests | 14 | Parser/Autoren/Formatter; ohne NSWindow/FileManager | mittel | bibliography |
| CompletionTests | 20 | Kontext/Rang/Applier; ohne Fenster/sleep | mittel | completion |
| CompletionOptionTests | 7 | Scanner/Optionen; ohne AppKit | mittel | completion |
| FoldingTests | 38 | Regionenlogik; ohne NSWindow | mittel | fold-regions |
| SyntaxHighlighterTests | 6 | deterministisch; ohne random | leicht | latex-tokenizer |
| ReferenceCheckTests | 11 | Logik; ohne AppKit/sleep | mittel | references |
| MarkAnchorRewrapTests | 14 | Logik; PDFKit prüfen | mittel | mark-anchor |
| MarkAnchorRefreshTests | 7 | Logik; ohne Dateien/Date | schwer | mark-anchor |
| MarkResolverTests | 12 | Logik; ohne PDFKit/Date | schwer | **fehlt** (marks) |
| MarkStorageTests | 8 | Serialisierung; ohne Dateien/Date | mittel | **fehlt** (marks) |
| SyncTeXTests | 17 | Referenzwerte/Pfade/Koordinaten; ohne Process | schwer | synctex |
| LinkPreviewTests | 11 | Layout; ohne NSWindow/PDFKit | mittel | misc |
| QuickOpenTests | 6 | Ranking/Filter | leicht | misc |
| FileOperationsTests | 10 | Namensteil; ohne FileManager | leicht | misc |
| ChangeMarksTests | 9 | Logik; FileManager prüfen | mittel | **fehlt** (marks) |
| SidebarModelTests | 9 | Zustandsfolgen ohne UI | mittel | **fehlt** |
| SearchActionsTests | 6 | Treffer/Ersetzen | mittel | **fehlt** |
| ProjectSearchTests | 11 | Matching; ohne sleep/Dateien | mittel | **fehlt** |
| LineIndexTests | 8 | Literal; ohne `.random` | leicht | **fehlt** (positions) |
| TechnicalVocabularyTests | 8 | Wortlisten | leicht | **fehlt** (writing) |
| TypingTests | 8 | Textlogik; ohne AppKit/sleep | mittel | **fehlt** (text-editing) |
| EditorTabStoreTests | 10 | Zustandslogik; ohne FileManager | mittel | **fehlt** (misc) |
| EditorSettingsTests | 12 | Defaults/Codierung; ohne NSWindow | mittel | **fehlt** |
| FileActionsTests | 13 | nur Namens-/Pfadlogik | schwer | **fehlt** |
| GitStoreTests | 12 | Parser/Zustand; ohne Dateien/Date/sleep | schwer | **fehlt** |
| GitRemoteTests | 7 | URL-/Ausgabe-Parser | mittel | **fehlt** (git-status) |
| SectionBarTests | 5 | Logik; ohne AppKit | mittel | **fehlt** |
| StatusBarTests | 7 | Textformatierung | leicht | **fehlt** |
| InsertionIntegrationTests | 1 | Literal-Teil | mittel | **fehlt** (insertion) |
| BuildTests | 10 | Argument-/Log-Logik; ohne Prozess | schwer | **fehlt** |
| AllFileTypesTests | 5 | Typ-Erkennung | mittel | **fehlt** (misc) |
| PDFLinkTests | 6 | nur Literal-Logik, PDFKit-abhängig | schwer | **fehlt** |
| DemoProjectTests | 4 | Strukturchecks, dateisystemnah | mittel | **fehlt** |

## (C) Nicht geeignet

Zeitbudget, Zufall, Fenster, Pixel, Prozesse: PerformanceTests, RobustnessTests, StabilizationTests, WindowLayoutTests, ViewModeStateTests, SessionSwitchTests, SidebarPeekTests, InterfaceZoomTests, DesignFixTests, EditorIntegrationTests, ImagePreviewTests, PDFLinkInteractionTests, NavigationActionsTests, MarkActionsTests, BuildCancelTests, FileUndoTests, GitActionsTests, GitPhase2Tests, GitResetTests, RecoveryAndFontTests.

## Zusätzliche Vektordateien neben denen aus dem Plan

`positions.json` (TextPositions, LineIndex), `usages.json` (UsageFinder), `marks.json` (MarkResolver-Logik, MarkStorage, ChangeMarks), `project.json` (ProjectLoading, ProjectSearch, SearchActions) — jeweils nach dem Zuschnitt der Aufgabe W0-11/12 oder später in M4/M5.
