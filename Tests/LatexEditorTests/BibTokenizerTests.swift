import AppKit
import Testing
@testable import LatexEditor

private struct BibPair: Equatable, CustomStringConvertible {
    let kind: TokenKind
    let text: String

    init(_ kind: TokenKind, _ text: String) {
        self.kind = kind
        self.text = text
    }

    var description: String { "\(kind)(\(text))" }
}

/// Färbt einen ganzen `.bib`-Text und liefert die Tokens als lesbare Paare.
private func highlight(_ source: String) -> [BibPair] {
    let text = source as NSString
    var highlighter = SyntaxHighlighter(language: .bibtex)
    let tokens = highlighter.highlightAll(text, lines: LineIndex(text: text))
    return tokens.map { BibPair($0.kind, text.substring(with: $0.range)) }
}

/// Nur die Tokens ohne reine Leerzeichen-Kommentare (Leerzeilen zwischen Einträgen)
private func visible(_ pairs: [BibPair]) -> [BibPair] {
    pairs.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}

@Suite("BibTeX-Farben")
struct BibTokenizerTests {
    @Test("Typischer Eintrag: Typ, Schlüssel, Feldnamen, Klammern, Befehl im Wert; Werte und Zahlen bleiben Text")
    func typicalEntry() {
        let source = """
            @book{knuth1984,
            \tauthor = {Knuth, Donald},
            \ttitle = {The {\\TeX}book},
            \tyear = 1984,
            }
            """
        #expect(visible(highlight(source)) == [
            BibPair(.command, "@book"), BibPair(.delimiter, "{"), BibPair(.keyArgument, "knuth1984"),
            BibPair(.optionalArgument, "author"), BibPair(.delimiter, "="), BibPair(.delimiter, "{"), BibPair(.delimiter, "}"),
            BibPair(.optionalArgument, "title"), BibPair(.delimiter, "="), BibPair(.delimiter, "{"), BibPair(.delimiter, "{"),
            BibPair(.command, "\\TeX"), BibPair(.delimiter, "}"), BibPair(.delimiter, "}"),
            BibPair(.optionalArgument, "year"), BibPair(.delimiter, "="),
            BibPair(.delimiter, "}"),
        ])
    }

    @Test("Anführungszeichen, Verkettung mit #, @string-Makro und runde Eintragsklammern")
    func quotesAndMacros() {
        let source = """
            @string{jan = "Januar"}
            @misc(x1, month = jan # " 2024", note = "a {b} c")
            """
        #expect(visible(highlight(source)) == [
            BibPair(.command, "@string"), BibPair(.delimiter, "{"), BibPair(.optionalArgument, "jan"), BibPair(.delimiter, "="),
            BibPair(.delimiter, "\""), BibPair(.delimiter, "\""), BibPair(.delimiter, "}"),
            BibPair(.command, "@misc"), BibPair(.delimiter, "("), BibPair(.keyArgument, "x1"),
            BibPair(.optionalArgument, "month"), BibPair(.delimiter, "="), BibPair(.keyArgument, "jan"), BibPair(.delimiter, "#"),
            BibPair(.delimiter, "\""), BibPair(.delimiter, "\""),
            BibPair(.optionalArgument, "note"), BibPair(.delimiter, "="), BibPair(.delimiter, "\""), BibPair(.delimiter, "{"),
            BibPair(.delimiter, "}"), BibPair(.delimiter, "\""), BibPair(.delimiter, ")"),
        ])
    }

    @Test("Text außerhalb von Einträgen und @comment sind Kommentar, auch mit verschachtelten Klammern")
    func commentsOutsideEntries() {
        let source = "% Literatur\nFreier Text\n@comment{ein {Kommentar} hier}\n@book{a,}"
        let pairs = visible(highlight(source))
        #expect(pairs.prefix(5) == [
            BibPair(.comment, "% Literatur"), BibPair(.comment, "Freier Text"),
            BibPair(.command, "@comment"), BibPair(.delimiter, "{"), BibPair(.comment, "ein {Kommentar} hier"),
        ])
        #expect(pairs.suffix(4) == [
            BibPair(.command, "@book"), BibPair(.delimiter, "{"), BibPair(.keyArgument, "a"), BibPair(.delimiter, "}"),
        ])
    }

    @Test("% bis zum Zeilenende ist Kommentar: auskommentierte Einträge und Felder; im Wert bleibt es Text")
    func percentComments() {
        let source = """
            % @book{alt,
            %   title = {Alt},
            % }
            @book{neu, % Schlüssel
            	% note = {weg},
            	title = {50 % und \\% hier},
            }
            """
        #expect(visible(highlight(source)) == [
            BibPair(.comment, "% @book{alt,"), BibPair(.comment, "%   title = {Alt},"), BibPair(.comment, "% }"),
            BibPair(.command, "@book"), BibPair(.delimiter, "{"), BibPair(.keyArgument, "neu"), BibPair(.comment, "% Schlüssel"),
            BibPair(.comment, "% note = {weg},"),
            BibPair(.optionalArgument, "title"), BibPair(.delimiter, "="), BibPair(.delimiter, "{"), BibPair(.command, "\\%"),
            BibPair(.delimiter, "}"),
            BibPair(.delimiter, "}"),
        ])
    }

    @Test("Mehrzeilige Werte: Der Zustand trägt Klammertiefe und Phase in die nächste Zeile")
    func multilineValue() {
        let source = "@article{k,\n  title = {Ein langer\n  Titel mit {Klammer}\n  über drei Zeilen},\n  year = {2024}\n}"
        let text = source as NSString
        var highlighter = SyntaxHighlighter(language: .bibtex)
        _ = highlighter.highlightAll(text, lines: LineIndex(text: text))
        guard case let .bibtex(afterTitleStart) = highlighter.endStates[1] else {
            Issue.record("Kein BibTeX-Zustand")
            return
        }
        #expect(afterTitleStart.phase == .value && afterTitleStart.depth == 2)
        #expect(highlighter.endStates[5] == .bibtex(BibLexState()), "Nach dem Eintrag wieder außerhalb")

        let pairs = visible(highlight(source))
        #expect(!pairs.contains { $0.text.contains("Titel") || $0.text.contains("Zeilen") }, "Wert bleibt Fließtext")
        #expect(pairs.contains(BibPair(.optionalArgument, "year")))
    }

    @Test("Kaputter Eintrag (offenes Anführungszeichen) endet an der Eintragsklammer, der nächste wird erkannt")
    func brokenEntryRecovers() {
        let source = "@book{a, title = \"offen}\n@book{b, year = 1}"
        let pairs = visible(highlight(source))
        #expect(pairs.contains(BibPair(.keyArgument, "b")))
        #expect(pairs.contains(BibPair(.optionalArgument, "year")))
    }

    @Test("Zufällige Bearbeitungen: inkrementell gleich komplett neu berechnet")
    func randomEditsMatchFullHighlight() {
        let entry = "@book{key%d,\n\tauthor = {Nach, Vor and Zwei, Name},\n\ttitle = {Titel {\\LaTeX} %d},\n\tyear = %d,\n}\n\n"
        let source = (0..<120).map { String(format: entry, $0, $0, 2000 + $0) }.joined()
        let text = NSMutableString(string: source)
        var lines = LineIndex(text: text)
        var highlighter = SyntaxHighlighter(language: .bibtex)
        _ = highlighter.highlightAll(text, lines: lines)
        var generator = SeededGenerator(seed: 11)
        let snippets = ["", "{", "}", "\"", ",", "=", "@book{", "@comment{", "\n", "#", "x", "\\emph{", "(", ")", "% "]
        for _ in 0..<500 {
            let location = Int.random(in: 0...text.length, using: &generator)
            let length = Int.random(in: 0...min(text.length - location, 30), using: &generator)
            let snippet = snippets.randomElement(using: &generator) ?? ""
            let edit = replace(text, range: NSRange(location: location, length: length), with: snippet)
            let splice = lines.applyEdit(in: text, editedRange: edit.editedRange, changeInLength: edit.delta)
            _ = highlighter.update(text, lines: lines, splice: splice)
        }
        var fresh = SyntaxHighlighter(language: .bibtex)
        let freshTokens = fresh.highlightAll(text, lines: LineIndex(text: text))

        #expect(highlighter.endStates == fresh.endStates)
        #expect(highlighter.tokens(in: NSRange(location: 0, length: text.length), of: text, lines: lines) == freshTokens)
    }

    @Test("Sprache nach Endung; .tex bleibt LaTeX")
    func languageFromExtension() {
        #expect(SyntaxLanguage(url: URL(fileURLWithPath: "/p/hgbreferences.bib")) == .bibtex)
        #expect(SyntaxLanguage(url: URL(fileURLWithPath: "/p/Literatur.BIB")) == .bibtex)
        #expect(SyntaxLanguage(url: URL(fileURLWithPath: "/p/main.tex")) == .latex)
    }
}

@Suite("BibTeX-Farben in der Sitzung")
@MainActor
struct BibSessionTests {
    @Test("Eine .bib-Sitzung färbt Feldnamen; nach Umbenennen in .tex gelten die LaTeX-Farben")
    func sessionUsesBibColors() throws {
        let session = DocumentSession(url: URL(fileURLWithPath: "/tmp/demo.bib"), text: "@book{k, title = {T}}")
        let fieldColor = session.textStorage.attribute(.foregroundColor, at: 9, effectiveRange: nil) as? NSColor
        #expect(fieldColor == SyntaxTheme.color(for: .optionalArgument), "„title“ ist ein Feldname")

        session.relocate(to: URL(fileURLWithPath: "/tmp/demo.tex"))
        let afterRename = session.textStorage.attribute(.foregroundColor, at: 9, effectiveRange: nil) as? NSColor
        #expect(afterRename == NSColor.textColor, "In LaTeX ist das Fließtext")
        #expect(!session.isDirty)
    }
}
