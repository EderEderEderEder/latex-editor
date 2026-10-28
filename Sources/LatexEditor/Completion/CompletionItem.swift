import Foundation

/// Ein Vorschlag in der Liste.
struct CompletionItem: Equatable, Identifiable, Sendable {
    enum Kind: Equatable, Hashable, Sendable {
        case command
        case environment
        case label
        case citation
        case acronym
        case image
        case file
        case option
    }

    let kind: Kind
    /// Angezeigt und gefiltert (Befehle ohne `\`)
    let text: String
    /// Zusatz rechts, z. B. Titel bei Zitaten oder Datei:Zeile bei Labels
    let detail: String
    /// Ersetzt das Getippte; bei Befehlen z. B. `section{}`
    let insertion: String
    /// Cursor danach, relativ zum Anfang von `insertion` (UTF-16); `nil` = dahinter
    let cursorOffset: Int?
    /// Kleingeschrieben, für die Suche
    let searchKey: String
    /// UTF-16-Positionen, an denen ein Wort beginnt (nach `:` `-` `_` `/` `.` oder bei einem Großbuchstaben)
    let wordStarts: Set<Int>
    /// Länge in UTF-16 (vorberechnet, Sortierkriterium)
    let length: Int
    /// Weiterer durchsuchbarer Text (bei Zitaten Autoren, Titel, Jahr), kleingeschrieben
    let extraSearchText: String

    var id: String { "\(kind)-\(insertion)" }

    init(kind: Kind, text: String, detail: String = "", insertion: String? = nil, cursorOffset: Int? = nil, searchableExtra: String = "") {
        self.kind = kind
        self.text = text
        self.detail = detail
        self.insertion = insertion ?? text
        self.cursorOffset = cursorOffset
        searchKey = text.lowercased()
        wordStarts = CompletionMatcher.wordStarts(in: text)
        length = (text as NSString).length
        extraSearchText = searchableExtra.lowercased()
    }

    /// Befehl mit Argument-Gerüst; der Cursor steht im ersten Argument.
    static func command(_ name: String, arguments: String = "", detail: String = "") -> CompletionItem {
        let insertion = name + arguments
        let firstArgument = arguments.firstIndex { $0 == "{" || $0 == "[" }
        let offset = firstArgument.map { (name as NSString).length + (String(arguments[...$0]) as NSString).length }
        return CompletionItem(kind: .command, text: name, detail: detail, insertion: insertion, cursorOffset: offset)
    }
}

/// Filtert und sortiert: Anfang (Groß-/Kleinschreibung passend) vor Anfang (egal) vor Wortanfang
/// (nach `:` `-` `_` `/` `.` oder Großbuchstabe) vor irgendwo enthalten vor Treffer nur im Zusatztext
/// (Autor, Titel, Jahr bei Zitaten); dann kürzer vor länger.
enum CompletionMatcher {
    static let defaultLimit = 50
    private static let wordSeparators: Set<Character> = [":", "-", "_", "/", ".", " "]

    static func rank(_ items: [CompletionItem], prefix: String, limit: Int = defaultLimit) -> [CompletionItem] {
        guard !prefix.isEmpty else { return Array(items.prefix(limit)) }
        let lowered = prefix.lowercased()
        let scored = items.compactMap { item in score(item, prefix: prefix, lowered: lowered).map { (item, $0) } }
        let sorted = scored.sorted { left, right in
            if left.1 != right.1 { return left.1 < right.1 }
            if left.0.length != right.0.length { return left.0.length < right.0.length }
            return left.0.text < right.0.text
        }
        return sorted.prefix(limit).map(\.0)
    }

    /// Ein Durchlauf über die Fundstellen im kleingeschriebenen Text; Wortanfänge sind vorberechnet.
    private static func score(_ item: CompletionItem, prefix: String, lowered: String) -> Int? {
        if item.text.hasPrefix(prefix) { return 0 }
        let key = item.searchKey as NSString
        var searchStart = 0
        var best: Int?
        while searchStart < key.length {
            let found = key.range(of: lowered, options: .literal, range: NSRange(location: searchStart, length: key.length - searchStart))
            guard found.location != NSNotFound else { break }
            if found.location == 0 { return 1 }
            if item.wordStarts.contains(found.location) { return 2 }
            best = 3
            searchStart = found.location + 1
        }
        if best == nil, !item.extraSearchText.isEmpty, item.extraSearchText.contains(lowered) { return 4 }
        return best
    }

    static func wordStarts(in text: String) -> Set<Int> {
        var starts: Set<Int> = []
        var previous: Character?
        var offset = 0
        for character in text {
            if let previous, wordSeparators.contains(previous) || (character.isUppercase && previous.isLowercase) {
                starts.insert(offset)
            }
            previous = character
            offset += character.utf16.count
        }
        return starts
    }
}
