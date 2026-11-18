import Foundation
import Testing
@testable import LatexEditor

/// Zufällige, reproduzierbare Zeilen aus einem kleinen Wortschatz: viele Wiederholungen, also viele Gleichstände
private enum RandomLines {
    static let seed: UInt64 = 2026
    static let lineCount = 200
    static let anchorCount = 50
    static let wordsPerLine = 2...8
    static let vocabulary = ["die", "der", "und", "daten", "arbeit", "modell", "test", "x", "1", "ergebnis"]
    /// Kommen in keiner Zeile vor
    static let unknownWords = ["fremd", "unbekannt"]
    /// Steht in keiner Zeile: Kein Anker bekommt einen Bonus für die Nachbarzeilen
    static let noNeighbour = "% kein Nachbar"
    /// Reihum je Anker: Kopie einer Zeile, Zeile mit einem fremden Wort, ganz neue Wortfolge
    static let anchorKinds = 3

    static func words(from vocabulary: [String], using generator: inout SeededGenerator) -> [String] {
        (0..<Int.random(in: wordsPerLine, using: &generator)).map { _ in
            vocabulary[Int.random(in: vocabulary.indices, using: &generator)]
        }
    }

    static func anchor(number: Int, in lines: [String], using generator: inout SeededGenerator) -> MarkAnchor {
        let base = Int.random(in: lines.indices, using: &generator)
        var words = lines[base].split(separator: " ").map(String.init)
        switch number % anchorKinds {
        case 0:
            break
        case 1:
            words[Int.random(in: words.indices, using: &generator)] = unknownWords[Int.random(in: unknownWords.indices, using: &generator)]
        default:
            words = Self.words(from: vocabulary + unknownWords, using: &generator)
        }
        return MarkAnchor(path: "x.tex", line: base + 1, text: words.joined(separator: " "), before: noNeighbour,
                          after: noNeighbour, words: [])
    }
}

/// Die einfache Referenz zur Suche nach der gleichen bzw. ähnlichsten Zeile (ohne Nachbarzeilen, die Anker haben keine):
/// die gleiche Zeile, sonst die ähnlichste ab der Schwelle; bei Gleichstand die nähere, bei gleichem Abstand die frühere.
/// `nil`, wenn keine passt: Dort greift in `locate` der Rückfall, der Vergleich gilt nicht.
private func referenceLine(_ anchor: MarkAnchor, in lines: [String]) -> Int? {
    let start = anchor.line - 1
    let exact = lines.indices.filter { lines[$0].trimmingCharacters(in: .whitespacesAndNewlines) == anchor.text }
    if let nearest = exact.min(by: { abs($0 - start) < abs($1 - start) }) { return nearest + 1 }
    let wanted = MarkText.words(inSource: anchor.text)
    let similar = lines.indices
        .map { (index: $0, score: MarkAnchorLocator.similarity(wanted, MarkText.words(inSource: lines[$0]))) }
        .filter { $0.score >= MarkAnchorLocator.similarityThreshold }
    let best = similar.min { lhs, rhs in
        lhs.score != rhs.score ? lhs.score > rhs.score : abs(lhs.index - start) < abs(rhs.index - start)
    }
    return best.map { $0.index + 1 }
}

@Suite("PDF-Markierungen: Die schnelle Suche nach der ähnlichsten Zeile gleicht der einfachen Referenz")
struct MarkAnchorSimilarLineTests {
    @Test("200 zufällige Zeilen, 50 Anker: gleiches Ergebnis wie die Ähnlichkeit über alle Zeilen")
    func matchesReference() {
        var generator = SeededGenerator(seed: RandomLines.seed)
        let lines = (0..<RandomLines.lineCount).map { _ in
            RandomLines.words(from: RandomLines.vocabulary, using: &generator).joined(separator: " ")
        }
        let anchors = (0..<RandomLines.anchorCount).map { RandomLines.anchor(number: $0, in: lines, using: &generator) }
        let source = MarkSourceLines(lines)
        var compared = 0
        for anchor in anchors {
            guard let expected = referenceLine(anchor, in: lines) else { continue }
            compared += 1
            #expect(MarkAnchorLocator.locate(anchor, in: source) == expected, "„\(anchor.text)“ bei Zeile \(anchor.line)")
        }
        #expect(compared >= RandomLines.anchorCount / RandomLines.anchorKinds, "Zu wenige Anker verglichen: \(compared)")
    }
}
