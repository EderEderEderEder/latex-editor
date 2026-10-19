import Foundation

/// Teil einer Diff-Zeile; `isChanged` markiert geänderte Wörter innerhalb einer geänderten Zeile.
struct DiffSegment: Equatable, Sendable {
    let text: String
    let isChanged: Bool
}

struct DiffLine: Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case context
        case removed
        case added
    }

    let kind: Kind
    /// 1-basiert; `nil` bei hinzugefügten Zeilen
    let oldNumber: Int?
    /// 1-basiert; `nil` bei entfernten Zeilen
    let newNumber: Int?
    var segments: [DiffSegment]

    var text: String { segments.map(\.text).joined() }
}

/// Zeilen-Diff mit Wort-Hervorhebung. Reine Logik: aus den Zeilen lässt sich der alte bzw. neue Text
/// exakt wiederherstellen (bis auf den abschließenden Zeilenumbruch).
enum LineDiff {
    /// Mehr Bearbeitungsschritte rechnet Myers nicht; danach gilt der Rest als ersetzt (Speicher O(D²)).
    static let maximumLineEdits = 2_000
    static let maximumWordEdits = 400
    /// Mindestanteil gemeinsamer Zeichen, damit zwei Zeilen als „dieselbe Zeile, geändert“ gelten
    static let minimumSimilarity = 0.3

    /// `highlightingWords: false` spart die Wort-Hervorhebung (z. B. für die Änderungsmarken im Editor).
    static func compute(old: String, new: String, highlightingWords: Bool = true) -> [DiffLine] {
        let oldLines = splitLines(old)
        let newLines = splitLines(new)
        let script = editScript(oldLines.map { Substring($0) }, newLines.map { Substring($0) }, maxEdits: maximumLineEdits)
        var lines = buildLines(old: oldLines, new: newLines, removed: script.removed, inserted: script.inserted)
        if highlightingWords { highlightWords(in: &lines) }
        return lines
    }

    /// Zeilen ohne Trenner. Ein abschließender Zeilenumbruch erzeugt keine leere letzte Zeile; `\r\n` zählt als ein Umbruch.
    static func splitLines(_ text: String) -> [String] {
        // Über UTF-8 statt über Zeichen: `\r\n` wäre ein einziges Graphem, und Grapheme sind langsam.
        let newline = UInt8(ascii: "\n"), carriageReturn = UInt8(ascii: "\r")
        guard !text.isEmpty else { return [] }
        var lines = text.utf8.split(separator: newline, omittingEmptySubsequences: false).map { bytes in
            let content = bytes.last == carriageReturn ? bytes.dropLast() : bytes[...]
            return String(Substring(content))
        }
        if text.utf8.last == newline { lines.removeLast() }
        return lines
    }

    // MARK: Bearbeitungsskript

    /// Welche Elemente aus `old` entfernt und welche in `new` eingefügt werden.
    struct EditScript: Equatable {
        var removed: [Bool]
        var inserted: [Bool]
    }

    /// Kürzestes Bearbeitungsskript. Gemeinsamer Anfang und Ende sowie Elemente ohne Gegenstück auf der
    /// anderen Seite werden vorab abgetrennt; das verkleinert Myers in der Praxis drastisch.
    static func editScript<Element: Hashable>(_ old: [Element], _ new: [Element], maxEdits: Int) -> EditScript {
        var script = EditScript(removed: Array(repeating: false, count: old.count), inserted: Array(repeating: false, count: new.count))
        let prefix = zip(old, new).prefix { $0 == $1 }.count
        let maxSuffix = min(old.count, new.count) - prefix
        var suffix = 0
        while suffix < maxSuffix, old[old.count - 1 - suffix] == new[new.count - 1 - suffix] { suffix += 1 }
        let oldRange = prefix..<(old.count - suffix)
        let newRange = prefix..<(new.count - suffix)

        let oldSet = Set(old[oldRange])
        let newSet = Set(new[newRange])
        let oldCandidates = oldRange.filter { newSet.contains(old[$0]) }
        let newCandidates = newRange.filter { oldSet.contains(new[$0]) }
        for index in oldRange { script.removed[index] = true }
        for index in newRange { script.inserted[index] = true }

        let matched = myers(oldCandidates.map { old[$0] }, newCandidates.map { new[$0] }, maxEdits: maxEdits)
        for (oldIndex, newIndex) in matched {
            script.removed[oldCandidates[oldIndex]] = false
            script.inserted[newCandidates[newIndex]] = false
        }
        return script
    }

    /// Myers O(ND): liefert die Paare gleicher Elemente (Indizes in `a` und `b`) einer längsten gemeinsamen
    /// Teilfolge. Überschreitet D `maxEdits`, gibt es keine Paare (alles gilt als ersetzt).
    private static func myers<Element: Equatable>(_ a: [Element], _ b: [Element], maxEdits: Int) -> [(Int, Int)] {
        let n = a.count, m = b.count
        guard n > 0, m > 0 else { return [] }
        let limit = min(n + m, maxEdits)
        let offset = limit + 1
        var v = [Int](repeating: 0, count: 2 * limit + 3)
        var trace: [[Int]] = []
        for d in 0...limit {
            trace.append(Array(v[(offset - d - 1)...(offset + d + 1)]))
            for k in stride(from: -d, through: d, by: 2) {
                let goesDown = k == -d || (k != d && v[offset + k - 1] < v[offset + k + 1])
                var x = goesDown ? v[offset + k + 1] : v[offset + k - 1] + 1
                var y = x - k
                while x < n, y < m, a[x] == b[y] {
                    x += 1
                    y += 1
                }
                v[offset + k] = x
                if x >= n, y >= m { return backtrack(trace: trace, n: n, m: m) }
            }
        }
        return []
    }

    /// Geht den Pfad rückwärts und sammelt die Diagonalen (gleiche Elemente). `trace[d]` ist der Stand
    /// vor Schritt d für die Diagonalen −(d+1)…d+1.
    private static func backtrack(trace: [[Int]], n: Int, m: Int) -> [(Int, Int)] {
        var pairs: [(Int, Int)] = []
        var x = n, y = m
        for d in stride(from: trace.count - 1, through: 0, by: -1) {
            let snapshot = trace[d]
            let value = { (diagonal: Int) in snapshot[diagonal + d + 1] }
            let k = x - y
            let goesDown = k == -d || (k != d && value(k - 1) < value(k + 1))
            let previousK = goesDown ? k + 1 : k - 1
            let previousX = value(previousK)
            let previousY = previousX - previousK
            while x > previousX, y > previousY {
                x -= 1
                y -= 1
                pairs.append((x, y))
            }
            x = previousX
            y = previousY
        }
        return pairs.reversed()
    }

    // MARK: Zeilen zusammensetzen

    private static func buildLines(old: [String], new: [String], removed: [Bool], inserted: [Bool]) -> [DiffLine] {
        var lines: [DiffLine] = []
        lines.reserveCapacity(max(old.count, new.count))
        var i = 0, j = 0
        while i < old.count || j < new.count {
            if i < old.count, removed[i] {
                lines.append(DiffLine(kind: .removed, oldNumber: i + 1, newNumber: nil, segments: [DiffSegment(text: old[i], isChanged: false)]))
                i += 1
            } else if j < new.count, inserted[j] {
                lines.append(DiffLine(kind: .added, oldNumber: nil, newNumber: j + 1, segments: [DiffSegment(text: new[j], isChanged: false)]))
                j += 1
            } else {
                lines.append(DiffLine(kind: .context, oldNumber: i + 1, newNumber: j + 1, segments: [DiffSegment(text: new[j], isChanged: false)]))
                i += 1
                j += 1
            }
        }
        return lines
    }

    // MARK: Wörter

    /// Paart in jedem Änderungsblock die k-te entfernte mit der k-ten hinzugefügten Zeile und markiert
    /// die geänderten Wörter, wenn sich die Zeilen ähnlich genug sind.
    private static func highlightWords(in lines: inout [DiffLine]) {
        var index = 0
        while index < lines.count {
            guard lines[index].kind != .context else {
                index += 1
                continue
            }
            let removedStart = index
            while index < lines.count, lines[index].kind == .removed { index += 1 }
            let addedStart = index
            while index < lines.count, lines[index].kind == .added { index += 1 }
            let pairCount = min(addedStart - removedStart, index - addedStart)
            for offset in 0..<pairCount {
                highlightPair(in: &lines, removed: removedStart + offset, added: addedStart + offset)
            }
        }
    }

    private static func highlightPair(in lines: inout [DiffLine], removed: Int, added: Int) {
        let oldTokens = tokenize(lines[removed].text)
        let newTokens = tokenize(lines[added].text)
        let script = editScript(oldTokens, newTokens, maxEdits: maximumWordEdits)
        // Längen in Unicode-Skalaren: Grapheme zu zählen wäre bei langen Absätzen merklich langsamer.
        let common = zip(oldTokens, script.removed).reduce(0) { $0 + ($1.1 ? 0 : $1.0.unicodeScalars.count) }
        let longest = max(oldTokens.reduce(0) { $0 + $1.unicodeScalars.count }, newTokens.reduce(0) { $0 + $1.unicodeScalars.count })
        guard longest > 0, Double(common) / Double(longest) >= minimumSimilarity else { return }
        lines[removed].segments = segments(oldTokens, changed: script.removed)
        lines[added].segments = segments(newTokens, changed: script.inserted)
    }

    /// Fasst benachbarte Tokens gleichen Zustands zusammen.
    private static func segments(_ tokens: [Substring], changed: [Bool]) -> [DiffSegment] {
        var result: [DiffSegment] = []
        var buffer = ""
        var bufferChanged = false
        for (token, isChanged) in zip(tokens, changed) {
            if isChanged != bufferChanged, !buffer.isEmpty {
                result.append(DiffSegment(text: buffer, isChanged: bufferChanged))
                buffer = ""
            }
            buffer += token
            bufferChanged = isChanged
        }
        if !buffer.isEmpty { result.append(DiffSegment(text: buffer, isChanged: bufferChanged)) }
        return result
    }

    /// Wörter (Buchstaben und Ziffern), LaTeX-Befehle (`\section`), Leerraum und einzelne Satzzeichen.
    /// Arbeitet auf Unicode-Skalaren (deutlich schneller als Grapheme); kombinierende Zeichen gehören zum Wort.
    static func tokenize(_ text: String) -> [Substring] {
        let scalars = text.unicodeScalars
        var tokens: [Substring] = []
        var index = scalars.startIndex
        while index < scalars.endIndex {
            let end = tokenEnd(in: scalars, from: index)
            tokens.append(text[index..<end])
            index = end
        }
        return tokens
    }

    private static func tokenEnd(in scalars: String.UnicodeScalarView, from start: String.Index) -> String.Index {
        let first = scalars[start]
        var index = scalars.index(after: start)
        let sameClass: (Unicode.Scalar) -> Bool
        if first == "\\" {
            sameClass = { $0.properties.isAlphabetic }
        } else if isWordCharacter(first) {
            sameClass = isWordCharacter
        } else if first.properties.isWhitespace {
            sameClass = { $0.properties.isWhitespace }
        } else {
            return index
        }
        while index < scalars.endIndex, sameClass(scalars[index]) { index = scalars.index(after: index) }
        return index
    }

    private static func isWordCharacter(_ scalar: Unicode.Scalar) -> Bool {
        if scalar.isASCII { return ("a"..."z").contains(scalar) || ("A"..."Z").contains(scalar) || ("0"..."9").contains(scalar) }
        let properties = scalar.properties
        switch properties.generalCategory {
        case .nonspacingMark, .spacingMark, .enclosingMark, .decimalNumber: return true
        default: return properties.isAlphabetic
        }
    }
}

/// Was die Diff-Ansicht für eine Datei zeigt.
struct FileDiff: Equatable, Sendable {
    enum Content: Equatable, Sendable {
        case text([DiffLine])
        case binary
        case conflict
        case tooLarge
    }

    /// Größere Dateien werden nicht verglichen (Speicher, Rechenzeit, Darstellung).
    static let maximumBytes = 4 * 1024 * 1024
    /// Git hält Dateien mit NUL in den ersten 8.000 Bytes für binär.
    private static let binaryProbeLength = 8_000

    let content: Content

    var addedCount: Int { lines.count { $0.kind == .added } }
    var removedCount: Int { lines.count { $0.kind == .removed } }

    private var lines: [DiffLine] {
        if case let .text(lines) = content { return lines }
        return []
    }

    /// Vergleicht zwei Dateistände (`nil` = Datei existiert auf dieser Seite nicht).
    static func make(old: Data?, new: Data?, isBinaryKind: Bool) -> FileDiff {
        let oldData = old ?? Data(), newData = new ?? Data()
        if isBinaryKind || isBinary(oldData) || isBinary(newData) { return FileDiff(content: .binary) }
        if oldData.count > maximumBytes || newData.count > maximumBytes { return FileDiff(content: .tooLarge) }
        return FileDiff(content: .text(LineDiff.compute(old: decode(oldData), new: decode(newData))))
    }

    static func isBinary(_ data: Data) -> Bool {
        data.prefix(binaryProbeLength).contains(0)
    }

    /// Wie beim Öffnen im Editor: UTF-8, sonst Latin-1.
    private static func decode(_ data: Data) -> String {
        String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) ?? String(decoding: data, as: UTF8.self)
    }
}

/// Eine sichtbare Zeile der Diff-Ansicht: eine Diff-Zeile oder ein eingeklappter Bereich unveränderter Zeilen.
enum DiffRow: Equatable, Identifiable, Sendable {
    /// Index in den Diff-Zeilen
    case line(Int)
    /// Eingeklappter Bereich; `start` identifiziert ihn beim Aufklappen
    case collapsed(start: Int, count: Int)

    var id: Int {
        switch self {
        case let .line(index): index
        case let .collapsed(start, _): -start - 1
        }
    }
}

/// Klappt unveränderte Bereiche ein, die weiter als `context` Zeilen von einer Änderung entfernt sind.
enum DiffLayout {
    static let contextLines = 3
    /// Kürzere Bereiche bleiben offen, ein „… 1 unveränderte Zeile“ wäre unnötig.
    static let minimumCollapsedLines = 4

    static func rows(for lines: [DiffLine], context: Int = contextLines, expanded: Set<Int> = []) -> [DiffRow] {
        var rows: [DiffRow] = []
        var index = 0
        while index < lines.count {
            guard lines[index].kind == .context else {
                rows.append(.line(index))
                index += 1
                continue
            }
            let start = index
            while index < lines.count, lines[index].kind == .context { index += 1 }
            appendContextRun(start..<index, total: lines.count, context: context, expanded: expanded, to: &rows)
        }
        return rows
    }

    private static func appendContextRun(_ run: Range<Int>, total: Int, context: Int, expanded: Set<Int>, to rows: inout [DiffRow]) {
        let keepBefore = run.lowerBound == 0 ? 0 : context
        let keepAfter = run.upperBound == total ? 0 : context
        let hiddenStart = run.lowerBound + keepBefore
        let hiddenEnd = run.upperBound - keepAfter
        guard hiddenEnd - hiddenStart >= minimumCollapsedLines, !expanded.contains(hiddenStart) else {
            rows += run.map { .line($0) }
            return
        }
        rows += (run.lowerBound..<hiddenStart).map { .line($0) }
        rows.append(.collapsed(start: hiddenStart, count: hiddenEnd - hiddenStart))
        rows += (hiddenEnd..<run.upperBound).map { .line($0) }
    }
}
