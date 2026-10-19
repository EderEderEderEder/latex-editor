import Foundation

/// Ein Eintrag einer `.bib`-Datei mit allen Feldern in Originalreihenfolge.
struct BibRecord: Equatable, Sendable {
    let type: String
    let key: String
    let fields: [(name: String, value: String)]

    static func == (left: BibRecord, right: BibRecord) -> Bool {
        left.type == right.type && left.key == right.key
            && left.fields.map(\.name) == right.fields.map(\.name) && left.fields.map(\.value) == right.fields.map(\.value)
    }

    func value(_ name: String) -> String? {
        fields.first { $0.name.lowercased() == name }?.value
    }
}

/// Liest `.bib`-Dateien: `@typ{schlüssel, feld = {wert}, feld = "wert", feld = 2024}`; verschachtelte
/// Klammern, Kommentare außerhalb von Einträgen und `@comment`/`@string`/`@preamble` werden übersprungen.
enum BibParser {
    private static let skippedTypes: Set<String> = ["comment", "string", "preamble"]

    static func parse(_ text: String) -> [BibRecord] {
        let characters = Array(text)
        var records: [BibRecord] = []
        var index = 0
        while index < characters.count {
            guard characters[index] == "@" else {
                index = nextLine(after: index, in: characters, skippingComment: characters[index] == "%")
                continue
            }
            let (record, end) = parseEntry(characters, at: index)
            if let record { records.append(record) }
            index = max(end, index + 1)
        }
        return records
    }

    private static func nextLine(after index: Int, in characters: [Character], skippingComment: Bool) -> Int {
        guard skippingComment else { return index + 1 }
        var position = index
        while position < characters.count, characters[position] != "\n" { position += 1 }
        return position + 1
    }

    /// Ein Eintrag ab `@`; liefert das Ende (hinter der schließenden Klammer).
    private static func parseEntry(_ characters: [Character], at start: Int) -> (BibRecord?, Int) {
        var index = start + 1
        let type = readIdentifier(characters, &index).lowercased()
        skipWhitespace(characters, &index)
        guard index < characters.count, characters[index] == "{" || characters[index] == "(" else { return (nil, index) }
        let closing: Character = characters[index] == "{" ? "}" : ")"
        index += 1
        guard !skippedTypes.contains(type) else { return (nil, skipBalanced(characters, from: index, closing: closing)) }
        skipWhitespace(characters, &index)
        var key = ""
        while index < characters.count, characters[index] != ",", characters[index] != closing { key.append(characters[index]); index += 1 }
        var fields: [(String, String)] = []
        while index < characters.count, characters[index] != closing {
            index += 1
            skipWhitespace(characters, &index)
            let name = readIdentifier(characters, &index)
            skipWhitespace(characters, &index)
            guard !name.isEmpty, index < characters.count, characters[index] == "=" else { continue }
            index += 1
            skipWhitespace(characters, &index)
            fields.append((name.lowercased(), readValue(characters, &index, closing: closing)))
            skipWhitespace(characters, &index)
        }
        let record = BibRecord(type: type, key: key.trimmingCharacters(in: .whitespacesAndNewlines), fields: fields)
        return (record.key.isEmpty ? nil : record, index + 1)
    }

    /// `{…}` (verschachtelt), `"…"` oder ein Wort/eine Zahl; `#`-Verkettungen werden zusammengefügt.
    private static func readValue(_ characters: [Character], _ index: inout Int, closing: Character) -> String {
        var value = ""
        while index < characters.count {
            let character = characters[index]
            if character == "{" {
                let end = skipBalanced(characters, from: index + 1, closing: "}")
                value += String(characters[(index + 1)..<max(index + 1, end - 1)])
                index = end
            } else if character == "\"" {
                var end = index + 1
                var depth = 0
                while end < characters.count, characters[end] != "\"" || depth > 0 {
                    if characters[end] == "{" { depth += 1 } else if characters[end] == "}" { depth -= 1 }
                    end += 1
                }
                value += String(characters[(index + 1)..<min(end, characters.count)])
                index = end + 1
            } else {
                var word = ""
                while index < characters.count, !",#\n".contains(characters[index]), characters[index] != closing {
                    word.append(characters[index])
                    index += 1
                }
                value += word.trimmingCharacters(in: .whitespaces)
            }
            skipWhitespace(characters, &index)
            guard index < characters.count, characters[index] == "#" else { break }
            index += 1
            skipWhitespace(characters, &index)
        }
        return value.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.joined(separator: " ")
    }

    private static func skipBalanced(_ characters: [Character], from start: Int, closing: Character) -> Int {
        var depth = 0
        var index = start
        while index < characters.count {
            if characters[index] == "{" { depth += 1 }
            if characters[index] == "}" || characters[index] == closing {
                if depth == 0, characters[index] == closing { return index + 1 }
                if characters[index] == "}" { depth -= 1 }
            }
            index += 1
        }
        return index
    }

    private static func readIdentifier(_ characters: [Character], _ index: inout Int) -> String {
        var identifier = ""
        while index < characters.count, characters[index].isLetter || characters[index].isNumber || "_-:.".contains(characters[index]) {
            identifier.append(characters[index])
            index += 1
        }
        return identifier
    }

    private static func skipWhitespace(_ characters: [Character], _ index: inout Int) {
        while index < characters.count, characters[index].isWhitespace { index += 1 }
    }
}

// MARK: - Autoren und Schlüssel

enum BibAuthors {
    /// „Max Mustermann; Erika Musterfrau“ oder eine Person pro Zeile → „Mustermann, Max and Musterfrau, Erika“.
    /// Schon vorhandene „Nachname, Vorname“ und Einträge mit „and“ bleiben; ein einzelnes Wort (Organisation) auch.
    static func bibtex(from input: String) -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        if trimmed.range(of: " and ", options: .caseInsensitive) != nil { return trimmed }
        let people = trimmed.components(separatedBy: CharacterSet(charactersIn: ";\n"))
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        return people.map(personName).joined(separator: " and ")
    }

    private static func personName(_ name: String) -> String {
        guard !name.contains(","), !name.hasPrefix("{") else { return name }
        let parts = name.split(separator: " ").map(String.init)
        guard parts.count > 1, let last = parts.last else { return name }
        return last + ", " + parts.dropLast().joined(separator: " ")
    }

    /// Nachname der ersten Person, für Schlüssel und Anzeige.
    static func firstLastName(_ authors: String) -> String {
        let first = authors.components(separatedBy: " and ").first?.trimmingCharacters(in: .whitespaces) ?? ""
        let cleaned = first.replacingOccurrences(of: "{", with: "").replacingOccurrences(of: "}", with: "")
        if let comma = cleaned.firstIndex(of: ",") { return String(cleaned[..<comma]).trimmingCharacters(in: .whitespaces) }
        return cleaned.split(separator: " ").last.map(String.init) ?? cleaned
    }

    /// Kurzform für Listen: „Mustermann“, „Mustermann und Musterfrau“, „Mustermann u. a.“
    static func short(_ authors: String) -> String {
        let people = authors.components(separatedBy: " and ").filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        guard let first = people.first else { return "" }
        let name = firstLastName(first)
        switch people.count {
        case 1: return name
        case 2: return name + " und " + firstLastName(people[1])
        default: return name + " u. a."
        }
    }
}

enum BibKey {
    private static let transliteration: [Character: String] = ["ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss"]
    private static let suffixes = "abcdefghijklmnopqrstuvwxyz".map(String.init)

    /// „Mustermann2024“; ohne Autor das erste Wort des Titels. Eindeutig gegenüber `existing` (a, b, c …).
    static func make(authors: String, title: String, year: String, existing: Set<String>) -> String {
        let name = BibAuthors.firstLastName(authors)
        let base = ascii(name.isEmpty ? (title.split(separator: " ").first.map(String.init) ?? "quelle") : name)
        let stem = (base.isEmpty ? "quelle" : base) + ascii(year)
        guard existing.contains(stem) else { return stem }
        return suffixes.lazy.map { stem + $0 }.first { !existing.contains($0) } ?? stem + "-\(existing.count)"
    }

    /// Erlaubt sind Buchstaben, Ziffern und `:-_.`; Umlaute werden umschrieben, Akzente entfernt.
    static func isValid(_ key: String) -> Bool {
        !key.isEmpty && key.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || ":-_.".contains($0)) }
    }

    static func ascii(_ text: String) -> String {
        let transliterated = text.map { transliteration[$0] ?? String($0) }.joined()
        let folded = transliterated.folding(options: .diacriticInsensitive, locale: nil)
        return String(folded.filter { $0.isASCII && ($0.isLetter || $0.isNumber) })
    }
}

// MARK: - Quelltypen und Formatierung

/// Ein Feld im Formular „Quelle“.
struct SourceField: Equatable, Sendable {
    let name: String
    let title: String
    let isRequired: Bool
    var placeholder = ""
}

/// Quelltypen mit den Feldern, die biblatex (und die Gliederung der HgbThesis in Literatur, Online-Quellen,
/// Software) erwartet.
enum SourceType: String, CaseIterable, Identifiable, Sendable {
    case book
    case article
    case inproceedings
    case incollection
    case online
    case thesis
    case software

    var id: String { rawValue }

    var title: String {
        switch self {
        case .book: "Buch"
        case .article: "Zeitschriftenartikel"
        case .inproceedings: "Konferenzbeitrag"
        case .incollection: "Beitrag in Sammelband"
        case .online: "Webseite / Online-Quelle"
        case .thesis: "Abschlussarbeit"
        case .software: "Software"
        }
    }

    var fields: [SourceField] {
        let title = SourceField(name: "title", title: "Titel", isRequired: true)
        let date = SourceField(name: "date", title: "Jahr", isRequired: self != .online && self != .software, placeholder: "z. B. 2024")
        switch self {
        case .book:
            return [title, SourceField(name: "subtitle", title: "Untertitel", isRequired: false),
                    SourceField(name: "edition", title: "Auflage", isRequired: false, placeholder: "z. B. 3"),
                    SourceField(name: "publisher", title: "Verlag", isRequired: true),
                    SourceField(name: "location", title: "Ort", isRequired: false), date,
                    SourceField(name: "isbn", title: "ISBN", isRequired: false)]
        case .article:
            return [title, SourceField(name: "journaltitle", title: "Zeitschrift", isRequired: true),
                    SourceField(name: "volume", title: "Jahrgang (Band)", isRequired: false),
                    SourceField(name: "number", title: "Heft", isRequired: false),
                    SourceField(name: "pages", title: "Seiten", isRequired: false, placeholder: "z. B. 12--34"), date,
                    SourceField(name: "doi", title: "DOI", isRequired: false)]
        case .inproceedings, .incollection:
            return [title, SourceField(name: "booktitle", title: self == .inproceedings ? "Tagungsband" : "Sammelband", isRequired: true),
                    SourceField(name: "editor", title: "Herausgeber", isRequired: false),
                    SourceField(name: "publisher", title: "Verlag", isRequired: false),
                    SourceField(name: "location", title: "Ort", isRequired: false),
                    SourceField(name: "pages", title: "Seiten", isRequired: false, placeholder: "z. B. 12--34"), date,
                    SourceField(name: "doi", title: "DOI", isRequired: false)]
        case .online:
            return [title, SourceField(name: "organization", title: "Organisation", isRequired: false),
                    SourceField(name: "url", title: "URL", isRequired: true, placeholder: "https://…"),
                    SourceField(name: "urldate", title: "Abgerufen am", isRequired: true, placeholder: "JJJJ-MM-TT"), date]
        case .thesis:
            return [title, SourceField(name: "type", title: "Art", isRequired: true, placeholder: "z. B. Masterarbeit"),
                    SourceField(name: "institution", title: "Hochschule", isRequired: true),
                    SourceField(name: "location", title: "Ort", isRequired: false), date]
        case .software:
            return [title, SourceField(name: "version", title: "Version", isRequired: false),
                    SourceField(name: "url", title: "URL", isRequired: false, placeholder: "https://…"),
                    SourceField(name: "urldate", title: "Abgerufen am", isRequired: false, placeholder: "JJJJ-MM-TT"), date]
        }
    }

    /// Ohne Autor nur bei Webseiten und Software sinnvoll (dort steht oft eine Organisation).
    var requiresAuthor: Bool { self != .online && self != .software }
}

/// Formatiert einen Eintrag wie das Beispiel der HgbThesis: ein Feld pro Zeile, Tabulator, `feld={wert}`.
enum BibFormatter {
    /// Felder, deren Werte nicht maskiert werden (biblatex liest sie wörtlich)
    private static let verbatimFields: Set<String> = ["url", "doi", "urldate", "isbn", "date", "pages", "langid"]

    /// `escaping: false` für eingefügtes BibTeX (dort ist schon alles maskiert, `$…$` darf bleiben).
    static func entry(type: String, key: String, fields: [(name: String, value: String)], escaping: Bool = true) -> String {
        let lines = fields.filter { !$0.value.trimmingCharacters(in: .whitespaces).isEmpty }
            .map { "\t\($0.name)={\(escaping ? escaped($0.value, field: $0.name) : $0.value)}" }
        return "@\(type){\(key),\n" + lines.joined(separator: ",\n") + "\n}\n"
    }

    /// `&`, `%`, `#`, `_` und `$` maskieren, schon maskierte nicht doppelt.
    static func escaped(_ value: String, field: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !verbatimFields.contains(field) else { return trimmed }
        var result = ""
        var previous: Character?
        for character in trimmed {
            if "&%#_$".contains(character), previous != "\\" { result.append("\\") }
            result.append(character)
            previous = character
        }
        return result
    }
}

// MARK: - Zieldatei

enum BibliographyFile {
    private static let commands = try! NSRegularExpression(
        pattern: #"\\(?:addbibresource|AddBibFile|bibliography)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}"#
    )

    /// Die Literaturdatei, in die neue Quellen kommen: die zuerst eingebundene der Hauptdatei
    /// (`\addbibresource`, `\AddBibFile`, `\bibliography{a,b}`), sonst die erste im Projekt.
    static func target(mainFile: URL?, mainText: String?, projectFiles: [URL]) -> URL? {
        let bibFiles = projectFiles.filter { FileKind(url: $0) == .bib }
        if let mainFile, let mainText {
            let directory = mainFile.deletingLastPathComponent()
            let text = mainText as NSString
            for match in commands.matches(in: mainText, range: NSRange(location: 0, length: text.length)) {
                for name in text.substring(with: match.range(at: 1)).split(separator: ",") {
                    let trimmed = name.trimmingCharacters(in: .whitespaces)
                    let file = trimmed.hasSuffix(".bib") ? trimmed : trimmed + ".bib"
                    let url = directory.appendingPathComponent(file).standardizedFileURL
                    if FileManager.default.fileExists(atPath: url.path) { return url }
                }
            }
        }
        return bibFiles.first
    }

    /// Text, der ans Ende der Datei kommt: genau eine Leerzeile Abstand zum Vorherigen.
    static func appendix(for entry: String, after existing: String) -> String {
        if existing.isEmpty { return entry }
        let trimmedEnd = existing.reversed().prefix { $0 == "\n" }.count
        let separator = String(repeating: "\n", count: max(0, 2 - trimmedEnd))
        return separator + entry
    }
}

// MARK: - Neue Quelle

struct SourceDraft: Equatable, Sendable {
    let key: String
    let entry: String
}

/// Baut aus dem Formular oder eingefügtem BibTeX den Eintrag für die Literaturdatei.
enum SourceBuilder {
    /// Liefert den Eintrag oder einen Hinweis, was fehlt.
    static func draft(from settings: SourceSettings, existingKeys: Set<String>, today: Date = Date()) -> Result<SourceDraft, SourceProblem> {
        switch settings.mode {
        case .form: formDraft(settings, existingKeys: existingKeys, today: today)
        case .bibtex: bibtexDraft(settings, existingKeys: existingKeys)
        }
    }

    private static func formDraft(_ settings: SourceSettings, existingKeys: Set<String>, today: Date) -> Result<SourceDraft, SourceProblem> {
        let type = settings.type
        let authors = BibAuthors.bibtex(from: settings.authors)
        var values = settings.values.mapValues { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        if type == .online, values["urldate", default: ""].isEmpty { values["urldate"] = isoDate(today) }
        var missing = type.fields.filter { $0.isRequired && values[$0.name, default: ""].isEmpty }.map(\.title)
        if type.requiresAuthor, authors.isEmpty { missing.insert("Autor", at: 0) }
        guard missing.isEmpty else { return .failure(.missingFields(missing)) }
        let key = chosenKey(settings.keyOverride, authors: authors, title: values["title", default: ""],
                            year: values["date", default: ""], existingKeys: existingKeys)
        let fields = [("author", authors)] + type.fields.map { ($0.name, values[$0.name, default: ""]) }
            + [("langid", settings.language.rawValue)]
        return .success(SourceDraft(key: key, entry: BibFormatter.entry(type: type.rawValue, key: key, fields: fields)))
    }

    private static func bibtexDraft(_ settings: SourceSettings, existingKeys: Set<String>) -> Result<SourceDraft, SourceProblem> {
        guard let record = BibParser.parse(settings.bibtex).first else { return .failure(.noBibtexEntry) }
        let proposed = settings.keyOverride.isEmpty ? record.key : settings.keyOverride
        let key = BibKey.isValid(proposed) && !existingKeys.contains(proposed)
            ? proposed
            : BibKey.make(authors: record.value("author") ?? "", title: record.value("title") ?? "",
                          year: record.value("date") ?? record.value("year") ?? "", existing: existingKeys)
        return .success(SourceDraft(key: key, entry: BibFormatter.entry(type: record.type, key: key, fields: record.fields, escaping: false)))
    }

    private static func chosenKey(_ override: String, authors: String, title: String, year: String, existingKeys: Set<String>) -> String {
        let trimmed = override.trimmingCharacters(in: .whitespaces)
        if BibKey.isValid(trimmed), !existingKeys.contains(trimmed) { return trimmed }
        return BibKey.make(authors: authors, title: title, year: String(year.prefix(4)), existing: existingKeys)
    }

    static func isoDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

enum SourceProblem: Error, Equatable, Sendable {
    case missingFields([String])
    case noBibtexEntry

    var message: String {
        switch self {
        case let .missingFields(fields): "Bitte noch ausfüllen: " + fields.joined(separator: ", ")
        case .noBibtexEntry: "Kein BibTeX-Eintrag erkannt (er beginnt mit @book{…, @article{… usw.)."
        }
    }
}
