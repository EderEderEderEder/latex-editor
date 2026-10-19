import AppKit
import Testing
@testable import LatexEditor

@Suite("Editor-Integration")
@MainActor
struct EditorIntegrationTests {
    @Test("Tippen hält Zeilenindex und Highlighter mit dem Text synchron")
    func editsKeepIndexInSync() {
        let fixture = EditorFixture(text: "Erste Zeile\nZweite Zeile\n")

        fixture.replace(NSRange(location: 0, length: 0), with: "\\section{A}\n$x")
        fixture.replace(NSRange(location: 5, length: 3), with: "")

        let text = fixture.session.textStorage.mutableString
        #expect(fixture.session.lineIndex == LineIndex(text: text))
        #expect(fixture.session.isDirty)
    }

    @Test("Bearbeitungen setzen Syntaxfarben im betroffenen Bereich")
    func editsApplyColors() {
        let fixture = EditorFixture(text: "Text\n")

        fixture.replace(NSRange(location: 0, length: 0), with: "\\label{x} % Notiz\n")

        #expect(fixture.color(at: 0) == SyntaxTheme.color(for: .command))
        #expect(fixture.color(at: 7) == SyntaxTheme.color(for: .keyArgument))
        #expect(fixture.color(at: 10) == SyntaxTheme.color(for: .comment))
        #expect(fixture.color(at: 18) == NSColor.textColor)
    }

    @Test("Beim Öffnen ist die ganze Datei eingefärbt")
    func initialColoring() {
        let fixture = EditorFixture(text: "a\n\\begin{equation}\nx = 1\n\\end{equation}\n")
        let mathLocation = fixture.session.lineIndex.start(ofLine: 2)

        #expect(fixture.color(at: 0) == NSColor.textColor)
        #expect(fixture.color(at: mathLocation) == SyntaxTheme.color(for: .math))
    }

    @Test("Rechtschreibfilter erkennt Syntax, Prosa-Argumente bleiben prüfbar")
    func spellingFilter() {
        let fixture = EditorFixture(text: "\\section{Einleitung} Text $x$ % Kommentar")
        fixture.textView.syntaxTokensProvider = { fixture.session.syntaxTokens(in: $0) }
        let text = fixture.session.textStorage.mutableString

        #expect(fixture.textView.isSyntax(text.range(of: "section")))
        #expect(!fixture.textView.isSyntax(text.range(of: "Einleitung")))
        #expect(!fixture.textView.isSyntax(text.range(of: "Text")))
        let math = text.range(of: "$x$")
        #expect(fixture.textView.isSyntax(NSRange(location: math.location + 1, length: 1)))
        #expect(fixture.textView.isSyntax(text.range(of: "Kommentar")))
    }

    @Test("Overlap-Suche in sortierten Tokens")
    func tokenOverlap() {
        let tokens = [
            SyntaxToken(kind: .command, location: 0, length: 4),
            SyntaxToken(kind: .math, location: 10, length: 5)
        ]
        #expect(tokens.containsOverlap(with: NSRange(location: 2, length: 1)))
        #expect(!tokens.containsOverlap(with: NSRange(location: 4, length: 6)))
        #expect(tokens.containsOverlap(with: NSRange(location: 8, length: 3)))
        #expect(!tokens.containsOverlap(with: NSRange(location: 15, length: 2)))
        #expect(![SyntaxToken]().containsOverlap(with: NSRange(location: 0, length: 1)))
    }
}

@Suite("Zeilennummern")
@MainActor
struct LineNumberRulerTests {
    private static let narrowSize = NSSize(width: 200, height: 400)

    @Test("Umbrochene Zeile bekommt nur eine Nummer")
    func wrappedLineHasOneNumber() {
        let longLine = String(repeating: "Wort ", count: 80)
        let fixture = EditorFixture(text: "kurz\n\(longLine)\nende", size: Self.narrowSize)

        let labels = fixture.labels(in: fixture.textView.bounds)

        #expect(labels.map(\.number) == [1, 2, 3])
        let wrappedHeight = labels[2].y - labels[1].y
        #expect(wrappedHeight > 3 * labels[1].height)
    }

    @Test("Leere Datei und abschließender Umbruch haben eine Nummer für die letzte Zeile")
    func emptyAndTrailingLines() {
        let empty = EditorFixture(text: "")
        #expect(empty.labels(in: empty.textView.bounds).map(\.number) == [1])

        let trailing = EditorFixture(text: "a\nb\n")
        #expect(trailing.labels(in: trailing.textView.bounds).map(\.number) == [1, 2, 3])
    }

    @Test("Nur sichtbare Zeilen werden berechnet")
    func onlyVisibleLines() {
        let fixture = EditorFixture(text: LargeDocument.make(lineCount: 2_000))
        let lineHeight = fixture.labels(in: NSRect(x: 0, y: 0, width: 600, height: 100))[0].height
        let visible = NSRect(x: 0, y: lineHeight * 500, width: 600, height: lineHeight * 40)

        let labels = fixture.labels(in: visible)

        #expect(labels.count <= 42)
        #expect((labels.first?.number ?? 0) > 400)
        #expect(labels.map(\.number) == Array(labels.first!.number...labels.last!.number))
    }

    @Test("Breite wächst mit der Stellenzahl")
    func thicknessFollowsDigits() {
        let small = EditorFixture(text: "a\nb")
        let large = EditorFixture(text: String(repeating: "\n", count: 12_000))
        small.ruler.refresh()
        large.ruler.refresh()

        #expect(large.ruler.ruleThickness > small.ruler.ruleThickness)
    }
}
