import Foundation

struct HighlightUpdate: Equatable, Sendable {
    /// Zeichenbereich, der neu eingefärbt werden muss (ganze Zeilen).
    let range: NSRange
    let tokens: [SyntaxToken]
    let tokenizedLineCount: Int
}

/// Inkrementelles Syntax-Highlighting: speichert den Lexer-Zustand am Ende jeder Zeile.
/// Nach einer Bearbeitung wird ab der ersten geänderten Zeile neu tokenisiert, bis der
/// Endzustand wieder mit dem gespeicherten übereinstimmt.
struct SyntaxHighlighter: Sendable {
    /// Parallel zu `LineIndex`: ein Eintrag pro Zeile.
    private(set) var endStates: [LexState] = []
    /// Zustand vor der ersten Zeile (LaTeX oder BibTeX)
    private let initialState: LexState

    private static let estimatedTokensPerLine = 4

    init(language: SyntaxLanguage = .latex) {
        initialState = language.initialState
    }

    mutating func highlightAll(_ text: NSString, lines: LineIndex) -> [SyntaxToken] {
        let characters = UTF16Buffer.read(text, range: NSRange(location: 0, length: text.length))
        var tokens: [SyntaxToken] = []
        tokens.reserveCapacity(lines.lineCount * Self.estimatedTokensPerLine)
        var states: [LexState] = []
        states.reserveCapacity(lines.lineCount)

        var state = initialState
        characters.withUnsafeBufferPointer { all in
            for line in 0..<lines.lineCount {
                let range = lines.contentRange(ofLine: line)
                let content = UnsafeBufferPointer(rebasing: all[range.location..<NSMaxRange(range)])
                state = Self.tokenize(content, lineOffset: range.location, from: state, into: &tokens)
                states.append(state)
            }
        }
        endStates = states
        return tokens
    }

    /// Muss direkt nach `LineIndex.applyEdit` mit dessen Ergebnis aufgerufen werden.
    mutating func update(_ text: NSString, lines: LineIndex, splice: LineSplice) -> HighlightUpdate {
        let firstLine = splice.firstLine
        // Der Endzustand der letzten alten Zeile bleibt an der Position der letzten neuen Zeile stehen,
        // damit der Vergleich dort sinnvoll ist.
        endStates.replaceSubrange(
            firstLine..<(firstLine + splice.removedLineCount),
            with: repeatElement(initialState, count: splice.insertedLineCount)
        )
        let lastChangedLine = firstLine + splice.insertedLineCount

        var tokens: [SyntaxToken] = []
        var state = firstLine == 0 ? initialState : endStates[firstLine - 1]
        var line = firstLine
        while true {
            state = Self.tokenizeLine(line, of: text, lines: lines, from: state, into: &tokens)
            let previous = endStates[line]
            endStates[line] = state
            let hasConverged = line >= lastChangedLine && state == previous
            if hasConverged || line + 1 == lines.lineCount { break }
            line += 1
        }

        let start = lines.start(ofLine: firstLine)
        let end = NSMaxRange(lines.fullRange(ofLine: line))
        return HighlightUpdate(
            range: NSRange(location: start, length: end - start),
            tokens: tokens,
            tokenizedLineCount: line - firstLine + 1
        )
    }

    /// Tokens der Zeilen, die `range` berühren, ohne den Zustand zu verändern (z. B. für die Rechtschreibprüfung).
    func tokens(in range: NSRange, of text: NSString, lines: LineIndex) -> [SyntaxToken] {
        guard endStates.count == lines.lineCount, range.location <= lines.length else { return [] }
        let firstLine = lines.line(containing: range.location)
        let lastLine = lines.line(containing: min(max(NSMaxRange(range) - 1, range.location), lines.length))

        var tokens: [SyntaxToken] = []
        var state = firstLine == 0 ? initialState : endStates[firstLine - 1]
        for line in firstLine...lastLine {
            state = Self.tokenizeLine(line, of: text, lines: lines, from: state, into: &tokens)
        }
        return tokens
    }

    private static func tokenizeLine(
        _ line: Int,
        of text: NSString,
        lines: LineIndex,
        from state: LexState,
        into tokens: inout [SyntaxToken]
    ) -> LexState {
        let range = lines.contentRange(ofLine: line)
        let characters = UTF16Buffer.read(text, range: range)
        return characters.withUnsafeBufferPointer { content in
            tokenize(content, lineOffset: range.location, from: state, into: &tokens)
        }
    }

    /// Der Zustand bestimmt die Sprache: `.bib`-Dateien beginnen mit `.bibtex`, und der `BibTokenizer` bleibt darin.
    private static func tokenize(
        _ content: UnsafeBufferPointer<UInt16>,
        lineOffset: Int,
        from state: LexState,
        into tokens: inout [SyntaxToken]
    ) -> LexState {
        if case let .bibtex(bibState) = state {
            return .bibtex(BibTokenizer.tokenize(content, lineOffset: lineOffset, from: bibState, into: &tokens))
        }
        return LatexTokenizer.tokenize(content, lineOffset: lineOffset, from: state, into: &tokens)
    }
}
