import Foundation

struct LabelEntry: Identifiable, Hashable, Sendable {
    let label: String
    let file: URL
    /// 1-basiert
    let line: Int

    var id: String { label }
}

struct BibEntry: Identifiable, Hashable, Sendable {
    let key: String
    let title: String
    /// Kurzform für Listen: „Mustermann“, „Mustermann und Musterfrau“, „Mustermann u. a.“
    var authors = ""
    var year = ""
    /// Rohwert für die Suche (alle Namen)
    var allAuthors = ""
    /// Literaturdatei und Zeile des Eintrags (für den Sprung); fehlt bei Einträgen aus reinem Text
    var file: URL?
    /// 1-basiert
    var line = 1

    var id: String { key }

    /// „Mustermann 2024 · Titel“ für Vervollständigung und Listen
    var summary: String {
        let head = [authors, year].filter { !$0.isEmpty }.joined(separator: " ")
        return [head, title].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

/// Labels, Literaturschlüssel und Bildverzeichnisse eines Projekts. Wird beim Öffnen des
/// Einfügen-Fensters im Hintergrund gelesen.
struct ProjectCatalog: Sendable, Equatable {
    var labels: [LabelEntry] = []
    var bibEntries: [BibEntry] = []
    /// aus `\graphicspath{{images/}}`, jeweils mit abschließendem `/`
    var graphicsDirectories: [String] = []

    static let empty = ProjectCatalog()

    var labelNames: Set<String> { Set(labels.map(\.label)) }

    static func scan(files: [URL], mainFile: URL?) -> ProjectCatalog {
        let measurement = Signposts.begin("CatalogScan")
        defer { measurement.end() }
        var catalog = ProjectCatalog()
        for file in files {
            guard let text = readText(file) else { continue }
            switch FileKind(url: file) {
            case .tex: catalog.labels += labels(in: text, file: file)
            case .bib: catalog.bibEntries += bibEntries(in: text, file: file)
            default: break
            }
        }
        if let mainFile, let text = readText(mainFile) {
            catalog.graphicsDirectories = graphicsDirectories(in: text)
        }
        catalog.labels.sort { $0.label.localizedStandardCompare($1.label) == .orderedAscending }
        catalog.bibEntries.sort { $0.key.localizedStandardCompare($1.key) == .orderedAscending }
        return catalog
    }

    // MARK: Labels

    static func labels(in text: String, file: URL) -> [LabelEntry] {
        var entries: [LabelEntry] = []
        for (index, line) in text.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
            let code = line[..<(LatexComments.commentStart(in: line) ?? line.endIndex)]
            var searchStart = code.startIndex
            while let range = code.range(of: "\\label{", range: searchStart..<code.endIndex),
                  let close = code[range.upperBound...].firstIndex(of: "}") {
                let name = code[range.upperBound..<close].trimmingCharacters(in: .whitespaces)
                if !name.isEmpty { entries.append(LabelEntry(label: name, file: file, line: index + 1)) }
                searchStart = close
            }
        }
        return entries
    }

    // MARK: Literatur

    static func bibEntries(in text: String, file: URL? = nil) -> [BibEntry] {
        let lines = file == nil ? [:] : entryLines(in: text)
        return BibParser.parse(text).map { record in
            let authors = record.value("author") ?? record.value("editor") ?? record.value("organization") ?? ""
            let year = String((record.value("date") ?? record.value("year") ?? "").prefix(4))
            return BibEntry(key: record.key, title: cleaned(record.value("title") ?? ""), authors: cleaned(BibAuthors.short(authors)),
                            year: year, allAuthors: cleaned(authors), file: file, line: lines[record.key] ?? 1)
        }
    }

    private static let entryStart = try! NSRegularExpression(pattern: #"^\s*@[A-Za-z]+\s*[{(]\s*([^,\s]+)\s*,"#, options: .anchorsMatchLines)

    /// Zeile (1-basiert) des ersten Eintrags zu jedem Schlüssel
    private static func entryLines(in text: String) -> [String: Int] {
        let source = text as NSString
        var lines: [String: Int] = [:]
        var line = 1
        var scanned = 0
        entryStart.enumerateMatches(in: text, range: NSRange(location: 0, length: source.length)) { match, _, _ in
            guard let match else { return }
            // Ab dem Schlüssel zählen: `^\s*` darf vorangehende Leerzeilen mit verschlucken
            let keyRange = match.range(at: 1)
            while scanned < keyRange.location {
                if source.character(at: scanned) == 0x0A { line += 1 }
                scanned += 1
            }
            let key = source.substring(with: keyRange)
            if lines[key] == nil { lines[key] = line }
        }
        return lines
    }

    /// Geschweifte Klammern (Schutz der Großschreibung) entfernen
    private static func cleaned(_ value: String) -> String {
        value.replacingOccurrences(of: "{", with: "").replacingOccurrences(of: "}", with: "").trimmingCharacters(in: .whitespaces)
    }

    // MARK: Grafikpfade

    static func graphicsDirectories(in text: String) -> [String] {
        guard let command = text.range(of: "\\graphicspath"),
              let open = text[command.upperBound...].firstIndex(of: "{") else { return [] }
        var directories: [String] = []
        var depth = 0
        var current = ""
        for character in text[open...] {
            if character == "{" {
                depth += 1
                if depth == 2 { current = "" }
            } else if character == "}" {
                if depth == 2, !current.isEmpty { directories.append(current.hasSuffix("/") ? current : current + "/") }
                depth -= 1
                if depth == 0 { break }
            } else if depth == 2 {
                current.append(character)
            }
        }
        return directories
    }

    private static func readText(_ url: URL) -> String? {
        ProjectText.string(url)
    }
}
