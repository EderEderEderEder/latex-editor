import AppKit
import Testing
@testable import LatexEditor

@Suite("Abschnitt an der obersten sichtbaren Zeile")
struct SectionChainTests {
    private let a = URL(fileURLWithPath: "/p/a.tex")
    private let b = URL(fileURLWithPath: "/p/b.tex")

    private var entries: [OutlineEntry] {
        [
            OutlineEntry(level: .chapter, title: "A", fileURL: a, line: 1),
            OutlineEntry(level: .section, title: "A1", fileURL: a, line: 10),
            OutlineEntry(level: .subsection, title: "A1a", fileURL: a, line: 20),
            OutlineEntry(level: .section, title: "A2", fileURL: a, line: 30),
            OutlineEntry(level: .chapter, title: "B", fileURL: b, line: 1),
            OutlineEntry(level: .subsection, title: "B-ohne-Abschnitt", fileURL: b, line: 5),
        ]
    }

    private func titles(_ file: URL, _ line: Int) -> [String] {
        OutlineTree.sectionChain(in: entries, file: file, line: line).map(\.title)
    }

    @Test("Kette von außen nach innen")
    func chain() {
        #expect(titles(a, 25) == ["A", "A1", "A1a"])
        #expect(titles(a, 35) == ["A", "A2"])
        #expect(titles(a, 10) == ["A", "A1"], "die Überschrift selbst gehört zum Abschnitt")
        #expect(titles(b, 3) == ["B"])
    }

    @Test("Unterabschnitt direkt unter dem Kapitel hängt am Kapitel")
    func skippedLevel() {
        #expect(titles(b, 9) == ["B", "B-ohne-Abschnitt"])
    }

    @Test("Vor der ersten Überschrift einer Datei gilt der Abschnitt davor; unbekannte Datei: keiner")
    func edges() {
        let c = URL(fileURLWithPath: "/p/c.tex")
        var withC = entries
        withC.insert(OutlineEntry(level: .chapter, title: "C", fileURL: c, line: 5), at: 4)
        #expect(OutlineTree.sectionChain(in: withC, file: c, line: 2).map(\.title) == ["A", "A2"])
        #expect(OutlineTree.sectionChain(in: entries, file: URL(fileURLWithPath: "/p/x.tex"), line: 1).isEmpty)
    }

    @Test("Der Store setzt die Kette nur bei Änderung")
    @MainActor
    func store() async {
        let store = OutlineStore()
        store.updateViewport(file: a, topLine: 1)
        #expect(store.sectionChain.isEmpty, "ohne Gliederung gibt es keinen Abschnitt")
        store.updateViewport(file: nil, topLine: 0)
        #expect(store.sectionChain.isEmpty)
    }
}

@Suite("Oberste sichtbare Zeile melden", .serialized)
@MainActor
struct TopLineReportTests {
    @Test("Scrollen meldet die Zeile entprellt, Datei und 1-basiert")
    func reportsTopLine() async throws {
        let text = (1...400).map { "Zeile \($0)" }.joined(separator: "\n")
        let harness = CompletionHarness(text: text)
        try await harness.start()
        var reported: [(URL, Int)] = []
        harness.coordinator.onTopLineChanged = { reported.append(($0, $1)) }

        let scrollView = try #require(harness.window.contentView as? NSScrollView)
        let lineHeight = harness.textView.layoutManager?.defaultLineHeight(for: EditorAppearance.font) ?? 15
        scrollView.contentView.scroll(to: NSPoint(x: 0, y: lineHeight * 100))
        scrollView.reflectScrolledClipView(scrollView.contentView)
        harness.window.displayIfNeeded()
        // Unter Last kommt die entprellte Meldung spät
        for _ in 0..<250 where reported.isEmpty { try await Task.sleep(for: .milliseconds(20)) }

        let last = try #require(reported.last)
        #expect(last.0 == harness.session.url)
        // Unabhängig berechnet: erste sichtbare Zeile laut Layout (im nicht zusammenhängenden Layout sind die Höhen davor geschätzt)
        let textView = harness.textView
        let layoutManager = try #require(textView.layoutManager)
        let container = try #require(textView.textContainer)
        let visible = textView.visibleRect.offsetBy(dx: -textView.textContainerOrigin.x, dy: -textView.textContainerOrigin.y)
        let glyphs = layoutManager.glyphRange(forBoundingRect: visible, in: container)
        let firstLine = harness.session.lineIndex.line(containing: layoutManager.characterIndexForGlyph(at: glyphs.location)) + 1
        #expect(last.1 > 1)
        #expect(abs(last.1 - firstLine) <= 1, "gemeldet \(last.1), erste sichtbare Zeile \(firstLine)")
    }
}
