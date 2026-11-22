import Foundation
import Testing
@testable import LatexEditor

@Suite("PDF-Markierungen: Liste")
struct MarkListGroupingTests {
    private func mark(_ text: String, created: TimeInterval = 0) -> PDFMark {
        let anchor = MarkAnchor(path: "a.tex", line: 1, text: text, before: "", after: "", words: [])
        return PDFMark(id: UUID(), color: .yellow, comment: "", text: text, start: anchor, end: anchor, pageHint: 1, createdAt: Date(timeIntervalSince1970: created))
    }

    private func placed(page: Int, top: CGFloat) -> MarkResolution {
        .placed(segments: [.init(pageIndex: page, rect: CGRect(x: 0, y: top - 10, width: 50, height: 10))], precision: .words)
    }

    @Test("Zuerst, was Handlungsbedarf hat, dann die Seiten; auf der Seite von oben nach unten")
    func order() {
        let orphan = mark("verwaist", created: 1)
        let waiting = mark("wartet", created: 2)
        let unknown = mark("unbekannt", created: 3)
        let low = mark("unten"), high = mark("oben"), later = mark("später")
        let resolutions: [UUID: MarkResolution] = [
            orphan.id: .orphaned, waiting.id: .pending,
            low.id: placed(page: 1, top: 100), high.id: placed(page: 1, top: 700), later.id: placed(page: 4, top: 300),
        ]
        let sections = MarkListGrouping.sections(marks: [low, later, orphan, high, waiting, unknown], resolutions: resolutions)
        #expect(sections.map(\.title) == ["Nicht zugeordnet", "Wartet auf Kompilieren", "Seite 2", "Seite 5"])
        #expect(sections[0].marks == [orphan])
        #expect(sections[1].marks == [waiting, unknown], "Ohne Lage (noch kein PDF) wartet es ebenfalls")
        #expect(sections[2].marks == [high, low])
        #expect(MarkListGrouping.sections(marks: [], resolutions: [:]).isEmpty)
    }
}
