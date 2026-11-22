import Foundation

/// Sprache einer Datei für die Syntaxfarben
enum SyntaxLanguage: Sendable {
    case latex
    case bibtex

    init(url: URL) {
        self = url.pathExtension.lowercased() == "bib" ? .bibtex : .latex
    }

    /// Zustand vor der ersten Zeile
    var initialState: LexState {
        switch self {
        case .latex: .normal
        case .bibtex: .bibtex(BibLexState())
        }
    }
}

/// Zustand am Zeilenende in einer `.bib`-Datei. Einträge und Werte gehen oft über mehrere Zeilen.
struct BibLexState: Hashable, Sendable {
    enum Phase: UInt8, Sendable {
        /// Zwischen Einträgen: Text dort ignoriert BibTeX, er wird wie ein Kommentar gefärbt.
        case outside
        /// Nach `@typ`, vor `{` bzw. `(`
        case entryOpening
        /// Zitierschlüssel bis zum Komma
        case key
        /// Erwartet einen Feldnamen oder das Ende des Eintrags
        case fieldName
        /// Nach dem Feldnamen, erwartet `=`
        case equals
        case value
        /// Inhalt von `@comment{…}`
        case comment
    }

    enum EntryKind: UInt8, Sendable {
        case regular
        /// `@string`, `@preamble`: ohne Zitierschlüssel
        case withoutKey
        case comment
    }

    var phase = Phase.outside
    var kind = EntryKind.regular
    /// Klammertiefe im Eintrag; die Klammer des Eintrags selbst ist 1.
    var depth = 0
    var inQuotes = false
    var closesWithParenthesis = false
}

/// Färbt `.bib`: Eintragstyp wie ein Befehl, Zitierschlüssel wie ein Label, Feldnamen wie Optionen,
/// Klammern und Anführungszeichen als Trenner, LaTeX-Befehle in Werten als Befehl. Werte selbst bleiben
/// ungefärbt (Titel und Namen sind Fließtext, die Rechtschreibprüfung soll sie sehen).
enum BibTokenizer {
    static func tokenize(
        _ line: UnsafeBufferPointer<UInt16>,
        lineOffset: Int,
        from state: BibLexState,
        into tokens: inout [SyntaxToken]
    ) -> BibLexState {
        var scanner = BibLineScanner(characters: line, lineOffset: lineOffset, state: state, tokens: tokens)
        tokens = []
        scanner.run()
        tokens = scanner.tokens
        return scanner.state
    }
}

private enum BibChar {
    static let at = UInt16(UInt8(ascii: "@"))
    static let backslash = UInt16(UInt8(ascii: "\\"))
    static let openBrace = UInt16(UInt8(ascii: "{"))
    static let closeBrace = UInt16(UInt8(ascii: "}"))
    static let openParenthesis = UInt16(UInt8(ascii: "("))
    static let closeParenthesis = UInt16(UInt8(ascii: ")"))
    static let quote = UInt16(UInt8(ascii: "\""))
    static let comma = UInt16(UInt8(ascii: ","))
    static let equals = UInt16(UInt8(ascii: "="))
    static let hash = UInt16(UInt8(ascii: "#"))
    static let percent = UInt16(UInt8(ascii: "%"))
    static let space = UInt16(UInt8(ascii: " "))
    static let tab = UInt16(UInt8(ascii: "\t"))
    static let carriageReturn = UInt16(UInt8(ascii: "\r"))
    /// Zeichen in Schlüsseln und Feldnamen außer Buchstaben und Ziffern
    static let nameSymbols: Set<UInt16> = Set("_-:.+/'".utf16)

    static func isLetter(_ character: UInt16) -> Bool {
        (UInt16(UInt8(ascii: "a"))...UInt16(UInt8(ascii: "z"))).contains(character)
            || (UInt16(UInt8(ascii: "A"))...UInt16(UInt8(ascii: "Z"))).contains(character)
    }

    static func isDigit(_ character: UInt16) -> Bool {
        (UInt16(UInt8(ascii: "0"))...UInt16(UInt8(ascii: "9"))).contains(character)
    }

    static func isWhitespace(_ character: UInt16) -> Bool {
        character == space || character == tab || character == carriageReturn
    }

    static func isNameCharacter(_ character: UInt16) -> Bool {
        isLetter(character) || isDigit(character) || nameSymbols.contains(character)
    }
}

private struct BibLineScanner {
    private let characters: UnsafeBufferPointer<UInt16>
    private let lineOffset: Int
    private var index = 0
    private(set) var state: BibLexState
    private(set) var tokens: [SyntaxToken]

    init(characters: UnsafeBufferPointer<UInt16>, lineOffset: Int, state: BibLexState, tokens: [SyntaxToken]) {
        self.characters = characters
        self.lineOffset = lineOffset
        self.state = state
        self.tokens = tokens
    }

    private var count: Int { characters.count }

    /// Jede Phase rückt mindestens ein Zeichen vor oder wechselt in eine Phase, die das tut.
    mutating func run() {
        while index < count {
            if allowsLineComment {
                skipWhitespace()
                guard index < count else { return }
                if characters[index] == BibChar.percent {
                    emit(.comment, from: index, to: count)
                    index = count
                    return
                }
            }
            switch state.phase {
            case .outside: scanOutside()
            case .entryOpening: scanEntryOpening()
            case .key: scanKey()
            case .fieldName: scanFieldName()
            case .equals: scanEquals()
            case .value: state.depth > 1 || state.inQuotes ? scanValueText() : scanValueTopLevel()
            case .comment: scanCommentBody()
            }
        }
    }

    /// `%` bis zum Zeilenende ist ein Kommentar (auch ein auskommentierter Eintrag oder ein Feld darin), nur nicht
    /// im Inhalt eines Werts: Dort ist es Text wie bei BibTeX. Der Zustand (Klammertiefe) bleibt unverändert.
    private var allowsLineComment: Bool {
        switch state.phase {
        case .comment: false
        case .value: state.depth <= 1 && !state.inQuotes
        default: true
        }
    }

    // MARK: Zwischen Einträgen

    private mutating func scanOutside() {
        let start = index
        while index < count, characters[index] != BibChar.at, characters[index] != BibChar.percent { index += 1 }
        emit(.comment, from: start, to: index)
        guard index < count, characters[index] == BibChar.at else { return }
        let nameStart = index + 1
        var end = nameStart
        while end < count, BibChar.isLetter(characters[end]) { end += 1 }
        guard end > nameStart else {
            emit(.comment, from: index, to: index + 1)
            index += 1
            return
        }
        emit(.command, from: index, to: end)
        state.kind = entryKind(from: nameStart, to: end)
        state.phase = .entryOpening
        index = end
    }

    private func entryKind(from start: Int, to end: Int) -> BibLexState.EntryKind {
        let name = String(decoding: characters[start..<end], as: UTF16.self).lowercased()
        switch name {
        case "comment": return .comment
        case "string", "preamble": return .withoutKey
        default: return .regular
        }
    }

    private mutating func scanEntryOpening() {
        skipWhitespace()
        guard index < count else { return }
        let character = characters[index]
        guard character == BibChar.openBrace || character == BibChar.openParenthesis else {
            state = BibLexState()
            return
        }
        emitDelimiter()
        state.depth = 1
        state.closesWithParenthesis = character == BibChar.openParenthesis
        switch state.kind {
        case .regular: state.phase = .key
        case .withoutKey: state.phase = .fieldName
        case .comment: state.phase = .comment
        }
    }

    // MARK: Schlüssel und Felder

    private mutating func scanKey() {
        skipWhitespace()
        guard index < count else { return }
        let character = characters[index]
        if character == BibChar.comma {
            index += 1
            state.phase = .fieldName
        } else if isEntryCloser(character) {
            closeEntry()
        } else {
            let start = index
            while index < count, !endsKey(characters[index]) { index += 1 }
            emit(.keyArgument, from: start, to: index)
        }
    }

    private func endsKey(_ character: UInt16) -> Bool {
        character == BibChar.comma || isEntryCloser(character) || BibChar.isWhitespace(character)
    }

    private mutating func scanFieldName() {
        skipWhitespace()
        guard index < count else { return }
        let character = characters[index]
        if isEntryCloser(character) {
            closeEntry()
        } else if character == BibChar.openBrace || character == BibChar.quote {
            // `@preamble{"…"}`: Wert ohne Namen
            state.phase = .value
        } else if BibChar.isNameCharacter(character) {
            let start = index
            while index < count, BibChar.isNameCharacter(characters[index]) { index += 1 }
            emit(.optionalArgument, from: start, to: index)
            state.phase = .equals
        } else {
            index += 1
        }
    }

    private mutating func scanEquals() {
        skipWhitespace()
        guard index < count else { return }
        if characters[index] == BibChar.equals {
            emitDelimiter()
            state.phase = .value
        } else {
            state.phase = .fieldName
        }
    }

    // MARK: Werte

    /// Auf oberster Ebene des Werts: `{` oder `"` öffnet, `#` verkettet, Namen sind `@string`-Makros.
    private mutating func scanValueTopLevel() {
        skipWhitespace()
        guard index < count else { return }
        let character = characters[index]
        switch character {
        case BibChar.openBrace:
            emitDelimiter()
            state.depth += 1
        case BibChar.quote:
            emitDelimiter()
            state.inQuotes = true
        case BibChar.hash:
            emitDelimiter()
        case BibChar.comma:
            index += 1
            state.phase = .fieldName
        case _ where isEntryCloser(character):
            closeEntry()
        case _ where BibChar.isLetter(character):
            let start = index
            while index < count, BibChar.isNameCharacter(characters[index]) { index += 1 }
            emit(.keyArgument, from: start, to: index)
        default:
            index += 1
        }
    }

    /// In `{…}` oder `"…"`: nur Klammern, das schließende `"` und LaTeX-Befehle werden gefärbt.
    private mutating func scanValueText() {
        while index < count {
            switch characters[index] {
            case BibChar.backslash:
                emitCommand()
            case BibChar.openBrace:
                emitDelimiter()
                state.depth += 1
            case BibChar.closeBrace:
                guard state.depth > 1 else {
                    // Kaputter Eintrag (Anführungszeichen nicht geschlossen): die Klammer beendet ihn
                    closeEntry()
                    return
                }
                emitDelimiter()
                state.depth -= 1
                if state.depth == 1, !state.inQuotes { return }
            case BibChar.quote where state.inQuotes && state.depth == 1:
                emitDelimiter()
                state.inQuotes = false
                return
            default:
                index += 1
            }
        }
    }

    private mutating func emitCommand() {
        let start = index
        index += 1
        if index < count, BibChar.isLetter(characters[index]) {
            while index < count, BibChar.isLetter(characters[index]) { index += 1 }
        } else if index < count {
            index += 1
        }
        emit(.command, from: start, to: index)
    }

    // MARK: @comment

    private mutating func scanCommentBody() {
        let start = index
        while index < count {
            let character = characters[index]
            if character == BibChar.openBrace {
                state.depth += 1
            } else if state.depth == 1, isEntryCloser(character) {
                emit(.comment, from: start, to: index)
                closeEntry()
                return
            } else if character == BibChar.closeBrace {
                state.depth -= 1
            }
            index += 1
        }
        emit(.comment, from: start, to: index)
    }

    // MARK: Hilfen

    private func isEntryCloser(_ character: UInt16) -> Bool {
        character == (state.closesWithParenthesis ? BibChar.closeParenthesis : BibChar.closeBrace)
    }

    private mutating func closeEntry() {
        emitDelimiter()
        state = BibLexState()
    }

    private mutating func skipWhitespace() {
        while index < count, BibChar.isWhitespace(characters[index]) { index += 1 }
    }

    private mutating func emitDelimiter() {
        emit(.delimiter, from: index, to: index + 1)
        index += 1
    }

    private mutating func emit(_ kind: TokenKind, from start: Int, to end: Int) {
        guard end > start else { return }
        tokens.append(SyntaxToken(kind: kind, location: lineOffset + start, length: end - start))
    }
}
