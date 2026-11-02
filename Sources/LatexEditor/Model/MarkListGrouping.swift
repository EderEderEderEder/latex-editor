import Foundation

struct MarkListSection: Identifiable, Equatable {
    enum Kind: Equatable {
        /// Die Stelle im Text gibt es nicht mehr: nach Neu zuordnen oder Entfernen fragen
        case unplaced
        /// Noch kein PDF bzw. der Text ist neuer als das PDF
        case waiting
        case page(Int)
    }

    let kind: Kind
    let marks: [PDFMark]

    var id: String {
        switch kind {
        case .unplaced: "unplaced"
        case .waiting: "waiting"
        case .page(let index): "page-\(index)"
        }
    }

    var title: String {
        switch kind {
        case .unplaced: "Nicht zugeordnet"
        case .waiting: "Wartet auf Kompilieren"
        case .page(let index): "Seite \(index + 1)"
        }
    }
}

/// Reihenfolge der Liste „Markierungen“: Handlungsbedarf zuerst, dann nach Seite, auf der Seite von oben nach unten
enum MarkListGrouping {
    static func sections(marks: [PDFMark], resolutions: [UUID: MarkResolution]) -> [MarkListSection] {
        var unplaced: [PDFMark] = []
        var waiting: [PDFMark] = []
        var pages: [Int: [(mark: PDFMark, top: CGFloat)]] = [:]
        for mark in marks {
            switch resolutions[mark.id] {
            case .orphaned?: unplaced.append(mark)
            case .placed(let segments, _)?:
                guard let first = segments.first else { waiting.append(mark); continue }
                pages[first.pageIndex, default: []].append((mark, first.rect.maxY))
            case .pending?, nil: waiting.append(mark)
            }
        }
        var sections: [MarkListSection] = []
        if !unplaced.isEmpty { sections.append(MarkListSection(kind: .unplaced, marks: byCreation(unplaced))) }
        if !waiting.isEmpty { sections.append(MarkListSection(kind: .waiting, marks: byCreation(waiting))) }
        for page in pages.keys.sorted() {
            let ordered = (pages[page] ?? []).sorted { $0.top > $1.top }.map(\.mark)
            sections.append(MarkListSection(kind: .page(page), marks: ordered))
        }
        return sections
    }

    private static func byCreation(_ marks: [PDFMark]) -> [PDFMark] {
        marks.sorted { $0.createdAt < $1.createdAt }
    }
}
