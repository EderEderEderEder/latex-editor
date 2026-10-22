import AppKit
import Testing
@testable import LatexEditor

private func regions(_ text: String) -> [FoldRegion] {
    FoldScanner.regions(in: text)
}

private func summary(_ regions: [FoldRegion]) -> [String] {
    regions.map { region in
        let kind: String = switch region.kind {
        case .section: "Abschnitt"
        case let .environment(name): name
        case .comments: "Kommentar"
        }
        return "\(kind) \(region.startLine)-\(region.endLine)"
    }
}

@Suite("Zuklappbare Bereiche erkennen")
struct FoldScannerTests {
    @Test("Kapitel, Abschnitte und Umgebungen verschachtelt; Leerzeilen am Ende gehören nicht dazu")
    func nestedSections() {
        let text = """
        \\chapter{Eins}
        Text a
        \\section{A}
        Text b
        \\begin{itemize}
        \\item x
        \\end{itemize}

        \\section{B}
        Text c
        \\chapter{Zwei}
        Text d
        """
        #expect(summary(regions(text)) == [
            "Abschnitt 0-9", "Abschnitt 2-6", "itemize 4-6", "Abschnitt 8-9", "Abschnitt 10-11",
        ])
    }

    @Test("Ein Abschnitt endet vor \\end{document}, \\appendix und \\backmatter")
    func barriers() {
        let document = "\\begin{document}\n\\section{A}\ntext\n\\end{document}\n"
        #expect(summary(regions(document)) == ["document 0-3", "Abschnitt 1-2"])
        let appendix = "\\chapter{A}\nx\n\\appendix\n\\chapter{B}\ny\n"
        #expect(summary(regions(appendix)) == ["Abschnitt 0-1", "Abschnitt 3-4"])
    }

    @Test("Einzeilige und nie geschlossene Umgebungen sind nicht zuklappbar")
    func degenerateEnvironments() {
        #expect(regions("\\begin{a}x\\end{a}\n").isEmpty)
        #expect(regions("\\begin{a}\nx\n").isEmpty)
        #expect(regions("x\n\\end{a}\n").isEmpty)
    }

    @Test("Ungleich verschachtelte Umgebungen: \\end schließt die passende, auch über eine offene hinweg")
    func mismatchedEnvironments() {
        let text = "\\begin{a}\n\\begin{b}\nx\n\\end{a}\n"
        #expect(summary(regions(text)) == ["a 0-3"])
    }

    @Test("Auskommentierte Befehle zählen nicht, ein Abschnitt reicht aber über Kommentarzeilen")
    func commentedCommands() {
        let text = "% \\section{X}\n\\section{Y}\na\n% \\begin{foo}\nb\n"
        #expect(summary(regions(text)) == ["Abschnitt 1-4"])
    }

    @Test("Code-Umgebung ist selbst zuklappbar, ihr Inhalt zählt nicht (weder Überschriften noch Kommentare)")
    func codeEnvironment() {
        let text = "\\begin{lstlisting}\n\\section{X}\n% foo\n% bar\n\\end{lstlisting}\n"
        #expect(summary(regions(text)) == ["lstlisting 0-4"])
        let hgb = "\\begin{PythonCode}\n\\section{X}\n\\begin{y}\n\\end{PythonCode}\n"
        #expect(summary(regions(hgb)) == ["PythonCode 0-3"])
    }

    @Test("Kommentarblöcke ab zwei Zeilen am Stück")
    func commentBlocks() {
        let text = "% a\n  % b\ntext\n% allein\ntext\n%c\n%d\n%e\n"
        #expect(summary(regions(text)) == ["Kommentar 0-1", "Kommentar 5-7"])
    }

    @Test("Eine Kopfzeile bekommt nur ihren größten Bereich")
    func oneRegionPerHeader() {
        let text = "\\begin{a}\\begin{b}\nx\n\\end{b}\ny\n\\end{a}\n"
        #expect(summary(regions(text)) == ["a 0-4"])
    }

    @Test("Ausgeblendet wird vom Ende der Kopfzeile bis vor den Zeilenumbruch der letzten Zeile")
    func hiddenRange() {
        let text = "ab\ncd\nef\ngh\n" as NSString
        let lines = LineIndex(text: text)
        let region = FoldRegion(kind: .section, startLine: 0, endLine: 2)
        #expect(region.hiddenRange(in: lines) == NSRange(location: 2, length: 6))
        #expect(text.substring(with: region.hiddenRange(in: lines)) == "\ncd\nef")
    }

    @Test("Auch Dateien mit \\r\\n-Zeilenenden")
    func windowsLineEndings() {
        let text = "\\section{A}\r\nx\r\n\\section{B}\r\ny\r\n"
        #expect(summary(regions(text)) == ["Abschnitt 0-1", "Abschnitt 2-3"])
    }
}

@MainActor
@Suite("Zugeklappte Stellen verwalten")
struct FoldStateTests {
    private static let text = "\\section{A}\nx\ny\n\\section{B}\nz\n"

    private func state(_ text: String = FoldStateTests.text) -> (FoldState, LineIndex) {
        let folds = FoldState()
        let lines = LineIndex(text: text as NSString)
        folds.lines = { lines }
        folds.adopt(FoldScanner.regions(in: text), lines: lines)
        return (folds, lines)
    }

    @Test("Zuklappen blendet vom Ende der Kopfzeile bis vor den letzten Zeilenumbruch aus")
    func foldAndUnfold() {
        let (folds, lines) = state()
        var changes: [NSRange] = []
        folds.onHiddenChange = { changes.append($0) }
        let region = folds.region(startingAtLine: 0)!
        folds.toggle(region, lines: lines)
        #expect(folds.hiddenRanges == [NSRange(location: 11, length: 4)])
        #expect(folds.isFolded(region, lines: lines))
        folds.toggle(region, lines: lines)
        #expect(folds.hiddenRanges.isEmpty)
        #expect(changes == [NSRange(location: 11, length: 4), NSRange(location: 11, length: 4)])
    }

    @Test("Verschachtelte Bereiche ergeben ein Ausgeblendetes; Aufklappen des äußeren lässt den inneren zu")
    func nested() {
        let text = "\\section{A}\n\\begin{x}\nb\n\\end{x}\nc\n"
        let (folds, lines) = state(text)
        let outer = folds.region(startingAtLine: 0)!
        let inner = folds.region(startingAtLine: 1)!
        folds.fold(inner, lines: lines)
        folds.fold(outer, lines: lines)
        #expect(folds.hiddenRanges.count == 1)
        folds.unfold(outer, lines: lines)
        #expect(folds.hiddenRanges == [inner.hiddenRange(in: lines)])
    }

    @Test("Alles zuklappen lässt \\begin{document} offen; Alles aufklappen räumt auf")
    func foldAll() {
        let text = "\\begin{document}\n\\section{A}\nx\n\\section{B}\ny\n\\end{document}\n"
        let (folds, lines) = state(text)
        folds.foldAll(lines: lines)
        #expect(folds.folded.count == 2)
        #expect(folds.region(startingAtLine: 0).map { folds.isFolded($0, lines: lines) } == false)
        folds.unfoldAll()
        #expect(!folds.hasFolds)
    }

    @Test("Der innerste offene Bereich unter dem Cursor; ein zugeklappter wird übersprungen")
    func innermost() {
        let text = "\\section{A}\n\\begin{x}\nb\n\\end{x}\nc\n"
        let (folds, lines) = state(text)
        #expect(folds.innermostOpenRegion(containingLine: 2, lines: lines)?.startLine == 1)
        folds.fold(folds.region(startingAtLine: 1)!, lines: lines)
        #expect(folds.innermostOpenRegion(containingLine: 1, lines: lines)?.startLine == 0)
    }

    // MARK: Bearbeitungen

    private func edit(_ folds: FoldState, text: String, in range: NSRange, with replacement: String) -> LineIndex {
        let old = NSMutableString(string: text)
        var lines = LineIndex(text: old)
        old.replaceCharacters(in: range, with: replacement)
        let edited = NSRange(location: range.location, length: (replacement as NSString).length)
        let delta = edited.length - range.length
        let splice = lines.applyEdit(in: old, editedRange: edited, changeInLength: delta)
        folds.lines = { lines }
        folds.applyEdit(editedRange: edited, delta: delta, splice: splice, textLength: old.length)
        return lines
    }

    @Test("Eine Änderung davor verschiebt die zugeklappte Stelle, eine dahinter lässt sie")
    func editsOutsideKeepFold() {
        let (folds, lines) = state()
        folds.fold(folds.region(startingAtLine: 0)!, lines: lines)
        let before = folds.hiddenRanges
        _ = edit(folds, text: Self.text, in: NSRange(location: 11, length: 0), with: "!!")
        #expect(folds.hiddenRanges == [NSRange(location: before[0].location + 2, length: before[0].length)])
        let (other, otherLines) = state()
        other.fold(other.region(startingAtLine: 0)!, lines: otherLines)
        _ = edit(other, text: Self.text, in: NSRange(location: 20, length: 0), with: "!!")
        #expect(other.hiddenRanges == before)
    }

    @Test("Eine Änderung im Ausgeblendeten klappt auf und meldet den betroffenen Bereich")
    func editInsideUnfolds() {
        let (folds, lines) = state()
        folds.fold(folds.region(startingAtLine: 0)!, lines: lines)
        var changed: NSRange?
        folds.onHiddenChange = { changed = $0 }
        _ = edit(folds, text: Self.text, in: NSRange(location: 12, length: 1), with: "q")
        #expect(!folds.hasFolds)
        #expect(changed.map { NSIntersectionRange($0, NSRange(location: 11, length: 4)).length > 0 } == true)
    }

    @Test("Neue Zeilen verschieben die Bereiche, bis die nächste Prüfung sie bestätigt")
    func regionsFollowLineChanges() {
        let (folds, lines) = state()
        _ = edit(folds, text: Self.text, in: NSRange(location: 0, length: 0), with: "neu\n")
        #expect(folds.regions.map(\.startLine) == [1, 4])
        _ = lines
    }

    @Test("Eine neue Zeile hinter der Kopfzeile lässt die Kopfzeile stehen")
    func newLineAfterHeader() {
        let (folds, _) = state()
        _ = edit(folds, text: Self.text, in: NSRange(location: 11, length: 0), with: "\n")
        #expect(folds.regions.map(\.startLine) == [0, 4])
    }

    @Test("Nach einer Prüfung klappt auf, wozu es keinen Bereich mehr gibt")
    func adoptDropsStaleFolds() {
        let (folds, lines) = state()
        folds.fold(folds.region(startingAtLine: 0)!, lines: lines)
        let changedLines = LineIndex(text: "\\section{A}\nx\ny\nz\n\\section{B}\n" as NSString)
        folds.adopt(FoldScanner.regions(in: "\\section{A}\nx\ny\nz\n\\section{B}\n"), lines: changedLines)
        #expect(!folds.hasFolds)
    }

    // MARK: Cursor

    @Test("Cursor am Ende des Ausgeblendeten rückt an das Ende der Kopfzeile")
    func caretAtEndMovesToHeader() {
        let (folds, lines) = state()
        folds.fold(folds.region(startingAtLine: 0)!, lines: lines)
        let hidden = folds.hiddenRanges[0]
        let adjusted = folds.adjustedSelection(NSRange(location: NSMaxRange(hidden), length: 0), previousLocation: 30, textLength: 30)
        #expect(adjusted == NSRange(location: hidden.location, length: 0))
        #expect(folds.hasFolds)
    }

    @Test("Ein Schritt nach rechts vom Ende der Kopfzeile springt hinter den Bereich")
    func stepRightSkipsFold() {
        let (folds, lines) = state()
        folds.fold(folds.region(startingAtLine: 0)!, lines: lines)
        let hidden = folds.hiddenRanges[0]
        let adjusted = folds.adjustedSelection(NSRange(location: hidden.location + 1, length: 0), previousLocation: hidden.location, textLength: 30)
        #expect(adjusted == NSRange(location: NSMaxRange(hidden) + 1, length: 0))
        #expect(folds.hasFolds)
    }

    @Test("Mitten ins Ausgeblendete (Suche, Gehe zu Zeile) klappt auf")
    func jumpInsideUnfolds() {
        let (folds, lines) = state()
        folds.fold(folds.region(startingAtLine: 0)!, lines: lines)
        let hidden = folds.hiddenRanges[0]
        #expect(folds.adjustedSelection(NSRange(location: hidden.location + 2, length: 0), previousLocation: 0, textLength: 30) == nil)
        #expect(!folds.hasFolds)
    }

    @Test("Eine Auswahl über den ganzen Bereich lässt ihn zu, ein Rand mittendrin klappt auf")
    func selectionHandling() {
        let (folds, lines) = state()
        folds.fold(folds.region(startingAtLine: 0)!, lines: lines)
        _ = folds.adjustedSelection(NSRange(location: 0, length: 30), previousLocation: 0, textLength: 30)
        #expect(folds.hasFolds)
        _ = folds.adjustedSelection(NSRange(location: 12, length: 5), previousLocation: 0, textLength: 30)
        #expect(!folds.hasFolds)
    }
}

/// Echter Editor mit Layout: Zeilenhöhen, Zeilennummern, Platzhalter
@MainActor
@Suite("Zuklappen im Editor", .serialized)
struct FoldLayoutTests {
    private static let text = "\\chapter{Eins}\nerste\nzweite\n\\chapter{Zwei}\nletzte\n"

    /// Fenster, damit `visibleRect` der Text-View nicht leer ist
    private let window = NSWindow(contentRect: NSRect(origin: .zero, size: EditorFixture.defaultSize), styleMask: [.titled], backing: .buffered, defer: false)

    private func fixture(_ text: String = FoldLayoutTests.text) -> EditorFixture {
        let fixture = EditorFixture(text: text)
        window.contentView = fixture.scrollView
        fixture.scrollView.verticalRulerView = fixture.ruler
        fixture.scrollView.hasVerticalRuler = true
        fixture.scrollView.rulersVisible = true
        fixture.session.folds.adopt(FoldScanner.regions(in: text), lines: fixture.session.lineIndex)
        return fixture
    }

    /// Oberkante der Zeile, in der das Zeichen steht
    private func top(of character: Int, in fixture: EditorFixture) -> CGFloat {
        guard let layoutManager = fixture.textView.layoutManager else { return -1 }
        layoutManager.ensureLayout(for: fixture.textView.textContainer!)
        let glyph = layoutManager.glyphIndexForCharacter(at: character)
        return layoutManager.lineFragmentRect(forGlyphAt: glyph, effectiveRange: nil).minY
    }

    private func labels(_ fixture: EditorFixture) -> [Int] {
        fixture.labels(in: fixture.textView.bounds).map(\.number)
    }

    @Test("Zugeklappt rückt die nächste Überschrift direkt unter die Kopfzeile; aufgeklappt ist alles wie vorher")
    func layoutCollapsesAndRestores() {
        let fixture = fixture()
        let nextHeading = (Self.text as NSString).range(of: "\\chapter{Zwei}").location
        let before = top(of: nextHeading, in: fixture)
        let lineHeight = top(of: 15, in: fixture) - top(of: 0, in: fixture)

        fixture.textView.toggleFold(atLine: 0)
        #expect(top(of: nextHeading, in: fixture) == top(of: 0, in: fixture) + lineHeight)
        #expect(top(of: 20, in: fixture) == top(of: 0, in: fixture))

        fixture.textView.toggleFold(atLine: 0)
        #expect(top(of: nextHeading, in: fixture) == before)
    }

    @Test("Die Zeilennummern überspringen ausgeblendete Zeilen")
    func labelsSkipHiddenLines() {
        let fixture = fixture()
        #expect(labels(fixture) == [1, 2, 3, 4, 5, 6])
        fixture.textView.toggleFold(atLine: 0)
        #expect(labels(fixture) == [1, 4, 5, 6])
    }

    @Test("Ein Platzhalter steht hinter der Kopfzeile; ein Klick darauf klappt auf")
    func placeholderClickUnfolds() {
        let fixture = fixture()
        fixture.textView.toggleFold(atLine: 0)
        let placeholders = fixture.textView.foldPlaceholders(in: fixture.textView.bounds)
        #expect(placeholders.count == 1)
        let placeholder = placeholders[0]
        #expect(placeholder.hiddenStart == 14)
        #expect(placeholder.rect.minX > 8 + 14 * 6)
        let inside = fixture.textView.convert(NSPoint(x: placeholder.rect.midX, y: placeholder.rect.midY), to: nil)
        let outside = fixture.textView.convert(NSPoint(x: 1, y: 1), to: nil)
        #expect(!fixture.textView.unfoldPlaceholder(atWindowPoint: outside))
        #expect(fixture.textView.unfoldPlaceholder(atWindowPoint: inside))
        #expect(!fixture.session.folds.hasFolds)
    }

    @Test("Tippen am Ende der Kopfzeile lässt den Bereich zu, Tippen im Ausgeblendeten (Ersetzen) klappt auf")
    func editingAroundTheFold() {
        let fixture = fixture()
        fixture.textView.toggleFold(atLine: 0)
        fixture.replace(NSRange(location: 14, length: 0), with: " x")
        #expect(fixture.session.folds.hiddenRanges.first?.location == 16)
        #expect(top(of: (fixture.session.textStorage.string as NSString).range(of: "\\chapter{Zwei}").location, in: fixture) > top(of: 0, in: fixture))

        fixture.replace(NSRange(location: 18, length: 2), with: "ZZ")
        #expect(!fixture.session.folds.hasFolds)
        #expect(labels(fixture) == [1, 2, 3, 4, 5, 6])
    }

    @Test("Ersetzen des ganzen Texts von außen (Umbenennen, Neu laden) lässt keinen verwaisten Bereich zurück")
    func replacingEverything() {
        let fixture = fixture()
        fixture.textView.toggleFold(atLine: 0)
        fixture.replace(NSRange(location: 0, length: fixture.session.textStorage.length), with: "neu\nganz\nanders\n")
        #expect(!fixture.session.folds.hasFolds)
        #expect(labels(fixture) == [1, 2, 3, 4])
    }

    @Test("Befehle: Zuklappen am Cursor nimmt den innersten Bereich und setzt den Cursor an die Kopfzeile")
    func commands() {
        let text = "\\section{A}\n\\begin{x}\nb\n\\end{x}\nc\n"
        let fixture = fixture(text)
        fixture.textView.setSelectedRange(NSRange(location: 20, length: 0))
        fixture.textView.foldAtCursor(nil)
        #expect(fixture.session.folds.hiddenRanges == [NSRange(location: 21, length: 10)])
        #expect(fixture.textView.selectedRange() == NSRange(location: 20, length: 0))

        fixture.textView.foldAtCursor(nil)
        #expect(fixture.session.folds.folded.count == 2)
        #expect(fixture.textView.selectedRange() == NSRange(location: 11, length: 0))

        fixture.textView.unfoldAtCursor(nil)
        #expect(fixture.session.folds.folded.count == 1)
        fixture.textView.unfoldAllRegions(nil)
        #expect(!fixture.session.folds.hasFolds)
    }

    @Test("Dreieck anklicken: nur in der Dreiecksspalte und nur bei Zeilen mit Bereich")
    func rulerHitTest() {
        let fixture = fixture()
        let ruler = fixture.ruler
        let label = fixture.labels(in: fixture.textView.bounds)[0]
        let point = NSPoint(x: ruler.ruleThickness - 8 - 6, y: ruler.convert(NSPoint(x: 0, y: label.y + label.height / 2), from: fixture.textView).y)
        #expect(ruler.foldableLine(at: point) == 0)
        #expect(ruler.foldableLine(at: NSPoint(x: 3, y: point.y)) == nil)
        let plainLine = fixture.labels(in: fixture.textView.bounds)[1]
        let plainPoint = NSPoint(x: point.x, y: ruler.convert(NSPoint(x: 0, y: plainLine.y + plainLine.height / 2), from: fixture.textView).y)
        #expect(ruler.foldableLine(at: plainPoint) == nil)
    }
}

/// Der echte `EditorCoordinator` in einem Offscreen-Fenster
@MainActor
@Suite("Zuklappen im echten Editor", .serialized)
struct FoldCoordinatorTests {
    private static let text = "\\chapter{Eins}\nerste\nzweite\n\\chapter{Zwei}\nletzte\n"

    private let coordinator = EditorCoordinator()
    private let scrollView: NSScrollView
    private let window: NSWindow

    init() {
        scrollView = coordinator.makeScrollView()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 700, height: 400), styleMask: [.titled], backing: .buffered, defer: false)
        scrollView.frame = window.contentLayoutRect
        window.contentView = scrollView
    }

    private var textView: LatexTextView { scrollView.documentView as! LatexTextView }

    private func show(_ session: DocumentSession?) async {
        coordinator.update(session: session, jump: nil, insert: nil)
        try? await Task.sleep(for: .milliseconds(40))
        window.displayIfNeeded()
    }

    /// Mit sofort bekannten Bereichen, damit die Tests nicht auf den Prüflauf im Hintergrund warten
    private func makeSession(_ name: String = "folds.tex", text: String = FoldCoordinatorTests.text, scanned: Bool = true) -> DocumentSession {
        let session = DocumentSession(url: URL(fileURLWithPath: "/tmp/\(name)"), text: text)
        if scanned { session.folds.adopt(FoldScanner.regions(in: text), lines: session.lineIndex) }
        return session
    }

    private func top(of character: Int) -> CGFloat {
        let layoutManager = textView.layoutManager!
        layoutManager.ensureLayout(for: textView.textContainer!)
        return layoutManager.lineFragmentRect(forGlyphAt: layoutManager.glyphIndexForCharacter(at: character), effectiveRange: nil).minY
    }

    @Test("Der Prüflauf nach dem Öffnen findet die Bereiche von selbst")
    func scansAfterOpening() async {
        let session = makeSession(scanned: false)
        await show(session)
        for _ in 0..<100 where session.folds.regions.isEmpty { try? await Task.sleep(for: .milliseconds(20)) }
        #expect(session.folds.regions.map(\.startLine) == [0, 3])
    }

    @Test("Zugeklappt bleibt beim Dateiwechsel erhalten")
    func foldsSurviveSwitching() async {
        let first = makeSession("a.tex")
        let second = makeSession("b.tex", text: "nur eine Zeile\n")
        await show(first)
        textView.toggleFold(atLine: 0)
        let folded = top(of: (Self.text as NSString).range(of: "\\chapter{Zwei}").location)

        await show(second)
        await show(first)

        #expect(top(of: (Self.text as NSString).range(of: "\\chapter{Zwei}").location) == folded)
        #expect(first.folds.hasFolds)
    }

    @Test("Cursor: Ende der Zeile bleibt an der Kopfzeile")
    func endOfLineStaysAtHeader() async {
        let session = makeSession()
        await show(session)
        textView.toggleFold(atLine: 0)
        textView.setSelectedRange(NSRange(location: 3, length: 0))
        textView.doCommand(by: #selector(NSResponder.moveToEndOfLine(_:)))
        #expect(textView.selectedRange() == NSRange(location: 14, length: 0))
        #expect(session.folds.hasFolds)
    }

    @Test("Pfeil rechts und Wortsprung von der Kopfzeile gehen hinter den Bereich, links wieder zurück")
    func hopsOverFold() async {
        let session = makeSession()
        await show(session)
        textView.toggleFold(atLine: 0)
        for command in [#selector(NSResponder.moveRight(_:)), #selector(NSResponder.moveForward(_:)), #selector(NSResponder.moveWordRight(_:))] {
            textView.setSelectedRange(NSRange(location: 14, length: 0))
            textView.doCommand(by: command)
            #expect(textView.selectedRange() == NSRange(location: 28, length: 0))
        }
        for command in [#selector(NSResponder.moveLeft(_:)), #selector(NSResponder.moveWordLeft(_:))] {
            textView.setSelectedRange(NSRange(location: 28, length: 0))
            textView.doCommand(by: command)
            #expect(textView.selectedRange() == NSRange(location: 14, length: 0))
        }
        #expect(session.folds.hasFolds)
    }

    @Test("Mit Umschalt wird der zugeklappte Bereich in einem Schritt markiert")
    func extendingSelectionOverFold() async {
        let session = makeSession()
        await show(session)
        textView.toggleFold(atLine: 0)
        textView.setSelectedRange(NSRange(location: 14, length: 0))
        textView.doCommand(by: #selector(NSResponder.moveRightAndModifySelection(_:)))
        #expect(textView.selectedRange() == NSRange(location: 14, length: 14))
        textView.setSelectedRange(NSRange(location: 28, length: 0))
        textView.doCommand(by: #selector(NSResponder.moveLeftAndModifySelection(_:)))
        #expect(textView.selectedRange() == NSRange(location: 14, length: 14))
        #expect(session.folds.hasFolds)
    }

    @Test("Rückschritt am Zeilenanfang hinter dem Bereich klappt vorher auf")
    func backspaceUnfolds() async {
        let session = makeSession()
        await show(session)
        textView.toggleFold(atLine: 0)
        textView.setSelectedRange(NSRange(location: 28, length: 0))
        textView.deleteBackward(nil)
        #expect(!session.folds.hasFolds)
        #expect(session.textStorage.string.hasPrefix("\\chapter{Eins}\nerste\nzweite\\chapter{Zwei}"))
    }

    @Test("Gehe zu Zeile in den zugeklappten Teil klappt auf, und die Zeile ist sichtbar")
    func jumpIntoFold() async {
        let session = makeSession()
        await show(session)
        textView.toggleFold(atLine: 0)
        textView.setSelectedRange(NSRange(location: 17, length: 0))
        #expect(!session.folds.hasFolds)
        #expect(top(of: 17) > top(of: 0))
    }

    @Test("Zuklappen ändert den Text nicht und macht die Datei nicht „geändert“")
    func textStaysUntouched() async {
        let session = makeSession()
        await show(session)
        textView.toggleFold(atLine: 0)
        textView.foldAllRegions(nil)
        #expect(session.textStorage.string == Self.text)
        #expect(!session.isDirty)
    }
}
