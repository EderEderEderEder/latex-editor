import AppKit
import Foundation
import PDFKit
import Testing
@testable import LatexEditor

@MainActor
@Suite("PDF-Markierungen: auf das PDF legen")
struct MarkResolverTests {
    private static let paragraph = "Das Qubit ist die kleinste Einheit der Quanteninformation und besitzt zwei Zustände. Ein Bit kennt nur null oder eins."
    private let rows = [
        "Einleitung",
        "Das Qubit ist die kleinste Einheit",
        "der Quanteninformation und besitzt",
        "zwei Zustände. Ein Bit kennt nur",
        "null oder eins.",
    ]
    private var source: [String] { ["\\section{Einleitung}", "", Self.paragraph] }
    private var layout: [Int: ClosedRange<Int>] { [1: 0...0, 3: 1...4] }

    private func fixture() -> MarkFixture { MarkFixture(rows: rows, layout: layout) }

    private func creator(_ fixture: MarkFixture, lines: [String]? = nil) -> MarkCreator {
        MarkCreator(root: fixture.root, document: fixture.document, linesOf: { _ in lines ?? source }, backward: fixture.backward, forward: fixture.forward)
    }

    private func resolver(_ fixture: MarkFixture, lines: [String]? = nil, newer: Bool = false) -> MarkResolver {
        MarkResolver(
            root: fixture.root, document: fixture.document, linesOf: { _ in lines ?? source },
            forward: fixture.forward, isNewerThanPDF: { _ in newer }
        )
    }

    private func makeMark(_ fixture: MarkFixture) throws -> PDFMark {
        let selection = try #require(fixture.selection(from: "kleinste", to: "Quanteninformation"))
        return try creator(fixture).makeMark(from: selection, color: .yellow)
    }

    private func segments(_ resolution: MarkResolution) -> [MarkResolution.Segment] {
        if case .placed(let segments, _) = resolution { return segments }
        return []
    }

    @Test("Eine Auswahl über zwei PDF-Zeilen wird zu einer Markierung mit Anfang und Ende in derselben Quellzeile")
    func createsMark() throws {
        let fixture = fixture()
        let mark = try makeMark(fixture)
        #expect(mark.start.path == "main.tex")
        #expect(mark.start.line == 3)
        #expect(mark.end.line == 3)
        #expect(mark.start.words == ["kleinste", "einheit", "der"])
        #expect(mark.end.words == ["einheit", "der", "quanteninformation"])
        #expect(mark.pageHint == 1)
        #expect(mark.text.contains("kleinste"))
    }

    @Test("Die Markierung sitzt auf den Wörtern, nicht auf der ganzen Quellzeile (Absatz)")
    func placesOnWords() throws {
        let fixture = fixture()
        let resolution = resolver(fixture).resolve(try makeMark(fixture))
        guard case .placed(let segments, let precision) = resolution else { Issue.record("nicht zugeordnet: \(resolution)"); return }
        #expect(precision == .words)
        #expect(segments.count == 2, "Zwei PDF-Zeilen")
        let first = try #require(segments.first).rect
        let second = try #require(segments.last).rect
        #expect(first.minX > MarkFixture.left + 40, "Beginnt erst bei „kleinste“, nicht am Zeilenanfang")
        #expect(first.maxY > second.maxY, "Erste Zeile liegt oberhalb")
        #expect(second.minX <= MarkFixture.left + 1, "Zweite Zeile beginnt am Rand")
        #expect(second.maxX < MarkFixture.left + 468, "und endet nach „Quanteninformation“, vor dem Zeilenende des Absatzes")
    }

    @Test("Nach Einfügen von Zeilen davor und kleinen Änderungen in der Zeile liegt die Markierung wieder auf denselben Wörtern")
    func survivesEdits() throws {
        let fixture = fixture()
        let mark = try makeMark(fixture)
        let before = segments(resolver(fixture).resolve(mark))

        var edited = ["% neu", "% neu 2"] + source
        edited[4] = edited[4].replacingOccurrences(of: "zwei Zustände", with: "genau zwei Zustände")
        var moved = fixture
        moved.layout = [3: 0...0, 5: 1...4]
        let after = segments(resolver(moved, lines: edited).resolve(mark))
        #expect(!before.isEmpty)
        #expect(after == before)
    }

    @Test("Ist die Zeile im Quelltext verschwunden, wird die Markierung verwaist und nicht gelöscht")
    func orphan() throws {
        let fixture = fixture()
        let mark = try makeMark(fixture)
        #expect(resolver(fixture, lines: ["\\section{Einleitung}", "", "Ganz anderer Text steht jetzt hier."]).resolve(mark) == .orphaned)
        #expect(resolver(fixture, lines: []).resolve(mark) == .orphaned)
        var other = fixture
        other.layout = [1: 0...0]
        #expect(resolver(other).resolve(mark) == .orphaned, "SyncTeX kennt die Zeile nicht (mehr)")
    }

    @Test("Ist die Datei neuer als das PDF, wartet die Markierung, statt falsch zu landen")
    func pending() throws {
        let fixture = fixture()
        #expect(resolver(fixture, newer: true).resolve(try makeMark(fixture)) == .pending)
    }

    @Test("Finden sich die Wörter im PDF nicht, bleibt die Markierung an der Zeile")
    func fallsBackToLines() throws {
        let fixture = fixture()
        var mark = try makeMark(fixture)
        mark.start.words = ["gibtesnicht"]
        mark.end.words = ["auchnicht"]
        guard case .placed(let segments, let precision) = resolver(fixture).resolve(mark) else { Issue.record("nicht zugeordnet"); return }
        #expect(precision == .lines)
        #expect(!segments.isEmpty)
    }

    @Test("Ein einzelnes Wort, das mehrfach vorkommt, wird nicht geraten")
    func ambiguousSingleWord() throws {
        let fixture = MarkFixture(rows: ["der der der", "zeile"], layout: [1: 0...0])
        let mark = PDFMark(
            id: UUID(), color: .blue, comment: "", text: "der",
            start: MarkAnchor(path: "main.tex", line: 1, text: "der der der", before: "", after: "", words: ["der"]),
            end: MarkAnchor(path: "main.tex", line: 1, text: "der der der", before: "", after: "", words: ["der"]),
            pageHint: 1, createdAt: Date()
        )
        guard case .placed(_, let precision) = resolver(fixture, lines: ["der der der"]).resolve(mark) else { Issue.record("nicht zugeordnet"); return }
        #expect(precision == .lines)
    }

    @Test("Stelle ohne Text im PDF (Formel, Bild): das Rechteck der Zeile")
    func noTextInRegion() throws {
        var fixture = fixture()
        fixture.layout[7] = 12...12
        let anchor = MarkAnchor(path: "main.tex", line: 7, text: "a = 1", before: "", after: "", words: ["a"])
        let mark = PDFMark(id: UUID(), color: .orange, comment: "", text: "a", start: anchor, end: anchor, pageHint: 1, createdAt: Date())
        let lines = ["", "", "", "", "", "", "a = 1"]
        guard case .placed(let segments, let precision) = resolver(fixture, lines: lines).resolve(mark) else { Issue.record("nicht zugeordnet"); return }
        #expect(precision == .lines)
        #expect(segments.count == 1)
    }

    @Test("Die Anzeige legt Textmarker ins Dokument, ersetzt sie beim nächsten Mal und zeigt Verwaiste nicht")
    func showsAnnotations() throws {
        let fixture = fixture()
        let view = PDFView()
        view.document = fixture.document
        let store = PDFPreviewStore()
        store.pdfView = view
        let mark = try makeMark(fixture)
        let orphan = PDFMark(id: UUID(), color: .pink, comment: "", text: "x", start: mark.start, end: mark.end, pageHint: 1, createdAt: Date())
        let resolutions: [UUID: MarkResolution] = [mark.id: resolver(fixture).resolve(mark), orphan.id: .orphaned]

        var commented = mark
        commented.comment = "Prüfen"
        commented.color = .blue
        store.showMarks([commented, orphan], resolutions)
        let page = try #require(fixture.document.page(at: 0))
        let highlights = page.annotations.filter { $0.type == "Highlight" }
        #expect(highlights.count == 1)
        #expect(highlights.first?.quadrilateralPoints?.count == 8, "Zwei Zeilen, je vier Ecken")
        #expect(highlights.first?.contents == "Prüfen")
        #expect(highlights.first?.userName == mark.id.uuidString)

        store.showMarks([commented], resolutions)
        #expect(page.annotations.filter { $0.type == "Highlight" }.count == 1, "Nicht doppelt")
        store.showMarks([], [:])
        #expect(page.annotations.filter { $0.type == "Highlight" }.isEmpty)
    }

    @Test("Kommt die Wortfolge in der Zeile mehrfach vor (Gleichungsnummer „(1)“ neben „= 1“), merkt sich der Anker den Treffer")
    func repeatedWordsKeepTheirPlace() throws {
        let fixture = MarkFixture(rows: ["a = 1 und 1 sowie 1 (1)", "zeile"], layout: [1: 0...0])
        let lines = ["a = 1 und 1 sowie 1 (1)"]
        let page = try #require(fixture.document.page(at: 0))
        let text = (page.string ?? "") as NSString
        let creator = MarkCreator(root: fixture.root, document: fixture.document, linesOf: { _ in lines }, backward: fixture.backward, forward: fixture.forward)
        let resolver = MarkResolver(root: fixture.root, document: fixture.document, linesOf: { _ in lines }, forward: fixture.forward, isNewerThanPDF: { _ in false })

        var lefts: [CGFloat] = []
        for needle in ["1 (", "1 sowie", "= 1"] {
            // jeweils eine „1“ markieren (Anfang des Treffers), die erste, die zweite und die letzte „1“
            var range = text.range(of: needle)
            range = NSRange(location: range.location + (needle.hasPrefix("= ") ? 2 : 0), length: 1)
            let selection = try #require(page.selection(for: range))
            let mark = try creator.makeMark(from: selection, color: .yellow)
            #expect(mark.start.matchedWords == 1)
            #expect(mark.start.occurrence != nil)
            guard case .placed(let segments, let precision) = resolver.resolve(mark) else { Issue.record("nicht zugeordnet"); return }
            #expect(precision == .words, "Genau diese „1“, nicht die ganze Zeile")
            let rect = try #require(segments.first?.rect)
            #expect(rect.width < 12)
            lefts.append(rect.minX)
        }
        #expect(Set(lefts.map { Int($0) }).count == 3, "Drei verschiedene Stellen: \(lefts)")
        var old = try creator.makeMark(from: try #require(page.selection(for: NSRange(location: text.range(of: "= 1").location + 2, length: 1))), color: .blue)
        old.start.occurrence = nil
        old.start.matchedWords = nil
        guard case .placed(_, let fallback) = resolver.resolve(old) else { Issue.record("nicht zugeordnet"); return }
        #expect(fallback == .lines, "Ohne gemerkten Treffer (alte Dateien) wird nicht geraten")
    }

    @Test("Rechtecke ohne Höhe (SyncTeX meldet sie für manche Zeilen) werden sichtbar gemacht, unbrauchbare nicht gezeichnet")
    func degenerateRects() {
        #expect(CGRect(x: 1, y: 1, width: 10, height: 5).isDrawable)
        #expect(!CGRect(x: 1, y: 1, width: 10, height: 0).isDrawable)
        #expect(!CGRect(x: CGFloat.nan, y: 1, width: 10, height: 5).isDrawable)
        #expect(!CGRect.null.isDrawable)
        #expect(!CGRect.infinite.isDrawable)
    }

    @Test("Anlegen scheitert verständlich: ohne Auswahl, ohne Quellzeile, außerhalb des Projekts")
    func creationFailures() throws {
        let fixture = fixture()
        let selection = try #require(fixture.selection(from: "kleinste", to: "Quanteninformation"))
        #expect(throws: MarkCreator.Failure.noSourceLine) {
            try MarkCreator(root: fixture.root, document: fixture.document, linesOf: { _ in nil }, backward: fixture.backward)
                .makeMark(from: selection, color: .blue)
        }
        #expect(throws: MarkCreator.Failure.noSourceLine) {
            try MarkCreator(root: fixture.root, document: fixture.document, linesOf: { _ in [""] }, backward: { _, _ in nil })
                .makeMark(from: selection, color: .blue)
        }
        #expect(throws: MarkCreator.Failure.outsideProject) {
            try MarkCreator(root: URL(fileURLWithPath: "/tmp/anderes"), document: fixture.document, linesOf: { _ in [""] }, backward: fixture.backward)
                .makeMark(from: selection, color: .blue)
        }
        #expect(throws: MarkCreator.Failure.emptySelection) {
            try creator(fixture).makeMark(from: PDFSelection(document: fixture.document), color: .blue)
        }
        #expect(!MarkCreator.Failure.noSourceLine.message.isEmpty)
    }
}
