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
struct MarkAnchor: Codable, Hashable, Sendable {
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
    static func locate(_ anchor: MarkAnchor, in lines: [String], isStart: Bool = true) -> Int? {
        locate(anchor, in: MarkSourceLines(lines), isStart: isStart)
    }

    /// Erst die gleiche Zeile, dann eine ähnliche, zuletzt der Text verteilt über mehrere Zeilen (`rewrappedLine`).
    /// `isStart` (Anfang oder Ende der Markierung) zählt nur dort: Es entscheidet, welche der Zeilen gemeint ist.
    static func locate(_ anchor: MarkAnchor, in source: MarkSourceLines, isStart: Bool = true) -> Int? {
        guard !source.lines.isEmpty else { return nil }
        let start = anchor.line - 1
        let exact = anchor.text.isEmpty ? [] : source.lines(withTrimmedText: anchor.text)
        if !exact.isEmpty {
            return exact.max { contextScore(anchor, source, $0, start) < contextScore(anchor, source, $1, start) }.map { $0 + 1 }
        }
        return similarLine(to: anchor, in: source, near: start) ?? rewrappedLine(to: anchor, in: source, near: start, isStart: isStart)
    }

    /// Die ähnlichste einzelne Zeile (Ähnlichkeit ab `similarityThreshold`). Zeilen, die die Schwelle schon nach Wortzahl
    /// oder gemeinsamen Wörtern nicht erreichen können, überspringt sie ohne die teure Teilfolge (das Ergebnis bleibt gleich).
    private static func similarLine(to anchor: MarkAnchor, in source: MarkSourceLines, near start: Int) -> Int? {
        let words = MarkText.words(inSource: anchor.text)
        guard words.count >= minimumFuzzyWords else { return nil }
        let wanted = source.wordIDs(of: words)
        var counts = AnchorWordCounts(wanted, vocabularySize: source.vocabularySize)
        var best: (index: Int, score: Double)?
        for (index, line) in source.lineWordIDs.enumerated() {
            let total = wanted.count + line.count
            guard ratio(min(wanted.count, line.count), total) >= similarityThreshold,
                  ratio(counts.commonWords(with: line), total) >= similarityThreshold else { continue }
            let similarity = ratio(commonSubsequenceLength(wanted, line), total)
            guard similarity >= similarityThreshold else { continue }
            let score = similarity + contextBonusScore(anchor, source, index)
            if best == nil || score > best!.score || (score == best!.score && abs(index - start) < abs(best!.index - start)) {
                best = (index, score)
            }
        }
        return best.map { $0.index + 1 }
    }

    /// Mehr Übereinstimmung mit den Nachbarzeilen gewinnt, bei Gleichstand die Zeile näher an der alten Stelle
    private static func contextScore(_ anchor: MarkAnchor, _ source: MarkSourceLines, _ index: Int, _ start: Int) -> Double {
        contextBonusScore(anchor, source, index) * 1000 - Double(abs(index - start))
    }

    private static func contextBonusScore(_ anchor: MarkAnchor, _ source: MarkSourceLines, _ index: Int) -> Double {
        var score = 0.0
        if source.trimmedLine(index - 1) == anchor.before { score += contextBonus }
        if source.trimmedLine(index + 1) == anchor.after { score += contextBonus }
        return score
    }

    /// 2·common/total wie in `similarity`; `total` ist die Summe beider Wortzahlen
    private static func ratio(_ common: Int, _ total: Int) -> Double {
        2 * Double(common) / Double(total)
    }

    /// Länge der längsten gemeinsamen Teilfolge zweier Wortfolgen (als Kennungen aus `MarkSourceLines`)
    private static func commonSubsequenceLength(_ lhs: [Int], _ rhs: [Int]) -> Int {
        var previous = [Int](repeating: 0, count: rhs.count + 1)
        var current = previous
        for left in lhs {
            for column in rhs.indices {
                current[column + 1] = left == rhs[column] ? previous[column] + 1 : max(previous[column + 1], current[column])
            }
            swap(&previous, &current)
        }
        return previous[rhs.count]
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

/// Wie oft jedes Wort des Ankers vorkommt (je Kennung). Die gemeinsamen Wörter mit einer Zeile (mit Vielfachheit) sind eine
/// obere Schranke der gemeinsamen Teilfolge: Erreicht schon sie die Schwelle nicht, braucht die Zeile keinen Vergleich.
private struct AnchorWordCounts {
    private var counts: [Int]
    private var taken: [Int]
    private var touched: [Int] = []

    init(_ wanted: [Int], vocabularySize: Int) {
        counts = Array(repeating: 0, count: vocabularySize)
        taken = counts
        for id in wanted where id != MarkSourceLines.unknownWordID { counts[id] += 1 }
    }

    mutating func commonWords(with line: [Int]) -> Int {
        var common = 0
        for id in line where taken[id] < counts[id] {
            taken[id] += 1
            touched.append(id)
            common += 1
        }
        for id in touched { taken[id] = 0 }
        touched.removeAll(keepingCapacity: true)
        return common
    }
}

/// Die Zeilen einer Datei mit ihren Wörtern (`MarkText.words(inSource:)`), je Zeile erst bei Bedarf zerlegt und dann behalten:
/// Beim Zuordnen vieler Markierungen derselben Datei zerlegte sonst jeder unscharf gesuchte Anker alle Zeilen neu.
/// Dazu, einmal für alle Zeilen: die Wörter als Zahlen (gleiches Wort, gleiche Kennung), die Zeilen ohne Leerraum am Rand
/// und je solchem Zeilentext seine Zeilen. So vergleicht die Suche je Anker Zahlen statt Strings.
final class MarkSourceLines {
    /// Kennung eines Ankerworts, das in keiner Zeile vorkommt: gleicht keiner Kennung einer Zeile (die sind alle ≥ 0)
    static let unknownWordID = -1

    let lines: [String]
    private var cachedWords: [[String]?]
    private var vocabulary: [String: Int] = [:]
    private var cachedWordIDs: [[Int]]?
    private var cachedTrimmed: [String]?
    private var cachedLinesByText: [String: [Int]]?

    init(_ lines: [String]) {
        self.lines = lines
        cachedWords = Array(repeating: nil, count: lines.count)
    }

    func words(at index: Int) -> [String] {
        if let known = cachedWords[index] { return known }
        let computed = MarkText.words(inSource: lines[index])
        cachedWords[index] = computed
        return computed
    }

    /// Die Wörter jeder Zeile als Kennungen
    var lineWordIDs: [[Int]] {
        if let known = cachedWordIDs { return known }
        let computed = lines.indices.map { index in words(at: index).map { wordID(of: $0) } }
        cachedWordIDs = computed
        return computed
    }

    /// Anzahl verschiedener Wörter der Datei; jede Kennung einer Zeile ist kleiner
    var vocabularySize: Int {
        _ = lineWordIDs
        return vocabulary.count
    }

    /// Die Kennungen fremder Wörter (Anker); nicht vorkommende werden `unknownWordID`
    func wordIDs(of words: [String]) -> [Int] {
        _ = lineWordIDs
        return words.map { vocabulary[$0] ?? Self.unknownWordID }
    }

    /// Die Zeile ohne Leerraum am Rand; außerhalb der Datei leer
    func trimmedLine(_ index: Int) -> String {
        guard lines.indices.contains(index) else { return "" }
        if let known = cachedTrimmed { return known[index] }
        let computed = lines.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        cachedTrimmed = computed
        return computed[index]
    }

    /// Die Zeilen (aufsteigend), deren Text ohne Leerraum am Rand genau `text` ist
    func lines(withTrimmedText text: String) -> [Int] {
        if let known = cachedLinesByText { return known[text] ?? [] }
        let computed = Dictionary(grouping: lines.indices) { trimmedLine($0) }
        cachedLinesByText = computed
        return computed[text] ?? []
    }

    private func wordID(of word: String) -> Int {
        if let known = vocabulary[word] { return known }
        let id = vocabulary.count
        vocabulary[word] = id
        return id
    }
}

// MARK: Neu umbrochener Absatz

extension MarkAnchorLocator {
    /// Über so viele aufeinanderfolgende Zeilen darf der Text des Ankers nach einem neuen Umbruch verteilt sein
    static let maximumRewrapLines = 4
    /// So viele Stellen (die nächsten zur alten Zeile zuerst) vergleicht der Rückfall je Anker höchstens
    static let maximumRewrapCandidates = 64
    /// Von einem langen Anker zählen nur so viele Wörter (beim Anfang die ersten, beim Ende die letzten)
    private static let maximumRewrapWords = 40
    /// Ein verglichenes Stück ist höchstens so viel Mal so lang wie der Anker (in Wörtern)
    private static let maximumSpanFactor = 2
    /// Ein Stück beginnt mit dem ersten Wortpaar des Ankers oder, ist dessen erstes Wort geändert, mit dem zweiten
    private static let rewrapStartPairs = 2
    /// Ohne bestätigende Nachbarzeile zählt ein Stück erst ab so vielen gemeinsamen Wörtern: Zwei Wörter am Stück („der
    /// Arbeit“, „\item die Daten“, „1 & 2“) stehen sonst an vielen fremden Stellen. Mehr als drei verlöre den Endanker
    /// „Vorlage der Hochschule.“ nach einem neuen Umbruch.
    private static let minimumRewrapWordsWithoutContext = 3

    private struct SpanWord {
        let word: String
        let line: Int
    }

    private struct SpanMatch {
        let words: [SpanWord]
        let score: Double
    }

    /// Rückfall, wenn keine einzelne Zeile passt: Der Absatz ist neu umbrochen oder die Zeile hinten verändert. Verglichen
    /// werden Stücke aus bis zu `maximumRewrapLines` Zeilen (nicht über eine Leerzeile), die mit einem Wortpaar vom Anfang des
    /// Ankers beginnen. Ergebnis: beim Anfang die Zeile, in der die Markierung jetzt beginnt, beim Ende die, in der sie endet.
    private static func rewrappedLine(to anchor: MarkAnchor, in source: MarkSourceLines, near start: Int, isStart: Bool) -> Int? {
        let all = MarkText.words(inSource: anchor.text)
        let wanted = isStart ? Array(all.prefix(maximumRewrapWords)) : Array(all.suffix(maximumRewrapWords))
        guard wanted.count >= minimumFuzzyWords else { return nil }
        let center = min(max(start, 0), source.lines.count - 1)
        var best: SpanMatch?
        // Die Kandidaten kommen nach Nähe zur alten Zeile: Bei gleichem Wert bleibt der nähere
        for candidate in rewrapCandidates(for: wanted, in: source, near: center) {
            let span = spanWords(from: candidate, limit: wanted.count * maximumSpanFactor, in: source)
            guard let match = bestMatch(of: wanted, in: span, anchor: anchor, source: source) else { continue }
            if match.score > best?.score ?? 0 { best = match }
        }
        return best.map { line(of: $0, for: anchor, isStart: isStart) + 1 }
    }

    /// Kam `text` (die von `locate` gefundene Zeile) aus dem Rückfall? Die genaue Suche liefert dieselbe Zeile, die ähnliche
    /// eine ab `similarityThreshold`; greift der Rückfall, war keine Zeile so ähnlich, also auch die gefundene nicht.
    static func isRewrapMatch(_ anchor: MarkAnchor, line text: String) -> Bool {
        guard text != anchor.text else { return false }
        return similarity(MarkText.words(inSource: anchor.text), MarkText.words(inSource: text)) < similarityThreshold
    }

    /// Stellen (Zeile, Wort), an denen ein Wortpaar vom Anfang des Ankers steht, die nächsten zur alten Zeile zuerst
    private static func rewrapCandidates(for wanted: [String], in source: MarkSourceLines, near center: Int) -> [(line: Int, offset: Int)] {
        let ids = source.wordIDs(of: wanted)
        let pairs = (0..<min(rewrapStartPairs, ids.count - 1)).map { (first: ids[$0], second: ids[$0 + 1]) }
        let lineIDs = source.lineWordIDs
        var result: [(line: Int, offset: Int)] = []
        for index in linesByDistance(from: center, count: source.lines.count) {
            let words = lineIDs[index]
            for offset in words.indices where pairs.contains(where: { $0.first == words[offset] }) {
                let next = nextWordID(after: index, offset, in: lineIDs, source)
                guard pairs.contains(where: { $0.first == words[offset] && $0.second == next }) else { continue }
                result.append((index, offset))
                if result.count == maximumRewrapCandidates { return result }
            }
        }
        return result
    }

    /// Zeilenindizes nach Abstand zu `center`; bei gleichem Abstand die frühere zuerst (wie `similarLine`)
    private static func linesByDistance(from center: Int, count: Int) -> [Int] {
        var order = [center]
        for distance in 1..<max(count, 1) {
            let (above, below) = (center - distance, center + distance)
            guard above >= 0 || below < count else { break }
            if above >= 0 { order.append(above) }
            if below < count { order.append(below) }
        }
        return order
    }

    /// Das Wort nach dem an `offset`, am Zeilenende das erste der nächsten Zeile (nicht über eine Leerzeile)
    private static func nextWordID(after line: Int, _ offset: Int, in lineIDs: [[Int]], _ source: MarkSourceLines) -> Int? {
        let words = lineIDs[line]
        if offset + 1 < words.count { return words[offset + 1] }
        guard line + 1 < lineIDs.count, !isBlank(source, line + 1) else { return nil }
        return lineIDs[line + 1].first
    }

    /// Die Wörter ab der Stelle, über höchstens `maximumRewrapLines` Zeilen und bis zur nächsten Leerzeile (Absatzende)
    private static func spanWords(from candidate: (line: Int, offset: Int), limit: Int, in source: MarkSourceLines) -> [SpanWord] {
        var result: [SpanWord] = []
        for index in candidate.line..<min(candidate.line + maximumRewrapLines, source.lines.count) {
            if index > candidate.line, isBlank(source, index) { break }
            for word in source.words(at: index).dropFirst(index == candidate.line ? candidate.offset : 0) {
                result.append(SpanWord(word: word, line: index))
                if result.count == limit { return result }
            }
        }
        return result
    }

    /// Das beste Anfangsstück von `span`: je Ende die längste gemeinsame Teilfolge mit dem Anker, bewertet wie `similarity`,
    /// nur zählt ein kürzeres Stück wie eines in Ankerlänge (fehlende Wörter kosten, ein angehängter Satz nicht). Dazu kommen
    /// die Nachbarzeilen, damit ein kurzer Anker mit einem geänderten Wort noch gefunden wird; mit weniger als
    /// `minimumRewrapWordsWithoutContext` gemeinsamen Wörtern zählt ein Stück nur mit passender Nachbarzeile.
    private static func bestMatch(of wanted: [String], in span: [SpanWord], anchor: MarkAnchor, source: MarkSourceLines) -> SpanMatch? {
        let present = Set(wanted)
        var previous = [Int](repeating: 0, count: wanted.count + 1)
        var current = previous
        var best: SpanMatch?
        for (end, token) in span.enumerated() {
            for (row, word) in wanted.enumerated() {
                current[row + 1] = word == token.word ? previous[row] + 1 : max(previous[row + 1], current[row])
            }
            swap(&previous, &current)
            let common = previous[wanted.count]
            guard common >= minimumFuzzyWords, present.contains(token.word) else { continue }
            let length = max(end + 1, wanted.count)
            let similarity = 2 * Double(common) / Double(wanted.count + length)
            let context = spanContextBonus(anchor, source, first: span[0].line, last: token.line)
            guard common >= minimumRewrapWordsWithoutContext || context > 0 else { continue }
            let score = similarity + context
            if score >= similarityThreshold, score > best?.score ?? 0 { best = SpanMatch(words: Array(span[...end]), score: score) }
        }
        return best
    }

    /// Wie `contextBonusScore`, aber nur nicht leere Nachbarzeilen zählen: Eine Leerzeile steht vor und nach fast jedem Absatz
    private static func spanContextBonus(_ anchor: MarkAnchor, _ source: MarkSourceLines, first: Int, last: Int) -> Double {
        var score = 0.0
        if !anchor.before.isEmpty, source.trimmedLine(first - 1) == anchor.before { score += contextBonus }
        if !anchor.after.isEmpty, source.trimmedLine(last + 1) == anchor.after { score += contextBonus }
        return score
    }

    /// Die Zeile mit den gemerkten Wörtern der Markierung (Anfang: erster Treffer, Ende: letzter), sonst Anfang bzw. Ende des Stücks
    private static func line(of match: SpanMatch, for anchor: MarkAnchor, isStart: Bool) -> Int {
        let words = match.words.map(\.word)
        let count = anchor.words.count
        let hits: [Int] = count == 0 || count > words.count
            ? [] : (0...(words.count - count)).filter { words[$0..<($0 + count)].elementsEqual(anchor.words) }
        if let hit = isStart ? hits.first : hits.last { return match.words[isStart ? hit : hit + count - 1].line }
        return isStart ? match.words[0].line : match.words[match.words.count - 1].line
    }

    private static func isBlank(_ source: MarkSourceLines, _ index: Int) -> Bool {
        source.trimmedLine(index).isEmpty
    }
}
