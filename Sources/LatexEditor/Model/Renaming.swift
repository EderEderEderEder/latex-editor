import Foundation

/// Was projektweit umbenannt wird: Name und Art (bestimmt, wo gesucht wird und welche Namen gültig sind).
struct RenameSubject: Equatable, Sendable {
    enum Kind: Sendable {
        case label
        case citation
        case acronym
        case command
        case environment
    }

    let kind: Kind
    /// Ohne `\` (Befehle) und ohne Klammern
    let name: String

    var kindName: String {
        switch kind {
        case .label: "Label"
        case .citation: "Quelle"
        case .acronym: "Abkürzung"
        case .command: "Befehl"
        case .environment: "Umgebung"
        }
    }

    /// „Label „fig:a““, „Befehl „\tool““
    var displayName: String {
        "\(kindName) „\(kind == .command ? "\\" + name : name)“"
    }
}

/// `\begin{name}` … `\end{name}` in einer Datei; die Bereiche umfassen nur den Namen.
struct EnvironmentPair: Equatable, Sendable {
    let name: String
    let begin: NSRange
    let end: NSRange
}

/// Was „Umbenennen …“ an einer Stelle anbietet: projektweit oder nur das Umgebungspaar in dieser Datei.
enum RenameScope: Equatable, Sendable {
    case project(RenameSubject)
    case pair(URL, EnvironmentPair)

    var oldName: String {
        switch self {
        case let .project(subject): subject.name
        case let .pair(_, pair): pair.name
        }
    }

    var kind: RenameSubject.Kind {
        switch self {
        case let .project(subject): subject.kind
        case .pair: .environment
        }
    }

    var menuTitle: String {
        switch self {
        case let .project(subject):
            subject.kind == .environment ? "\(subject.displayName) überall umbenennen …" : "\(subject.displayName) umbenennen …"
        case let .pair(_, pair): "Umgebung „\(pair.name)“ umbenennen (dieses Paar) …"
        }
    }
}

/// Fundstellen finden und ersetzen, je Art. Kommentare und Code-Umgebungen zählen nie (`LatexMasking`), in `.bib`
/// nur echte Eintragsschlüssel und Querverweise (`crossref`, `xdata` …), keine auskommentierten Einträge.
enum Renamer {
    // MARK: Fundstellen

    static func occurrences(of subject: RenameSubject, in text: String, isBibliography: Bool) -> [NSRange] {
        if isBibliography {
            return subject.kind == .citation ? BibKeys.occurrences(of: subject.name, in: text) : []
        }
        switch subject.kind {
        case .label:
            return LatexReferences.scan(text).filter { $0.kind != .citation && $0.key == subject.name }.map(\.range)
        case .citation:
            return LatexReferences.scan(text).filter { $0.kind == .citation && $0.key == subject.name }.map(\.range)
        case .acronym:
            return Acronyms.scan(text).filter { $0.key == subject.name }.map(\.range)
        case .command:
            return CommandNames.occurrences(of: subject.name, in: text)
        case .environment:
            return EnvironmentNames.occurrences(of: subject.name, in: text)
        }
    }

    /// Ersetzt von hinten nach vorn, damit die vorderen Bereiche gültig bleiben.
    static func apply(_ ranges: [NSRange], newName: String, to text: String) -> String {
        let result = NSMutableString(string: text)
        for range in ranges.sorted(by: { $0.location > $1.location }) where NSMaxRange(range) <= result.length {
            result.replaceCharacters(in: range, with: newName)
        }
        return result as String
    }

    // MARK: Namen prüfen

    private static let forbiddenKeyCharacters = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "{},%#\\~^$&"))
    private static let commandNameCharacters = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
    private static let environmentNameCharacters = commandNameCharacters.union(CharacterSet(charactersIn: "*"))

    /// Befehle dürfen mit `\` eingegeben werden
    static func normalized(_ rawName: String, kind: RenameSubject.Kind) -> String {
        let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
        return kind == .command && name.hasPrefix("\\") ? String(name.dropFirst()) : name
    }

    /// Hinweistext, warum `newName` nicht geht; `nil`, wenn es geht. `existing`: schon vergebene Namen dieser Art.
    static func validate(_ rawName: String, kind: RenameSubject.Kind, old: String, existing: Set<String>) -> String? {
        let name = normalized(rawName, kind: kind)
        if name.isEmpty { return "Bitte einen Namen eingeben." }
        if name == old { return "Der Name ist unverändert." }
        switch kind {
        case .command:
            guard name.unicodeScalars.allSatisfy(commandNameCharacters.contains) else {
                return "Befehlsnamen bestehen nur aus Buchstaben (a–z, A–Z)."
            }
        case .environment:
            guard name.unicodeScalars.allSatisfy(environmentNameCharacters.contains), !name.dropLast().contains("*") else {
                return "Umgebungsnamen bestehen aus Buchstaben, höchstens mit * am Ende."
            }
        case .label, .citation, .acronym:
            if name.unicodeScalars.contains(where: forbiddenKeyCharacters.contains) {
                return "Im Namen sind Leerzeichen und die Zeichen { } , % # \\ ~ ^ $ & nicht erlaubt."
            }
        }
        return existing.contains(name) ? "\(indefiniteArticle(for: kind)) mit diesem Namen gibt es schon." : nil
    }

    private static func indefiniteArticle(for kind: RenameSubject.Kind) -> String {
        switch kind {
        case .label: "Ein Label"
        case .citation: "Eine Quelle"
        case .acronym: "Eine Abkürzung"
        case .command: "Einen Befehl"
        case .environment: "Eine Umgebung"
        }
    }

    // MARK: Was steht unter dem Cursor?

    /// Art und Name an `location`, ohne Projektwissen (ob ein Befehl oder eine Umgebung zum Projekt gehört, prüft
    /// der Aufrufer). In `.tex` zuerst Labels/Zitate, dann Abkürzungen, dann `\begin`/`\end` bzw. eine
    /// Umgebungsdefinition, zuletzt ein Befehl.
    static func candidates(at location: Int, in text: NSString, isBibliography: Bool) -> [RenameCandidate] {
        if isBibliography {
            return BibKeys.key(at: location, in: text).map { [.project(RenameSubject(kind: .citation, name: $0))] } ?? []
        }
        let line = text.lineRange(for: NSRange(location: min(location, text.length), length: 0))
        let lineText = text.substring(with: line)
        let local = location - line.location
        func contains(_ range: NSRange) -> Bool { local >= range.location && local <= NSMaxRange(range) }

        if let hit = LatexReferences.scan(lineText).first(where: { contains($0.range) }) {
            return [.project(RenameSubject(kind: hit.kind == .citation ? .citation : .label, name: hit.key))]
        }
        if let hit = Acronyms.scan(lineText).first(where: { contains($0.range) }) {
            return [.project(RenameSubject(kind: .acronym, name: hit.key))]
        }
        if let pair = EnvironmentNames.pair(at: location, in: text) {
            return [.pair(pair), .project(RenameSubject(kind: .environment, name: pair.name))]
        }
        if let name = EnvironmentNames.definition(at: local, inLine: lineText) {
            return [.project(RenameSubject(kind: .environment, name: name))]
        }
        if let name = CommandNames.name(at: location, in: text) {
            return [.project(RenameSubject(kind: .command, name: name))]
        }
        return []
    }
}

/// Ergebnis der Erkennung unter dem Cursor (die Datei für ein Paar ergänzt der Aufrufer)
enum RenameCandidate: Equatable, Sendable {
    case project(RenameSubject)
    case pair(EnvironmentPair)
}

// MARK: - .bib-Schlüssel

enum BibKeys {
    private static let entryHeader = try! NSRegularExpression(pattern: ##"@([A-Za-z]+)\s*[{(]\s*([^\s,{}()"#%=]+)\s*,"##)
    private static let crossReference = try! NSRegularExpression(
        pattern: #"\b(?:crossref|xref|xdata|related)\s*=\s*[{"]([^{}"]*)[}"]"#, options: .caseInsensitive
    )
    private static let entryTypesWithoutKey: Set<String> = ["comment", "string", "preamble"]

    /// Eintragsschlüssel und Querverweise mit diesem Namen; auskommentierte Zeilen (`%`) zählen nicht.
    static func occurrences(of key: String, in text: String) -> [NSRange] {
        let source = text as NSString
        let comments = commentTokens(in: source)
        var result: [NSRange] = []
        let whole = NSRange(location: 0, length: source.length)
        for match in entryHeader.matches(in: text, range: whole) {
            let type = source.substring(with: match.range(at: 1)).lowercased()
            let range = match.range(at: 2)
            guard !entryTypesWithoutKey.contains(type), source.substring(with: range) == key else { continue }
            result.append(range)
        }
        for match in crossReference.matches(in: text, range: whole) {
            result += listItems(in: match.range(at: 1), of: source).filter { source.substring(with: $0) == key }
        }
        return result.filter { !comments.containsOverlap(with: $0) }.sorted { $0.location < $1.location }
    }

    /// Schlüssel des Eintragskopfs an `location` (`@book{knuth1984,` mit dem Cursor im Schlüssel)
    static func key(at location: Int, in text: NSString) -> String? {
        let line = text.lineRange(for: NSRange(location: min(location, text.length), length: 0))
        let lineText = text.substring(with: line)
        guard !lineText.trimmingCharacters(in: .whitespaces).hasPrefix("%") else { return nil }
        let local = location - line.location
        for match in entryHeader.matches(in: lineText, range: NSRange(location: 0, length: (lineText as NSString).length)) {
            let range = match.range(at: 2)
            let type = (lineText as NSString).substring(with: match.range(at: 1)).lowercased()
            if !entryTypesWithoutKey.contains(type), local >= range.location, local <= NSMaxRange(range) {
                return (lineText as NSString).substring(with: range)
            }
        }
        return nil
    }

    private static func commentTokens(in text: NSString) -> [SyntaxToken] {
        var highlighter = SyntaxHighlighter(language: .bibtex)
        return highlighter.highlightAll(text, lines: LineIndex(text: text)).filter { $0.kind == .comment }
    }

    /// Kommagetrennte Einträge ohne Leerraum
    private static func listItems(in group: NSRange, of text: NSString) -> [NSRange] {
        var result: [NSRange] = []
        var start = group.location
        let end = NSMaxRange(group)
        while start <= end {
            var stop = start
            while stop < end, text.character(at: stop) != UInt16(UInt8(ascii: ",")) { stop += 1 }
            var first = start
            var last = stop
            while first < last, Capitalization.isWhitespace(text.character(at: first)) { first += 1 }
            while last > first, Capitalization.isWhitespace(text.character(at: last - 1)) { last -= 1 }
            if last > first { result.append(NSRange(location: first, length: last - first)) }
            start = stop + 1
        }
        return result
    }
}

// MARK: - Abkürzungen und Glossar

/// `\newacronym{api}{API}{…}`, `\DeclareAcronym{api}{…}`, `\newglossaryentry{…}` und die Verwendungen
/// (`\ac{api}`, `\acs`, `\gls` …) aus acronym, acro und glossaries.
enum Acronyms {
    static let definitionCommands = ["newacronym", "newglossaryentry", "longnewglossaryentry", "newabbreviation", "DeclareAcronym", "newdualentry"]
    static let useCommands = [
        "ac", "acs", "acl", "acf", "acp", "acsp", "aclp", "acfp", "Ac", "Acs", "Acl", "Acf", "Acp", "Acsp", "Aclp", "Acfp",
        "iac", "Iac", "acsingle", "acused", "acreset", "acuse", "acresetall",
        "gls", "Gls", "GLS", "glspl", "Glspl", "GLSpl", "glstext", "Glstext", "glsfirst", "Glsfirst", "glsdesc", "Glsdesc",
        "glssymbol", "glsuseri", "glsentrytext", "glslink",
        "acrshort", "acrlong", "acrfull", "Acrshort", "Acrlong", "Acrfull", "acrshortpl", "acrlongpl", "acrfullpl",
        "glsxtrshort", "glsxtrlong", "glsxtrfull",
    ]

    struct Occurrence: Equatable, Sendable {
        let key: String
        let range: NSRange
        let isDefinition: Bool
    }

    private static let expression: NSRegularExpression = {
        let names = (definitionCommands + useCommands).sorted { $0.count > $1.count }.joined(separator: "|")
        return try! NSRegularExpression(pattern: #"\\("# + names + #")\*?\s*(?:\[[^\]\n]*\]\s*)?\{\s*([^{}\s,]+)\s*\}"#)
    }()

    static func scan(_ text: String) -> [Occurrence] {
        scan(masked: LatexMasking.scannable(text) as NSString)
    }

    /// Auf schon maskiertem Text (`LatexMasking.scannable`)
    static func scan(masked: NSString) -> [Occurrence] {
        expression.matches(in: masked as String, range: NSRange(location: 0, length: masked.length)).map { match in
            Occurrence(key: masked.substring(with: match.range(at: 2)), range: match.range(at: 2),
                       isDefinition: definitionCommands.contains(masked.substring(with: match.range(at: 1))))
        }
    }

    static func definedKeys(in text: String) -> Set<String> {
        Set(scan(text).filter(\.isDefinition).map(\.key))
    }

    /// Wird in `\glsaddall` jede Abkürzung gedruckt: keine gilt als ungenutzt
    static func usesAll(_ text: String) -> Bool {
        LatexMasking.scannable(text).contains("\\glsaddall")
    }

    // MARK: Definitionen mit Kurzform und Langform

    private static let maximumValueLength = 200

    /// Die Definitionen eines Textes mit dem, was man zum Wählen braucht: Kurzform und Langform. Aus
    /// `\newacronym[…]{key}{kurz}{lang}`, `\newabbreviation{key}{kurz}{lang}`, `\DeclareAcronym{key}{short = …, long = …}` und
    /// `\newglossaryentry{key}{name = …, description = …}`.
    static func definitions(in text: String, file: URL) -> [AcronymEntry] {
        let masked = LatexMasking.scannable(text) as NSString
        let lines = LineIndex(text: masked)
        return scan(masked: masked).filter(\.isDefinition).map { occurrence in
            let (short, long) = details(after: occurrence.range, in: masked)
            return AcronymEntry(key: occurrence.key, short: short, long: long, file: file,
                                line: lines.line(containing: occurrence.range.location) + 1)
        }
    }

    /// Die beiden Gruppen hinter dem Schlüssel (`{key}` ist schon gelesen)
    private static func details(after keyRange: NSRange, in text: NSString) -> (short: String, long: String) {
        var cursor = NSMaxRange(keyRange)
        while cursor < text.length, text.character(at: cursor) != 0x7D { cursor += 1 }
        cursor += 1
        guard let first = group(at: &cursor, in: text) else { return ("", "") }
        if first.contains("=") { return keyValues(first) }
        guard let second = group(at: &cursor, in: text) else { return (clean(first), "") }
        return (clean(first), clean(second))
    }

    /// `name = API, description = Programmierschnittstelle`; `short`/`long` bei `\DeclareAcronym`
    private static func keyValues(_ text: String) -> (short: String, long: String) {
        var values: [String: String] = [:]
        var depth = 0
        var current = ""
        var parts: [String] = []
        for character in text {
            if character == "{" { depth += 1 } else if character == "}" { depth -= 1 }
            if character == ",", depth == 0 {
                parts.append(current)
                current = ""
            } else {
                current.append(character)
            }
        }
        parts.append(current)
        for part in parts {
            guard let equals = part.firstIndex(of: "=") else { continue }
            values[part[..<equals].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()] =
                clean(String(part[part.index(after: equals)...]))
        }
        return (values["short"] ?? values["name"] ?? "", values["long"] ?? values["description"] ?? "")
    }

    /// Inhalt der nächsten `{…}`-Gruppe (Leerraum davor ist erlaubt); `cursor` steht danach
    private static func group(at cursor: inout Int, in text: NSString) -> String? {
        var index = cursor
        while index < text.length, [0x20, 0x09, 0x0A].contains(text.character(at: index)) { index += 1 }
        guard index < text.length, text.character(at: index) == 0x7B else { return nil }
        var depth = 0
        var end = index
        while end < text.length {
            let unit = text.character(at: end)
            if unit == 0x5C { end += 2; continue }
            if unit == 0x7B { depth += 1 } else if unit == 0x7D {
                depth -= 1
                if depth == 0 { break }
            }
            end += 1
        }
        guard end < text.length else { return nil }
        cursor = end + 1
        let content = text.substring(with: NSRange(location: index + 1, length: min(end - index - 1, maximumValueLength)))
        return content
    }

    /// Ohne äußere Klammern, Zeilenumbrüche und mehrfache Leerzeichen
    private static func clean(_ value: String) -> String {
        var result = value.trimmingCharacters(in: .whitespacesAndNewlines)
        while result.hasPrefix("{"), result.hasSuffix("}"), result.count >= 2 { result = String(result.dropFirst().dropLast()) }
        return result.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
}

/// Eine Abkürzung oder ein Glossareintrag des Projekts
struct AcronymEntry: Equatable, Hashable, Sendable {
    let key: String
    let short: String
    let long: String
    let file: URL
    /// 1-basiert
    let line: Int

    /// „API – Application Programming Interface“ für Listen
    var summary: String {
        [short, long].filter { !$0.isEmpty }.joined(separator: " – ")
    }
}

// MARK: - Eigene Befehle

enum CommandNames {
    private static let backslash = UInt16(UInt8(ascii: "\\"))
    private static let at = UInt16(UInt8(ascii: "@"))

    /// Jedes `\name` (Definition und Aufrufe), nicht `\namefoo`, nicht `\\name` (Zeilenumbruch + Text).
    /// Die Bereiche umfassen nur den Namen ohne `\`.
    static func occurrences(of name: String, in text: String) -> [NSRange] {
        let masked = LatexMasking.scannable(text) as NSString
        let pattern = "\\\\" + NSRegularExpression.escapedPattern(for: name) + "(?![A-Za-z@])"
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return [] }
        return expression.matches(in: masked as String, range: NSRange(location: 0, length: masked.length)).compactMap { match in
            guard startsCommand(at: match.range.location, in: masked) else { return nil }
            return NSRange(location: match.range.location + 1, length: match.range.length - 1)
        }
    }

    /// Name des Befehls, in dem `location` liegt (auf dem `\` oder im Namen)
    static func name(at location: Int, in text: NSString) -> String? {
        guard text.length > 0 else { return nil }
        var start = min(location, text.length)
        while start > 0, isLetter(text.character(at: start - 1)) { start -= 1 }
        if start < text.length, text.character(at: start) == backslash, location == start { start += 1 }
        guard start > 0, text.character(at: start - 1) == backslash, startsCommand(at: start - 1, in: text) else { return nil }
        var end = start
        while end < text.length, isLetter(text.character(at: end)) { end += 1 }
        guard end > start, end >= location, end == text.length || text.character(at: end) != at else { return nil }
        return text.substring(with: NSRange(location: start, length: end - start))
    }

    /// Ein `\` beginnt einen Befehl, wenn davor eine gerade Zahl von `\` steht (`\\` ist ein Zeilenumbruch).
    private static func startsCommand(at index: Int, in text: NSString) -> Bool {
        var count = 0
        var position = index - 1
        while position >= 0, text.character(at: position) == backslash {
            count += 1
            position -= 1
        }
        return count % 2 == 0
    }

    private static func isLetter(_ unit: UInt16) -> Bool {
        (UInt16(UInt8(ascii: "a"))...UInt16(UInt8(ascii: "z"))).contains(unit)
            || (UInt16(UInt8(ascii: "A"))...UInt16(UInt8(ascii: "Z"))).contains(unit)
    }
}

// MARK: - Umgebungen

enum EnvironmentNames {
    static let definitionCommands = [
        "newenvironment", "renewenvironment", "NewDocumentEnvironment", "RenewDocumentEnvironment", "lstnewenvironment", "newtheorem",
    ]
    private static let beginEnd = try! NSRegularExpression(pattern: #"\\(begin|end)\s*\{([A-Za-z]+\*?)\}"#)
    private static let definition: NSRegularExpression = {
        try! NSRegularExpression(pattern: #"\\(?:"# + definitionCommands.joined(separator: "|") + #")\*?\s*\{([A-Za-z]+\*?)\}"#)
    }()

    /// `\begin{name}`, `\end{name}` und Definitionen (`\newenvironment{name}` …)
    static func occurrences(of name: String, in text: String) -> [NSRange] {
        let masked = LatexMasking.scannable(text) as NSString
        let whole = NSRange(location: 0, length: masked.length)
        let uses = beginEnd.matches(in: masked as String, range: whole).map { $0.range(at: 2) }
        let definitions = definition.matches(in: masked as String, range: whole).map { $0.range(at: 1) }
        return (uses + definitions).filter { masked.substring(with: $0) == name }.sorted { $0.location < $1.location }
    }

    /// Im Projekt (in .tex) definierte Umgebungen
    static func definedNames(in text: String) -> Set<String> {
        let masked = LatexMasking.scannable(text) as NSString
        let matches = definition.matches(in: masked as String, range: NSRange(location: 0, length: masked.length))
        return Set(matches.map { masked.substring(with: $0.range(at: 1)) })
    }

    /// Name in einer Definition an der Spaltenposition `local` der Zeile
    static func definition(at local: Int, inLine line: String) -> String? {
        let source = line as NSString
        let match = definition.matches(in: line, range: NSRange(location: 0, length: source.length)).first {
            local >= $0.range.location && local <= NSMaxRange($0.range)
        }
        return match.map { source.substring(with: $0.range(at: 1)) }
    }

    /// Das Paar, wenn `location` in einem `\begin{…}` oder `\end{…}` liegt; verschachtelte gleichnamige Umgebungen
    /// werden mitgezählt. `nil`, wenn das Gegenstück fehlt. Läuft auf dem Main-Thread (Rechtsklick, ⌥⌘R): Gesucht wird
    /// nur vom Treffer aus in eine Richtung, Kommentare werden zeilenweise erkannt – das Dokument wird nicht maskiert.
    /// (Ein gleichnamiges `\begin`/`\end` *innerhalb* eines Code-Blocks zählt dabei mit; das kommt praktisch nicht vor.)
    static func pair(at location: Int, in text: NSString) -> EnvironmentPair? {
        guard let hit = command(at: location, in: text),
              let expression = try? NSRegularExpression(pattern: #"\\(begin|end)\s*\{"# + NSRegularExpression.escapedPattern(for: hit.name) + #"\}"#)
        else { return nil }
        // Bis zum Dateiende bzw. -anfang: `\begin{document}` … `\end{document}` umfasst die ganze Hauptdatei
        let searchRange = hit.isBegin
            ? NSRange(location: NSMaxRange(hit.range), length: text.length - NSMaxRange(hit.range))
            : NSRange(location: 0, length: hit.range.location)
        var candidates = expression.matches(in: text as String, range: searchRange).filter { !isCommented($0.range.location, in: text) }
        if !hit.isBegin { candidates.reverse() }
        var depth = 0
        for candidate in candidates {
            let candidateIsBegin = text.substring(with: candidate.range(at: 1)) == "begin"
            if candidateIsBegin == hit.isBegin {
                depth += 1
            } else if depth > 0 {
                depth -= 1
            } else {
                let partner = nameRange(of: candidate, in: text)
                return EnvironmentPair(name: hit.name, begin: hit.isBegin ? hit.nameRange : partner, end: hit.isBegin ? partner : hit.nameRange)
            }
        }
        return nil
    }

    /// `\begin{name}` bzw. `\end{name}` an `location` (in derselben Zeile), nicht in Kommentar oder Code
    private static func command(at location: Int, in text: NSString) -> (isBegin: Bool, name: String, nameRange: NSRange, range: NSRange)? {
        let line = text.lineRange(for: NSRange(location: min(location, text.length), length: 0))
        let match = beginEnd.matches(in: text as String, range: line).first {
            location >= $0.range.location && location <= NSMaxRange($0.range)
        }
        guard let match, !isCommented(match.range.location, in: text),
              !LatexEnvironments.isInsideCode(at: match.range.location, in: text) else { return nil }
        return (text.substring(with: match.range(at: 1)) == "begin", text.substring(with: match.range(at: 2)), match.range(at: 2), match.range)
    }

    private static func nameRange(of match: NSTextCheckingResult, in text: NSString) -> NSRange {
        let open = text.range(of: "{", options: .literal, range: match.range)
        return NSRange(location: NSMaxRange(open), length: NSMaxRange(match.range) - 1 - NSMaxRange(open))
    }

    private static func isCommented(_ location: Int, in text: NSString) -> Bool {
        let lineStart = text.lineRange(for: NSRange(location: location, length: 0)).location
        return LatexComments.isInComment(text, lineStart: lineStart, location: location)
    }
}
