import Foundation
import Testing
@testable import LatexEditor

/// Text, Zeilenindex und Highlighter im Gleichschritt, wie in DocumentSession.
private struct HighlightedText {
    let text: NSMutableString
    var lines: LineIndex
    var highlighter = SyntaxHighlighter()
    private(set) var allTokens: [SyntaxToken] = []

    init(_ string: String) {
        text = NSMutableString(string: string)
        lines = LineIndex(text: text)
        allTokens = highlighter.highlightAll(text, lines: lines)
    }

    mutating func replace(_ range: NSRange, with replacement: String) -> HighlightUpdate {
        let edit = LatexEditorTests.replace(text, range: range, with: replacement)
        return apply(edit)
    }

    mutating func apply(_ edit: (editedRange: NSRange, delta: Int)) -> HighlightUpdate {
        let splice = lines.applyEdit(in: text, editedRange: edit.editedRange, changeInLength: edit.delta)
        return highlighter.update(text, lines: lines, splice: splice)
    }

    func location(of substring: String) -> Int {
        text.range(of: substring).location
    }
}

@Suite("SyntaxHighlighter")
struct SyntaxHighlighterTests {
    private static let paragraphs = """
        Erster Absatz mit Text.
        Noch eine Zeile.

        Zweiter Absatz.
        Mit zwei Zeilen.

        Dritter Absatz am Ende.
        """

    @Test("Komplettes Einfärben speichert einen Endzustand pro Zeile")
    func fullHighlightStates() {
        let document = HighlightedText("a\n\\begin{equation}\nx\n\\end{equation}\nb")
        #expect(document.highlighter.endStates == [
            .normal, .mathEnvironment("equation"), .mathEnvironment("equation"), .normal, .normal
        ])
    }

    @Test("Normales Tippen färbt genau eine Zeile neu")
    func typingTouchesOneLine() {
        var document = HighlightedText(Self.paragraphs)
        let location = document.location(of: "Zweiter") + 3

        let update = document.replace(NSRange(location: location, length: 0), with: "x")

        #expect(update.tokenizedLineCount == 1)
        #expect(update.range == document.lines.fullRange(ofLine: 3))
    }

    @Test("Ein offenes $ färbt nur bis zum Absatzende neu")
    func openDollarStopsAtParagraph() {
        var document = HighlightedText(Self.paragraphs)
        let location = document.location(of: "Zweiter")

        let update = document.replace(NSRange(location: location, length: 0), with: "$")

        // Zeile 3 und 4 sind Mathe, Leerzeile 5 setzt zurück und konvergiert.
        #expect(update.tokenizedLineCount == 3)
        #expect(update.tokens.allSatisfy { $0.kind == .math })
        #expect(document.highlighter.endStates[4] == .math(.dollar))
        #expect(document.highlighter.endStates[5] == .normal)
    }

    @Test("Offene Verbatim-Umgebung wirkt bis zum Dateiende und wird beim Schließen zurückgenommen")
    func verbatimPropagatesAndReconverges() {
        var document = HighlightedText(Self.paragraphs)
        let lastLine = document.lines.lineCount - 1

        let opening = document.replace(NSRange(location: 0, length: 0), with: "\\begin{verbatim}\n")
        #expect(opening.tokenizedLineCount == document.lines.lineCount)
        #expect(document.highlighter.endStates[lastLine + 1] == .verbatimEnvironment("verbatim"))

        let closeLocation = document.location(of: "Noch")
        let closing = document.replace(NSRange(location: closeLocation, length: 0), with: "\\end{verbatim}\n")
        #expect(document.highlighter.endStates.last == .normal)
        #expect(closing.tokenizedLineCount < document.lines.lineCount)
    }

    @Test("Inkrementelle Zustände entsprechen nach zufälligen Bearbeitungen einem Neuaufbau")
    func randomEditsMatchFullHighlight() {
        var generator = SeededGenerator(seed: 7)
        var document = HighlightedText(LargeDocument.make(lineCount: 300))
        for _ in 0..<500 {
            let edit = randomEdit(in: document.text, using: &generator)
            let update = document.apply(edit)
            #expect(update.range.location + update.range.length <= document.text.length)
        }
        var fresh = SyntaxHighlighter()
        let freshTokens = fresh.highlightAll(document.text, lines: LineIndex(text: document.text))

        #expect(document.highlighter.endStates == fresh.endStates)
        let fullRange = NSRange(location: 0, length: document.text.length)
        #expect(document.highlighter.tokens(in: fullRange, of: document.text, lines: document.lines) == freshTokens)
    }

    @Test("Tokens für einen Teilbereich nutzen den gespeicherten Zustand der Vorzeile")
    func tokensInRangeUseStoredState() {
        let document = HighlightedText("\\begin{equation}\nx + y\n\\end{equation}")
        let line = document.lines.contentRange(ofLine: 1)

        let tokens = document.highlighter.tokens(in: line, of: document.text, lines: document.lines)

        #expect(tokens == [SyntaxToken(kind: .math, location: line.location, length: line.length)])
    }
}
