import Foundation

/// Eine Datei, die ⌘P anbieten kann.
struct QuickOpenCandidate: Equatable, Identifiable, Sendable {
    let url: URL
    /// Pfad relativ zum Projektordner, z. B. „chapters/einleitung.tex“
    let relativePath: String
    /// Hat einen Tab
    var isOpen = false

    var id: URL { url }
    var fileName: String { url.lastPathComponent }
    /// „chapters“ für „chapters/einleitung.tex“, leer im Projektordner
    var folder: String { (relativePath as NSString).deletingLastPathComponent }
}

/// Unscharfe Suche für „Schnell öffnen“: Die Zeichen der Eingabe müssen in dieser Reihenfolge im Pfad vorkommen
/// („einl“ findet „chapters/einleitung.tex“, „cheil“ auch). Treffer im Dateinamen zählen mehr als im Ordner.
enum QuickOpenMatcher {
    static let defaultLimit = 50

    private static let substringInName = 1_000
    private static let prefixOfName = 500
    private static let subsequenceInName = 600
    private static let subsequenceInPath = 300
    private static let openFileBonus = 50
    private static let consecutiveBonus = 10

    /// Ohne Eingabe: offene Dateien zuerst (in der gegebenen Reihenfolge), dann alphabetisch.
    static func rank(_ candidates: [QuickOpenCandidate], query: String, limit: Int = defaultLimit) -> [QuickOpenCandidate] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else {
            let open = candidates.filter(\.isOpen)
            let rest = candidates.filter { !$0.isOpen }
                .sorted { $0.relativePath.localizedStandardCompare($1.relativePath) == .orderedAscending }
            return Array((open + rest).prefix(limit))
        }
        let scored = candidates.compactMap { candidate in score(candidate, needle: needle).map { (candidate, $0) } }
        let sorted = scored.sorted { lhs, rhs in
            if lhs.1 != rhs.1 { return lhs.1 > rhs.1 }
            return lhs.0.relativePath.localizedStandardCompare(rhs.0.relativePath) == .orderedAscending
        }
        return sorted.prefix(limit).map(\.0)
    }

    private static func score(_ candidate: QuickOpenCandidate, needle: String) -> Int? {
        let name = candidate.fileName.lowercased()
        let path = candidate.relativePath.lowercased()
        var value: Int
        if name.hasPrefix(needle) {
            value = substringInName + prefixOfName
        } else if name.contains(needle) {
            value = substringInName
        } else if let runs = consecutiveRuns(of: needle, in: name) {
            value = subsequenceInName + runs * consecutiveBonus
        } else if let runs = consecutiveRuns(of: needle, in: path) {
            value = subsequenceInPath + runs * consecutiveBonus
        } else {
            return nil
        }
        if candidate.isOpen { value += openFileBonus }
        // Kürzere Pfade zuerst
        return value - path.count
    }

    /// Anzahl direkt aufeinanderfolgender Treffer, `nil` wenn `needle` keine Teilfolge von `text` ist.
    private static func consecutiveRuns(of needle: String, in text: String) -> Int? {
        var remaining = Substring(needle)
        var previousMatched = false
        var runs = 0
        for character in text {
            guard let wanted = remaining.first else { break }
            if character == wanted {
                remaining = remaining.dropFirst()
                if previousMatched { runs += 1 }
                previousMatched = true
            } else {
                previousMatched = false
            }
        }
        return remaining.isEmpty ? runs : nil
    }
}
