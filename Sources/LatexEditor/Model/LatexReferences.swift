import Foundation

/// Ein Schlüssel in `\label{…}`, `\ref{…}` oder `\cite{…}`: Art, Name und Lage des Namens im Text.
struct ReferenceOccurrence: Equatable, Sendable {
    enum Kind: Sendable {
        case labelDefinition
        case labelUse
        case citation
    }

    let kind: Kind
    let key: String
    /// Nur der Schlüssel, ohne Befehl und Klammern (UTF-16)
    let range: NSRange
}

/// Findet alle Labels, Verweise und Zitate eines LaTeX-Textes. Kommentare und Code (`verbatim`, `lstlisting` …) zählen nicht.
/// Grundlage für die Prüfung auf unbekannte Schlüssel, für ungenutzte Labels und Quellen, für den ⌘-Klick und das Umbenennen.
enum LatexReferences {
    static let labelUseCommands = [
        "ref", "eqref", "pageref", "autoref", "Autoref", "cref", "Cref", "vref", "Vref", "nameref", "labelcref", "cpageref", "Cpageref",
    ]
    static let citationCommands = [
        "cite", "citep", "citet", "citealp", "citealt", "citeauthor", "citeyear", "citeyearpar", "citetitle", "Cite", "Citep", "Citet",
        "parencite", "Parencite", "textcite", "Textcite", "autocite", "Autocite", "smartcite", "Smartcite", "footcite", "footcitetext",
        "fullcite", "nocite", "supercite",
    ]

    private static let commandExpression: NSRegularExpression = {
        let names = (["label"] + labelUseCommands + citationCommands).sorted { $0.count > $1.count }.joined(separator: "|")
        // Befehl, optional Stern und bis zu zwei [Optionen] (biblatex: Vor- und Nachnote), dann {Schlüsselliste}
        return try! NSRegularExpression(pattern: #"\\("# + names + #")\*?\s*(?:\[[^\]\n]*\]\s*){0,2}\{([^{}]*)\}"#)
    }()
    private static let hyperrefExpression = try! NSRegularExpression(pattern: #"\\hyperref\s*\[([^\]\n]*)\]"#)

    static func scan(_ text: String) -> [ReferenceOccurrence] {
        let masked = LatexMasking.scannable(text) as NSString
        var occurrences: [ReferenceOccurrence] = []
        let whole = NSRange(location: 0, length: masked.length)
        commandExpression.enumerateMatches(in: masked as String, range: whole) { match, _, _ in
            guard let match else { return }
            let name = masked.substring(with: match.range(at: 1))
            let kind: ReferenceOccurrence.Kind = name == "label" ? .labelDefinition
                : labelUseCommands.contains(name) ? .labelUse : .citation
            occurrences += keys(in: match.range(at: 2), of: masked, splitsLists: kind != .labelDefinition, kind: kind)
        }
        hyperrefExpression.enumerateMatches(in: masked as String, range: whole) { match, _, _ in
            guard let match else { return }
            occurrences += keys(in: match.range(at: 1), of: masked, splitsLists: false, kind: .labelUse)
        }
        return occurrences.sorted { $0.range.location < $1.range.location }
    }

    /// Die Schlüssel einer Klammer. `\cite{a, b}` ergibt zwei; `#1` (Makroparameter) und `*` (`\nocite{*}`) fallen weg.
    private static func keys(in group: NSRange, of text: NSString, splitsLists: Bool, kind: ReferenceOccurrence.Kind) -> [ReferenceOccurrence] {
        let raw = text.substring(with: group)
        var result: [ReferenceOccurrence] = []
        var offset = 0
        let parts = splitsLists ? raw.components(separatedBy: ",") : [raw]
        for part in parts {
            defer { offset += (part as NSString).length + 1 }
            let nsPart = part as NSString
            var start = 0
            var end = nsPart.length
            while start < end, isSpace(nsPart.character(at: start)) { start += 1 }
            while end > start, isSpace(nsPart.character(at: end - 1)) { end -= 1 }
            guard end > start else { continue }
            let key = nsPart.substring(with: NSRange(location: start, length: end - start))
            guard key != "*", !key.contains("#") else { continue }
            result.append(ReferenceOccurrence(kind: kind, key: key, range: NSRange(location: group.location + offset + start, length: end - start)))
        }
        return result
    }

    private static func isSpace(_ unit: unichar) -> Bool {
        unit == 0x20 || unit == 0x09 || unit == 0x0A || unit == 0x0D
    }

    /// `\nocite{*}`: Alle Quellen der Literaturdatei gelten als benutzt
    static func citesEverything(_ text: String) -> Bool {
        LatexMasking.scannable(text).contains("\\nocite{*}")
    }
}

/// Texte so vorbereiten, dass Befehlssuche nur echte Befehle trifft: Kommentare und Code werden durch Leerzeichen
/// ersetzt (gleiche Länge, damit Bereiche stimmen).
enum LatexMasking {
    private static let beginExpression = try! NSRegularExpression(pattern: #"\\begin\{([A-Za-z*]+)\}"#)
    private static let verbExpression = try! NSRegularExpression(pattern: #"\\verb\*?([^A-Za-z\s*])[^\n]*?\1"#)

    static func scannable(_ text: String) -> String {
        maskingCode(in: ReferenceUpdater.maskingComments(in: text))
    }

    static func maskingCode(in text: String) -> String {
        let result = NSMutableString(string: text)
        var searchStart = 0
        while searchStart < result.length {
            let remaining = NSRange(location: searchStart, length: result.length - searchStart)
            guard let match = beginExpression.firstMatch(in: result as String, range: remaining) else { break }
            let name = result.substring(with: match.range(at: 1))
            let bodyStart = NSMaxRange(match.range)
            guard LatexEnvironments.isCode(name) else {
                searchStart = bodyStart
                continue
            }
            let tail = NSRange(location: bodyStart, length: result.length - bodyStart)
            let end = result.range(of: "\\end{\(name)}", options: [], range: tail)
            let bodyEnd = end.location == NSNotFound ? result.length : end.location
            mask(NSRange(location: bodyStart, length: bodyEnd - bodyStart), in: result)
            searchStart = bodyEnd
        }
        let whole = NSRange(location: 0, length: result.length)
        for match in verbExpression.matches(in: result as String, range: whole) {
            mask(match.range, in: result)
        }
        return result as String
    }

    private static func mask(_ range: NSRange, in text: NSMutableString) {
        guard range.length > 0 else { return }
        text.replaceCharacters(in: range, with: String(repeating: " ", count: range.length))
    }
}

/// Ein Verweis oder Zitat, dessen Schlüssel es im Projekt nicht gibt.
struct ReferenceProblem: Equatable, Sendable {
    enum Kind: Sendable {
        case unknownLabel
        case unknownCitation
    }

    let kind: Kind
    let key: String
    let range: NSRange

    var message: String {
        switch kind {
        case .unknownLabel: "Das Label „\(key)“ ist im Projekt nicht definiert."
        case .unknownCitation: "„\(key)“ steht in keiner Literaturdatei des Projekts."
        }
    }
}

enum ReferenceChecker {
    /// `citations == nil`: Zitate nicht prüfen (keine Literaturdatei mit Einträgen im Projekt, z. B. liegt sie außerhalb)
    static func problems(in text: String, labels: Set<String>, citations: Set<String>?) -> [ReferenceProblem] {
        LatexReferences.scan(text).compactMap { occurrence -> ReferenceProblem? in
            switch occurrence.kind {
            case .labelDefinition:
                return nil
            case .labelUse:
                guard !labels.contains(occurrence.key) else { return nil }
                return ReferenceProblem(kind: .unknownLabel, key: occurrence.key, range: occurrence.range)
            case .citation:
                guard let citations, !citations.contains(occurrence.key) else { return nil }
                return ReferenceProblem(kind: .unknownCitation, key: occurrence.key, range: occurrence.range)
            }
        }
    }
}
