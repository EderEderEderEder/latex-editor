import Foundation

struct SearchOptions: Equatable, Sendable {
    var caseSensitive = false
    var wholeWord = false
}

struct SearchHit: Identifiable, Equatable, Sendable {
    let file: URL
    /// 1-basiert
    let line: Int
    /// Treffer im Dateitext (UTF-16)
    let range: NSRange
    /// Der gefundene Text (um beim Ersetzen veraltete Treffer zu erkennen)
    let matchedText: String
    /// Die Zeile, bei langen Zeilen gekürzt um den Treffer
    let excerpt: String
    /// Treffer innerhalb von `excerpt` (UTF-16)
    let excerptRange: NSRange

    var id: String { "\(file.path):\(range.location)" }
}

struct SearchResult: Equatable, Sendable {
    var hits: [SearchHit] = []
    /// Es gab mehr Treffer als angezeigt werden
    var isTruncated = false

    var fileCount: Int { Set(hits.map(\.file)).count }
    /// In Dateireihenfolge gruppiert
    var groups: [(file: URL, hits: [SearchHit])] {
        var order: [URL] = []
        var byFile: [URL: [SearchHit]] = [:]
        for hit in hits {
            if byFile[hit.file] == nil { order.append(hit.file) }
            byFile[hit.file, default: []].append(hit)
        }
        return order.map { ($0, byFile[$0] ?? []) }
    }

    static func == (lhs: SearchResult, rhs: SearchResult) -> Bool {
        lhs.hits == rhs.hits && lhs.isTruncated == rhs.isTruncated
    }
}

/// Suche über Texte (Textsuche, keine regulären Ausdrücke) und Ersetzen in einem Text. Reine Logik.
enum ProjectSearch {
    static let maximumHits = 2_000
    /// So viele Zeichen vor dem Treffer zeigt die Trefferliste höchstens: In der schmalen Seitenleiste soll auch ein
    /// zweiter Treffer weit hinten in der Zeile sichtbar bleiben.
    private static let contextBefore = 24
    private static let maximumExcerptLength = 160

    static func search(_ query: String, options: SearchOptions, in documents: [(url: URL, text: String)]) -> SearchResult {
        var result = SearchResult()
        guard !query.isEmpty else { return result }
        for document in documents {
            let remaining = maximumHits - result.hits.count
            let found = search(query, options: options, in: document.text, file: document.url, limit: remaining + 1)
            result.hits += found.prefix(remaining)
            if found.count > remaining {
                result.isTruncated = true
                break
            }
        }
        return result
    }

    static func search(_ query: String, options: SearchOptions, in text: String, file: URL, limit: Int = maximumHits) -> [SearchHit] {
        let source = text as NSString
        let needle = query as NSString
        guard needle.length > 0, source.length >= needle.length else { return [] }
        var compareOptions: NSString.CompareOptions = [.literal]
        if !options.caseSensitive { compareOptions.insert(.caseInsensitive) }
        var hits: [SearchHit] = []
        var position = 0
        var line = 1
        var lineScanned = 0
        while position <= source.length - needle.length, hits.count < limit {
            let range = source.range(of: query, options: compareOptions, range: NSRange(location: position, length: source.length - position))
            guard range.location != NSNotFound else { break }
            position = range.location + 1
            if options.wholeWord, !isWholeWord(range, in: source) { continue }
            while lineScanned < range.location {
                if source.character(at: lineScanned) == 0x0A { line += 1 }
                lineScanned += 1
            }
            hits.append(makeHit(range, line: line, in: source, file: file))
        }
        return hits
    }

    private static func makeHit(_ range: NSRange, line: Int, in source: NSString, file: URL) -> SearchHit {
        let lineRange = source.lineRange(for: range)
        var content = source.substring(with: lineRange)
        // Zeilenende abschneiden
        while content.hasSuffix("\n") || content.hasSuffix("\r") { content.removeLast() }
        var contentRange = NSRange(location: lineRange.location, length: (content as NSString).length)
        // Einrückung weglassen
        let nsContent = content as NSString
        var leading = 0
        while leading < nsContent.length, nsContent.character(at: leading) == 0x20 || nsContent.character(at: leading) == 0x09 {
            leading += 1
        }
        if leading > 0, leading <= range.location - contentRange.location {
            contentRange = NSRange(location: contentRange.location + leading, length: contentRange.length - leading)
        }
        // Der Auszug beginnt kurz vor dem Treffer, nicht in der Mitte eines Zeichens aus zwei UTF-16-Einheiten
        var start = max(contentRange.location, range.location - contextBefore)
        start = source.rangeOfComposedCharacterSequence(at: start).location
        let end = min(NSMaxRange(contentRange), start + maximumExcerptLength)
        let excerptRange = NSRange(location: max(start, contentRange.location), length: max(0, end - max(start, contentRange.location)))
        var excerpt = source.substring(with: excerptRange)
        var matchStart = range.location - excerptRange.location
        if excerptRange.location > contentRange.location {
            excerpt = "…" + excerpt
            matchStart += 1
        }
        if NSMaxRange(excerptRange) < NSMaxRange(contentRange) { excerpt += "…" }
        return SearchHit(file: file, line: line, range: range, matchedText: source.substring(with: range), excerpt: excerpt,
                         excerptRange: NSRange(location: matchStart, length: range.length))
    }

    private static func isWholeWord(_ range: NSRange, in text: NSString) -> Bool {
        let before = range.location > 0 ? text.character(at: range.location - 1) : nil
        let after = NSMaxRange(range) < text.length ? text.character(at: NSMaxRange(range)) : nil
        return !(before.map(isWordCharacter) ?? false) && !(after.map(isWordCharacter) ?? false)
    }

    private static func isWordCharacter(_ unit: unichar) -> Bool {
        guard let scalar = Unicode.Scalar(unit) else { return true }
        return scalar == "_" || scalar.properties.isAlphabetic || scalar.properties.numericType != nil
    }

    // MARK: Ersetzen

    /// Ersetzt die Treffer im Text und liefert den neuen Text. Treffer, deren Text sich inzwischen geändert hat
    /// (veraltetes Ergebnis), werden übersprungen und nicht mitgezählt.
    static func replace(_ hits: [SearchHit], with replacement: String, in text: String) -> (text: String, applied: Int) {
        let result = NSMutableString(string: text)
        var applied = 0
        for hit in hits.sorted(by: { $0.range.location > $1.range.location }) {
            guard NSMaxRange(hit.range) <= result.length, result.substring(with: hit.range) == hit.matchedText else { continue }
            result.replaceCharacters(in: hit.range, with: replacement)
            applied += 1
        }
        return (result as String, applied)
    }
}
