import AppKit
import Testing
@testable import LatexEditor

/// Zeitbudgets für den Debug-Build (`scripts/test.sh`), schnellster von mehreren Durchläufen (`fastestDuration`; die Messwerte
/// in den Kommentaren stammen teils noch aus Medianen und sind damit eher zu hoch) auf einem Intel-Mac.
/// Kalibriert mit etwa 3-fachem Puffer zum Messwert vom 14.10.2026 (Kommentar: Debug / Release).
/// Release ist deutlich schneller; hält Debug das Budget, hält Release es sicher.
private enum Budget {
    /// gemessen 2,7 ms / 0,7 ms
    static let lineIndexBuild = Duration.milliseconds(10)
    /// gemessen 0,033 ms / 0,014 ms
    static let lineIndexEdit = Duration.microseconds(250)
    /// gemessen 40 ms / 6,7 ms, läuft beim Öffnen im Hintergrund
    static let tokenizeFullDocument = Duration.milliseconds(120)
    /// gemessen 300 ms ohne Sitzung (Maskieren 27, ganzer Text eingefärbt 62, die neun Regex-Durchläufe von ICU ca. 200);
    /// eine offene Datei nutzt die Zeilenzustände der Sitzung (`checkOpenDocument`). Ein Kapitel mit 500 Zeilen: ca. 15 ms.
    static let writingHintsFullDocument = Duration.milliseconds(1_000)
    /// gemessen 282 ms: was 0,6 s nach der Eingabe im Hintergrund läuft (einmal maskieren 27, Verweise 44, Hinweise ohne
    /// Neu-Einfärben 210 – fast nur ICU-Regex). Vorher rund 450 ms (doppelt maskiert, ganzer Text neu eingefärbt).
    static let checkOpenDocument = Duration.milliseconds(850)
    /// gemessen 47 ms: eine .bib mit 2.000 Einträgen (12.000 Zeilen) komplett färben, beim Öffnen im Hintergrund
    static let tokenizeBibliography = Duration.milliseconds(150)
    /// gemessen 64 ms / 26 ms (Vorbereitung im Hintergrund + Attribute im Main-Thread)
    static let openDocument = Duration.milliseconds(200)
    /// gemessen 9,6 ms: Schrift und Absatzstil einer offenen Datei nach einer Einstellungsänderung (Main-Thread, selten)
    static let applyEditorFont = Duration.milliseconds(30)
    /// gemessen 0,125 ms / 0,06 ms; ein Frame bei 60 Hz hat 16,7 ms
    static let keystroke = Duration.microseconds(500)
    /// gemessen 0,9 ms / 0,7 ms für zwei Bearbeitungen, die je einen Absatz neu färben
    static let keystrokeOpeningMath = Duration.milliseconds(3)
    /// gemessen 0,114 ms / 0,024 ms
    static let spellingTokensForParagraph = Duration.microseconds(500)
    /// gemessen 0,036 ms / 0,026 ms
    static let rulerVisibleLabels = Duration.microseconds(250)
    /// gemessen 9–17 ms (fast nur TextKit-Layout der Zielstelle, daher Debug ≈ Release).
    /// Einmalig pro Gliederungsklick; ein Komplett-Layout der Datei läge deutlich über 100 ms.
    static let rulerJumpDeepIntoDocument = Duration.milliseconds(40)
    /// gemessen 34 ms / 6,7 ms, läuft im Hintergrund
    static let outlineParseLargeFile = Duration.milliseconds(100)
    /// gemessen 785 ms / 53 ms für ein 5-MB-Log (ca. 135.000 Zeilen, rund 75-mal das Thesis-Log).
    /// Läuft im Hintergrund nach jedem Build. Debug ist hier 15-mal langsamer als Release, weil die
    /// Byte-Verarbeitung pro Zeile im unoptimierten Build echte Funktionsaufrufe kostet.
    static let logParseFiveMegabytes = Duration.milliseconds(2_000)
    /// gemessen 1.425 ms / 180 ms: SyncTeX-Daten laden (gzip + Parsen), synthetisch 400 Seiten mit
    /// ca. 250.000 Einträgen (ein Vielfaches der Thesis), läuft im Hintergrund nach jedem Build
    static let syncTeXLoad = Duration.milliseconds(4_000)
    /// gemessen 0,47 ms / 0,084 ms: eine Vorwärts- plus eine Rückwärtsabfrage, im Main-Thread
    static let syncTeXQuery = Duration.microseconds(1_500)
    /// gemessen 0,015 ms / 0,013 ms: Kontexterkennung pro Tastendruck, Argument am Ende einer 2.000-Zeichen-Zeile
    static let completionContext = Duration.microseconds(50)
    /// gemessen 9,7 ms / 2,1 ms: 5.000 Vorschläge filtern und sortieren (beim Weitertippen, Liste offen)
    static let completionRanking = Duration.milliseconds(30)
    /// gemessen 116 ms / 24 ms: Diff 10.000 Zeilen, 100 verstreute Änderungen (im Hintergrund)
    static let diffTypical = Duration.milliseconds(350)
    /// gemessen 1.300 ms / 231 ms: jede Zeile geändert, fast alles davon Wort-Hervorhebung
    static let diffRewrite = Duration.milliseconds(4_000)
    /// gemessen 890 ms / 155 ms: 10.000 Zeilen aus fünf Bausteinen, umsortiert; Myers stößt an `maximumLineEdits`
    static let diffWorstCase = Duration.milliseconds(2_700)
}

private enum Iterations {
    static let fast = 200
    static let medium = 20
    static let slow = 5
}

private func check(_ name: String, _ measured: Duration, within budget: Duration) {
    print("⏱ \(name): \(String(format: "%.3f", measured.milliseconds)) ms (Budget \(budget.milliseconds) ms)")
    #expect(measured <= budget, "\(name) überschreitet das Budget")
}

@Suite("Performance (10.000 Zeilen)", .serialized)
@MainActor
struct PerformanceTests {
    private let document = LargeDocument.make()

    @Test("Zeilenindex aufbauen")
    func lineIndexBuild() {
        let text = document as NSString
        let duration = fastestDuration(iterations: Iterations.medium) { _ = LineIndex(text: text) }
        check("LineIndex aufbauen", duration, within: Budget.lineIndexBuild)
    }

    @Test("Zeilenindex: eine Bearbeitung in der Mitte")
    func lineIndexEdit() {
        let text = NSMutableString(string: document)
        var index = LineIndex(text: text)
        let middle = text.length / 2
        let duration = fastestDuration(iterations: Iterations.fast) {
            let edit = replace(text, range: NSRange(location: middle, length: 0), with: "\n")
            index.applyEdit(in: text, editedRange: edit.editedRange, changeInLength: edit.delta)
        }
        check("LineIndex Bearbeitung", duration, within: Budget.lineIndexEdit)
    }

    @Test("Komplettes Tokenisieren")
    func tokenizeFullDocument() {
        let text = document as NSString
        let lines = LineIndex(text: text)
        let duration = fastestDuration(iterations: Iterations.slow) {
            var highlighter = SyntaxHighlighter()
            _ = highlighter.highlightAll(text, lines: lines)
        }
        check("Tokenisieren komplett", duration, within: Budget.tokenizeFullDocument)
    }

    @Test("Schreibhinweise für die ganze Datei")
    func writingHintsFullDocument() {
        let duration = fastestDuration(iterations: Iterations.slow) { _ = WritingHints.hints(in: document) }
        check("Schreibhinweise komplett", duration, within: Budget.writingHintsFullDocument)
    }

    @Test("Prüfung einer offenen Datei: Verweise und Schreibhinweise mit den Zeilenzuständen der Sitzung")
    func checkOpenDocument() {
        let session = DocumentSession(url: URL(fileURLWithPath: "/tmp/perf-check.tex"), text: document)
        let syntax = session.syntaxSnapshot()
        let duration = fastestDuration(iterations: Iterations.slow) {
            let masked = LatexMasking.scannable(document)
            _ = ReferenceChecker.problems(masked: masked as NSString, labels: [], citations: nil)
            _ = WritingHints.hints(in: document, masked: masked, syntax: syntax)
        }
        check("Prüfung offene Datei", duration, within: Budget.checkOpenDocument)
    }

    @Test("BibTeX: große Literaturdatei komplett färben")
    func tokenizeBibliography() {
        let entry = "@book{key%d,\n\tauthor = {Nachname, Vorname and Zweite, Person},\n\ttitle = {Ein {\\LaTeX} Titel %d},\n"
            + "\tpublisher = {Verlag},\n\tyear = {%d},\n}\n"
        let text = (0..<2_000).map { String(format: entry, $0, $0, 1900 + $0 % 120) }.joined() as NSString
        let lines = LineIndex(text: text)
        let duration = fastestDuration(iterations: Iterations.slow) {
            var highlighter = SyntaxHighlighter(language: .bibtex)
            _ = highlighter.highlightAll(text, lines: lines)
        }
        check("BibTeX färben komplett", duration, within: Budget.tokenizeBibliography)
    }

    @Test("Einstellung geändert: Schrift und Absatzstil einer großen Datei übernehmen")
    func applyEditorFont() {
        let session = DocumentSession(url: URL(fileURLWithPath: "/tmp/perf-font.tex"), text: document)
        let duration = fastestDuration(iterations: Iterations.medium) { session.applyEditorFont() }
        check("Schrift übernehmen", duration, within: Budget.applyEditorFont)
    }

    @Test("Datei öffnen: Index, Tokens und Farben im NSTextStorage")
    func openDocument() {
        let duration = fastestDuration(iterations: Iterations.slow) {
            _ = DocumentSession(url: URL(fileURLWithPath: "/tmp/perf.tex"), text: document)
        }
        check("Öffnen inkl. Einfärben", duration, within: Budget.openDocument)
    }

    @Test("Ein Tastendruck in der Dateimitte (Index, Highlighting, Attribute)")
    func keystroke() {
        let fixture = EditorFixture(text: document)
        let location = fixture.session.lineIndex.start(ofLine: 5_003) + 10
        var offset = 0
        let duration = fastestDuration(iterations: Iterations.fast) {
            fixture.replace(NSRange(location: location + offset, length: 0), with: "x")
            offset += 1
        }
        check("Tastendruck", duration, within: Budget.keystroke)
    }

    @Test("Tastendruck, der Inline-Mathe öffnet und wieder schließt")
    func keystrokeOpeningMath() {
        let fixture = EditorFixture(text: document)
        let location = fixture.session.lineIndex.start(ofLine: 5_006)
        let duration = fastestDuration(iterations: Iterations.medium) {
            fixture.replace(NSRange(location: location, length: 0), with: "$")
            fixture.replace(NSRange(location: location, length: 1), with: "")
        }
        check("Mathe öffnen + schließen", duration, within: Budget.keystrokeOpeningMath)
    }

    @Test("Tokens für die Rechtschreibprüfung eines Absatzes")
    func spellingTokens() {
        let fixture = EditorFixture(text: document)
        let lines = fixture.session.lineIndex
        let paragraph = NSRange(location: lines.start(ofLine: 5_000), length: lines.start(ofLine: 5_026) - lines.start(ofLine: 5_000))
        let duration = fastestDuration(iterations: Iterations.fast) {
            _ = fixture.session.syntaxTokens(in: paragraph)
        }
        check("Spelling-Tokens Absatz", duration, within: Budget.spellingTokensForParagraph)
    }

    @Test("Ruler: sichtbare Zeilennummern beim Scrollen")
    func rulerVisibleLabels() {
        let fixture = EditorFixture(text: document)
        let visible = NSRect(x: 0, y: 2_000, width: 600, height: 800)
        _ = fixture.labels(in: visible)
        let duration = fastestDuration(iterations: Iterations.fast) { _ = fixture.labels(in: visible) }
        check("Ruler sichtbarer Bereich", duration, within: Budget.rulerVisibleLabels)
    }

    @Test("Sprung zu Zeile 9.000 wie beim Gliederungsklick (erstes Layout dort + Ruler)")
    func rulerJump() {
        let targetLine = 9_000
        let clock = ContinuousClock()
        var durations: [Duration] = []
        for _ in 0..<Iterations.slow {
            let fixture = EditorFixture(text: document)
            var labels: [LineNumberRulerView.Label] = []
            durations.append(clock.measure { labels = fixture.labelsAfterJump(toLine: targetLine) })
            #expect(labels.contains { $0.number == targetLine + 1 })
        }
        check("Sprung + Ruler", durations.sorted()[durations.count / 2], within: Budget.rulerJumpDeepIntoDocument)
    }

    @Test("Gliederung einer großen Datei parsen")
    func outlineParse() async throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let main = try project.write("main.tex", document)
        let clock = ContinuousClock()
        var durations: [Duration] = []
        for _ in 0..<Iterations.slow {
            let parser = OutlineParser()
            let start = clock.now
            _ = await parser.outline(mainFile: main)
            durations.append(clock.now - start)
        }
        check("Gliederung parsen", durations.min() ?? .zero, within: Budget.outlineParseLargeFile)
    }

    @Test("Log-Parser mit 5-MB-Log")
    func logParse() throws {
        let fixtures = try ["errors.log", "warnings.log", "biber.log", "clean.log"].map(LogFixture.text)
        let targetBytes = 5 * 1_024 * 1_024
        var log = ""
        while log.utf8.count < targetBytes { log += fixtures.joined(separator: "\n") }
        let base = URL(fileURLWithPath: "/p", isDirectory: true)
        var issueCount = 0
        let duration = fastestDuration(iterations: Iterations.slow) {
            issueCount = LatexLogParser.parse(log, baseDirectory: base).count
        }
        #expect(issueCount > 1_000)
        check("Log-Parser 5 MB", duration, within: Budget.logParseFiveMegabytes)
    }

    @Test("SyncTeX-Daten laden (ca. 5 MB unkomprimiert)")
    func syncTeXLoad() throws {
        let project = try TemporaryProject()
        defer { project.remove() }
        let url = project.url("main.synctex.gz")
        try SyntheticSyncTeX.gzipped(SyntheticSyncTeX.text()).write(to: url)
        var recordCount = 0
        let duration = try fastestDuration(iterations: Iterations.slow) {
            recordCount = try SyncTeXIndex.load(contentsOf: url).records.count
        }
        #expect(recordCount > 100_000)
        check("SyncTeX laden", duration, within: Budget.syncTeXLoad)
    }

    @Test("SyncTeX: eine Vorwärts- und eine Rückwärtsabfrage")
    func syncTeXQuery() throws {
        let index = try SyncTeXIndex.parse(Data(SyntheticSyncTeX.text().utf8))
        let chapter = URL(fileURLWithPath: SyntheticSyncTeX.chapterPath(7))
        var box: SyncTeXBox?
        var location: SyncTeXSourceLocation?
        let duration = fastestDuration(iterations: Iterations.medium) {
            box = index.forward(file: chapter, line: 1_234)
            location = index.backward(page: box?.page ?? 1, point: CGPoint(x: 200, y: 400))
        }
        #expect(box != nil && location != nil)
        check("SyncTeX Abfrage", duration, within: Budget.syncTeXQuery)
    }
}

/// Erzeugt eine große, realistisch aufgebaute SyncTeX-Datei (Kapitel, Seiten, Zeilenboxen mit Elementen).
enum SyntheticSyncTeX {
    static let chapterCount = 10
    static let pageCount = 400
    static let linesPerPage = 45
    static let leavesPerLine = 12
    private static let lineSkip = 786_432
    private static let topMargin = 6_000_000
    private static let leftMargin = 6_000_000
    private static let lineWidth = 22_000_000

    static func chapterPath(_ number: Int) -> String {
        "/tmp/Synthetic Thesis/./chapters/kapitel\(number).tex"
    }

    static func text() -> String {
        var lines = ["SyncTeX Version:1"]
        for chapter in 1...chapterCount { lines.append("Input:\(chapter):\(chapterPath(chapter))") }
        lines += ["Output:pdf", "Magnification:1000", "Unit:1", "X Offset:0", "Y Offset:0", "Content:"]
        for page in 1...pageCount { lines += pageLines(page) }
        lines += ["Postamble:", "Count:1", "Post scriptum:"]
        return lines.joined(separator: "\n") + "\n"
    }

    private static func pageLines(_ page: Int) -> [String] {
        let tag = (page - 1) * chapterCount / pageCount + 1
        var lines = ["{\(page)", "[\(tag),1:\(leftMargin),\(topMargin + linesPerPage * lineSkip):\(lineWidth),40000000,0"]
        for row in 0..<linesPerPage {
            let sourceLine = (page * linesPerPage + row) % 3_000 + 1
            let baseline = topMargin + row * lineSkip
            lines.append("(\(tag),\(sourceLine):\(leftMargin),\(baseline):\(lineWidth),600000,180000")
            for leaf in 0..<leavesPerLine {
                lines.append("x\(tag),\(sourceLine):\(leftMargin + leaf * 1_800_000),\(baseline)")
            }
            lines.append(")")
        }
        lines += ["]", "}\(page)"]
        return lines
    }

    static func gzipped(_ text: String) throws -> Data {
        let deflated = try (Data(text.utf8) as NSData).compressed(using: .zlib) as Data
        let header: [UInt8] = [0x1F, 0x8B, 0x08, 0x00, 0, 0, 0, 0, 0, 0x03]
        return Data(header) + deflated + Data(count: 8)
    }
}

@Suite("Performance: Git-Diff (10.000 Zeilen)", .serialized)
struct DiffPerformanceTests {
    private let document = LargeDocument.make()

    @Test("Diff mit 100 verstreuten Änderungen")
    func typicalDiff() {
        var lines = LineDiff.splitLines(document)
        for index in stride(from: 50, to: lines.count, by: 100) { lines[index] += " geändert" }
        let changed = lines.joined(separator: "\n")
        let duration = fastestDuration(iterations: Iterations.slow) { _ = LineDiff.compute(old: document, new: changed) }
        check("Diff typisch", duration, within: Budget.diffTypical)
    }

    @Test("Diff, wenn jede Zeile geändert ist")
    func rewriteDiff() {
        let changed = LineDiff.splitLines(document).map { $0 + "!" }.joined(separator: "\n")
        let duration = fastestDuration(iterations: Iterations.slow) { _ = LineDiff.compute(old: document, new: changed) }
        check("Diff alles neu", duration, within: Budget.diffRewrite)
    }

    @Test("Diff im ungünstigsten Fall bleibt begrenzt")
    func worstCaseDiff() {
        var generator = SeededGenerator(seed: 7)
        let pieces = ["", "\\item a", "\\item b", "\\hline", "Text."]
        let old = (0..<10_000).map { _ in pieces.randomElement(using: &generator)! }
        let new = old.shuffled(using: &generator)
        let duration = fastestDuration(iterations: 1) {
            _ = LineDiff.compute(old: old.joined(separator: "\n"), new: new.joined(separator: "\n"))
        }
        check("Diff ungünstigster Fall", duration, within: Budget.diffWorstCase)
    }
}

@Suite("Performance: Vervollständigung", .serialized)
struct CompletionPerformanceTests {
    @Test("Kontexterkennung pro Tastendruck auf einer langen Zeile")
    func contextDetection() {
        let line = String(repeating: "Ein langer Absatz mit Text und 50\\% Inhalt. ", count: 45) + "\\cite[S.~3]{knuth,lam"
        let text = line as NSString
        let duration = fastestDuration(iterations: Iterations.fast) {
            _ = CompletionContextDetector.detect(in: text, cursor: text.length, lineStart: 0)
        }
        check("Vervollständigung Kontext", duration, within: Budget.completionContext)
    }

    @Test("Filtern und Sortieren vieler Vorschläge")
    func ranking() {
        let items = (0..<5_000).map { CompletionItem(kind: .label, text: "fig:abbildung-\($0)-teil") }
        let duration = fastestDuration(iterations: Iterations.medium) {
            _ = CompletionMatcher.rank(items, prefix: "teil")
        }
        check("Vervollständigung Sortieren", duration, within: Budget.completionRanking)
    }
}
