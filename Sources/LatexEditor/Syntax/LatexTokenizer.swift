import Foundation

enum TokenKind: UInt8, Sendable {
    /// `\section`, `\\`, escapte Zeichen wie `\%` oder `\$`
    case command
    /// `{` `}` `[` `]`
    case delimiter
    /// Inhalt von `[...]` nach einem Befehl
    case optionalArgument
    /// Inhalt von Schlüssel-Argumenten (`\label{...}`, `\begin{...}`, ...), kein Fließtext
    case keyArgument
    case math
    case comment
    case verbatim
}

struct SyntaxToken: Equatable, Sendable {
    let kind: TokenKind
    let location: Int
    let length: Int

    var range: NSRange { NSRange(location: location, length: length) }
}

enum MathDelimiter: Hashable, Sendable {
    case dollar
    case doubleDollar
    case parenthesis
    case bracket
}

/// Lexer-Zustand am Zeilenende. Alles außer `.normal` setzt sich in die nächste Zeile fort.
enum LexState: Hashable, Sendable {
    case normal
    case math(MathDelimiter)
    case mathEnvironment(String)
    case verbatimEnvironment(String)
    /// `.bib`-Dateien (`BibTokenizer`)
    case bibtex(BibLexState)

    /// Mathe endet an einer Leerzeile (in TeX wäre eine Leerzeile dort ein Fehler).
    /// Das begrenzt das Umfärben beim Tippen eines offenen `$` auf den Absatz.
    var endsAtBlankLine: Bool {
        switch self {
        case .math, .mathEnvironment: true
        case .normal, .verbatimEnvironment, .bibtex: false
        }
    }
}

enum LatexTokenizer {
    /// Tokenisiert eine Zeile (ohne "\n") ab `state` und gibt den Zustand am Zeilenende zurück.
    /// Token-Positionen sind absolut (`lineOffset` + Position in der Zeile).
    static func tokenize(
        _ line: UnsafeBufferPointer<UInt16>,
        lineOffset: Int,
        from state: LexState,
        into tokens: inout [SyntaxToken]
    ) -> LexState {
        var scanner = LatexLineScanner(characters: line, lineOffset: lineOffset, state: state, tokens: tokens)
        tokens = []
        scanner.run()
        tokens = scanner.tokens
        return scanner.state
    }
}

// MARK: - Zeilenscanner

private enum Char {
    static let backslash = UInt16(UInt8(ascii: "\\"))
    static let percent = UInt16(UInt8(ascii: "%"))
    static let dollar = UInt16(UInt8(ascii: "$"))
    static let openBrace = UInt16(UInt8(ascii: "{"))
    static let closeBrace = UInt16(UInt8(ascii: "}"))
    static let openBracket = UInt16(UInt8(ascii: "["))
    static let closeBracket = UInt16(UInt8(ascii: "]"))
    static let openParenthesis = UInt16(UInt8(ascii: "("))
    static let closeParenthesis = UInt16(UInt8(ascii: ")"))
    static let star = UInt16(UInt8(ascii: "*"))
    static let space = UInt16(UInt8(ascii: " "))
    static let tab = UInt16(UInt8(ascii: "\t"))
    static let carriageReturn = UInt16(UInt8(ascii: "\r"))
    static let at = UInt16(UInt8(ascii: "@"))
    static let lowercaseA = UInt16(UInt8(ascii: "a"))
    static let lowercaseE = UInt16(UInt8(ascii: "e"))
    static let lowercaseZ = UInt16(UInt8(ascii: "z"))
    static let uppercaseA = UInt16(UInt8(ascii: "A"))
    static let uppercaseZ = UInt16(UInt8(ascii: "Z"))
}

private enum Vocabulary {
    /// Befehle, deren erstes {}-Argument kein Fließtext ist (Labels, Schlüssel, Pfade, Namen).
    static let keyArgumentCommands: Set<String> = [
        "label", "ref", "eqref", "pageref", "autoref", "cref", "Cref", "nameref", "vref",
        "cite", "citep", "citet", "citealp", "parencite", "textcite", "autocite", "footcite",
        "nocite", "citeauthor", "citeyear", "fullcite",
        "end", "usepackage", "RequirePackage", "documentclass",
        "input", "include", "includeonly", "includegraphics", "subfile", "graphicspath",
        "bibliography", "bibliographystyle", "addbibresource",
        "url", "href", "hyperref",
        "newcommand", "renewcommand", "providecommand", "newenvironment", "renewenvironment",
        "DeclareMathOperator", "lstinputlisting", "inputminted",
        "setlength", "addtolength", "setcounter", "addtocounter", "numberwithin",
        "vspace", "hspace", "hypersetup", "pagestyle", "thispagestyle", "pagenumbering",
        "definecolor", "color", "textcolor",
        "ac", "acs", "acl", "acf", "acp", "Ac", "acsp", "aclp", "acfp",
        "gls", "Gls", "glspl", "Glspl", "newacronym"
    ]

    static let commentEnvironment = "comment"
}

private struct LatexLineScanner {
    private let characters: UnsafeBufferPointer<UInt16>
    private let lineOffset: Int
    private var index = 0
    /// Beginn eines Mathe-Bereichs, der in dieser Zeile geöffnet wurde (inklusive Öffner).
    private var regionStart: Int?
    private(set) var state: LexState
    private(set) var tokens: [SyntaxToken]

    init(characters: UnsafeBufferPointer<UInt16>, lineOffset: Int, state: LexState, tokens: [SyntaxToken]) {
        self.characters = characters
        self.lineOffset = lineOffset
        self.state = state
        self.tokens = tokens
    }

    private var count: Int { characters.count }

    mutating func run() {
        if state.endsAtBlankLine, isBlankLine {
            state = .normal
            return
        }
        while index < count {
            switch state {
            case .normal: scanNormal()
            case .math, .mathEnvironment: scanMath()
            case let .verbatimEnvironment(name): scanVerbatimEnvironment(name)
            // Der Highlighter gibt `.bib`-Zeilen an den `BibTokenizer`
            case .bibtex: return
            }
        }
    }

    // MARK: Normaler Text

    private mutating func scanNormal() {
        while index < count {
            switch characters[index] {
            case Char.percent:
                emitComment()
            case Char.backslash:
                scanBackslash()
                if state != .normal { return }
            case Char.dollar:
                openDollarMath()
                return
            case Char.openBrace, Char.closeBrace:
                emit(.delimiter, from: index, to: index + 1)
                index += 1
            default:
                index += 1
            }
        }
    }

    private mutating func emitComment() {
        emit(.comment, from: index, to: count)
        index = count
    }

    private mutating func openDollarMath() {
        let isDisplay = index + 1 < count && characters[index + 1] == Char.dollar
        openMath(isDisplay ? .doubleDollar : .dollar, openerLength: isDisplay ? 2 : 1)
    }

    private mutating func openMath(_ delimiter: MathDelimiter, openerLength: Int) {
        regionStart = index
        index += openerLength
        state = .math(delimiter)
    }

    private mutating func scanBackslash() {
        let start = index
        let next = index + 1
        guard next < count else {
            emit(.command, from: start, to: next)
            index = next
            return
        }
        let character = characters[next]
        if isLetter(character) {
            scanCommandWord(start: start)
        } else if character == Char.openBracket {
            openMath(.bracket, openerLength: 2)
        } else if character == Char.openParenthesis {
            openMath(.parenthesis, openerLength: 2)
        } else {
            emit(.command, from: start, to: next + 1)
            index = next + 1
            if character == Char.backslash { scanOptionalArguments() }
        }
    }

    private mutating func scanCommandWord(start: Int) {
        let nameEnd = letterRunEnd(from: start + 1)
        let name = string(from: start + 1, to: nameEnd)
        if name == "verb" {
            scanVerb(start: start, afterName: nameEnd)
            return
        }
        let commandEnd = nameEnd < count && characters[nameEnd] == Char.star ? nameEnd + 1 : nameEnd
        emit(.command, from: start, to: commandEnd)
        index = commandEnd

        if name == "begin" {
            scanBeginArguments()
        } else if Vocabulary.keyArgumentCommands.contains(name) {
            scanOptionalArguments()
            scanKeyArgument()
        } else {
            scanOptionalArguments()
        }
    }

    // MARK: Argumente

    private mutating func scanOptionalArguments() {
        var position = skipSpaces(from: index)
        while position < count, characters[position] == Char.openBracket {
            let match = findClosingBracket(openedAt: position)
            emit(.delimiter, from: position, to: position + 1)
            emit(.optionalArgument, from: position + 1, to: match.contentEnd)
            index = match.contentEnd
            guard let close = match.close else { return }
            emit(.delimiter, from: close, to: close + 1)
            index = close + 1
            position = skipSpaces(from: index)
        }
    }

    /// Liest `{...}` als Schlüssel-Argument und gibt dessen Inhalt zurück, falls geschlossen.
    @discardableResult
    private mutating func scanKeyArgument() -> String? {
        let position = skipSpaces(from: index)
        guard position < count, characters[position] == Char.openBrace else { return nil }
        let match = findClosingBrace(openedAt: position)
        emit(.delimiter, from: position, to: position + 1)
        emit(.keyArgument, from: position + 1, to: match.contentEnd)
        index = match.contentEnd
        guard let close = match.close else { return nil }
        emit(.delimiter, from: close, to: close + 1)
        index = close + 1
        return string(from: position + 1, to: close)
    }

    private mutating func scanBeginArguments() {
        guard let environment = scanKeyArgument() else { return }
        // Listen aus `LatexEnvironments` (gemeinsam mit Wortzähler, Verweisprüfung und Maskierung)
        if LatexEnvironments.isMath(environment) {
            regionStart = index
            state = .mathEnvironment(environment)
        } else if LatexEnvironments.isVerbatim(environment) {
            scanOptionalArguments()
            state = .verbatimEnvironment(environment)
        }
    }

    private mutating func scanVerb(start: Int, afterName: Int) {
        var position = afterName
        if position < count, characters[position] == Char.star { position += 1 }
        guard position < count else {
            emit(.verbatim, from: start, to: count)
            index = count
            return
        }
        let delimiter = characters[position]
        var end = count
        if let close = (position + 1..<count).first(where: { characters[$0] == delimiter }) {
            end = close + 1
        }
        emit(.verbatim, from: start, to: end)
        index = end
    }

    // MARK: Mathe

    private mutating func scanMath() {
        let start = regionStart ?? index
        regionStart = nil
        while index < count {
            let character = characters[index]
            if character == Char.percent {
                emit(.math, from: start, to: index)
                emitComment()
                return
            }
            if character == Char.backslash, scanMathBackslash(regionStart: start) { return }
            if character == Char.dollar, closeDollarMath(regionStart: start) { return }
            if character != Char.backslash { index += 1 }
        }
        emit(.math, from: start, to: count)
    }

    /// Verarbeitet `\...` in Mathe. Gibt `true` zurück, wenn der Mathe-Bereich dadurch endet.
    private mutating func scanMathBackslash(regionStart start: Int) -> Bool {
        let next = index + 1
        guard next < count else {
            index = next
            return false
        }
        let character = characters[next]
        if (state == .math(.bracket) && character == Char.closeBracket)
            || (state == .math(.parenthesis) && character == Char.closeParenthesis) {
            emit(.math, from: start, to: next + 1)
            index = next + 1
            state = .normal
            return true
        }
        guard isLetter(character) else {
            index = next + 1
            return false
        }
        if character == Char.lowercaseE, case let .mathEnvironment(environment) = state,
           endsEnvironment(environment, at: index) {
            emit(.math, from: start, to: index)
            state = .normal
            scanCommandWord(start: index)
            return true
        }
        index = letterRunEnd(from: next)
        return false
    }

    private mutating func closeDollarMath(regionStart start: Int) -> Bool {
        let closerLength: Int
        switch state {
        case .math(.dollar): closerLength = 1
        case .math(.doubleDollar) where index + 1 < count && characters[index + 1] == Char.dollar: closerLength = 2
        default: return false
        }
        emit(.math, from: start, to: index + closerLength)
        index += closerLength
        state = .normal
        return true
    }

    // MARK: Verbatim-Umgebungen

    private mutating func scanVerbatimEnvironment(_ environment: String) {
        let kind: TokenKind = environment == Vocabulary.commentEnvironment ? .comment : .verbatim
        let start = index
        let end = (start..<count).first { position in
            characters[position] == Char.backslash && endsEnvironment(environment, at: position)
        }
        guard let end else {
            emit(kind, from: start, to: count)
            index = count
            return
        }
        emit(kind, from: start, to: end)
        state = .normal
        scanCommandWord(start: end)
    }

    // MARK: Hilfen

    /// Prüft, ob an `position` genau `\end{environment}` steht.
    private func endsEnvironment(_ environment: String, at position: Int) -> Bool {
        let pattern = Array("\\end{\(environment)}".utf16)
        guard position + pattern.count <= count else { return false }
        for (offset, character) in pattern.enumerated() where characters[position + offset] != character {
            return false
        }
        return true
    }

    /// Schließende `}` passend zu `{` an `openedAt`. Stoppt an einem unescapten `%`.
    private func findClosingBrace(openedAt start: Int) -> (close: Int?, contentEnd: Int) {
        var depth = 0
        var position = start
        while position < count {
            switch characters[position] {
            case Char.backslash: position += 1
            case Char.percent: return (nil, position)
            case Char.openBrace: depth += 1
            case Char.closeBrace:
                depth -= 1
                if depth == 0 { return (position, position) }
            default: break
            }
            position += 1
        }
        return (nil, count)
    }

    /// Erste `]` auf Klammertiefe 0 nach `[` an `openedAt`. Stoppt an einem unescapten `%`.
    private func findClosingBracket(openedAt start: Int) -> (close: Int?, contentEnd: Int) {
        var depth = 0
        var position = start + 1
        while position < count {
            switch characters[position] {
            case Char.backslash: position += 1
            case Char.percent: return (nil, position)
            case Char.openBrace: depth += 1
            case Char.closeBrace: depth = max(depth - 1, 0)
            case Char.closeBracket where depth == 0: return (position, position)
            default: break
            }
            position += 1
        }
        return (nil, count)
    }

    private var isBlankLine: Bool {
        characters.allSatisfy { $0 == Char.space || $0 == Char.tab || $0 == Char.carriageReturn }
    }

    private func skipSpaces(from start: Int) -> Int {
        var position = start
        while position < count, characters[position] == Char.space || characters[position] == Char.tab {
            position += 1
        }
        return position
    }

    private func letterRunEnd(from start: Int) -> Int {
        var position = start
        while position < count, isLetter(characters[position]) { position += 1 }
        return position
    }

    private func isLetter(_ character: UInt16) -> Bool {
        (character >= Char.lowercaseA && character <= Char.lowercaseZ)
            || (character >= Char.uppercaseA && character <= Char.uppercaseZ)
            || character == Char.at
    }

    private func string(from start: Int, to end: Int) -> String {
        String(decoding: UnsafeBufferPointer(rebasing: characters[start..<min(end, count)]), as: UTF16.self)
    }

    private mutating func emit(_ kind: TokenKind, from start: Int, to end: Int) {
        guard end > start else { return }
        tokens.append(SyntaxToken(kind: kind, location: lineOffset + start, length: end - start))
    }
}
