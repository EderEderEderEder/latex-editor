import Foundation

/// Wörter eines Textes für den Vergleich: Buchstaben und Ziffern, kleingeschrieben, Ligaturen aufgelöst (ﬁ → fi).
/// `range` bleibt die Position im Originaltext (bei PDF-Text: Zeichenindex der Seite).
enum MarkText {
    struct Token: Equatable {
        let text: String
        let range: NSRange
    }

    private static let wordCharacters = CharacterSet.alphanumerics.union(.nonBaseCharacters)

    static func tokens(in string: String) -> [Token] {
        let text = string as NSString
        var result: [Token] = []
        var start: Int?
        for index in 0...text.length {
            let isWordCharacter = index < text.length && Unicode.Scalar(text.character(at: index)).map(wordCharacters.contains) == true
            if isWordCharacter {
                if start == nil { start = index }
            } else if let begin = start {
                let range = NSRange(location: begin, length: index - begin)
                result.append(Token(text: normalized(text.substring(with: range)), range: range))
                start = nil
            }
        }
        return result
    }

    /// Wörter einer Quelltextzeile: ohne Befehle (`\emph`, `\ref` …), Kommentar und Klammern
    static func words(inSource line: String) -> [String] {
        var text = line
        if let comment = LatexComments.commentStart(in: line) { text = String(line[..<comment]) }
        text = text.replacingOccurrences(of: #"\\[A-Za-z@]+\*?"#, with: " ", options: .regularExpression)
        return tokens(in: text).map(\.text)
    }

    static func normalized(_ word: String) -> String {
        word.precomposedStringWithCompatibilityMapping.lowercased()
    }
}

/// Die Stelle im Quelltext, an der eine Markierung hängt: Datei, Zeile und der Text der Zeile samt Nachbarzeilen.
/// Die Zeilennummer ist nur der Startwert; gefunden wird die Zeile über ihren Text, weil Nummern beim Schreiben verrutschen.
struct MarkAnchor: Codable, Equatable, Sendable {
    /// Relativ zum Projektordner
    var path: String
    /// 1-basiert
    var line: Int
    var text: String
    var before: String
    var after: String
    /// Die ersten (Anfang) bzw. letzten (Ende) Wörter der Markierung im PDF, kleingeschrieben; verfeinern die Zeile auf das Wort
    var words: [String]
    /// Kommen die Wörter in der Zeile mehrfach vor (Gleichungsnummer „(1)“ neben „= 1“), merkt sich das: mit wie vielen Wörtern
    /// gesucht wurde und der wievielte Treffer es war (am Ende der Markierung von hinten gezählt). Fehlt bei älteren Dateien.
    var matchedWords: Int? = nil
    var occurrence: Int? = nil
}

enum MarkAnchorLocator {
    /// Wie weit eine Zeile beim Anlegen von der SyncTeX-Zeile entfernt sein darf, wenn sie die Wörter besser enthält
    static let creationSearchRadius = 5
    /// Ab dieser Ähnlichkeit (0 bis 1) gilt eine veränderte Zeile noch als dieselbe
    static let similarityThreshold = 0.7
    private static let minimumFuzzyWords = 2
    private static let contextBonus = 0.15

    static func anchor(path: String, line: Int, in lines: [String], words: [String]) -> MarkAnchor {
        let index = min(max(line - 1, 0), max(lines.count - 1, 0))
        return MarkAnchor(
            path: path, line: index + 1, text: trimmed(lines, index), before: trimmed(lines, index - 1),
            after: trimmed(lines, index + 1), words: words
        )
    }

    /// Die Zeile im Radius, die die Wörter am besten enthält; bleibt bei `line`, wenn sie schon passt oder keine besser passt
    static func bestLine(near line: Int, containing words: [String], in lines: [String]) -> Int {
        guard !words.isEmpty, !lines.isEmpty else { return line }
        let center = min(max(line - 1, 0), lines.count - 1)
        func score(_ index: Int) -> Int {
            let present = Set(MarkText.words(inSource: lines[index]))
            return words.filter(present.contains).count
        }
        let candidates = max(0, center - creationSearchRadius)...min(lines.count - 1, center + creationSearchRadius)
        let best = candidates.max { lhs, rhs in
            let (left, right) = (score(lhs), score(rhs))
            return left != right ? left < right : abs(lhs - center) > abs(rhs - center)
        } ?? center
        return score(best) > score(center) ? best + 1 : center + 1
    }

    /// Die Zeile (1-basiert), zu der der Anker jetzt gehört; `nil`, wenn sie sich nicht mehr finden lässt (verwaist)
    static func locate(_ anchor: MarkAnchor, in lines: [String]) -> Int? {
        guard !lines.isEmpty else { return nil }
        let start = anchor.line - 1
        let exact = lines.indices.filter { trimmed(lines, $0) == anchor.text }
        if !anchor.text.isEmpty, !exact.isEmpty {
            return exact.max { contextScore(anchor, lines, $0, start) < contextScore(anchor, lines, $1, start) }.map { $0 + 1 }
        }
        return similarLine(to: anchor, in: lines, near: start)
    }

    private static func similarLine(to anchor: MarkAnchor, in lines: [String], near start: Int) -> Int? {
        let wanted = MarkText.words(inSource: anchor.text)
        guard wanted.count >= minimumFuzzyWords else { return nil }
        var best: (index: Int, score: Double)?
        for index in lines.indices {
            let similarity = similarity(wanted, MarkText.words(inSource: lines[index]))
            guard similarity >= similarityThreshold else { continue }
            let score = similarity + contextBonusScore(anchor, lines, index)
            if best == nil || score > best!.score || (score == best!.score && abs(index - start) < abs(best!.index - start)) {
                best = (index, score)
            }
        }
        return best.map { $0.index + 1 }
    }

    /// Mehr Übereinstimmung mit den Nachbarzeilen gewinnt, bei Gleichstand die Zeile näher an der alten Stelle
    private static func contextScore(_ anchor: MarkAnchor, _ lines: [String], _ index: Int, _ start: Int) -> Double {
        contextBonusScore(anchor, lines, index) * 1000 - Double(abs(index - start))
    }

    private static func contextBonusScore(_ anchor: MarkAnchor, _ lines: [String], _ index: Int) -> Double {
        var score = 0.0
        if trimmed(lines, index - 1) == anchor.before { score += contextBonus }
        if trimmed(lines, index + 1) == anchor.after { score += contextBonus }
        return score
    }

    /// 2·LCS/(a+b) über die Wörter: 1 = gleich, 0 = nichts gemeinsam
    static func similarity(_ lhs: [String], _ rhs: [String]) -> Double {
        guard !lhs.isEmpty, !rhs.isEmpty else { return 0 }
        var previous = [Int](repeating: 0, count: rhs.count + 1)
        for left in lhs {
            var current = [Int](repeating: 0, count: rhs.count + 1)
            for (column, right) in rhs.enumerated() {
                current[column + 1] = left == right ? previous[column] + 1 : max(previous[column + 1], current[column])
            }
            previous = current
        }
        return 2 * Double(previous[rhs.count]) / Double(lhs.count + rhs.count)
    }

    private static func trimmed(_ lines: [String], _ index: Int) -> String {
        lines.indices.contains(index) ? lines[index].trimmingCharacters(in: .whitespacesAndNewlines) : ""
    }
}
