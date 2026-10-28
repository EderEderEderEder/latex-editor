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
        scan(masked: LatexMasking.scannable(text) as NSString)
    }

    /// Auf schon maskiertem Text (`LatexMasking.scannable`), wenn mehrere Prüfungen denselben Text brauchen
    static func scan(masked: NSString) -> [ReferenceOccurrence] {
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

    /// Erst `\verb` (ein `\verb|%|` ist kein Kommentar), dann Kommentare, dann Code-Umgebungen (deren `\begin`
    /// in einem Kommentar zählt nicht).
    static func scannable(_ text: String) -> String {
        maskingCode(in: LatexComments.masking(maskingVerb(in: text)))
    }

    private static func maskingVerb(in text: String) -> String {
        let result = NSMutableString(string: text)
        for match in verbExpression.matches(in: text, range: NSRange(location: 0, length: result.length)) {
            mask(match.range, in: result)
        }
        return result as String
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
        case unknownAcronym
    }

    let kind: Kind
    let key: String
    let range: NSRange

    var message: String {
        switch kind {
        case .unknownLabel: "Das Label „\(key)“ ist im Projekt nicht definiert."
        case .unknownCitation: "„\(key)“ steht in keiner Literaturdatei des Projekts."
        case .unknownAcronym: "Die Abkürzung „\(key)“ ist im Projekt nicht definiert (\\newacronym, \\newglossaryentry …)."
        }
    }
}

enum ReferenceChecker {
    /// `citations == nil`: Zitate nicht prüfen (keine Literaturdatei mit Einträgen im Projekt, z. B. liegt sie außerhalb)
    static func problems(in text: String, labels: Set<String>, citations: Set<String>?, acronyms: Set<String>? = nil) -> [ReferenceProblem] {
        problems(masked: LatexMasking.scannable(text) as NSString, labels: labels, citations: citations, acronyms: acronyms)
    }

    /// `acronyms == nil`: Abkürzungen nicht prüfen (keine Definition im Projekt)
    static func problems(masked: NSString, labels: Set<String>, citations: Set<String>?, acronyms: Set<String>? = nil) -> [ReferenceProblem] {
        let unknownAcronyms = acronyms.map { known in
            Acronyms.scan(masked: masked).filter { !$0.isDefinition && !known.contains($0.key) }
                .map { ReferenceProblem(kind: .unknownAcronym, key: $0.key, range: $0.range) }
        } ?? []
        return unknownAcronyms + LatexReferences.scan(masked: masked).compactMap { occurrence -> ReferenceProblem? in
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

/// Labels, die im Projekt mehr als einmal definiert sind: LaTeX warnt („multiply defined“), und jeder Verweis darauf
/// führt zu einer der beiden Stellen, je nach Reihenfolge.
enum DuplicateLabelChecker {
    /// Nur die mehrfach definierten, mit allen Stellen
    static func duplicates(in labels: [LabelEntry]) -> [String: [LabelEntry]] {
        Dictionary(grouping: labels, by: \.label).filter { $0.value.count > 1 }
    }

    /// Markiert `\label{…}` dieser Datei, deren Name auch anderswo (oder weiter oben) definiert wird.
    static func marks(masked: NSString, file: URL, duplicates: [String: [LabelEntry]]) -> [TextMark] {
        guard !duplicates.isEmpty else { return [] }
        let occurrences = LatexReferences.scan(masked: masked).filter { $0.kind == .labelDefinition && duplicates[$0.key] != nil }
        guard !occurrences.isEmpty else { return [] }
        let lines = LineIndex(text: masked)
        let current = file.standardizedFileURL
        return occurrences.compactMap { occurrence in
            let line = lines.line(containing: occurrence.range.location) + 1
            let others = (duplicates[occurrence.key] ?? []).filter { !($0.file.standardizedFileURL == current && $0.line == line) }
            guard let other = others.first else { return nil }
            let place = other.file.standardizedFileURL == current ? "Zeile \(other.line)" : "\(other.file.lastPathComponent), Zeile \(other.line)"
            let more = others.count > 1 ? " (insgesamt \(others.count + 1) Stellen)" : ""
            return TextMark(severity: .warning, range: occurrence.range,
                            message: "Das Label „\(occurrence.key)“ ist mehrfach definiert, auch in \(place)\(more). Verweise treffen nur eine der Stellen.")
        }
    }
}
