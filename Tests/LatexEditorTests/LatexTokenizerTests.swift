import Foundation
import Testing
@testable import LatexEditor

/// Tokenisiert eine Zeile und liefert lesbare Paare (Art, Text) plus Endzustand.
private func scan(_ line: String, from state: LexState = .normal) -> (tokens: [Pair], state: LexState) {
    let characters = Array(line.utf16)
    var tokens: [SyntaxToken] = []
    let endState = characters.withUnsafeBufferPointer {
        LatexTokenizer.tokenize($0, lineOffset: 0, from: state, into: &tokens)
    }
    let text = line as NSString
    return (tokens.map { Pair($0.kind, text.substring(with: $0.range)) }, endState)
}

private struct Pair: Equatable, CustomStringConvertible {
    let kind: TokenKind
    let text: String

    init(_ kind: TokenKind, _ text: String) {
        self.kind = kind
        self.text = text
    }

    var description: String { "\(kind)(\(text))" }
}

private let open = Pair(.delimiter, "{")
private let close = Pair(.delimiter, "}")

@Suite("LatexTokenizer")
struct LatexTokenizerTests {
    @Test("Prosa-Argumente bleiben ungefärbt, nur Klammern werden markiert")
    func proseArgument() {
        let result = scan("\\section{Ein Titel}")
        #expect(result.tokens == [Pair(.command, "\\section"), open, close])
        #expect(result.state == .normal)
    }

    @Test("Schlüssel-Argumente werden vollständig markiert, auch mit verschachtelten Klammern")
    func keyArgument() {
        #expect(scan("\\label{sec:x}").tokens == [Pair(.command, "\\label"), open, Pair(.keyArgument, "sec:x"), close])
        #expect(scan("\\cite{a{b}c}").tokens == [Pair(.command, "\\cite"), open, Pair(.keyArgument, "a{b}c"), close])
    }

    @Test("Optionales Argument vor Schlüssel-Argument")
    func optionalArgument() {
        let result = scan("\\includegraphics[width=0.8\\textwidth]{bild.pdf}")
        #expect(result.tokens == [
            Pair(.command, "\\includegraphics"),
            Pair(.delimiter, "["), Pair(.optionalArgument, "width=0.8\\textwidth"), Pair(.delimiter, "]"),
            open, Pair(.keyArgument, "bild.pdf"), close
        ])
    }

    @Test("Escapte Zeichen beginnen weder Kommentar noch Mathe")
    func escapedCharacters() {
        let result = scan("50\\% und 5\\$ sind \\{ok\\}")
        #expect(result.tokens == [
            Pair(.command, "\\%"), Pair(.command, "\\$"), Pair(.command, "\\{"), Pair(.command, "\\}")
        ])
        #expect(result.state == .normal)
    }

    @Test("Kommentar läuft bis zum Zeilenende, $ darin öffnet keine Mathe")
    func commentWithDollar() {
        let result = scan("Text % Kosten $5 und \\section{x}")
        #expect(result.tokens == [Pair(.comment, "% Kosten $5 und \\section{x}")])
        #expect(result.state == .normal)
    }

    @Test("Inline- und Display-Mathe in einer Zeile")
    func singleLineMath() {
        #expect(scan("a $x^2$ b").tokens == [Pair(.math, "$x^2$")])
        #expect(scan("$$x$$").tokens == [Pair(.math, "$$x$$")])
        #expect(scan("\\(x\\) und \\[y\\]").tokens == [Pair(.math, "\\(x\\)"), Pair(.math, "\\[y\\]")])
        #expect(scan("$a \\$ b$ c").tokens == [Pair(.math, "$a \\$ b$")])
    }

    @Test("Zeilenumbruch \\\\[2mm] ist keine Display-Mathe")
    func lineBreakWithSpacing() {
        let result = scan("Ende\\\\[2mm]")
        #expect(result.tokens == [
            Pair(.command, "\\\\"), Pair(.delimiter, "["), Pair(.optionalArgument, "2mm"), Pair(.delimiter, "]")
        ])
        #expect(result.state == .normal)
    }

    @Test("\\verb schützt seinen Inhalt vor Kommentar und Mathe")
    func verb() {
        #expect(scan("x \\verb|$x$ % kein| y").tokens == [Pair(.verbatim, "\\verb|$x$ % kein|")])
        #expect(scan("\\verb*+a b+").tokens == [Pair(.verbatim, "\\verb*+a b+")])
    }

    @Test("Mehrzeilige Mathe-Umgebung mit \\end in der Folgezeile")
    func mathEnvironment() {
        let begin = scan("\\begin{align*}")
        #expect(begin.tokens == [Pair(.command, "\\begin"), open, Pair(.keyArgument, "align*"), close])
        #expect(begin.state == .mathEnvironment("align*"))

        let body = scan("  a &= \\frac{1}{2} \\\\", from: begin.state)
        #expect(body.tokens == [Pair(.math, "  a &= \\frac{1}{2} \\\\")])
        #expect(body.state == .mathEnvironment("align*"))

        let end = scan("x \\end{align*} Text", from: body.state)
        #expect(end.tokens == [Pair(.math, "x "), Pair(.command, "\\end"), open, Pair(.keyArgument, "align*"), close])
        #expect(end.state == .normal)
    }

    @Test("Ein anderes \\end beendet die Mathe-Umgebung nicht")
    func nestedEnvironmentEnd() {
        let result = scan("\\end{split}", from: .mathEnvironment("equation"))
        #expect(result.tokens == [Pair(.math, "\\end{split}")])
        #expect(result.state == .mathEnvironment("equation"))
    }

    @Test("Verbatim-Umgebung ignoriert Kommentare und Mathe")
    func verbatimEnvironment() {
        let begin = scan("\\begin{lstlisting}[language=Swift]")
        #expect(begin.state == .verbatimEnvironment("lstlisting"))
        #expect(begin.tokens.last == Pair(.delimiter, "]"))

        let body = scan("let x = $y % z", from: begin.state)
        #expect(body.tokens == [Pair(.verbatim, "let x = $y % z")])

        let end = scan("\\end{lstlisting}", from: body.state)
        #expect(end.tokens == [Pair(.command, "\\end"), open, Pair(.keyArgument, "lstlisting"), close])
        #expect(end.state == .normal)
    }

    @Test("Kommentar in Mathe beendet die Mathe nicht")
    func commentInsideMath() {
        let result = scan("$a % b")
        #expect(result.tokens == [Pair(.math, "$a "), Pair(.comment, "% b")])
        #expect(result.state == .math(.dollar))
    }

    @Test("Leerzeile beendet offene Mathe, aber keine Verbatim-Umgebung")
    func blankLineResetsMath() {
        #expect(scan("", from: .math(.dollar)).state == .normal)
        #expect(scan("  \t", from: .mathEnvironment("equation")).state == .normal)
        #expect(scan("", from: .verbatimEnvironment("verbatim")).state == .verbatimEnvironment("verbatim"))
    }

    @Test("Unvollständige Konstrukte beim Tippen")
    func incompleteConstructs() {
        #expect(scan("\\sec").tokens == [Pair(.command, "\\sec")])
        #expect(scan("\\label{sec:").tokens == [Pair(.command, "\\label"), open, Pair(.keyArgument, "sec:")])
        #expect(scan("\\includegraphics[wid").tokens == [
            Pair(.command, "\\includegraphics"), Pair(.delimiter, "["), Pair(.optionalArgument, "wid")
        ])
        #expect(scan("\\verb|abc").tokens == [Pair(.verbatim, "\\verb|abc")])
        #expect(scan("\\verb").tokens == [Pair(.verbatim, "\\verb")])
        #expect(scan("Text\\").tokens == [Pair(.command, "\\")])

        let openMath = scan("Text $x + ")
        #expect(openMath.tokens == [Pair(.math, "$x + ")])
        #expect(openMath.state == .math(.dollar))

        let partialEnvironment = scan("\\begin{equ")
        #expect(partialEnvironment.state == .normal)
    }

    @Test("Kommentar innerhalb eines Schlüssel-Arguments wird erkannt")
    func commentInsideArgument() {
        let result = scan("\\label{a%b}")
        #expect(result.tokens == [Pair(.command, "\\label"), open, Pair(.keyArgument, "a"), Pair(.comment, "%b}")])
    }

    @Test("@ gehört zu Befehlsnamen (Paketcode)")
    func atInCommandName() {
        #expect(scan("\\@ifnextchar").tokens == [Pair(.command, "\\@ifnextchar")])
    }

    @Test("Positionen sind absolut und nutzen UTF-16 (Umlaute, Emoji)")
    func absoluteUTF16Offsets() {
        let characters = Array("Größe 😀 $x$".utf16)
        var tokens: [SyntaxToken] = []
        _ = characters.withUnsafeBufferPointer {
            LatexTokenizer.tokenize($0, lineOffset: 100, from: .normal, into: &tokens)
        }
        #expect(tokens == [SyntaxToken(kind: .math, location: 100 + 9, length: 3)])
    }
}
