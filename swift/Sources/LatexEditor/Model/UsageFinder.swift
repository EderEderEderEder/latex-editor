import Foundation

/// Eine Stelle, an der ein Label, eine Quelle, eine Abkürzung, ein Befehl oder eine Umgebung vorkommt.
struct UsageEntry: Identifiable, Equatable, Sendable {
    let file: URL
    /// 1-basiert
    let line: Int
    /// Die Zeile, getrimmt und gekürzt
    let excerpt: String
    let isDefinition: Bool
    /// Stelle des Treffers im Auszug (UTF-16), zum Hervorheben
    let matchInExcerpt: NSRange?
    /// Laufende Nummer der Stelle in der Zeile (mehrere Treffer in einer Zeile sind getrennte Einträge)
    let index: Int

    var id: String { "\(file.path):\(line):\(index)" }
}

/// Findet die Verwendungen eines Namens in einem Text (Grundlage der Liste „Verwendungen anzeigen“).
enum UsageFinder {
    static let maximumExcerptLength = 140
    private static let leadingContext = 40

    private static let commandDefinition = try! NSRegularExpression(
        pattern: #"\\(?:re)?newcommand|\\providecommand|\\DeclareRobustCommand|\\(?:New|Renew|Provide|Declare)DocumentCommand|\\[gex]?def\b"#)
    private static let environmentDefinition = try! NSRegularExpression(
        pattern: #"\\(?:re)?newenvironment|\\(?:New|Renew|Provide)DocumentEnvironment|\\NewEnviron"#)

    static func usages(of subject: RenameSubject, in text: String, url: URL) -> [UsageEntry] {
        let isBibliography = FileKind(url: url) == .bib
        let ranges = Renamer.occurrences(of: subject, in: text, isBibliography: isBibliography)
        guard !ranges.isEmpty else { return [] }
        let source = text as NSString
        let lines = LineIndex(text: source)
        let definitions = definitionLocations(of: subject, in: text, isBibliography: isBibliography)
        var perLine: [Int: Int] = [:]
        return ranges.sorted { $0.location < $1.location }.map { range in
            let line = lines.line(containing: range.location)
            let number = perLine[line, default: 0]
            perLine[line] = number + 1
            let (excerpt, match) = excerpt(of: lines.contentRange(ofLine: line), matching: range, in: source)
            let isDefinition = definitions.contains(range.location) || isDefinitionLine(excerpt, kind: subject.kind)
            return UsageEntry(file: url, line: line + 1, excerpt: excerpt, isDefinition: isDefinition, matchInExcerpt: match, index: number)
        }
    }

    /// Wo der Name definiert wird, soweit der Scanner es unterscheiden kann (Label, Abkürzung, Eintrag in der .bib)
    private static func definitionLocations(of subject: RenameSubject, in text: String, isBibliography: Bool) -> Set<Int> {
        switch subject.kind {
        case .label:
            return Set(LatexReferences.scan(text).filter { $0.kind == .labelDefinition && $0.key == subject.name }.map(\.range.location))
        case .acronym:
            return Set(Acronyms.scan(text).filter { $0.isDefinition && $0.key == subject.name }.map(\.range.location))
        case .citation:
            return isBibliography ? Set(Renamer.occurrences(of: subject, in: text, isBibliography: true).map(\.location)) : []
        case .command, .environment:
            return []
        }
    }

    private static func isDefinitionLine(_ line: String, kind: RenameSubject.Kind) -> Bool {
        let expression: NSRegularExpression
        switch kind {
        case .command: expression = commandDefinition
        case .environment: expression = environmentDefinition
        default: return false
        }
        return expression.firstMatch(in: line, range: NSRange(location: 0, length: (line as NSString).length)) != nil
    }

    /// Die Zeile ohne Einrückung; ist sie lang, ein Ausschnitt um den Treffer
    private static func excerpt(of lineRange: NSRange, matching match: NSRange, in text: NSString) -> (String, NSRange?) {
        var start = lineRange.location
        let end = NSMaxRange(lineRange)
        while start < end, [0x20, 0x09].contains(text.character(at: start)) { start += 1 }
        var shownStart = start
        var shownEnd = min(end, start + maximumExcerptLength)
        if NSMaxRange(match) > shownEnd {
            shownStart = max(start, match.location - leadingContext)
            shownEnd = min(end, shownStart + maximumExcerptLength)
        }
        var result = text.substring(with: NSRange(location: shownStart, length: shownEnd - shownStart))
        var prefix = 0
        if shownStart > start { result = "…" + result; prefix = 1 }
        if shownEnd < end { result += "…" }
        let local = NSRange(location: match.location - shownStart + prefix, length: match.length)
        let inside = local.location >= 0 && NSMaxRange(local) <= (result as NSString).length
        return (result, inside ? local : nil)
    }
}
