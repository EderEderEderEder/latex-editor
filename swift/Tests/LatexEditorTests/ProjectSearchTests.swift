import Foundation
import Testing
@testable import LatexEditor

@Suite("Projektsuche: Treffer")
struct ProjectSearchTests {
    private let file = URL(fileURLWithPath: "/p/a.tex")

    private func search(_ query: String, in text: String, caseSensitive: Bool = false, wholeWord: Bool = false) -> [SearchHit] {
        ProjectSearch.search(query, options: SearchOptions(caseSensitive: caseSensitive, wholeWord: wholeWord), in: text, file: file)
    }

    @Test("Treffer mit Zeile, Bereich und Auszug; Groß-/Kleinschreibung nach Option")
    func basicHits() {
        let text = "Eins\n  Zwei Haus haus\nDrei"
        let hits = search("haus", in: text)
        #expect(hits.map(\.line) == [2, 2])
        #expect(hits.map(\.range.location) == [12, 17])
        #expect(hits.map(\.matchedText) == ["Haus", "haus"])
        #expect(hits[0].excerpt == "Zwei Haus haus", "Einrückung fällt weg")
        #expect((hits[0].excerpt as NSString).substring(with: hits[0].excerptRange) == "Haus")
        #expect(search("haus", in: text, caseSensitive: true).count == 1)
    }

    @Test("Ganzes Wort: weder Buchstaben, Ziffern noch _ daneben; Umlaute zählen als Buchstaben")
    func wholeWord() {
        #expect(search("an", in: "an Bank an_x ändern an.", wholeWord: true).map(\.range.location) == [0, 20])
        #expect(search("Haus", in: "Hausbau Haus Häuser", wholeWord: true).count == 1)
        #expect(search("ander", in: "ändern ander", wholeWord: true).count == 1)
        #expect(search("a1", in: "a12 a1", wholeWord: true).count == 1)
    }

    @Test("Mehrere Treffer in einer Zeile, Zeilenzählung über viele Zeilen, CRLF, leere Suche")
    func lines() {
        let text = (1...50).map { "Zeile \($0) x" }.joined(separator: "\n")
        let hits = search("x", in: text)
        #expect(hits.count == 50)
        #expect(hits.last?.line == 50)
        #expect(search("x", in: "a\r\nb x\r\nc").first?.line == 2)
        #expect(search("", in: text).isEmpty)
        #expect(ProjectSearch.search("", options: SearchOptions(), in: [(file, text)]).hits.isEmpty)
    }

    @Test("Treffer weit hinten in der Zeile bleiben im Auszug sichtbar (Auszug beginnt kurz davor)")
    func laterHitsStayVisible() {
        let text = "Das alte Haus steht am See, und das Haus ist groß."
        let hits = search("Haus", in: text)
        #expect(hits[0].excerpt == text, "vorne: ganze Zeile")
        #expect(hits[1].excerpt.hasPrefix("…"))
        #expect((hits[1].excerpt as NSString).substring(with: hits[1].excerptRange) == "Haus")
        #expect(hits[1].excerptRange.location <= 26, "der Treffer steht weit links, auch in einer schmalen Leiste sichtbar")
    }

    @Test("Auszug schneidet kein Zeichen aus zwei UTF-16-Einheiten durch")
    func surrogatePairs() {
        let text = String(repeating: "😀", count: 20) + "Ziel"
        let hit = search("Ziel", in: text)[0]
        #expect((hit.excerpt as NSString).substring(with: hit.excerptRange) == "Ziel")
        #expect(!hit.excerpt.unicodeScalars.contains("\u{FFFD}"))
    }

    @Test("Lange Zeilen werden um den Treffer gekürzt, mit …")
    func longLines() {
        let text = String(repeating: "a", count: 300) + " Ziel " + String(repeating: "b", count: 300)
        let hit = search("Ziel", in: text)[0]
        #expect(hit.excerpt.hasPrefix("…") && hit.excerpt.hasSuffix("…"))
        #expect((hit.excerpt as NSString).substring(with: hit.excerptRange) == "Ziel")
        #expect(hit.excerpt.count < 200)
    }

    @Test("Über mehrere Dateien: Gruppen, Reihenfolge und Grenze")
    func projectWide() {
        let docs = (1...3).map { (URL(fileURLWithPath: "/p/\($0).tex"), "x\nx\n") }
        let result = ProjectSearch.search("x", options: SearchOptions(), in: docs)
        #expect(result.hits.count == 6)
        #expect(result.fileCount == 3)
        #expect(result.groups.map(\.file.lastPathComponent) == ["1.tex", "2.tex", "3.tex"])
        #expect(!result.isTruncated)

        let huge = [(file, String(repeating: "x ", count: ProjectSearch.maximumHits + 500))]
        let capped = ProjectSearch.search("x", options: SearchOptions(), in: huge)
        #expect(capped.hits.count == ProjectSearch.maximumHits)
        #expect(capped.isTruncated)
    }

    @Test("Ersetzen: alle, nur einzelne, veraltete Treffer werden übersprungen, Länge ändert sich")
    func replacing() {
        let text = "alt und alt, ALT"
        let hits = search("alt", in: text)
        #expect(ProjectSearch.replace(hits, with: "neu", in: text) == ("neu und neu, neu", 3))
        #expect(ProjectSearch.replace([hits[1]], with: "viel länger", in: text) == ("alt und viel länger, ALT", 1))
        #expect(ProjectSearch.replace(hits, with: "", in: text) == (" und , ", 3))

        let edited = "x alt und alt, ALT"
        let stale = ProjectSearch.replace(hits, with: "neu", in: edited)
        #expect(stale.applied < 3, "nach dem Einfügen davor stimmen die Positionen nicht mehr")
        #expect(ProjectSearch.replace([], with: "a", in: text) == (text, 0))
    }

    @Test("Schnell genug und linear: 3.000 Zeilen")
    func performance() {
        let lines = 3_000
        let text = String(repeating: "Das ist ein Satz mit Wörtern und mehr Text.\n", count: lines)
        let start = ContinuousClock.now
        let hits = ProjectSearch.search("Wörtern", options: SearchOptions(), in: text, file: file, limit: 20_000)
        let elapsed = ContinuousClock.now - start
        #expect(hits.count == lines)
        #expect(hits.last?.line == lines)
        #expect(elapsed < .seconds(1))
    }
}

@Suite("Suchen im Editor")
@MainActor
struct EditorFindTests {
    @Test("Kürzel: ⌘F, ⌥⌘F, ⌘G, ⇧⌘G, ⌘E; ⇧⌘F und andere gehen ins Menü")
    func shortcutMapping() {
        #expect(LatexTextView.findAction(key: "f", flags: .command) == .showFindInterface)
        #expect(LatexTextView.findAction(key: "F", flags: .command) == .showFindInterface)
        #expect(LatexTextView.findAction(key: "f", flags: [.command, .option]) == .showReplaceInterface)
        #expect(LatexTextView.findAction(key: "g", flags: .command) == .nextMatch)
        #expect(LatexTextView.findAction(key: "g", flags: [.command, .shift]) == .previousMatch)
        #expect(LatexTextView.findAction(key: "e", flags: .command) == .setSearchString)
        #expect(LatexTextView.findAction(key: "f", flags: [.command, .shift]) == nil, "Projektsuche ist ein Menübefehl")
        #expect(LatexTextView.findAction(key: "f", flags: []) == nil)
        #expect(LatexTextView.findAction(key: "f", flags: [.command, .capsLock]) == .showFindInterface)
    }

    @Test("Die Suchleiste erscheint, und ⌘G findet den nächsten Treffer")
    func findBarAppears() async throws {
        let harness = CompletionHarness(text: "Haus und Maus und Haus\nnoch ein Haus")
        try await harness.start()
        let scrollView = try #require(harness.textView.enclosingScrollView)
        #expect(!scrollView.isFindBarVisible)

        harness.textView.showFinder(.showFindInterface)
        try await Task.sleep(for: .milliseconds(100))
        #expect(scrollView.isFindBarVisible)
        harness.textView.showFinder(.hideFindInterface)
        try await Task.sleep(for: .milliseconds(100))
        #expect(!scrollView.isFindBarVisible)
    }
}
