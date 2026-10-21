import Foundation

/// Welche Art Argument gerade getippt wird (bestimmt die Vorschläge).
enum ArgumentKind: Equatable, Hashable, Sendable {
    case label
    case citation
    case graphics
    case input
    case beginEnvironment
    case endEnvironment
}

/// Wessen Optionen in `[…]` gerade getippt werden.
enum OptionTarget: Equatable, Hashable, Sendable {
    case graphics
    case floatPlacement
    /// `tabular`, `minipage`, `array`: Ausrichtung t/c/b
    case boxPosition
    case citation
    /// Name aus `\documentclass[…]{name}`, leer, solange er noch nicht dasteht
    case documentClass(String)
    case package(String)

    /// Nur ein Wert in den Klammern: Nach der Übernahme wird `]` ergänzt, falls es fehlt.
    var isSingleValue: Bool {
        switch self {
        case .floatPlacement, .boxPosition, .citation: true
        case .graphics, .documentClass, .package: false
        }
    }
}

/// Wo der Cursor steht: hinter `\` und Buchstaben (Befehl), in `{…}` eines bekannten Befehls oder in
/// `[…]` (Option; `key` gesetzt, wenn hinter `key=` ein Wert getippt wird).
struct CompletionContext: Equatable, Sendable {
    enum Kind: Equatable, Hashable, Sendable {
        case command
        case argument(ArgumentKind)
        case option(OptionTarget, key: String?)
    }

    let kind: Kind
    /// Bereits Getipptes (ohne `\`, bzw. ab `{` oder `,`)
    let prefix: String
    /// Bereich des Getippten im Dokument (UTF-16); wird beim Übernehmen ersetzt
    let range: NSRange
}

/// Erkennt den Kontext aus der aktuellen Zeile bis zum Cursor. Läuft bei jedem Tastendruck, deshalb nur
/// auf UTF-16 und höchstens `maximumLookBehind` Zeichen zurück.
enum CompletionContextDetector {
    static let maximumLookBehind = 300

    static let argumentCommands: [String: ArgumentKind] = {
        var commands: [String: ArgumentKind] = [:]
        for name in ["ref", "eqref", "pageref", "autoref", "Autoref", "cref", "Cref", "vref", "nameref", "labelcref", "cpageref"] {
            commands[name] = .label
        }
        for name in ["cite", "citep", "citet", "citealp", "citeauthor", "citeyear", "citetitle", "parencite", "Parencite",
                     "textcite", "Textcite", "autocite", "Autocite", "footcite", "fullcite", "nocite", "smartcite", "supercite"] {
            commands[name] = .citation
        }
        commands["includegraphics"] = .graphics
        for name in ["input", "include", "subfile", "includeonly"] { commands[name] = .input }
        commands["begin"] = .beginEnvironment
        commands["end"] = .endEnvironment
        return commands
    }()

    /// Argumente, die eine Liste mit Kommas sein dürfen (`\cite{a,b}`, `\cref{a,b}`)
    private static let listKinds: Set<ArgumentKind> = [.citation, .label]

    private static let backslash = UInt16(UInt8(ascii: "\\"))
    private static let openBrace = UInt16(UInt8(ascii: "{"))
    private static let closeBrace = UInt16(UInt8(ascii: "}"))
    private static let openBracket = UInt16(UInt8(ascii: "["))
    private static let closeBracket = UInt16(UInt8(ascii: "]"))
    private static let comma = UInt16(UInt8(ascii: ","))
    private static let percent = UInt16(UInt8(ascii: "%"))
    private static let star = UInt16(UInt8(ascii: "*"))
    private static let space = UInt16(UInt8(ascii: " "))
    private static let tab = UInt16(UInt8(ascii: "\t"))

    /// Erst die billige Suche rückwärts ab dem Cursor; die Prüfung auf `%` (ganze Zeile) nur bei einem Treffer.
    static func detect(in text: NSString, cursor: Int, lineStart: Int) -> CompletionContext? {
        guard cursor > lineStart, cursor <= text.length else { return nil }
        let start = max(lineStart, cursor - maximumLookBehind)
        let detected = command(in: text, cursor: cursor, start: start)
            ?? argument(in: text, cursor: cursor, start: start)
            ?? option(in: text, cursor: cursor, start: start)
        guard let detected, !LatexComments.isInComment(text, lineStart: lineStart, location: cursor) else { return nil }
        return detected
    }

    // MARK: Befehl

    private static func command(in text: NSString, cursor: Int, start: Int) -> CompletionContext? {
        var wordStart = cursor
        while wordStart > start, isLetter(text.character(at: wordStart - 1)) { wordStart -= 1 }
        guard wordStart > start, text.character(at: wordStart - 1) == backslash,
              isUnescapedBackslash(text, at: wordStart - 1, start: start) else { return nil }
        let range = NSRange(location: wordStart, length: cursor - wordStart)
        return CompletionContext(kind: .command, prefix: text.substring(with: range), range: range)
    }

    // MARK: Argument

    private static func argument(in text: NSString, cursor: Int, start: Int) -> CompletionContext? {
        guard let (separator, argumentStart) = argumentStart(in: text, cursor: cursor, start: start) else { return nil }
        var brace = separator
        if text.character(at: separator) == comma {
            guard let open = openingBrace(in: text, before: separator, start: start) else { return nil }
            brace = open
        }
        guard let name = commandName(in: text, beforeBrace: brace, start: start),
              let kind = argumentCommands[name] else { return nil }
        if text.character(at: separator) == comma, !listKinds.contains(kind) { return nil }
        var location = argumentStart
        while location < cursor, isBlank(text.character(at: location)) { location += 1 }
        let range = NSRange(location: location, length: cursor - location)
        return CompletionContext(kind: .argument(kind), prefix: text.substring(with: range), range: range)
    }

    /// Sucht rückwärts das `{` oder `,`, hinter dem das aktuelle Argument beginnt. Ein Argument ist ein Wort
    /// (Labels, Schlüssel, Pfade); Leerraum ist nur direkt nach `{` oder `,` erlaubt. So endet die Suche
    /// in Fließtext schon am Wortanfang.
    private static func argumentStart(in text: NSString, cursor: Int, start: Int) -> (separator: Int, argumentStart: Int)? {
        var index = cursor
        while index > start, !isBlank(text.character(at: index - 1)) {
            let character = text.character(at: index - 1)
            if character == openBrace || character == comma { return (index - 1, index) }
            if character == closeBrace || character == backslash { return nil }
            index -= 1
        }
        while index > start, isBlank(text.character(at: index - 1)) { index -= 1 }
        guard index > start else { return nil }
        let character = text.character(at: index - 1)
        guard character == openBrace || character == comma else { return nil }
        return (index - 1, index)
    }

    private static func openingBrace(in text: NSString, before index: Int, start: Int) -> Int? {
        var position = index
        while position > start {
            let character = text.character(at: position - 1)
            if character == openBrace { return position - 1 }
            if character == closeBrace || character == backslash { return nil }
            position -= 1
        }
        return nil
    }

    /// Name des Befehls vor `{`; optionale Argumente `[…]` und `*` dazwischen werden übersprungen.
    private static func commandName(in text: NSString, beforeBrace brace: Int, start: Int) -> String? {
        var index = brace
        while index > start, text.character(at: index - 1) == closeBracket {
            guard let open = matchingOpenBracket(in: text, before: index - 1, start: start) else { return nil }
            index = open
        }
        if index > start, text.character(at: index - 1) == star { index -= 1 }
        let nameEnd = index
        while index > start, isLetter(text.character(at: index - 1)) { index -= 1 }
        guard index < nameEnd, index > start, text.character(at: index - 1) == backslash,
              isUnescapedBackslash(text, at: index - 1, start: start) else { return nil }
        return text.substring(with: NSRange(location: index, length: nameEnd - index))
    }

    private static func matchingOpenBracket(in text: NSString, before index: Int, start: Int) -> Int? {
        var position = index
        while position > start {
            if text.character(at: position - 1) == openBracket { return position - 1 }
            position -= 1
        }
        return nil
    }

    // MARK: Option

    private static let floatEnvironments: Set<String> = ["figure", "figure*", "table", "table*", "program", "algorithm", "listing"]
    private static let boxEnvironments: Set<String> = ["tabular", "tabular*", "minipage", "array"]
    private static let equals = UInt16(UInt8(ascii: "="))
    private static let newline = UInt16(UInt8(ascii: "\n"))

    private static func option(in text: NSString, cursor: Int, start: Int) -> CompletionContext? {
        guard let (separator, tokenStart) = optionStart(in: text, cursor: cursor, start: start) else { return nil }
        var bracket = separator
        if text.character(at: separator) == comma {
            guard let open = matchingOpenBracket(in: text, before: separator, start: start) else { return nil }
            bracket = open
        }
        guard let target = optionTarget(in: text, beforeBracket: bracket, cursor: cursor, start: start) else { return nil }
        var location = tokenStart
        while location < cursor, isBlank(text.character(at: location)) { location += 1 }
        let token = text.substring(with: NSRange(location: location, length: cursor - location)) as NSString
        let equalsSign = token.range(of: "=")
        guard equalsSign.location != NSNotFound else {
            let range = NSRange(location: location, length: cursor - location)
            return CompletionContext(kind: .option(target, key: nil), prefix: token as String, range: range)
        }
        let key = token.substring(to: equalsSign.location).trimmingCharacters(in: .whitespaces)
        let valueStart = location + equalsSign.location + 1
        let range = NSRange(location: valueStart, length: cursor - valueStart)
        return CompletionContext(kind: .option(target, key: key), prefix: text.substring(with: range), range: range)
    }

    /// Rückwärts bis `[` oder `,`; Werte dürfen `\` enthalten (`0.8\textwidth`), aber keine Klammern.
    private static func optionStart(in text: NSString, cursor: Int, start: Int) -> (separator: Int, tokenStart: Int)? {
        var index = cursor
        while index > start {
            let character = text.character(at: index - 1)
            if character == openBracket || character == comma { return (index - 1, index) }
            if character == closeBracket || character == openBrace || character == closeBrace { return nil }
            index -= 1
        }
        return nil
    }

    /// Wem gehört die Klammer: Befehl (`\includegraphics[`, `\cite[…][`) oder Umgebung (`\begin{figure}[`).
    private static func optionTarget(in text: NSString, beforeBracket bracket: Int, cursor: Int, start: Int) -> OptionTarget? {
        var index = bracket
        while index > start, text.character(at: index - 1) == closeBracket {
            guard let open = matchingOpenBracket(in: text, before: index - 1, start: start) else { return nil }
            index = open
        }
        if index > start, text.character(at: index - 1) == closeBrace {
            return environmentName(in: text, beforeClosingBrace: index - 1, start: start).flatMap(environmentTarget)
        }
        guard let name = commandName(in: text, beforeBrace: index, start: start) else { return nil }
        switch name {
        case "includegraphics": return .graphics
        case "documentclass": return .documentClass(nameAfterOptions(in: text, from: cursor))
        case "usepackage", "RequirePackage": return .package(nameAfterOptions(in: text, from: cursor))
        default: return argumentCommands[name] == .citation ? .citation : nil
        }
    }

    private static func environmentTarget(_ name: String) -> OptionTarget? {
        if floatEnvironments.contains(name) { return .floatPlacement }
        return boxEnvironments.contains(name) ? .boxPosition : nil
    }

    /// `\begin{name}` direkt vor der Klammer
    private static func environmentName(in text: NSString, beforeClosingBrace closing: Int, start: Int) -> String? {
        var open = closing
        while open > start, text.character(at: open - 1) != openBrace { open -= 1 }
        guard open > start, commandName(in: text, beforeBrace: open - 1, start: start) == "begin" else { return nil }
        return text.substring(with: NSRange(location: open, length: closing - open))
    }

    /// Name aus `…]{name}` hinter dem Cursor in derselben Zeile (Paket, Klasse), sonst leer.
    private static func nameAfterOptions(in text: NSString, from cursor: Int) -> String {
        let lineEnd = NSMaxRange(text.lineRange(for: NSRange(location: cursor, length: 0)))
        let rest = text.substring(with: NSRange(location: cursor, length: lineEnd - cursor))
        guard let close = rest.firstIndex(of: "]") else { return "" }
        let afterBracket = rest[rest.index(after: close)...].drop { $0 == " " }
        guard afterBracket.first == "{", let end = afterBracket.firstIndex(of: "}") else { return "" }
        return String(afterBracket[afterBracket.index(after: afterBracket.startIndex)..<end]).trimmingCharacters(in: .whitespaces)
    }

    // MARK: Hilfen

    /// Ein `\` ist ein Befehlsanfang, wenn davor eine gerade Anzahl `\` steht (`\\sec` ist Zeilenumbruch + Text).
    private static func isUnescapedBackslash(_ text: NSString, at index: Int, start: Int) -> Bool {
        var count = 0
        var position = index
        while position >= start, text.character(at: position) == backslash {
            count += 1
            position -= 1
        }
        return count % 2 == 1
    }

    private static func isLetter(_ character: UInt16) -> Bool {
        (65...90).contains(character) || (97...122).contains(character)
    }

    private static func isBlank(_ character: UInt16) -> Bool {
        character == space || character == tab
    }
}
